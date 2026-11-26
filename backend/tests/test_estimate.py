"""Estimate API: budget and shopping list. Needs migration 20261127090000_estimates.sql applied."""

from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase

pytestmark = needs_supabase


def line(name="Sofa", **over):
    base = {"category": "furniture", "name": name, "room": "Living", "quantity": 1, "unit": "unit", "unit_price": 1000,
            "source": "user", "note": ""}
    return {**base, **over}


def body(items=None, currency="ILS"):
    return {"currency": currency, "items": [line()] if items is None else items}


@pytest.fixture(scope="module")
def world(api, make_user):
    designer_a, client_a, other_client_a, stranger, designer_b = (make_user(p) for p in ("es-da", "es-ca", "es-ca2", "es-st", "es-db"))
    studio_a = api.post("/v1/studios", json={"name": "Estimate A"}, headers=designer_a.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Estimate B"}, headers=designer_b.headers)

    def project(user, name):
        data = {"studio_id": studio_a["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=data, headers=user.headers).json()["data"]

    return SimpleNamespace(
        designer_a=designer_a, client_a=client_a, other_client_a=other_client_a, stranger=stranger, designer_b=designer_b,
        studio_id=studio_a["id"],
        project=project(client_a, "Mine"),
        fresh=project(client_a, "Untouched"),  # never saved to
        briefed=project(other_client_a, "Budgeted"),  # the budget-status tests only
    )


@pytest.fixture
def pr(world):
    """The module's main project; every test overwrites its list (a client may only own a few projects)."""
    project = world.project
    return SimpleNamespace(project=project, url=f"/v1/projects/{project['id']}/estimate")


def put(api, user, url, data):
    return api.put(url, json=data, headers=user.headers)


# ---- sample ------------------------------------------------------------------------------------------------


def test_sample_requires_sign_in_and_validates(api, world):
    from app.schemas import EstimateBody

    assert api.get("/v1/estimate/sample").status_code == 401
    sample = api.get("/v1/estimate/sample", headers=world.client_a.headers).json()["data"]
    assert sample["currency"] == "ILS" and sample["name"] == "Synthetic shopping list"
    assert len(sample["items"]) >= 20
    assert {i["source"] for i in sample["items"]} == {"synthetic"}
    EstimateBody.model_validate({"currency": sample["currency"], "items": sample["items"]})


# ---- read / write -------------------------------------------------------------------------------------------


def test_empty_default(api, world):
    fresh = api.get(f"/v1/projects/{world.fresh['id']}/estimate", headers=world.client_a.headers).json()["data"]
    assert fresh["currency"] is None and fresh["items"] == [] and fresh["status"] == "no_items"
    assert fresh["updated_at"] is None and fresh["totals"] == {"total": 0, "by_category": {}}


def test_save_and_reload_roundtrip_keeps_order_and_source(api, world, pr):
    items = [line("B", source="synthetic", category="lighting", room="  ", note="  hi "), line("A", quantity=2.5, unit="m2", room=None),
             line("C", category="textile", unit="set", unit_price=0)]
    saved = put(api, world.client_a, pr.url, body(items, "EUR"))
    assert saved.status_code == 200
    got = api.get(pr.url, headers=world.client_a.headers).json()["data"]
    assert got["currency"] == "EUR" and got["updated_at"]
    assert [i["name"] for i in got["items"]] == ["B", "A", "C"]
    assert [i["position"] for i in got["items"]] == [0, 1, 2]
    assert [i["source"] for i in got["items"]] == ["synthetic", "user", "user"]
    assert got["items"][0]["room"] is None and got["items"][0]["note"] == "hi"
    assert got["items"][1]["quantity"] == 2.5 and isinstance(got["items"][1]["quantity"], float)
    assert saved.json()["data"] == got
    assert all("id" in i for i in got["items"])


@pytest.mark.parametrize(
    "items, total",
    [
        ([line(quantity=3, unit_price=1)], 3),
        ([line(quantity=0.1, unit_price=3)], 0),  # 0.3 rounds to 0
        ([line(quantity=0.1, unit_price=5)], 1),  # 0.5 rounds half up to 1
        ([line(quantity=2.35, unit_price=100)], 235),
        ([line(quantity=0.01, unit_price=150)], 2),  # 1.5 -> 2
        ([line(quantity=1.5, unit_price=3)], 5),  # 4.5 -> 5
        ([line(quantity=10000, unit_price=100_000_000)], 10**12),
        ([line(quantity=0.1, unit_price=1), line(quantity=0.1, unit_price=1)], 0),  # amounts round per line, then sum
        ([line(quantity=2.35, unit_price=100), line(quantity=1, unit_price=7)], 242),
    ],
)
def test_amounts_and_totals_are_exact(api, world, pr, items, total):
    got = put(api, world.client_a, pr.url, body(items)).json()["data"]
    assert got["totals"]["total"] == total
    assert sum(i["amount"] for i in got["items"]) == total


def test_by_category(api, world, pr):
    items = [line("a", category="furniture", unit_price=100), line("b", category="furniture", unit_price=50),
             line("c", category="lighting", quantity=2, unit_price=30)]
    got = put(api, world.client_a, pr.url, body(items)).json()["data"]
    assert got["totals"] == {"total": 210, "by_category": {"furniture": 150, "lighting": 60}}
    assert [i["amount"] for i in got["items"]] == [100, 50, 60]


@pytest.mark.parametrize(
    "patch",
    [
        {"quantity": 0}, {"quantity": -1}, {"quantity": 10000.01}, {"quantity": 1.234}, {"quantity": "abc"}, {"quantity": True},
        {"quantity": "NaN"}, {"quantity": "Infinity"}, {"quantity": None}, {"quantity": [1]},
        {"quantity": "1e400"}, {"quantity": 1e30}, {"quantity": "12345678901234567890123456789"}, {"quantity": "-0"},
        {"quantity": "1e-400"}, {"quantity": " "},
        {"unit_price": -1}, {"unit_price": 1.5}, {"unit_price": 100_000_001}, {"unit_price": True}, {"unit_price": "5"},
        {"unit_price": None},
        {"name": ""}, {"name": "   "}, {"name": "x" * 121}, {"room": "r" * 61}, {"note": "n" * 201},
        {"category": "boat"}, {"category": None}, {"unit": "kg"}, {"unit": None}, {"source": "ai"}, {"unknown": 1},
    ],
)
def test_invalid_item_is_rejected_and_nothing_changes(api, world, pr, patch):
    assert put(api, world.client_a, pr.url, body([line("keep")])).status_code == 200
    assert put(api, world.client_a, pr.url, body([line("new"), {**line("bad"), **patch}])).status_code == 422
    assert [i["name"] for i in api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"]] == ["keep"]


@pytest.mark.parametrize(
    "data",
    [
        {"currency": "ILS", "items": [line()] * 201},
        {"currency": "XYZ", "items": []},
        {"currency": None, "items": []},
        {"items": []},
        {"currency": "ILS"},
        {"currency": "ILS", "items": [], "extra": 1},
        {"currency": "ILS", "items": "x"},
        {"currency": "ILS", "items": [5]},
        [],
    ],
)
def test_invalid_body_is_rejected(api, world, pr, data):
    assert put(api, world.client_a, pr.url, data).status_code == 422


def test_missing_category_unit_price_or_quantity_is_rejected(api, world, pr):
    for key in ("category", "name", "quantity", "unit", "unit_price"):
        item = line()
        del item[key]
        assert put(api, world.client_a, pr.url, body([item])).status_code == 422, key


def test_boundaries_are_accepted(api, world, pr):
    edge = [line("x" * 120, room="r" * 60, quantity=10000, unit_price=100_000_000, note="n" * 200)]
    assert put(api, world.client_a, pr.url, body(edge)).status_code == 200
    assert put(api, world.client_a, pr.url, body([line(quantity=0.01, unit_price=0)])).status_code == 200
    got = put(api, world.client_a, pr.url, body([line(f"i{n}") for n in range(200)])).json()["data"]
    assert len(got["items"]) == 200 and got["items"][199]["name"] == "i199"
    cleared = put(api, world.client_a, pr.url, body([], "USD")).json()["data"]
    assert cleared["items"] == [] and cleared["status"] == "no_items" and cleared["currency"] == "USD"


def test_quantity_given_as_decimal_string_or_with_trailing_zero(api, world, pr):
    got = put(api, world.client_a, pr.url, body([line(quantity="2.50"), line(quantity="3.0"), line(quantity=4)])).json()["data"]
    assert [i["quantity"] for i in got["items"]] == [2.5, 3.0, 4.0]


def test_quantity_with_extra_trailing_zeros_is_accepted(api, world, pr):
    saved = put(api, world.client_a, pr.url, body([line(quantity="1.500")]))
    assert saved.status_code == 200
    assert saved.json()["data"]["items"][0]["quantity"] == 1.5


@pytest.mark.parametrize("room", ["", "   "])
def test_blank_room_is_stored_as_null(api, world, pr, room):
    assert put(api, world.client_a, pr.url, body([line(room=room)])).status_code == 200
    assert api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"][0]["room"] is None


def test_null_note_is_stored_as_empty(api, world, pr):
    assert put(api, world.client_a, pr.url, body([line(note=None)])).status_code == 200
    assert api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"][0]["note"] == ""


def test_omitted_source_is_stored_as_user(api, world, pr):
    item = line()
    del item["source"]
    assert put(api, world.client_a, pr.url, body([item])).status_code == 200
    assert api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"][0]["source"] == "user"


def test_markup_text_is_stored_verbatim(api, world, pr):
    text = "<script>alert(1)</script> & \"quotes\""
    got = put(api, world.client_a, pr.url, body([line(text, room="<b>x</b>", note="<img src=x onerror=1>")])).json()["data"]
    assert got["items"][0]["name"] == text and got["items"][0]["room"] == "<b>x</b>"
    assert got["items"][0]["note"] == "<img src=x onerror=1>"


def test_repeated_put_is_idempotent(api, world, pr):
    data = body([line("a"), line("b", quantity=2.35, unit_price=100)])
    first = put(api, world.client_a, pr.url, data).json()["data"]
    second = put(api, world.client_a, pr.url, data).json()["data"]
    strip = lambda e: [{k: v for k, v in i.items() if k != "id"} for i in e["items"]]  # noqa: E731
    assert strip(first) == strip(second) and first["totals"] == second["totals"]
    assert len(second["items"]) == 2


# ---- statuses ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "brief, expected",
    [
        (None, "no_budget"),
        ({}, "no_budget"),
        ({"budget_min": 2000, "budget_max": 5000, "currency": "ILS"}, "under"),
        ({"budget_min": 1000, "budget_max": 5000, "currency": "ILS"}, "within"),
        ({"budget_min": 1000, "budget_max": 1000, "currency": "ILS"}, "within"),  # min == max == total
        ({"budget_min": 100, "budget_max": 1000, "currency": "ILS"}, "within"),  # bounds are inclusive
        ({"budget_min": 1000, "currency": "ILS"}, "within"),  # open upper bound
        ({"budget_max": 5000, "currency": "ILS"}, "within"),  # open lower bound
        ({"budget_min": 100, "budget_max": 999, "currency": "ILS"}, "over"),
        ({"budget_max": 999, "currency": "ILS"}, "over"),
        ({"budget_min": 1001, "currency": "ILS"}, "under"),
        ({"budget_min": 100, "budget_max": 5000, "currency": "EUR"}, "currency_mismatch"),
    ],
)
def test_status_against_the_brief_budget(api, world, brief, expected):
    project, user = world.briefed, world.other_client_a
    url, brief_url = f"/v1/projects/{project['id']}/estimate", f"/v1/projects/{project['id']}/brief"
    assert put(api, user, url, body([line(unit_price=1000)], "ILS")).status_code == 200  # total 1000
    if brief is not None:
        assert put(api, user, brief_url, brief).status_code == 200
    got = api.get(url, headers=user.headers).json()["data"]
    assert got["status"] == expected and got["totals"]["total"] == 1000
    if brief is not None:
        assert got["budget"] == {"min": brief.get("budget_min"), "max": brief.get("budget_max"), "currency": brief.get("currency", "USD")}


def test_no_brief_means_null_budget(api, world, make_user):
    user = make_user("es-nobrief")
    data = {"studio_id": world.studio_id, "name": "NB", "property_type": "new_build"}
    project = api.post("/v1/projects", json=data, headers=user.headers).json()["data"]
    url = f"/v1/projects/{project['id']}/estimate"
    assert put(api, user, url, body()).status_code == 200
    got = api.get(url, headers=user.headers).json()["data"]
    assert got["budget"] is None and got["status"] == "no_budget"


# ---- isolation and roles -----------------------------------------------------------------------------------


def test_stranger_and_other_studio_member_get_404(api, world, pr):
    assert put(api, world.client_a, pr.url, body([line("secret")])).status_code == 200
    for user in (world.stranger, world.designer_b):
        assert api.get(pr.url, headers=user.headers).status_code == 404
        assert put(api, user, pr.url, body([line("hacked")])).status_code == 404
    assert [i["name"] for i in api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"]] == ["secret"]
    assert api.get(pr.url).status_code == 401
    assert api.put(pr.url, json=body()).status_code == 401
    assert api.get("/v1/projects/00000000-0000-0000-0000-000000000000/estimate", headers=world.client_a.headers).status_code == 404
    assert api.get("/v1/projects/not-a-uuid/estimate", headers=world.client_a.headers).status_code == 422


def test_studio_designer_can_read_and_write(api, world, pr):
    assert put(api, world.client_a, pr.url, body([line("client")])).status_code == 200
    assert [i["name"] for i in api.get(pr.url, headers=world.designer_a.headers).json()["data"]["items"]] == ["client"]
    assert put(api, world.designer_a, pr.url, body([line("designer")], "USD")).status_code == 200
    got = api.get(pr.url, headers=world.client_a.headers).json()["data"]
    assert [i["name"] for i in got["items"]] == ["designer"] and got["currency"] == "USD"


def test_another_client_of_the_same_studio_gets_404(api, world, pr):
    assert put(api, world.client_a, pr.url, body([line("mine")])).status_code == 200
    assert api.get(pr.url, headers=world.other_client_a.headers).status_code == 404
    assert put(api, world.other_client_a, pr.url, body([line("hacked")])).status_code == 404
    assert [i["name"] for i in api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"]] == ["mine"]


def test_suspended_studio_blocks_the_write_but_not_the_read(api, world, pr, admin):
    assert put(api, world.client_a, pr.url, body([line("before")])).status_code == 200
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio_id).execute()
    try:
        for user in (world.client_a, world.designer_a):
            assert put(api, user, pr.url, body([line("after")])).status_code == 403
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio_id).execute()
    assert [i["name"] for i in api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"]] == ["before"]


def test_concurrent_puts_end_in_exactly_one_list(api, world, pr):
    from fastapi.testclient import TestClient

    from app.main import app

    lists = [[line(f"{tag}{n}") for n in range(25)] for tag in ("a", "b", "c")]

    def save(items):
        with TestClient(app) as thread_client:  # one client (and connection pool) per thread
            return thread_client.put(pr.url, json=body(items), headers=world.client_a.headers).status_code

    with ThreadPoolExecutor(3) as pool:
        codes = list(pool.map(save, lists))
    assert codes == [200, 200, 200]
    names = [i["name"] for i in api.get(pr.url, headers=world.client_a.headers).json()["data"]["items"]]
    assert names in [[i["name"] for i in items] for items in lists]
