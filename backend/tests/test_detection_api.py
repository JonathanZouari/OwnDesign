"""Item detection endpoints against the real Supabase project, with a fake detector (no model needed).

Maps to the acceptance criteria in specs/item-detection.md section 8.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.detection.model import Detection, ImageError, ModelUnavailable
from app.routes.detection import get_detector_loader
from tests.conftest import needs_supabase
from tests.test_design import PNG, upload

pytestmark = needs_supabase

SOFA = Detection("couch", "Sofa", "sofa", 0.93, (0.1, 0.4, 0.5, 0.3))
CHAIR = Detection("chair", "Chair", "chair", 0.55, (0.6, 0.5, 0.1, 0.2))


class FakeDetector:
    def __init__(self, found=(SOFA, CHAIR)):
        self.found = list(found)
        self.calls = 0
        self.error = None

    def detect(self, data):
        self.calls += 1
        if self.error:
            raise self.error
        assert data == PNG  # it gets the stored image, not something from the browser
        return self.found


@pytest.fixture
def fake(api):
    detector = FakeDetector()
    api.app.dependency_overrides[get_detector_loader] = lambda: (lambda: detector)
    yield detector
    api.app.dependency_overrides.pop(get_detector_loader, None)


@pytest.fixture(scope="module")
def world(api, make_user):
    designer, client, other_client, designer_b = (make_user(p) for p in ("det-d", "det-c", "det-c2", "det-db"))
    studio = api.post("/v1/studios", json={"name": "Detect Studio"}, headers=designer.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Detect B"}, headers=designer_b.headers)

    def project(user, name):
        body = {"studio_id": studio["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]

    mine, theirs = project(client, "Mine"), project(other_client, "Theirs")
    photo = upload(api, client, mine["id"], PNG, kind="existing_item").json()["data"]
    inspiration = upload(api, client, mine["id"], PNG, kind="inspiration").json()["data"]
    their_photo = upload(api, other_client, theirs["id"], PNG, kind="existing_item").json()["data"]
    return SimpleNamespace(**locals())


def detect_url(project, asset):
    return f"/v1/projects/{project['id']}/assets/{asset['id']}/detect"


def items_url(project):
    return f"/v1/projects/{project['id']}/owned-items"


def stored(admin, project):
    return admin.table("owned_items").select("*").eq("project_id", project["id"]).execute().data


def events(admin, project, action):
    return admin.table("audit_events").select("metadata").eq("project_id", project["id"]).eq("action", action).execute().data


# ---- detect ------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("who", ["client", "designer"])
def test_client_and_designer_see_the_same_items(api, world, fake, admin, who):
    response = api.post(detect_url(world.mine, world.photo), headers=getattr(world, who).headers)
    assert response.status_code == 200, response.text
    items = response.json()["data"]["items"]
    assert items == [
        {"item_class": "couch", "label": "Sofa", "catalog_type": "sofa", "confidence": 0.93, "box": {"x": 0.1, "y": 0.4, "w": 0.5, "h": 0.3}},
        {"item_class": "chair", "label": "Chair", "catalog_type": "chair", "confidence": 0.55, "box": {"x": 0.6, "y": 0.5, "w": 0.1, "h": 0.2}},
    ]
    assert stored(admin, world.mine) == []  # detections are never stored


def test_detection_is_recorded_as_metadata_only(api, world, fake, admin):
    before = len(events(admin, world.mine, "items.detected"))
    api.post(detect_url(world.mine, world.photo), headers=world.client.headers)
    found = events(admin, world.mine, "items.detected")
    assert len(found) == before + 1
    assert found[-1]["metadata"] == {"asset_id": world.photo["id"], "count": 2}


def test_only_photos_of_items_you_own(api, world, fake):
    response = api.post(detect_url(world.mine, world.inspiration), headers=world.client.headers)
    assert response.status_code == 422 and fake.calls == 0


def test_no_detection_without_access(api, world, fake, admin):
    before = len(events(admin, world.mine, "items.detected")) + len(events(admin, world.theirs, "items.detected"))
    cases = [
        (world.other_client, world.mine, world.photo),  # another client of the same studio
        (world.designer_b, world.mine, world.photo),  # a designer of another studio
        (world.client, world.mine, world.their_photo),  # someone else's photo through my project
        (world.client, world.theirs, world.their_photo),  # someone else's project
    ]
    for user, project, asset in cases:
        assert api.post(detect_url(project, asset), headers=user.headers).status_code == 404
    assert api.post(detect_url(world.mine, world.photo)).status_code == 401
    assert fake.calls == 0
    after = len(events(admin, world.mine, "items.detected")) + len(events(admin, world.theirs, "items.detected"))
    assert after == before


def test_unreadable_image_and_missing_model(api, world, fake):
    fake.error = ImageError("This image cannot be read")
    response = api.post(detect_url(world.mine, world.photo), headers=world.client.headers)
    assert response.status_code == 422 and response.json()["error"] == "This image cannot be read"
    fake.error = None

    def unavailable():
        raise ModelUnavailable("missing")

    api.app.dependency_overrides[get_detector_loader] = lambda: unavailable
    response = api.post(detect_url(world.mine, world.photo), headers=world.client.headers)
    assert response.status_code == 503


def test_failed_detection_records_nothing(world, fake, admin):
    from app.main import app

    quiet = TestClient(app, raise_server_exceptions=False)
    fake.error = RuntimeError("model crashed")
    before = len(events(admin, world.mine, "items.detected"))
    assert quiet.post(detect_url(world.mine, world.photo), headers=world.client.headers).status_code == 500
    assert len(events(admin, world.mine, "items.detected")) == before


def test_busy_user_gets_429_with_retry_after(api, world, fake):
    from app.routes import detection

    detection._BUSY_USERS.add(world.client.id)
    try:
        response = api.post(detect_url(world.mine, world.photo), headers=world.client.headers)
        assert response.status_code == 429 and response.headers["retry-after"] == "5"
        assert api.post(detect_url(world.mine, world.photo), headers=world.designer.headers).status_code == 200
    finally:
        detection._BUSY_USERS.discard(world.client.id)


def test_detection_allowed_in_a_suspended_studio(api, world, fake, admin):
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio["id"]).execute()
    try:
        assert api.post(detect_url(world.mine, world.photo), headers=world.client.headers).status_code == 200
        body = {"items": [{"item_class": "couch", "quantity": 1}]}
        assert api.post(items_url(world.mine), json=body, headers=world.client.headers).status_code == 403
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio["id"]).execute()


# ---- owned items -------------------------------------------------------------------------------------------------


def test_accepting_items_stores_them_and_adds_a_line_to_the_brief(api, world, admin):
    brief_url = f"/v1/projects/{world.mine['id']}/brief"
    api.put(brief_url, json={"existing_items": "Grand piano"}, headers=world.client.headers)
    body = {"source_asset_id": world.photo["id"], "items": [{"item_class": "couch", "quantity": 1}, {"item_class": "chair", "quantity": 2}]}
    response = api.post(items_url(world.mine), json=body, headers=world.client.headers)
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["brief"]["existing_items"] == "Grand piano\nFrom a photo: Sofa, Chair × 2"
    listed = api.get(items_url(world.mine), headers=world.designer.headers).json()["data"]
    assert [(i["item_class"], i["label"], i["catalog_type"], i["quantity"]) for i in listed] == [
        ("couch", "Sofa", "sofa", 1), ("chair", "Chair", "chair", 2)]
    # Survives a reload of the brief, for the designer too.
    assert api.get(brief_url, headers=world.designer.headers).json()["data"]["brief"]["existing_items"].endswith("Chair × 2")
    assert events(admin, world.mine, "items.accepted")[-1]["metadata"] == {"count": 3}


def test_plant_is_kept_but_has_no_catalog_type(api, world):
    api.post(items_url(world.theirs), json={"items": [{"item_class": "potted plant", "quantity": 1}]}, headers=world.other_client.headers)
    listed = api.get(items_url(world.theirs), headers=world.other_client.headers).json()["data"]
    assert [(i["label"], i["catalog_type"]) for i in listed] == [("Plant", None)]


@pytest.mark.parametrize("body", [
    {"items": []},
    {"items": [{"item_class": "person", "quantity": 1}]},
    {"items": [{"item_class": "couch", "quantity": 0}]},
    {"items": [{"item_class": "couch", "quantity": 21}]},
    {"items": [{"item_class": "couch", "quantity": 1}, {"item_class": "couch", "quantity": 1}]},
    {"items": [{"item_class": "couch", "quantity": 1, "label": "<b>x</b>"}]},
    {"items": [{"item_class": "couch", "quantity": 1}], "source_asset_id": "not-a-uuid"},
])
def test_invalid_items_are_refused(api, world, body):
    assert api.post(items_url(world.mine), json=body, headers=world.client.headers).status_code == 422


def test_source_photo_must_belong_to_the_project(api, world):
    body = {"source_asset_id": world.their_photo["id"], "items": [{"item_class": "couch", "quantity": 1}]}
    assert api.post(items_url(world.mine), json=body, headers=world.client.headers).status_code == 422


def test_brief_limit_is_kept(api, world, admin):
    brief_url = f"/v1/projects/{world.mine['id']}/brief"
    api.put(brief_url, json={"existing_items": "x" * 990}, headers=world.client.headers)
    before = len(stored(admin, world.mine))
    body = {"items": [{"item_class": "couch", "quantity": 1}]}
    response = api.post(items_url(world.mine), json=body, headers=world.client.headers)
    assert response.status_code == 422 and "1000" in response.json()["error"]
    assert len(stored(admin, world.mine)) == before  # nothing stored when the brief cannot take the line
    api.put(brief_url, json={"existing_items": ""}, headers=world.client.headers)


def test_no_items_for_strangers(api, world):
    body = {"items": [{"item_class": "couch", "quantity": 1}]}
    assert api.get(items_url(world.mine), headers=world.other_client.headers).status_code == 404
    assert api.post(items_url(world.mine), json=body, headers=world.designer_b.headers).status_code == 404
    item = api.get(items_url(world.mine), headers=world.client.headers).json()["data"][0]
    assert api.delete(f"{items_url(world.mine)}/{item['id']}", headers=world.other_client.headers).status_code == 404
    assert api.delete(f"{items_url(world.theirs)}/{item['id']}", headers=world.other_client.headers).status_code == 404


def test_users_cannot_read_or_write_items_through_the_data_api(world, admin):
    from supabase import create_client

    from app.db import settings

    row = admin.table("owned_items").insert({"project_id": world.mine["id"], "item_class": "clock", "quantity": 1}).execute().data[0]
    try:
        def as_user(user):
            client = create_client(settings().supabase_url, settings().supabase_publishable_key)
            client.postgrest.auth(user.token)
            return client

        # The policy lets the project's client and the studio's designer in, and nobody else.
        for user in (world.client, world.designer):
            assert row["id"] in {r["id"] for r in as_user(user).table("owned_items").select("id").execute().data}
        for user in (world.other_client, world.designer_b):
            assert as_user(user).table("owned_items").select("*").eq("project_id", world.mine["id"]).execute().data == []
        # Signed-in users can never write, not even to their own project's items.
        owner = as_user(world.client)
        for write in (
            lambda: owner.table("owned_items").insert({"project_id": world.mine["id"], "item_class": "couch", "quantity": 1}).execute(),
            lambda: owner.table("owned_items").update({"quantity": 5}).eq("id", row["id"]).execute(),
            lambda: owner.table("owned_items").delete().eq("id", row["id"]).execute(),
        ):
            with pytest.raises(Exception, match="permission denied"):
                write()
        anonymous = create_client(settings().supabase_url, settings().supabase_publishable_key)
        with pytest.raises(Exception, match="permission denied"):  # anon has no grant on the table at all
            anonymous.table("owned_items").select("*").execute()
    finally:
        admin.table("owned_items").delete().eq("id", row["id"]).execute()


def test_items_per_project_are_capped(api, world, admin, monkeypatch):
    from app.routes import detection

    monkeypatch.setattr(detection, "MAX_ITEMS_PER_PROJECT", len(stored(admin, world.mine)) + 1)
    body = {"items": [{"item_class": "tv", "quantity": 1}, {"item_class": "sink", "quantity": 1}]}
    assert api.post(items_url(world.mine), json=body, headers=world.client.headers).status_code == 409


def test_service_role_cannot_edit_an_accepted_item(world, admin):
    row = admin.table("owned_items").insert({"project_id": world.mine["id"], "item_class": "vase", "quantity": 1}).execute().data[0]
    try:
        with pytest.raises(Exception, match="permission denied"):
            admin.table("owned_items").update({"quantity": 2}).eq("id", row["id"]).execute()
    finally:
        admin.table("owned_items").delete().eq("id", row["id"]).execute()


def test_removing_an_item(api, world, admin):
    item = api.get(items_url(world.mine), headers=world.client.headers).json()["data"][0]
    assert api.delete(f"{items_url(world.mine)}/{item['id']}", headers=world.designer.headers).status_code == 200
    assert item["id"] not in {row["id"] for row in stored(admin, world.mine)}
    assert api.delete(f"{items_url(world.mine)}/{item['id']}", headers=world.client.headers).status_code == 404


def test_items_stay_when_their_photo_is_deleted_and_go_with_the_project(api, world, admin, make_user):
    photo = upload(api, world.client, world.mine["id"], PNG, kind="existing_item").json()["data"]
    body = {"source_asset_id": photo["id"], "items": [{"item_class": "bed", "quantity": 1}]}
    api.post(items_url(world.mine), json=body, headers=world.client.headers)
    api.delete(f"/v1/projects/{world.mine['id']}/assets/{photo['id']}", headers=world.client.headers)
    bed = [row for row in stored(admin, world.mine) if row["item_class"] == "bed"]
    assert len(bed) == 1 and bed[0]["source_asset_id"] is None

    admin.table("projects").delete().eq("id", world.theirs["id"]).execute()
    assert stored(admin, world.theirs) == []
