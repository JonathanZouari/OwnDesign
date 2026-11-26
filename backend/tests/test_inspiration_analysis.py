"""Inspiration image analysis and the style profile: API, failure paths, isolation. The detector is a fake;
the palette is computed for real from the uploaded bytes."""

import io
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from app import vision
from tests.conftest import needs_supabase

pytestmark = needs_supabase

ROOM_JPG = (Path(__file__).parent / "fixtures" / "room.jpg").read_bytes()
SOFA = {"label": "Sofa", "category": "seating", "confidence": 0.917, "box": [0.1, 0.4, 0.6, 0.3],
        "color_hex": "#c8b8a8", "color_name": "beige", "position": "centre"}
PLANT = {**SOFA, "label": "Plant", "category": "plants", "confidence": 0.6}


def solid(colour, size=(120, 90)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, "PNG")
    return buffer.getvalue()


class FakeDetector:
    def __init__(self):
        self.found, self.busy, self.calls = [SOFA], False, 0

    def detect(self, img):
        self.calls += 1
        if self.busy:
            raise vision.DetectorBusy("busy")
        return list(self.found)


@pytest.fixture()
def fake():
    from app.main import app  # not at module level: collection must work without Supabase settings (CI)

    detector = FakeDetector()
    app.dependency_overrides[vision.get_detector] = lambda: detector
    yield detector
    app.dependency_overrides.pop(vision.get_detector, None)


