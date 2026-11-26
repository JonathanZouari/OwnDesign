"""Room scan and item list: API, validation, isolation, quotas. The detector is a fake (no model call) except
where a test says otherwise; the real model is covered in test_vision.py and the browser journey."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import vision
from tests.conftest import needs_supabase
from tests.test_design import PNG
from tests.test_geometry import VALID

pytestmark = needs_supabase

ROOM_JPG = (Path(__file__).parent / "fixtures" / "room.jpg").read_bytes()
SOFA = {"label": "Sofa", "category": "seating", "confidence": 0.917, "box": [0.1, 0.4, 0.6, 0.3],
        "color_hex": "#c8b8a8", "color_name": "beige", "position": "centre"}


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
    designer, client, other_client, designer_b = (make_user(p) for p in ("ri-d", "ri-c", "ri-c2", "ri-db"))
    studio = api.post("/v1/studios", json={"name": "Items Studio"}, headers=designer.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Items Studio B"}, headers=designer_b.headers)

    def project(user, name):
        body = {"studio_id": studio["id"], "name": name, "property_type": "existing"}
        created = api.post("/v1/projects", json=body, headers=user.headers).json()["data"]
        api.post(f"/v1/projects/{created['id']}/versions", json={"label": "p", "geometry": VALID}, headers=user.headers)
        return created

    return SimpleNamespace(
        designer=designer, client=client, other_client=other_client, designer_b=designer_b, studio_id=studio["id"],
        project=project(client, "Mine"), other_project=project(other_client, "Theirs"), project_fn=project,
        room_id=VALID["rooms"][0]["id"],
    )


def scan(api, user, pid, data=ROOM_JPG, name="room.jpg", mime="image/jpeg", room_id=None):
    form = {"room_id": room_id} if room_id is not None else {}
    return api.post(f"/v1/projects/{pid}/scans", files={"file": (name, data, mime)}, data=form, headers=user.headers)


def add(api, user, pid, items):
    return api.post(f"/v1/projects/{pid}/items", json={"items": items}, headers=user.headers)


def item(**over):
    return {"label": "Armchair", "category": "seating", **over}


# ---- scan ---------------------------------------------------------------------------------------------------------


def test_scan_stores_the_photo_and_returns_detections_without_adding_items(api, world, fake):
    pid = world.project["id"]
    response = scan(api, world.client, pid, room_id=world.room_id)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["detections"] == [SOFA] and data["room_id"] == world.room_id
    assert data["asset"]["kind"] == "existing_item" and data["asset"]["url"].startswith("http")
    assert "storage_path" not in data["asset"]
    assets = api.get(f"/v1/projects/{pid}/assets", headers=world.designer.headers).json()["data"]
    assert data["asset"]["id"] in {a["id"] for a in assets}
    assert api.get(f"/v1/projects/{pid}/items", headers=world.client.headers).json()["data"] == []


def test_scan_with_no_detections(api, world, fake):
    fake.found = []
    response = scan(api, world.client, world.project["id"])
    assert response.status_code == 201 and response.json()["data"]["detections"] == []


@pytest.mark.parametrize(
    "data,name,mime,code",
    [
        (b"", "a.jpg", "image/jpeg", 422),
        (b"<svg onload=alert(1)>", "a.svg", "image/svg+xml", 415),
        (b"\xff\xd8\xff" + b"\x00" * 100, "broken.jpg", "image/jpeg", 422),  # looks like a JPEG, is not one
        (PNG, "tiny.png", "image/png", 422),  # a 1 x 1 image is too small to scan
        (ROOM_JPG + b"\x00" * (5 * 1024 * 1024), "big.jpg", "image/jpeg", 413),
    ],
)
def test_bad_scans_are_refused_and_store_nothing(api, world, fake, data, name, mime, code):
    pid = world.project["id"]
    before = len(api.get(f"/v1/projects/{pid}/assets", headers=world.client.headers).json()["data"])
    assert scan(api, world.client, pid, data, name, mime).status_code == code
    assert len(api.get(f"/v1/projects/{pid}/assets", headers=world.client.headers).json()["data"]) == before


@pytest.mark.parametrize("room_id", ["not-a-room", "bad id!", "x" * 41])
def test_scan_refuses_a_room_outside_the_plan(api, world, fake, room_id):
    assert scan(api, world.client, world.project["id"], room_id=room_id).status_code == 422
    assert fake.calls == 0


def test_busy_scanner_answers_503(api, world, fake):
    fake.busy = True
    assert scan(api, world.client, world.project["id"]).status_code == 503


def test_scan_access(api, world, fake):
    pid = world.project["id"]
    assert api.post(f"/v1/projects/{pid}/scans", files={"file": ("r.jpg", ROOM_JPG, "image/jpeg")}).status_code == 401
    for stranger in (world.other_client, world.designer_b):
        assert scan(api, stranger, pid).status_code == 404
    assert scan(api, world.designer, pid).status_code == 201  # the studio's designer may scan too
    assert fake.calls == 1


# ---- items --------------------------------------------------------------------------------------------------------


def test_confirmed_items_are_added_listed_edited_and_removed(api, world, fake):
    pid = world.project["id"]
    scanned = scan(api, world.client, pid, room_id=world.room_id).json()["data"]
    confirmed = {
        "label": "Grey sofa", "category": "seating", "color_hex": "#C8B8A8", "room_id": world.room_id, "source": "scan",
        "asset_id": scanned["asset"]["id"], "confidence": 0.917, "box": SOFA["box"], "note": "Keep it",
    }
    response = add(api, world.client, pid, [confirmed, item(label="Lamp", category="decor")])
    assert response.status_code == 201, response.text
    created = response.json()["data"]
    assert created[0]["color_hex"] == "#c8b8a8" and created[0]["box"] == SOFA["box"] and created[1]["source"] == "manual"

    listed = api.get(f"/v1/projects/{pid}/items", headers=world.designer.headers).json()["data"]
    assert [i["label"] for i in listed][-2:] == ["Grey sofa", "Lamp"]

    url = f"/v1/projects/{pid}/items/{created[1]['id']}"
    edit = {"label": "Floor lamp", "category": "decor", "color_hex": "#000000", "room_id": None, "note": "brass"}
    edited = api.put(url, json=edit, headers=world.designer.headers)
    assert edited.status_code == 200 and edited.json()["data"]["label"] == "Floor lamp"
    assert edited.json()["data"]["updated_at"] > created[1]["updated_at"]
    assert api.put(url, json={**edit, "room_id": "nope"}, headers=world.client.headers).status_code == 422

    assert api.delete(url, headers=world.client.headers).status_code == 200
    assert api.delete(url, headers=world.client.headers).status_code == 404  # repeated delete
    assert created[1]["id"] not in {i["id"] for i in api.get(f"/v1/projects/{pid}/items", headers=world.client.headers).json()["data"]}


@pytest.mark.parametrize(
    "items",
    [
        [],
        [item()] * 51,
        [item(label="")],
        [item(label="   ")],
        [item(label="x" * 81)],
        [item(category="spaceship")],
        [item(color_hex="red")],
        [item(color_hex="#12345")],
        [item(note="x" * 201)],
        [item(room_id="bad id!")],
        [item(source="scan", box=[0.5, 0.5, 0.6, 0.1])],  # runs past the right edge
        [item(source="scan", box=[0.1, 0.1, 0, 0.1])],  # empty
        [item(source="scan", box=[0.1, 0.1, 0.1])],
        [item(source="scan", box=[-0.1, 0.1, 0.1, 0.1])],
        [item(source="scan", confidence=1.5)],
        [item(box=[0.1, 0.1, 0.1, 0.1])],  # a hand-added item has no box
        [item(source="robot")],
        [item(extra="field")],
    ],
)
def test_invalid_items_are_refused(api, world, items):
    assert add(api, world.client, world.project["id"], items).status_code == 422


def test_items_can_only_reference_this_projects_rooms_and_photos(api, world, fake):
    pid = world.project["id"]
    assert add(api, world.client, pid, [item(room_id="not-in-plan")]).status_code == 422
    other_asset = scan(api, world.other_client, world.other_project["id"]).json()["data"]["asset"]["id"]
    foreign = item(source="scan", asset_id=other_asset, box=[0.1, 0.1, 0.2, 0.2], confidence=0.5)
    assert add(api, world.client, pid, [foreign]).status_code == 422
    assert add(api, world.client, pid, [{**foreign, "asset_id": "00000000-0000-0000-0000-000000000000"}]).status_code == 422


def test_markup_in_a_label_is_stored_as_plain_text(api, world):
    markup = '<img src=x onerror="alert(1)">'
    created = add(api, world.client, world.project["id"], [item(label=markup)]).json()["data"][0]
    assert created["label"] == markup


def test_item_isolation(api, world):
    pid = world.project["id"]
    created = add(api, world.client, pid, [item(label="Private chair")]).json()["data"][0]
    url = f"/v1/projects/{pid}/items/{created['id']}"
    edit = {"label": "x", "category": "other"}
    for stranger in (world.other_client, world.designer_b):
        assert api.get(f"/v1/projects/{pid}/items", headers=stranger.headers).status_code == 404
        assert add(api, stranger, pid, [item()]).status_code == 404
        assert api.put(url, json=edit, headers=stranger.headers).status_code == 404
        assert api.delete(url, headers=stranger.headers).status_code == 404
    # An item of this project cannot be reached through another project the caller owns.
    other_url = f"/v1/projects/{world.other_project['id']}/items/{created['id']}"
    assert api.put(other_url, json=edit, headers=world.other_client.headers).status_code == 404
    assert api.delete(other_url, headers=world.other_client.headers).status_code == 404
    assert api.get(f"/v1/projects/{pid}/items", headers=world.client.headers).status_code == 200


def test_users_cannot_read_others_or_write_items_through_the_data_api(api, world, admin):
    from supabase import create_client

    from app.db import settings

    def as_user(user):
        client = create_client(settings().supabase_url, settings().supabase_publishable_key)
        client.postgrest.auth(user.token)
        return client

    from postgrest.exceptions import APIError

    pid = world.project["id"]
    own = add(api, world.client, pid, [item(label="Data API chair")]).json()["data"][0]
    mine = as_user(world.client).table("room_items").select("id").eq("project_id", pid).execute().data
    assert own["id"] in {row["id"] for row in mine}  # the client reads its own items
    for stranger in (world.other_client, world.designer_b):
        assert as_user(stranger).table("room_items").select("id").eq("project_id", pid).execute().data == []
    anon = create_client(settings().supabase_url, settings().supabase_publishable_key)
    with pytest.raises(APIError) as denied:
        anon.table("room_items").select("id").limit(1).execute()
    assert denied.value.code == "42501"
    client = as_user(world.client)
    for write in (
        lambda: client.table("room_items").insert({"project_id": pid, "label": "x", "category": "other", "source": "manual"}).execute(),
        lambda: client.table("room_items").update({"label": "hacked"}).eq("project_id", pid).execute(),
        lambda: client.table("room_items").delete().eq("project_id", pid).execute(),
    ):
        with pytest.raises(APIError) as denied:
            write()
        assert denied.value.code == "42501"  # permission denied: users have SELECT only
    labels = {row["label"] for row in admin.table("room_items").select("label").eq("project_id", pid).execute().data}
    assert "hacked" not in labels and "Data API chair" in labels


def test_database_refuses_moving_an_item_or_linking_another_projects_photo(api, world, admin, fake):
    from postgrest.exceptions import APIError

    pid, other = world.project["id"], world.other_project["id"]
    row = add(api, world.client, pid, [item(label="Stays here")]).json()["data"][0]
    with pytest.raises(APIError) as refused:
        admin.table("room_items").update({"project_id": other}).eq("id", row["id"]).execute()
    assert refused.value.code == "P0001"
    other_asset = scan(api, world.other_client, other).json()["data"]["asset"]["id"]
    with pytest.raises(APIError) as refused:
        admin.table("room_items").insert({"project_id": pid, "label": "x", "category": "other", "source": "scan", "asset_id": other_asset}).execute()
    assert refused.value.code == "23503"  # the composite foreign key: the photo belongs to another project


def test_deleting_the_photo_keeps_the_item(api, world, fake):
    pid = world.project["id"]
    asset = scan(api, world.client, pid).json()["data"]["asset"]["id"]
    created = add(api, world.client, pid, [item(source="scan", asset_id=asset, box=[0, 0, 1, 1], confidence=0.9)]).json()["data"][0]
    assert api.delete(f"/v1/projects/{pid}/assets/{asset}", headers=world.client.headers).status_code == 200
    kept = {i["id"]: i for i in api.get(f"/v1/projects/{pid}/items", headers=world.client.headers).json()["data"]}
    assert kept[created["id"]]["asset_id"] is None


def test_suspended_studio_blocks_scans_and_item_writes(api, world, admin, fake):
    pid = world.project["id"]
    created = add(api, world.client, pid, [item()]).json()["data"][0]
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio_id).execute()
    try:
        assert scan(api, world.client, pid).status_code == 403
        assert add(api, world.client, pid, [item()]).status_code == 403
        url = f"/v1/projects/{pid}/items/{created['id']}"
        assert api.put(url, json={"label": "x", "category": "other"}, headers=world.client.headers).status_code == 403
        assert api.delete(url, headers=world.client.headers).status_code == 403
        assert api.get(f"/v1/projects/{pid}/items", headers=world.client.headers).status_code == 200  # reading still works
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio_id).execute()


def test_item_quota_holds_under_parallel_requests(api, world, admin):
    pid = world.project_fn(world.client, "Quota")["id"]
    for _ in range(3):
        assert add(api, world.client, pid, [item()] * 50).status_code == 201
    assert add(api, world.client, pid, [item()] * 47).status_code == 201  # 197
    assert add(api, world.client, pid, [item()] * 4).status_code == 409  # would be 201: all or nothing
    with ThreadPoolExecutor(6) as pool:
        codes = list(pool.map(lambda _: add(api, world.client, pid, [item()]).status_code, range(6)))
    assert sorted(codes) == [201] * 3 + [409] * 3
    assert len(admin.table("room_items").select("id").eq("project_id", pid).execute().data) == 200


def test_scan_of_a_project_with_no_image_slots_left_skips_the_model(api, world, admin, fake):
    pid = world.project_fn(world.client, "Full")["id"]
    rows = [{"project_id": pid, "kind": "inspiration", "storage_path": f"{pid}/fake-{i}.png", "mime": "image/png", "size_bytes": 1}
            for i in range(30)]
    admin.table("inspiration_assets").insert(rows).execute()
    assert scan(api, world.client, pid).status_code == 409
    assert fake.calls == 0


def test_inspiration_photos_cannot_be_linked_to_items(api, world):
    from tests.test_design import upload

    pid = world.project["id"]
    inspiration = upload(api, world.client, pid, PNG).json()["data"]["id"]
    linked = item(source="scan", asset_id=inspiration, box=[0, 0, 1, 1], confidence=0.9)
    assert add(api, world.client, pid, [linked]).status_code == 422


def test_consultant_context_includes_the_items(api, world):
    from app.auth import CurrentUser
    from app.routes.consultant import _context

    add(api, world.client, world.project["id"], [item(label="Private chair")])
    project = api.get(f"/v1/projects/{world.project['id']}", headers=world.client.headers).json()["data"]
    from supabase import create_client

    from app.db import settings

    db = create_client(settings().supabase_url, settings().supabase_publishable_key)
    db.postgrest.auth(world.client.token)
    context = _context(CurrentUser(id=world.client.id, email=world.client.email, db=db), project)
    assert "items_already_in_the_home" in context and "Private chair" in context
