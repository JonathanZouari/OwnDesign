"""Walking paths ("How we move"): upload, notes, validation, quotas, and isolation between studios and clients."""

import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase
from tests.test_design import JPEG, PNG

pytestmark = needs_supabase

LINE = [[0.1, 0.9], [0.5, 0.6], [0.9, 0.2]]


@pytest.fixture(scope="module")
def world(api, make_user):
    designer, client, other_client, other_designer = (make_user(p) for p in ("w-d", "w-c", "w-c2", "w-d2"))
    studio = api.post("/v1/studios", json={"name": "Walk Studio"}, headers=designer.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Other Walk Studio"}, headers=other_designer.headers)

    def project(user, name):
        body = {"studio_id": studio["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]["id"]

    return SimpleNamespace(designer=designer, client=client, other_client=other_client, other_designer=other_designer,
                           studio_id=studio["id"], pid=project(client, "Walk flat"), project=project)


@pytest.fixture
def pid(api, world):
    """A fresh project for each test, so the 10-path limit of one test never affects another."""
    return world.project(world.client, "Walk flat")


@pytest.fixture(scope="module")
def shared_path(api, world):
    return add_path(api, world.client, world.pid).json()["data"]


def add_path(api, user, pid, points=LINE, data=PNG, width=640, height=360, label="Door to kitchen"):
    raw = points if isinstance(points, str) else json.dumps(points)
    return api.post(
        f"/v1/projects/{pid}/walk-paths",
        files={"file": ("frame.png", data, "image/png")},
        data={"points": raw, "width": str(width), "height": str(height), "label": label},
        headers=user.headers,
    )


def test_path_round_trip_with_notes_from_both_roles(api, world, pid):
    created = add_path(api, world.client, pid, label="  Door to kitchen  ")
    assert created.status_code == 201, created.text
    path = created.json()["data"]
    assert path["label"] == "Door to kitchen" and path["points"] == LINE and path["url"].startswith("http")
    assert (path["width"], path["height"]) == (640, 360)

    notes_url = f"/v1/projects/{pid}/walk-paths/{path['id']}/notes"
    mine = api.post(notes_url, json={"x": 0.5, "y": 0.6, "text": "Tight here with shopping bags"}, headers=world.client.headers)
    assert mine.status_code == 201 and mine.json()["data"]["author_role"] == "client"
    theirs = api.post(notes_url, json={"x": 0, "y": 1, "text": "Keep this clear?"}, headers=world.designer.headers)
    assert theirs.status_code == 201 and theirs.json()["data"]["author_role"] == "designer"

    for viewer in (world.client, world.designer):
        listed = api.get(f"/v1/projects/{pid}/walk-paths", headers=viewer.headers).json()["data"]
        found = next(p for p in listed if p["id"] == path["id"])
        assert [n["text"] for n in found["notes"]] == ["Tight here with shopping bags", "Keep this clear?"]
        assert "storage_path" not in found


def test_minimum_and_maximum_points_and_jpeg(api, world, pid):
    assert add_path(api, world.client, pid, points=[[0, 0], [1, 1]], data=JPEG).status_code == 201
    assert add_path(api, world.client, pid, points=[[i / 599, 0.5] for i in range(600)]).status_code == 201


@pytest.mark.parametrize(
    "points",
    [
        [],
        [[0.5, 0.5]],  # one point is not a path
        [[0, 0]] * 601,
        [[0, 0], [1.01, 0]],
        [[0, 0], [-0.01, 0]],
        [[0, 0], [True, 0]],
        [[0, 0], ["0.5", 0]],
        [[0, 0], [0.5]],
        [[0, 0], [0.5, 0.5, 0.5]],
        {"x": 1},
        "not json",
        "[[0,0],[NaN,0]]",
        "",
    ],
)
def test_invalid_points_are_refused(api, world, points):
    assert add_path(api, world.client, world.pid, points=points).status_code == 422


@pytest.mark.parametrize(
    "data, width, height, status",
    [
        (b"", 640, 360, 422),
        (b"GIF89a" + b"\x00" * 20, 640, 360, 415),
        (b"<svg onload=alert(1)>", 640, 360, 415),
        (PNG + b"\x00" * 1_500_000, 640, 360, 413),
        (PNG, 0, 360, 422),
        (PNG, 640, 5000, 422),
    ],
)
def test_invalid_frames_are_refused(api, world, data, width, height, status):
    assert add_path(api, world.client, world.pid, data=data, width=width, height=height).status_code == status


def test_label_too_long_is_refused(api, world):
    assert add_path(api, world.client, world.pid, label="x" * 81).status_code == 422


@pytest.mark.parametrize(
    "body",
    [{"x": 0.5, "y": 0.5, "text": ""}, {"x": 0.5, "y": 0.5, "text": "   "}, {"x": 0.5, "y": 0.5, "text": "x" * 281},
     {"x": 1.5, "y": 0.5, "text": "a"}, {"x": "0.5", "y": 0.5, "text": "a"}, {"x": 0.5, "text": "a"},
     {"x": 0.5, "y": 0.5, "text": "a", "author_role": "designer"}],
)
def test_invalid_notes_are_refused(api, world, shared_path, body):
    assert api.post(f"/v1/projects/{world.pid}/walk-paths/{shared_path['id']}/notes", json=body, headers=world.client.headers).status_code == 422


def test_strangers_see_and_change_nothing(api, world, pid):
    path = add_path(api, world.client, pid).json()["data"]
    base = f"/v1/projects/{pid}/walk-paths"
    note = {"x": 0.5, "y": 0.5, "text": "hello"}
    for stranger in (world.other_client, world.other_designer):
        assert api.get(base, headers=stranger.headers).status_code == 404
        assert add_path(api, stranger, pid).status_code == 404
        assert api.post(f"{base}/{path['id']}/notes", json=note, headers=stranger.headers).status_code == 404
        assert api.delete(f"{base}/{path['id']}", headers=stranger.headers).status_code == 404
    assert api.get(base).status_code == 401

    # A path id from another project cannot be reached through a project the caller owns.
    own = world.project(world.other_client, "Someone else's")
    assert api.post(f"/v1/projects/{own}/walk-paths/{path['id']}/notes", json=note, headers=world.other_client.headers).status_code == 404
    assert api.delete(f"/v1/projects/{own}/walk-paths/{path['id']}", headers=world.other_client.headers).status_code == 404


def test_rls_hides_paths_and_notes_from_direct_reads(world, shared_path):
    from supabase import create_client

    from app.db import settings

    for user, visible in ((world.other_designer, False), (world.client, True)):
        db = create_client(settings().supabase_url, settings().supabase_publishable_key)
        db.postgrest.auth(user.token)
        assert bool(db.table("walk_paths").select("id").eq("id", shared_path["id"]).execute().data) is visible
        # Signed-in users may read, never write.
        with pytest.raises(Exception):
            db.table("walk_path_notes").insert({"path_id": shared_path["id"], "x": 0, "y": 0, "text": "x", "author_role": "client"}).execute()
        with pytest.raises(Exception):
            db.table("walk_paths").delete().eq("id", shared_path["id"]).execute()

def test_delete_removes_path_notes_and_frame(api, world, pid, admin):
    path = add_path(api, world.client, pid).json()["data"]
    base = f"/v1/projects/{pid}/walk-paths"
    api.post(f"{base}/{path['id']}/notes", json={"x": 0.1, "y": 0.1, "text": "n"}, headers=world.client.headers)
    stored = admin.table("walk_paths").select("storage_path").eq("id", path["id"]).execute().data[0]["storage_path"]
    assert api.delete(f"{base}/{path['id']}", headers=world.designer.headers).status_code == 200
    assert api.delete(f"{base}/{path['id']}", headers=world.designer.headers).status_code == 404  # repeated
    assert admin.table("walk_path_notes").select("id").eq("path_id", path["id"]).execute().data == []
    folder, name = stored.rsplit("/", 1)
    assert name not in [f["name"] for f in admin.storage.from_("project-assets").list(folder)]


def test_parallel_uploads_cannot_exceed_the_quota(api, world, admin, pid):
    for _ in range(7):
        assert add_path(api, world.client, pid).status_code == 201
    with ThreadPoolExecutor(6) as pool:
        codes = list(pool.map(lambda _: add_path(api, world.client, pid).status_code, range(6)))
    assert sorted(codes) == [201] * 3 + [409] * 3
    assert len(admin.table("walk_paths").select("id").eq("project_id", pid).execute().data) == 10


def test_suspended_studio_blocks_writes_but_not_reads(api, world, pid, admin):
    path = add_path(api, world.client, pid).json()["data"]
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio_id).execute()
    try:
        base = f"/v1/projects/{pid}/walk-paths"
        assert add_path(api, world.client, pid).status_code == 403
        assert api.post(f"{base}/{path['id']}/notes", json={"x": 0, "y": 0, "text": "n"}, headers=world.client.headers).status_code == 403
        assert api.delete(f"{base}/{path['id']}", headers=world.client.headers).status_code == 403
        assert api.get(base, headers=world.client.headers).status_code == 200
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio_id).execute()