@pytest.fixture(scope="module")
def world(api, make_user):
    designer, client, other_client, designer_b = (make_user(p) for p in ("ia-d", "ia-c", "ia-c2", "ia-db"))
    studio = api.post("/v1/studios", json={"name": "Inspiration Studio"}, headers=designer.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Inspiration Studio B"}, headers=designer_b.headers)

    def project(user, name):
        body = {"studio_id": studio["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]

    return SimpleNamespace(designer=designer, client=client, other_client=other_client, designer_b=designer_b,
                           studio_id=studio["id"], project_fn=project)


def upload(api, user, pid, data=ROOM_JPG, kind="inspiration", name="i.jpg", mime="image/jpeg"):
    return api.post(f"/v1/projects/{pid}/assets", files={"file": (name, data, mime)}, data={"kind": kind}, headers=user.headers)


def assets(api, user, pid):
    return api.get(f"/v1/projects/{pid}/assets", headers=user.headers).json()["data"]


def profile(api, user, pid):
    return api.get(f"/v1/projects/{pid}/style-profile", headers=user.headers)


def reanalyse(api, user, pid, asset_id):
    return api.post(f"/v1/projects/{pid}/assets/{asset_id}/analysis", headers=user.headers)


def test_inspiration_upload_is_analysed_and_listed(api, world, fake):
    pid = world.project_fn(world.client, "Analysed")["id"]
    created = upload(api, world.client, pid, solid((200, 30, 30)))
    assert created.status_code == 201, created.text
    analysis = created.json()["data"]["analysis"]
    assert analysis["objects"] == [{"label": "Sofa", "category": "seating", "confidence": 0.917}]
    assert analysis["palette"][0]["name"] == "red" and analysis["palette"][0]["share"] == 1.0
    [listed] = assets(api, world.designer, pid)
    assert listed["analysis"]["palette"] == analysis["palette"] and "storage_path" not in listed


def test_existing_item_photos_are_not_analysed(api, world, fake):
    pid = world.project_fn(world.client, "Owned")["id"]
    created = upload(api, world.client, pid, kind="existing_item").json()["data"]
    assert created["analysis"] is None and fake.calls == 0
    assert reanalyse(api, world.client, pid, created["id"]).status_code == 422


@pytest.mark.parametrize("trouble", ["busy", "no_model"])
def test_upload_succeeds_when_analysis_fails_and_can_be_repeated(api, world, fake, trouble):
    from app.main import app

    pid = world.project_fn(world.client, f"Later {trouble}")["id"]
    if trouble == "busy":
        fake.busy = True
    else:
        app.dependency_overrides[vision.get_detector] = lambda: None
    created = upload(api, world.client, pid)
    assert created.status_code == 201 and created.json()["data"]["analysis"] is None
    assert assets(api, world.client, pid)[0]["analysis"] is None
    assert reanalyse(api, world.client, pid, created.json()["data"]["id"]).status_code == 503

    app.dependency_overrides[vision.get_detector] = lambda: fake
    fake.busy = False
    again = reanalyse(api, world.client, pid, created.json()["data"]["id"])
    assert again.status_code == 200 and again.json()["data"]["objects"][0]["label"] == "Sofa"
    assert assets(api, world.client, pid)[0]["analysis"] is not None


def test_reanalysis_replaces_the_previous_result_and_parallel_runs_keep_one_row(api, world, fake, admin):
    pid = world.project_fn(world.client, "Again")["id"]
    asset_id = upload(api, world.client, pid).json()["data"]["id"]
    fake.found = [PLANT]
    with ThreadPoolExecutor(4) as pool:
        codes = list(pool.map(lambda _: reanalyse(api, world.client, pid, asset_id).status_code, range(4)))
    assert set(codes) <= {200, 503} and 200 in codes
    rows = admin.table("asset_analyses").select("objects").eq("asset_id", asset_id).execute().data
    assert len(rows) == 1 and rows[0]["objects"][0]["label"] == "Plant"


def test_reanalysis_of_unknown_or_foreign_images_is_404(api, world, fake):
    pid = world.project_fn(world.client, "Mine")["id"]
    other_pid = world.project_fn(world.other_client, "Theirs")["id"]
    foreign = upload(api, world.other_client, other_pid).json()["data"]["id"]
    assert reanalyse(api, world.client, pid, foreign).status_code == 404
    assert reanalyse(api, world.client, pid, "00000000-0000-0000-0000-000000000000").status_code == 404
    assert reanalyse(api, world.client, pid, "not-a-uuid").status_code == 422


def test_style_profile_empty_then_built_from_images_then_shrinks_on_delete(api, world, fake):
    pid = world.project_fn(world.client, "Profile")["id"]
    assert profile(api, world.client, pid).json()["data"] == {"analysed": 0, "total": 0, "palette": [], "categories": []}
    first = upload(api, world.client, pid, solid((245, 245, 242))).json()["data"]["id"]
    fake.found = [PLANT]
    upload(api, world.client, pid, solid((60, 135, 70)))
    data = profile(api, world.designer, pid).json()["data"]
    assert (data["analysed"], data["total"]) == (2, 2)
    assert {c["name"] for c in data["palette"]} == {"white", "green"}
    assert {c["category"]: c["images"] for c in data["categories"]} == {"seating": 1, "plants": 1}

    assert api.delete(f"/v1/projects/{pid}/assets/{first}", headers=world.client.headers).status_code == 200
    data = profile(api, world.client, pid).json()["data"]
    assert (data["analysed"], data["total"]) == (1, 1) and [c["name"] for c in data["palette"]] == ["green"]


def test_isolation_of_analyses_and_profile(api, world, fake, admin):
    from postgrest.exceptions import APIError
    from supabase import create_client

    from app.db import settings

    pid = world.project_fn(world.client, "Private")["id"]
    asset_id = upload(api, world.client, pid).json()["data"]["id"]
    for stranger in (world.other_client, world.designer_b):
        assert profile(api, stranger, pid).status_code == 404
        assert reanalyse(api, stranger, pid, asset_id).status_code == 404

    def as_user(user):
        client = create_client(settings().supabase_url, settings().supabase_publishable_key)
        client.postgrest.auth(user.token)
        return client

    assert as_user(world.client).table("asset_analyses").select("asset_id").eq("project_id", pid).execute().data
    for stranger in (world.other_client, world.designer_b):
        assert as_user(stranger).table("asset_analyses").select("asset_id").eq("project_id", pid).execute().data == []
    client = as_user(world.client)
    for write in (
        lambda: client.table("asset_analyses").update({"model": "x"}).eq("project_id", pid).execute(),
        lambda: client.table("asset_analyses").delete().eq("project_id", pid).execute(),
        lambda: client.table("asset_analyses").insert({"asset_id": asset_id, "project_id": pid, "palette": [], "model": "x"}).execute(),
    ):
        with pytest.raises(APIError) as denied:
            write()
        assert denied.value.code == "42501"
    # The database refuses an analysis of an item photo even from the service role.
    item_photo = upload(api, world.client, pid, kind="existing_item").json()["data"]["id"]
    with pytest.raises(APIError) as refused:
        admin.table("asset_analyses").insert({"asset_id": item_photo, "project_id": pid, "palette": [{"hex": "#000000", "name": "black", "share": 1}], "model": "x"}).execute()
    assert refused.value.code == "P0001"


def test_suspended_studio_blocks_reanalysis_but_not_reading(api, world, fake, admin):
    pid = world.project_fn(world.client, "Suspended")["id"]
    asset_id = upload(api, world.client, pid).json()["data"]["id"]
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio_id).execute()
    try:
        assert reanalyse(api, world.client, pid, asset_id).status_code == 403
        assert profile(api, world.client, pid).status_code == 200
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio_id).execute()


def test_signed_out_callers_are_refused(api, world):
    pid = world.project_fn(world.client, "Anon")["id"]
    assert api.get(f"/v1/projects/{pid}/style-profile").status_code == 401
    assert api.post(f"/v1/projects/{pid}/assets/00000000-0000-0000-0000-000000000000/analysis").status_code == 401


def test_consultant_context_includes_the_style_profile(api, world, fake):
    from supabase import create_client

    from app.auth import CurrentUser
    from app.db import settings
    from app.routes.consultant import _context

    pid = world.project_fn(world.client, "Consult")["id"]
    fake.found = [PLANT]
    upload(api, world.client, pid, solid((60, 135, 70)))
    project = api.get(f"/v1/projects/{pid}", headers=world.client.headers).json()["data"]
    db = create_client(settings().supabase_url, settings().supabase_publishable_key)
    db.postgrest.auth(world.client.token)
    context = _context(CurrentUser(id=world.client.id, email=world.client.email, db=db), project)
    assert "inspiration_profile" in context and "green" in context and "plants" in context
