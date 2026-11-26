"""Plan export endpoint against the real Supabase project: access, version choice, audit event, failures.

Maps to the acceptance criteria in specs/plan-export.md section 8.
"""

import copy
import io
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from tests.conftest import needs_supabase
from tests.test_export_layout import empty, room
from tests.test_geometry import VALID

pytestmark = needs_supabase

MAGIC = {"pdf": b"%PDF-", "png": b"\x89PNG\r\n", "dxf": b"  0\nSECTION"}
MEDIA = {"pdf": "application/pdf", "png": "image/png", "dxf": "image/vnd.dxf"}


def two_rooms():
    raw = copy.deepcopy(VALID)
    empty(raw)
    room(raw, "r1", "Living room", 0, 0, 500, 400)
    room(raw, "r2", "Bedroom", 500, 0, 350, 400)
    return raw


@pytest.fixture(scope="module")
def world(api, make_user):
    designer_a, client_a, other_client_a, designer_b, client_b = (
        make_user(p) for p in ("exp-d-a", "exp-c-a", "exp-c2-a", "exp-d-b", "exp-c-b")
    )
    studio_a = api.post("/v1/studios", json={"name": "Export A"}, headers=designer_a.headers).json()["data"]
    studio_b = api.post("/v1/studios", json={"name": "Export B"}, headers=designer_b.headers).json()["data"]

    def project(user, studio, name):
        body = {"studio_id": studio["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]

    def save(user, project, geometry, label=""):
        url = f"/v1/projects/{project['id']}/versions"
        return api.post(url, json={"label": label, "geometry": geometry}, headers=user.headers).json()["data"]

    project_a = project(client_a, studio_a, "Flat A")
    v1 = save(client_a, project_a, VALID, "first")
    v2 = save(designer_a, project_a, two_rooms(), "designer layout")
    other_project_a = project(other_client_a, studio_a, "Neighbour")
    other_v1 = save(other_client_a, other_project_a, VALID)
    project_b = project(client_b, studio_b, "Flat B")
    v_b = save(client_b, project_b, VALID)
    return SimpleNamespace(**{k: v for k, v in locals().items() if k not in ("project", "save")})


def url(project, version):
    return f"/v1/projects/{project['id']}/versions/{version['id']}/export"


def export_events(admin, project_id):
    return (
        admin.table("audit_events").select("*").eq("project_id", project_id).eq("action", "plan.exported")
        .order("id", desc=True).execute().data
    )


# ---- authorized exports ------------------------------------------------------------------------------------------


@pytest.mark.parametrize("fmt", ["pdf", "png", "dxf"])
@pytest.mark.parametrize("who", ["client_a", "designer_a"])
def test_client_and_designer_export_every_format(api, world, admin, fmt, who):
    user = getattr(world, who)
    before = len(export_events(admin, world.project_a["id"]))
    response = api.post(url(world.project_a, world.v2), json={"format": fmt, "paper": "a4"}, headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.content.startswith(MAGIC[fmt])
    assert response.headers["content-type"].startswith(MEDIA[fmt])
    assert response.headers["content-disposition"] == f'attachment; filename="flat-a-v2.{fmt}"'
    assert response.headers["cache-control"] == "no-store"

    events = export_events(admin, world.project_a["id"])
    assert len(events) == before + 1
    event = events[0]
    assert event["actor_id"] == user.id
    assert event["studio_id"] == world.studio_a["id"]
    role = "designer" if who == "designer_a" else "client"
    # Metadata only: no geometry, no names, no file contents.
    assert event["metadata"] == {"version_no": 2, "format": fmt, "actor_role": role}
    assert abs(datetime.fromisoformat(event["created_at"]) - datetime.now(UTC)) < timedelta(minutes=1)


def test_earlier_version_can_be_exported(api, world):
    import ezdxf.recover

    def walls(version):
        response = api.post(url(world.project_a, version), json={"format": "dxf"}, headers=world.client_a.headers)
        doc, _ = ezdxf.recover.read(io.BytesIO(response.content))
        return len([e for e in doc.modelspace() if e.dxf.layer == "WALLS"])

    assert walls(world.v1) == 3  # VALID: one wall split by its door, one partition
    assert walls(world.v2) == 8  # two rooms, no openings


def test_export_appears_in_studio_activity_as_a_role(api, world):
    api.post(url(world.project_a, world.v1), json={"format": "pdf", "paper": "a3"}, headers=world.client_a.headers)
    events = api.get(f"/v1/studios/{world.studio_a['id']}/audit", headers=world.designer_a.headers).json()["data"]
    latest = events[0]
    assert latest["action"] == "plan.exported"
    assert latest["metadata"] == {"version_no": 1, "format": "pdf", "actor_role": "client"}
    assert latest["project"] == {"name": "Flat A"}


def test_exporting_changes_no_version(api, world):
    versions = f"/v1/projects/{world.project_a['id']}/versions"
    before = api.get(versions, headers=world.client_a.headers).json()["data"]
    for fmt in ("pdf", "png", "dxf"):
        api.post(url(world.project_a, world.v1), json={"format": fmt}, headers=world.client_a.headers)
    assert api.get(versions, headers=world.client_a.headers).json()["data"] == before


def test_each_repeated_export_is_recorded_once(api, world, admin):
    before = len(export_events(admin, world.project_a["id"]))
    for _ in range(3):
        assert api.post(url(world.project_a, world.v1), json={"format": "dxf"}, headers=world.client_a.headers).status_code == 200
    assert len(export_events(admin, world.project_a["id"])) == before + 3


def test_suspended_studio_still_exports(api, world, admin):
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio_b["id"]).execute()
    try:
        response = api.post(url(world.project_b, world.v_b), json={"format": "pdf"}, headers=world.client_b.headers)
        assert response.status_code == 200 and response.content.startswith(MAGIC["pdf"])
        assert export_events(admin, world.project_b["id"])[0]["metadata"]["format"] == "pdf"
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio_b["id"]).execute()


# ---- access ------------------------------------------------------------------------------------------------------


def test_no_export_without_access(api, world, admin):
    before = {p: len(export_events(admin, p)) for p in (world.project_a["id"], world.project_b["id"], world.other_project_a["id"])}
    cases = [
        (world.other_client_a, world.project_a, world.v1),  # another client of the same studio
        (world.designer_b, world.project_a, world.v1),  # a designer of another studio
        (world.client_b, world.project_a, world.v1),  # a client of another studio
        (world.client_a, world.project_a, world.v_b),  # a version of another studio's project
        (world.client_a, world.project_a, world.other_v1),  # a version of another project in the same studio
        (world.client_b, world.project_b, world.v1),  # own project, someone else's version id
        (world.designer_a, world.project_b, world.v_b),  # own studio's designer, other studio's project
    ]
    for user, project, version in cases:
        response = api.post(url(project, version), json={"format": "pdf"}, headers=user.headers)
        assert response.status_code == 404, (user.email, response.text)
        assert response.json()["success"] is False
    after = {p: len(export_events(admin, p)) for p in before}
    assert after == before


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-token"}])
def test_export_requires_sign_in(api, world, headers):
    assert api.post(url(world.project_a, world.v1), json={"format": "pdf"}, headers=headers).status_code == 401


def test_unknown_or_malformed_ids(api, world):
    headers = world.client_a.headers
    missing = "00000000-0000-4000-8000-000000000000"
    assert api.post(f"/v1/projects/{world.project_a['id']}/versions/{missing}/export", json={"format": "pdf"}, headers=headers).status_code == 404
    assert api.post(f"/v1/projects/{missing}/versions/{world.v1['id']}/export", json={"format": "pdf"}, headers=headers).status_code == 404
    assert api.post(f"/v1/projects/not-a-uuid/versions/{world.v1['id']}/export", json={"format": "pdf"}, headers=headers).status_code == 422
    assert api.post(f"/v1/projects/{world.project_a['id']}/versions/latest/export", json={"format": "pdf"}, headers=headers).status_code == 422


@pytest.mark.parametrize("body", [{}, {"format": "svg"}, {"format": "pdf", "paper": "a5"}, {"format": "pdf", "geometry": VALID},
                                  {"format": "PDF"}, {"format": None}])
def test_invalid_export_request(api, world, body):
    response = api.post(url(world.project_a, world.v1), json=body, headers=world.client_a.headers)
    assert response.status_code == 422


# ---- failures ----------------------------------------------------------------------------------------------------


@pytest.fixture
def quiet_api():
    """Turns unhandled errors into the app's 500 response instead of raising them in the test."""
    from app.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_failed_generation_is_not_recorded(quiet_api, world, admin, monkeypatch):
    from app.routes import exports

    def broken(*_):
        raise RuntimeError("renderer crashed")

    monkeypatch.setattr(exports, "render", broken)
    before = len(export_events(admin, world.project_a["id"]))
    response = quiet_api.post(url(world.project_a, world.v1), json={"format": "pdf"}, headers=world.client_a.headers)
    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert len(export_events(admin, world.project_a["id"])) == before


def test_no_file_when_the_audit_record_fails(quiet_api, world, monkeypatch):
    from app.routes import exports

    def failing_audit(*_, **__):
        raise RuntimeError("audit insert failed")

    monkeypatch.setattr(exports, "audit", failing_audit)
    response = quiet_api.post(url(world.project_a, world.v1), json={"format": "pdf"}, headers=world.client_a.headers)
    assert response.status_code == 500
    assert not response.content.startswith(MAGIC["pdf"])


def test_malformed_stored_version_is_refused(api, world, admin):
    broken = copy.deepcopy(VALID)
    broken["openings"][0]["wallId"] = "no-such-wall"
    row = admin.table("plan_versions").insert({
        "project_id": world.other_project_a["id"], "version_no": 99, "label": "", "author_id": world.other_client_a.id,
        "author_role": "client", "geometry": broken,
    }).execute().data[0]
    response = api.post(url(world.other_project_a, row), json={"format": "dxf"}, headers=world.other_client_a.headers)
    assert response.status_code == 422
    assert export_events(admin, world.other_project_a["id"]) == []


def test_too_many_exports_at_once(api, world, admin):
    from app.routes import exports

    held = [exports.SLOTS.acquire(blocking=False) for _ in range(exports.MAX_PARALLEL_EXPORTS)]
    try:
        assert all(held)
        before = len(export_events(admin, world.project_a["id"]))
        response = api.post(url(world.project_a, world.v1), json={"format": "png"}, headers=world.client_a.headers)
        assert response.status_code == 429
        assert len(export_events(admin, world.project_a["id"])) == before
    finally:
        for _ in held:
            exports.SLOTS.release()
    assert api.post(url(world.project_a, world.v1), json={"format": "png"}, headers=world.client_a.headers).status_code == 200
