"""Budget integration tests (real Supabase): round trip, suggestions, isolation, suspended studio, stale lines."""

from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase
from tests.test_geometry import VALID

pytestmark = needs_supabase

SOFA = {"kind": "furniture", "ref": "sofa", "label": "Sofa", "qty": 1, "unit": "item", "unit_price": 900, "note": ""}
CUSTOM = {"kind": "custom", "label": "Curtains", "qty": 2, "unit": "item", "unit_price": 150}


@pytest.fixture(scope="module")
def world(api, make_user):
    designer_a, client_a, other_client_a, designer_b = (make_user(p) for p in ("bd-a", "bc-a", "bc2-a", "bd-b"))
    studio_a = api.post("/v1/studios", json={"name": "Budget A"}, headers=designer_a.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Budget B"}, headers=designer_b.headers)

    def project(user, name):
        body = {"studio_id": studio_a["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]

    mine = project(client_a, "Mine")
    api.post(f"/v1/projects/{mine['id']}/versions", json={"label": "p", "geometry": VALID}, headers=client_a.headers)
    return SimpleNamespace(designer_a=designer_a, client_a=client_a, other_client_a=other_client_a, designer_b=designer_b,
                           project=mine, other_project=project(other_client_a, "Theirs"))


def url(world, suffix=""):
    return f"/v1/projects/{world.project['id']}/budget{suffix}"


def test_empty_budget_then_save_replace_and_reload(api, world):
    h = world.client_a.headers
    empty = api.get(url(world), headers=h).json()["data"]
    assert empty["items"] == [] and empty["total"] == 0 and "not quotes" in empty["notice"]

    saved = api.put(url(world), json={"items": [SOFA, CUSTOM]}, headers=h).json()["data"]
    assert saved["total"] == 900 + 300 and saved["subtotals"] == {"furniture": 900, "finish": 0, "custom": 300}
    # Saving again replaces the set (repeated saves are fine) and keeps the order.
    again = api.put(url(world), json={"items": [CUSTOM, {**SOFA, "qty": 2.5}]}, headers=h).json()["data"]
    assert [i["label"] for i in again["items"]] == ["Curtains", "Sofa"] and again["total"] == 300 + 2250
    # The studio's designer sees the client's budget.
    assert api.get(url(world), headers=world.designer_a.headers).json()["data"]["total"] == 2550
    assert api.put(url(world), json={"items": []}, headers=h).json()["data"]["items"] == []


def test_budget_reads_the_target_and_currency_from_the_brief(api, world):
    brief = {"budget_min": 1000, "budget_max": 5000, "currency": "EUR"}
    api.put(f"/v1/projects/{world.project['id']}/brief", json=brief, headers=world.client_a.headers)
    data = api.get(url(world), headers=world.client_a.headers).json()["data"]
    assert (data["budget_min"], data["budget_max"], data["currency"]) == (1000, 5000, "EUR")


@pytest.mark.parametrize(
    "bad",
    [
        {**CUSTOM, "qty": -1}, {**CUSTOM, "unit_price": -1}, {**CUSTOM, "unit_price": 10**9}, {**CUSTOM, "unit_price": 1.5},
        {**CUSTOM, "label": ""}, {**CUSTOM, "kind": "other"}, {**CUSTOM, "ref": "x"}, {**CUSTOM, "extra": 1},
        {**SOFA, "ref": None}, {**SOFA, "unit": "m2"},
        {"kind": "finish", "ref": "r1|roof", "label": "x", "qty": 1, "unit": "m2", "unit_price": 1},
    ],
)
def test_invalid_lines_are_rejected(api, world, bad):
    assert api.put(url(world), json={"items": [bad]}, headers=world.client_a.headers).status_code == 422


def test_duplicates_and_more_than_300_lines_are_rejected_but_300_is_fine(api, world):
    h = world.client_a.headers
    assert api.put(url(world), json={"items": [SOFA, SOFA]}, headers=h).status_code == 422
    assert api.put(url(world), json={"items": [CUSTOM] * 301}, headers=h).status_code == 422
    assert api.put(url(world), json={"items": [CUSTOM] * 300}, headers=h).status_code == 200
    api.put(url(world), json={"items": []}, headers=h)


def test_markup_is_stored_as_plain_text(api, world):
    h = world.client_a.headers
    label = "<script>alert(1)</script> '; drop table budget_items; --"
    api.put(url(world), json={"items": [{**CUSTOM, "label": label[:80]}]}, headers=h)
    assert api.get(url(world), headers=h).json()["data"]["items"][0]["label"] == label[:80]
    api.put(url(world), json={"items": []}, headers=h)


def test_suggestions_come_from_the_plan_and_finishes_and_save_nothing(api, world):
    h = world.client_a.headers
    pid = world.project["id"]
    api.put(f"/v1/projects/{pid}/finishes", json={"selections": [{"room_id": "r1", "surface": "floor", "material_id": "oak-floor"}]}, headers=h)
    data = api.get(url(world, "/suggestions"), headers=h).json()["data"]
    kinds = {(s["kind"], s["ref"]): s for s in data["suggestions"]}
    assert kinds[("furniture", "sofa")]["qty"] == 1 and kinds[("furniture", "sofa")]["unit_price"] > 0
    floor = kinds[("finish", "r1|floor")]
    assert floor["unit"] == "m2" and floor["qty"] > 0 and floor["label"].startswith("Living room")
    assert api.get(url(world), headers=h).json()["data"]["items"] == []  # nothing was saved
    # What the API suggests, the API accepts.
    assert api.put(url(world), json={"items": data["suggestions"]}, headers=h).status_code == 200
    api.put(url(world), json={"items": []}, headers=h)


def test_a_line_for_something_no_longer_in_the_plan_is_stale(api, world):
    h = world.client_a.headers
    lamp = {"kind": "furniture", "ref": "bathtub", "label": "Bathtub", "qty": 1, "unit": "item", "unit_price": 700}
    items = api.put(url(world), json={"items": [SOFA, lamp, CUSTOM]}, headers=h).json()["data"]["items"]
    assert [i["stale"] for i in items] == [False, True, False]
    api.put(url(world), json={"items": []}, headers=h)


def test_budget_isolation(api, world):
    for stranger in (world.other_client_a, world.designer_b):
        for path in ("", "/suggestions"):
            assert api.get(url(world, path), headers=stranger.headers).status_code == 404
        assert api.put(url(world), json={"items": []}, headers=stranger.headers).status_code == 404
    assert api.get(url(world), headers={}).status_code == 401
    assert api.put(url(world), json={"items": []}, headers={}).status_code == 401
    missing = "/v1/projects/00000000-0000-0000-0000-000000000000/budget"
    assert api.get(missing, headers=world.client_a.headers).status_code == 404


def test_users_cannot_write_or_read_budget_rows_through_the_data_api(api, world):
    from supabase import create_client

    from app.db import settings

    api.put(url(world), json={"items": [CUSTOM]}, headers=world.client_a.headers)
    data_api = create_client(settings().supabase_url, settings().supabase_publishable_key)
    data_api.postgrest.auth(world.other_client_a.token)
    assert data_api.table("budget_items").select("*").eq("project_id", world.project["id"]).execute().data == []
    with pytest.raises(Exception):
        data_api.table("budget_items").insert({"project_id": world.other_project["id"], "kind": "custom", "label": "x", "qty": 1, "unit": "item", "unit_price": 1, "position": 0}).execute()
    api.put(url(world), json={"items": []}, headers=world.client_a.headers)


def test_suspended_studio_blocks_the_write(api, world, admin):
    pid = world.project["id"]
    studio_id = api.get(f"/v1/projects/{pid}", headers=world.client_a.headers).json()["data"]["studio_id"]
    admin.table("studios").update({"status": "suspended"}).eq("id", studio_id).execute()
    try:
        assert api.put(url(world), json={"items": [CUSTOM]}, headers=world.client_a.headers).status_code == 403
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", studio_id).execute()
