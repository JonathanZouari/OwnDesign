"""Integration tests against a real Supabase project (reads backend/.env).

They create throw-away users and studios and delete them afterwards.
Covers PRD acceptance scenarios 2 (save/reload geometry), 6 (designer sees the
client's plan) and 7 (Studio A cannot read or mutate Studio B's records, through
the API or directly against the Data API).
"""

from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase
from tests.test_geometry import VALID

pytestmark = needs_supabase


@pytest.fixture(scope="module")
def world(api, make_user):
    """Studio A (designer + client with a saved plan) and an unrelated Studio B."""
    designer_a, client_a, designer_b, client_b = (make_user(p) for p in ("designer-a", "client-a", "designer-b", "client-b"))
    studio_a = api.post("/v1/studios", json={"name": "Studio A"}, headers=designer_a.headers).json()["data"]
    studio_b = api.post("/v1/studios", json={"name": "Studio B"}, headers=designer_b.headers).json()["data"]
    project_a = api.post(
        "/v1/projects",
        json={"studio_id": studio_a["id"], "name": "Flat A", "property_type": "existing"},
        headers=client_a.headers,
    ).json()["data"]
    version_a = api.post(
        f"/v1/projects/{project_a['id']}/versions", json={"label": "first", "geometry": VALID}, headers=client_a.headers
    ).json()["data"]
    project_b = api.post(
        "/v1/projects",
        json={"studio_id": studio_b["id"], "name": "Flat B", "property_type": "new_build"},
        headers=client_b.headers,
    ).json()["data"]
    return SimpleNamespace(**locals())


def test_health(api):
    assert api.get("/health").json() == {"success": True, "data": {"status": "ok"}, "error": None}


def test_project_share_lifecycle(api, world, make_user):
    guest = make_user("sharing")
    studio_id = world.studio_a["id"]
    api.post("/v1/projects", headers=guest.headers, json={"studio_id": studio_id, "name": "Guest plan", "property_type": "existing"}).raise_for_status()
    target = api.post("/v1/projects", headers=world.designer_a.headers, json={"studio_id": studio_id, "name":"Sharing fixture", "property_type":"existing"}).json()["data"]
    path = f"/v1/projects/{target['id']}"
    api.post(path + "/versions", headers=world.designer_a.headers, json={"geometry":VALID}).raise_for_status()
    choice = {"client_id": guest.id, "permission": "view"}
    assert api.get(path, headers=guest.headers).status_code == 404
    assert api.put(path + "/share", headers=world.designer_b.headers, json=choice).status_code == 404
    api.put(path + "/share", headers=world.designer_a.headers, json=choice).raise_for_status()
    assert api.get(path, headers=guest.headers).json()["data"]["access"] == "view"
    assert api.get(path + "/versions/latest", headers=guest.headers).status_code == 200
    assert api.post(path + "/versions", headers=guest.headers, json={"geometry": VALID}).status_code == 403
    assert api.put(path + "/share", headers=guest.headers, json={**choice, "permission": "save"}).status_code == 403
    api.put(path + "/share", headers=world.designer_a.headers, json={**choice,"permission":"save"}).raise_for_status()
    assert api.post(path + "/versions", headers=guest.headers, json={"geometry":VALID}).json()["data"]["author_role"] == "client"
    api.put(path + "/share", headers=world.designer_a.headers, json={**choice,"permission":"remove"}).raise_for_status()
    assert api.get(path + "/versions/latest", headers=guest.headers).status_code == 404


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-token"}])
def test_requires_valid_session(api, headers):
    for path in ("/v1/me", "/v1/projects"):
        response = api.get(path, headers=headers)
        assert response.status_code == 401
        assert response.json()["success"] is False


