"""Client tasks: the designer asks, the client marks done. Roles, isolation, limits, races."""

from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase

pytestmark = needs_supabase

MISSING = "00000000-0000-0000-0000-000000000000"


@pytest.fixture(scope="module")
def world(api, make_user):
    designer, client, other_client, designer_b = (make_user(p) for p in ("td-a", "tc-a", "tc2-a", "td-b"))
    studio = api.post("/v1/studios", json={"name": "Tasks A"}, headers=designer.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Tasks B"}, headers=designer_b.headers)

    def project(user, name):
        body = {"studio_id": studio["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]

    return SimpleNamespace(
        designer=designer, client=client, other_client=other_client, designer_b=designer_b,
        studio=studio, mine=project(client, "Flat"), theirs=project(other_client, "House"), project=project,
    )


def url(project, task_id=None):
    base = f"/v1/projects/{project['id']}/tasks"
    return f"{base}/{task_id}" if task_id else base


def create(api, world, project=None, title="Measure the bedroom", **extra):
    return api.post(url(project or world.mine), json={"title": title, **extra}, headers=world.designer.headers)


# ---- the main flow -----------------------------------------------------------------------------------------------


def test_designer_asks_client_completes_designer_reopens(api, world):
    created = create(api, world, details="Wall to wall, both directions.")
    assert created.status_code == 201
    task = created.json()["data"]
    assert task["status"] == "open" and task["done_at"] is None and task["client_note"] == ""

    listed = api.get(url(world.mine), headers=world.client.headers).json()["data"]
    assert task["id"] in [t["id"] for t in listed]

    done = api.patch(url(world.mine, task["id"]), json={"status": "done", "client_note": " 3.40 x 2.90 m "}, headers=world.client.headers)
    assert done.status_code == 200
    body = done.json()["data"]
    assert body["status"] == "done" and body["client_note"] == "3.40 x 2.90 m" and body["done_at"]

    seen = {t["id"]: t for t in api.get(url(world.mine), headers=world.designer.headers).json()["data"]}
    assert seen[task["id"]]["client_note"] == "3.40 x 2.90 m"

    reopened = api.patch(url(world.mine, task["id"]), json={"status": "open"}, headers=world.designer.headers)
    assert reopened.status_code == 200
    assert reopened.json()["data"]["status"] == "open" and reopened.json()["data"]["done_at"] is None
    # The client's answer stays visible after the designer reopens, and a new completion replaces it.
    assert reopened.json()["data"]["client_note"] == "3.40 x 2.90 m"
    again = api.patch(url(world.mine, task["id"]), json={"status": "done", "client_note": "3.45 x 2.90 m"}, headers=world.client.headers)
    assert again.json()["data"]["client_note"] == "3.45 x 2.90 m"


def test_client_can_undo_own_completion(api, world):
    task = create(api, world).json()["data"]
    assert api.patch(url(world.mine, task["id"]), json={"status": "done"}, headers=world.client.headers).status_code == 200
    undone = api.patch(url(world.mine, task["id"]), json={"status": "open"}, headers=world.client.headers)
    assert undone.status_code == 200 and undone.json()["data"]["status"] == "open"
    assert undone.json()["data"]["client_note"] == ""


def test_open_tasks_are_listed_first_then_newest(api, world):
    project = world.project(world.client, "Order")
    first = create(api, world, project, "first").json()["data"]
    second = create(api, world, project, "second").json()["data"]
    api.patch(url(project, second["id"]), json={"status": "done"}, headers=world.client.headers)
    third = create(api, world, project, "third").json()["data"]
    ids = [t["id"] for t in api.get(url(project), headers=world.client.headers).json()["data"]]
    assert ids == [third["id"], first["id"], second["id"]]


def test_empty_project_has_no_tasks(api, world):
    project = world.project(world.client, "Empty")
    assert api.get(url(project), headers=world.client.headers).json()["data"] == []


# ---- roles -------------------------------------------------------------------------------------------------------


def test_client_cannot_create_or_delete(api, world):
    assert api.post(url(world.mine), json={"title": "Mine"}, headers=world.client.headers).status_code == 403
    task = create(api, world).json()["data"]
    assert api.delete(url(world.mine, task["id"]), headers=world.client.headers).status_code == 403


def test_designer_cannot_mark_done(api, world):
    task = create(api, world).json()["data"]
    assert api.patch(url(world.mine, task["id"]), json={"status": "done"}, headers=world.designer.headers).status_code == 403


def test_designer_deletes_a_task(api, world):
    task = create(api, world).json()["data"]
    assert api.delete(url(world.mine, task["id"]), headers=world.designer.headers).status_code == 200
    assert task["id"] not in [t["id"] for t in api.get(url(world.mine), headers=world.designer.headers).json()["data"]]
    assert api.delete(url(world.mine, task["id"]), headers=world.designer.headers).status_code == 404


def test_same_status_twice_is_a_conflict(api, world):
    task = create(api, world).json()["data"]
    assert api.patch(url(world.mine, task["id"]), json={"status": "open"}, headers=world.client.headers).status_code == 409
    assert api.patch(url(world.mine, task["id"]), json={"status": "done"}, headers=world.client.headers).status_code == 200
    assert api.patch(url(world.mine, task["id"]), json={"status": "done"}, headers=world.client.headers).status_code == 409


def test_concurrent_completions_change_the_task_once(api, world):
    task = create(api, world).json()["data"]
    body = {"status": "done", "client_note": "same"}
    with ThreadPoolExecutor(5) as pool:
        codes = list(pool.map(lambda _: api.patch(url(world.mine, task["id"]), json=body, headers=world.client.headers).status_code, range(5)))
    assert sorted(codes) == [200] + [409] * 4


# ---- isolation ---------------------------------------------------------------------------------------------------


def test_strangers_see_nothing(api, world):
    task = create(api, world).json()["data"]
    for stranger in (world.other_client, world.designer_b):
        assert api.get(url(world.mine), headers=stranger.headers).status_code == 404
        assert api.post(url(world.mine), json={"title": "x"}, headers=stranger.headers).status_code == 404
        assert api.patch(url(world.mine, task["id"]), json={"status": "done"}, headers=stranger.headers).status_code == 404
        assert api.delete(url(world.mine, task["id"]), headers=stranger.headers).status_code == 404
    assert api.get(url(world.mine), headers={}).status_code == 401
    assert api.get(f"/v1/projects/{MISSING}/tasks", headers=world.designer.headers).status_code == 404


def test_task_of_another_project_is_not_found(api, world):
    other = create(api, world, world.theirs).json()["data"]
    assert api.patch(url(world.mine, other["id"]), json={"status": "done"}, headers=world.client.headers).status_code == 404
    assert api.delete(url(world.mine, other["id"]), headers=world.designer.headers).status_code == 404
    assert api.patch(url(world.mine, MISSING), json={"status": "done"}, headers=world.client.headers).status_code == 404


def test_users_cannot_read_or_write_tasks_through_the_data_api(world, api):
    from supabase import create_client

    from app.db import settings

    task = create(api, world).json()["data"]
    direct = create_client(settings().supabase_url, settings().supabase_publishable_key)
    for stranger in (world.other_client, world.designer_b):
        direct.postgrest.auth(stranger.token)
        assert direct.table("project_tasks").select("id").eq("project_id", world.mine["id"]).execute().data == []
    direct.postgrest.auth(world.client.token)
    assert task["id"] in [row["id"] for row in direct.table("project_tasks").select("id").execute().data]
    with pytest.raises(Exception):
        direct.table("project_tasks").insert({"project_id": world.mine["id"], "title": "sneaky"}).execute()
    with pytest.raises(Exception):
        direct.table("project_tasks").update({"status": "done", "done_at": "now()"}).eq("id", task["id"]).execute()


def test_database_guards_task_rows(api, world, admin):
    task = create(api, world).json()["data"]
    rows = admin.table("project_tasks")
    # A task never moves to another project, and its author can only be cleared (user deleted).
    with pytest.raises(Exception):
        rows.update({"project_id": world.theirs["id"]}).eq("id", task["id"]).execute()
    with pytest.raises(Exception):
        rows.update({"created_by": world.client.id}).eq("id", task["id"]).execute()
    assert rows.update({"created_by": None}).eq("id", task["id"]).execute().data[0]["created_by"] is None
    # An open task cannot carry done_by; a done task needs done_at.
    with pytest.raises(Exception):
        rows.update({"done_by": world.client.id}).eq("id", task["id"]).execute()
    with pytest.raises(Exception):
        rows.update({"status": "done"}).eq("id", task["id"]).execute()
    with pytest.raises(Exception):
        rows.insert({"project_id": world.mine["id"], "title": "   "}).execute()


def test_anonymous_data_api_sees_no_tasks(world, api):
    from postgrest.exceptions import APIError
    from supabase import create_client

    from app.db import settings

    create(api, world)
    anon = create_client(settings().supabase_url, settings().supabase_publishable_key)
    try:
        assert anon.table("project_tasks").select("*").execute().data == []
    except APIError:
        pass  # permission denied is the expected outcome


# ---- inbox -------------------------------------------------------------------------------------------------------


def test_inbox_lists_only_my_open_tasks(api, world):
    project = world.project(world.client, "Inbox")
    open_task = create(api, world, project, "Photograph the windows").json()["data"]
    done_task = create(api, world, project, "Send the floor plan").json()["data"]
    api.patch(url(project, done_task["id"]), json={"status": "done"}, headers=world.client.headers)
    theirs = create(api, world, world.theirs, "Not yours").json()["data"]

    inbox = api.get("/v1/tasks", headers=world.client.headers).json()["data"]
    ids = {t["id"] for t in inbox}
    assert open_task["id"] in ids and done_task["id"] not in ids and theirs["id"] not in ids
    entry = next(t for t in inbox if t["id"] == open_task["id"])
    assert entry["project_id"] == project["id"] and entry["project_name"] == "Inbox"
    # A designer is not the client of any project here, so their inbox is empty.
    assert api.get("/v1/tasks", headers=world.designer.headers).json()["data"] == []
    assert api.get("/v1/tasks", headers={}).status_code == 401


# ---- input edges -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 121},
        {"title": "ok", "details": "x" * 1001},
        {"title": "ok", "status": "done"},
        {"title": "ok", "unknown": 1},
        {"title": 5},
        {"title": None},
    ],
)
def test_invalid_task_is_rejected(api, world, body):
    assert api.post(url(world.mine), json=body, headers=world.designer.headers).status_code == 422


@pytest.mark.parametrize(
    "body",
    [{}, {"status": "closed"}, {"status": "done", "client_note": "x" * 501}, {"status": "done", "title": "changed"}, {"status": None}],
)
def test_invalid_update_is_rejected(api, world, body):
    task = create(api, world).json()["data"]
    assert api.patch(url(world.mine, task["id"]), json=body, headers=world.client.headers).status_code == 422


def test_boundaries_are_accepted_and_markup_is_plain_text(api, world):
    assert create(api, world, title="x").status_code == 201
    assert create(api, world, title="x" * 120, details="d" * 1000).status_code == 201
    payload = '<img src=x onerror=alert(1)> "; drop table project_tasks; --'
    task = create(api, world, title=payload[:120]).json()["data"]
    assert task["title"] == payload[:120]
    done = api.patch(url(world.mine, task["id"]), json={"status": "done", "client_note": "n" * 500}, headers=world.client.headers)
    assert done.status_code == 200 and len(done.json()["data"]["client_note"]) == 500


def test_malformed_ids_are_rejected(api, world):
    assert api.get("/v1/projects/not-a-uuid/tasks", headers=world.designer.headers).status_code == 422
    assert api.patch(url(world.mine, "not-a-uuid"), json={"status": "done"}, headers=world.client.headers).status_code == 422


# ---- limits and studio state -------------------------------------------------------------------------------------


def test_quota_of_200_tasks_per_project(api, world, admin):
    project = world.project(world.client, "Full")
    admin.table("project_tasks").insert([{"project_id": project["id"], "title": f"t{i}"} for i in range(199)]).execute()
    assert create(api, world, project).status_code == 201
    assert create(api, world, project).status_code == 409


def test_parallel_creates_cannot_exceed_the_quota(api, world, admin):
    project = world.project(world.client, "Race")
    admin.table("project_tasks").insert([{"project_id": project["id"], "title": f"t{i}"} for i in range(197)]).execute()
    with ThreadPoolExecutor(6) as pool:
        codes = list(pool.map(lambda _: create(api, world, project).status_code, range(6)))
    assert sorted(codes) == [201] * 3 + [409] * 3
    assert len(admin.table("project_tasks").select("id").eq("project_id", project["id"]).execute().data) == 200


def test_suspended_studio_blocks_every_write(api, world, admin):
    task = create(api, world).json()["data"]
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio["id"]).execute()
    try:
        assert create(api, world).status_code == 403
        assert api.patch(url(world.mine, task["id"]), json={"status": "done"}, headers=world.client.headers).status_code == 403
        assert api.delete(url(world.mine, task["id"]), headers=world.designer.headers).status_code == 403
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio["id"]).execute()
