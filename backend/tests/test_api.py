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


@pytest.fixture(scope="module")
def homeowner_world(api, make_user):
    owner, stranger = make_user("home-owner"), make_user("home-stranger")
    project = api.post("/v1/projects", json={"name": "My flat", "property_type": "existing"}, headers=owner.headers)
    assert project.status_code == 201
    return SimpleNamespace(owner=owner, stranger=stranger, project=project.json()["data"])


def test_homeowner_project_without_studio(api, homeowner_world):
    w = homeowner_world
    base = f"/v1/projects/{w.project['id']}"
    assert w.project["studio_id"] is None and w.project["client_user_id"] == w.owner.id
    saved = api.post(f"{base}/versions", json={"label": "v1", "geometry": VALID}, headers=w.owner.headers)
    assert saved.status_code == 201 and saved.json()["data"]["author_role"] == "client"
    got = api.get(base, headers=w.owner.headers).json()["data"]
    assert got["my_role"] == "client" and got["studio"] is None
    assert [p["id"] for p in api.get("/v1/projects", headers=w.owner.headers).json()["data"]] == [w.project["id"]]
    assert api.get(f"{base}/versions/latest", headers=w.owner.headers).json()["data"]["geometry"] == VALID


def test_homeowner_project_is_private(api, homeowner_world):
    from app.db import user_client

    w = homeowner_world
    base = f"/v1/projects/{w.project['id']}"
    api.post(f"{base}/versions", json={"geometry": VALID}, headers=w.owner.headers)
    headers = w.stranger.headers
    assert api.get(base, headers=headers).status_code == 404
    assert api.get(f"{base}/versions", headers=headers).status_code == 404
    assert api.get(f"{base}/versions/latest", headers=headers).status_code == 404
    assert api.post(f"{base}/versions", json={"geometry": VALID}, headers=headers).status_code == 404
    assert api.get("/v1/projects", headers=headers).json()["data"] == []
    db = user_client(w.stranger.token)
    assert db.table("projects").select("id").eq("id", w.project["id"]).execute().data == []
    assert db.table("plan_versions").select("id").eq("project_id", w.project["id"]).execute().data == []


def test_explicit_null_studio_and_unknown_fields(api, make_user):
    user = make_user("home-null")
    created = api.post("/v1/projects", json={"studio_id": None, "name": "Null", "property_type": "new_build"}, headers=user.headers)
    assert created.status_code == 201 and created.json()["data"]["studio_id"] is None
    extra = api.post("/v1/projects", json={"name": "X", "property_type": "existing", "role": "admin"}, headers=user.headers)
    assert extra.status_code == 422
    bad = api.post("/v1/projects", json={"name": "X", "property_type": "castle"}, headers=user.headers)
    assert bad.status_code == 422


def test_quota_counts_studioless_projects_per_user(api, world, make_user, monkeypatch):
    from app.routes import projects

    user = make_user("home-quota")
    monkeypatch.setattr(projects, "MAX_PROJECTS_PER_CLIENT", 1)
    body = {"name": "One", "property_type": "existing"}
    assert api.post("/v1/projects", json=body, headers=user.headers).status_code == 201
    assert api.post("/v1/projects", json=body, headers=user.headers).status_code == 409
    # Another user is unaffected, and a studio project does not count against the studio-less quota.
    assert api.post("/v1/projects", json=body, headers=make_user("home-quota2").headers).status_code == 201
    in_studio = {**body, "studio_id": world.studio_a["id"]}
    assert api.post("/v1/projects", json=in_studio, headers=user.headers).status_code == 201