def test_studio_owner_and_public_lookup(api, world):
    me = api.get("/v1/me", headers=world.designer_a.headers).json()["data"]
    assert [(m["role"], m["studio"]["id"]) for m in me["memberships"]] == [("owner", world.studio_a["id"])]
    public = api.get(f"/v1/studios/by-slug/{world.studio_a['slug']}").json()["data"]
    assert public == {"id": world.studio_a["id"], "name": "Studio A", "slug": world.studio_a["slug"]}
    assert api.post("/v1/studios", json={"name": "Second"}, headers=world.designer_a.headers).status_code == 409


def test_plan_saves_reloads_and_tracks_author(api, world):
    base = f"/v1/projects/{world.project_a['id']}"
    assert world.version_a["version_no"] == 1 and world.version_a["author_role"] == "client"

    # The designer of the same studio sees the client's project and plan.
    seen = api.get(base, headers=world.designer_a.headers).json()["data"]
    assert seen["my_role"] == "designer" and seen["client_email"] == world.client_a.email
    assert api.get(f"{base}/versions/latest", headers=world.designer_a.headers).json()["data"]["geometry"] == VALID

    revised = {**VALID, "furniture": [{**VALID["furniture"][0], "x": 250}]}
    saved = api.post(f"{base}/versions", json={"label": "designer pass", "geometry": revised}, headers=world.designer_a.headers)
    assert saved.status_code == 201 and saved.json()["data"]["author_role"] == "designer"

    versions = api.get(f"{base}/versions", headers=world.client_a.headers).json()["data"]
    assert [(v["version_no"], v["author_role"]) for v in versions] == [(2, "designer"), (1, "client")]
    assert api.get(f"{base}/versions/latest", headers=world.client_a.headers).json()["data"]["geometry"] == revised
    # Earlier versions stay inspectable and unchanged.
    first = api.get(f"{base}/versions/{world.version_a['id']}", headers=world.client_a.headers).json()["data"]
    assert first["geometry"] == VALID


def test_invalid_geometry_is_rejected(api, world):
    base = f"/v1/projects/{world.project_a['id']}"
    before = len(api.get(f"{base}/versions", headers=world.client_a.headers).json()["data"])
    broken = {**VALID, "openings": [{**VALID["openings"][0], "wallId": "missing"}]}
    response = api.post(f"{base}/versions", json={"geometry": broken}, headers=world.client_a.headers)
    assert response.status_code == 422 and response.json()["success"] is False
    assert len(api.get(f"{base}/versions", headers=world.client_a.headers).json()["data"]) == before


@pytest.mark.parametrize("outsider", ["designer_b", "client_b"])
def test_other_studio_cannot_use_api(api, world, outsider):
    headers = getattr(world, outsider).headers
    base = f"/v1/projects/{world.project_a['id']}"
    assert api.get(base, headers=headers).status_code == 404
    assert api.get(f"{base}/versions", headers=headers).status_code == 404
    assert api.get(f"{base}/versions/latest", headers=headers).status_code == 404
    assert api.get(f"{base}/versions/{world.version_a['id']}", headers=headers).status_code == 404
    assert api.post(f"{base}/versions", json={"geometry": VALID}, headers=headers).status_code == 404
    listed = api.get("/v1/projects", params={"studio_id": world.studio_a["id"]}, headers=headers).json()["data"]
    assert listed == []
    assert api.get(f"/v1/studios/{world.studio_a['id']}/invites", headers=headers).status_code == 403
    invite = {"client_email": "x@example.com", "client_name": "X"}
    assert api.post(f"/v1/studios/{world.studio_a['id']}/invites", json=invite, headers=headers).status_code == 403


@pytest.mark.parametrize("outsider", ["designer_b", "client_b"])
def test_other_studio_cannot_read_data_api_directly(world, outsider):
    from app.db import user_client

    db = user_client(getattr(world, outsider).token)
    studio_id, project_id = world.studio_a["id"], world.project_a["id"]
    assert db.table("projects").select("id").eq("id", project_id).execute().data == []
    assert db.table("plan_versions").select("id").eq("project_id", project_id).execute().data == []
    assert db.table("studios").select("id").eq("id", studio_id).execute().data == []
    assert db.table("studio_memberships").select("user_id").eq("studio_id", studio_id).execute().data == []
    assert db.table("studio_invites").select("id").eq("studio_id", studio_id).execute().data == []
    assert db.table("audit_events").select("id").eq("studio_id", studio_id).execute().data == []


def test_nobody_can_write_data_api_directly(world):
    """Even on their own project, users cannot bypass backend validation or forge history."""
    from postgrest.exceptions import APIError

    from app.db import user_client

    db = user_client(world.client_a.token)
    project_id = world.project_a["id"]
    forged = {"project_id": project_id, "version_no": 99, "author_role": "designer", "geometry": {"junk": True}}
    with pytest.raises(APIError):
        db.table("plan_versions").insert(forged).execute()
    with pytest.raises(APIError):
        db.table("audit_events").insert({"action": "forged"}).execute()
    with pytest.raises(APIError):
        db.table("projects").update({"studio_id": world.studio_b["id"]}).eq("id", project_id).execute()
    with pytest.raises(APIError):
        db.table("plan_versions").delete().eq("project_id", project_id).execute()
    assert db.table("projects").select("studio_id").eq("id", project_id).execute().data == [{"studio_id": world.studio_a["id"]}]


def test_anonymous_key_sees_nothing(world):
    from postgrest.exceptions import APIError
    from supabase import create_client

    from app.db import settings

    anon = create_client(settings().supabase_url, settings().supabase_publishable_key)
    for table in ("studios", "projects", "plan_versions", "studio_invites", "audit_events"):
        try:
            assert anon.table(table).select("*").execute().data == []
        except APIError:
            pass  # permission denied is the expected outcome


def test_invite_flow(api, world):
    created = api.post(
        f"/v1/studios/{world.studio_a['id']}/invites",
        json={"client_email": world.client_a.email, "client_name": "Client A"},
        headers=world.designer_a.headers,
    )
    assert created.status_code == 201
    token = created.json()["data"]["token"]

    public = api.get(f"/v1/invites/{token}").json()["data"]
    assert public == {"client_name": "Client A", "accepted_at": None, "studio": {k: world.studio_a[k] for k in ("id", "name", "slug")}}
    assert api.get("/v1/invites/" + "x" * 32).status_code == 404

    assert api.post(f"/v1/invites/{token}/accept", headers=world.client_a.headers).json()["data"] == {"studio_id": world.studio_a["id"]}
    assert api.post(f"/v1/invites/{token}/accept", headers=world.client_a.headers).status_code == 200  # idempotent
    assert api.post(f"/v1/invites/{token}/accept", headers=world.client_b.headers).status_code == 409
    listed = api.get(f"/v1/studios/{world.studio_a['id']}/invites", headers=world.designer_a.headers).json()["data"]
    assert len(listed) == 1 and listed[0]["accepted_at"] is not None


def test_changes_are_audited(world):
    from app.db import user_client

    actions = {row["action"] for row in user_client(world.designer_a.token).table("audit_events").select("action").execute().data}
    assert {"studio.created", "project.created", "plan_version.created"} <= actions


def test_oversized_body_is_refused_even_without_content_length(api):
    def chunks():
        for _ in range(40):
            yield b"x" * 100_000  # 4 MB sent with Transfer-Encoding: chunked

    response = api.post("/v1/studios", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_quotas_bound_what_one_account_can_store(api, world, monkeypatch):
    from app.routes import projects

    monkeypatch.setattr(projects, "MAX_PROJECTS_PER_CLIENT", 1)  # client_b already has one project in studio B
    blocked = api.post(
        "/v1/projects", json={"studio_id": world.studio_b["id"], "name": "One too many", "property_type": "existing"}, headers=world.client_b.headers
    )
    assert blocked.status_code == 409

    monkeypatch.setattr(projects, "MAX_VERSIONS_PER_PROJECT", 1)
    base = f"/v1/projects/{world.project_b['id']}/versions"
    assert api.post(base, json={"geometry": VALID}, headers=world.client_b.headers).status_code == 201
    assert api.post(base, json={"geometry": VALID}, headers=world.client_b.headers).status_code == 409


def test_database_refuses_a_second_owned_studio(world):
    """The API check can be raced; the unique index is what guarantees one owned studio per user."""
    from postgrest.exceptions import APIError

    from app.db import service

    with pytest.raises(APIError) as error:
        service().table("studio_memberships").insert(
            {"studio_id": world.studio_b["id"], "user_id": world.designer_a.id, "role": "owner"}
        ).execute()
    assert error.value.code == "23505"


def test_studio_activity_is_listed_for_members_only(api, world):
    path = f"/v1/studios/{world.studio_a['id']}/audit"
    events = api.get(path, headers=world.designer_a.headers).json()["data"]
    assert 0 < len(events) <= 10
    assert events == sorted(events, key=lambda event: event["created_at"], reverse=True)
    assert set(events[0]) == {"id", "action", "metadata", "created_at", "project"}  # no actor ids leave the API
    assert all(set(event["metadata"]) <= {"version_no", "author_role"} for event in events)
    names = {event["project"]["name"] for event in events if event["project"]}
    assert names and "Flat B" not in names

    # The studio's own client and another studio's designer are not members.
    for outsider in (world.client_a, world.designer_b):
        assert api.get(path, headers=outsider.headers).status_code == 403
    assert api.get(path).status_code == 401
    assert api.get("/v1/studios/not-a-uuid/audit", headers=world.designer_a.headers).status_code == 422

    other = api.get(f"/v1/studios/{world.studio_b['id']}/audit", headers=world.designer_b.headers).json()["data"]
    assert other and "Flat A" not in {event["project"]["name"] for event in other if event["project"]}


def test_version_review_is_shared_scoped_and_retryable(api, world):
    path = f"/v1/projects/{world.project_a['id']}/versions/{world.version_a['id']}/reviews"
    payload = {"room_id": "r1", "item_id": "f1", "decision": "approve", "note": "Keep this layout"}
    assert api.put(path, json=payload, headers=world.client_a.headers).status_code == 200
    payload["note"] = "Measured and approved"
    assert api.put(path, json=payload, headers=world.client_a.headers).status_code == 200
    rows = api.get(path, headers=world.designer_a.headers).json()["data"]
    assert len(rows) == 1 and rows[0]["note"] == payload["note"]
    assert api.get(path, headers=world.client_b.headers).status_code == 404
    assert api.put(path, json={**payload, "room_id": "missing"}, headers=world.client_a.headers).status_code == 422

def test_project_conversation_and_receipts(api, world):
    from uuid import uuid4

    path = f"/v1/projects/{world.project_a['id']}/messages"
    client, designer, outsider = world.client_a.headers, world.designer_a.headers, world.client_b.headers
    payload = {"request_id": str(uuid4()), "body": "Could we move the sofa?"}
    for _ in range(2):
        assert api.post(path, headers=client, json=payload).status_code == 201
    feed = api.get(path, headers=designer).json()["data"]
    assert feed["unread"] == len(feed["items"]) == 1
    message = feed["items"][0]
    assert message["body"] == payload["body"] and not message["mine"]
    ids = {"ids": [message["id"]]}
    for _ in range(2):
        assert api.put(path + "/read", headers=designer, json=ids).status_code == 200
    assert api.get(path, headers=designer).json()["data"]["unread"] == 0
    assert api.post(path, headers=designer, json={**payload, "body": "Yes"}).status_code == 201
    assert api.get(path, headers=client).json()["data"]["unread"] == 1
    assert api.get(path, headers=outsider).status_code == 404
    assert api.post(path, headers=outsider, json=payload).status_code == 404
    assert api.put(path + "/read", headers=outsider, json=ids).status_code == 404
