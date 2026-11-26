"""Database-level tests for the estimates schema: read-only RLS for users, atomic replace_estimate for the backend.

These need the migration 20261127090000_estimates.sql applied to the Supabase project in backend/.env.
"""

from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase

pytestmark = needs_supabase


def item(name="Sofa", **over):
    base = {"category": "furniture", "name": name, "room": "Living", "quantity": 1, "unit": "unit",
            "unit_price": 1200, "source": "synthetic", "note": ""}
    return {**base, **over}


def replace(admin, project_id, items, user_id=None, currency="EUR"):
    return admin.rpc("replace_estimate", {"p_project": project_id, "p_user": user_id, "p_currency": currency,
                                          "p_items": items}).execute()


def rows(admin, project_id):
    return admin.table("estimate_items").select("*").eq("project_id", project_id).order("position").execute().data


def user_client(token=None):
    from supabase import create_client

    from app.db import settings

    client = create_client(settings().supabase_url, settings().supabase_publishable_key)
    if token:
        client.postgrest.auth(token)
    return client


@pytest.fixture(scope="module")
def world(api, make_user):
    designer_a, client_a, stranger, designer_b, owner = (make_user(p) for p in ("e-da", "e-ca", "e-st", "e-db", "e-solo"))
    studio_a = api.post("/v1/studios", json={"name": "Est A"}, headers=designer_a.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Est B"}, headers=designer_b.headers)
    body = {"studio_id": studio_a["id"], "name": "Studio project", "property_type": "existing"}
    project = api.post("/v1/projects", json=body, headers=client_a.headers).json()["data"]
    solo = api.post("/v1/projects", json={"name": "Solo", "property_type": "existing"}, headers=owner.headers).json()["data"]
    assert solo["studio_id"] is None
    return SimpleNamespace(designer_a=designer_a, client_a=client_a, stranger=stranger, designer_b=designer_b,
                           owner=owner, pid=project["id"], solo=solo["id"])


@pytest.fixture
def pid(api, make_user, admin):
    """A fresh project per test for the tests that only use the service role."""
    user = make_user("e-tmp")
    project = api.post("/v1/projects", json={"name": "Tmp", "property_type": "existing"}, headers=user.headers).json()["data"]
    return SimpleNamespace(id=project["id"], user=user)


# ---- service role: replace_estimate --------------------------------------------------------------------------


def test_replace_creates_ordered_list_and_replaces_it(admin, pid):
    replace(admin, pid.id, [item("A"), item("B", unit_price=0), item("C", quantity=0.5, unit="m2", room=None, category=None)],
            user_id=pid.user.id)
    got = rows(admin, pid.id)
    assert [(r["position"], r["name"]) for r in got] == [(0, "A"), (1, "B"), (2, "C")]
    assert got[2]["room"] is None and got[2]["category"] is None and got[2]["note"] == ""
    head = admin.table("project_estimates").select("*").eq("project_id", pid.id).single().execute().data
    assert head["currency"] == "EUR" and head["updated_by"] == pid.user.id

    replace(admin, pid.id, [item("Z")], currency="ILS")
    assert [(r["position"], r["name"]) for r in rows(admin, pid.id)] == [(0, "Z")]
    assert admin.table("project_estimates").select("currency").eq("project_id", pid.id).single().execute().data["currency"] == "ILS"


def test_replace_with_empty_list_clears_items_but_keeps_estimate(admin, pid):
    replace(admin, pid.id, [item()])
    replace(admin, pid.id, [])
    assert rows(admin, pid.id) == []
    assert len(admin.table("project_estimates").select("*").eq("project_id", pid.id).execute().data) == 1


def test_boundaries_are_accepted(admin, pid):
    edge = [item("x" * 120, room="r" * 60, quantity=10000, unit_price=100000000, note="n" * 200)]
    replace(admin, pid.id, edge)
    assert len(rows(admin, pid.id)) == 1
    replace(admin, pid.id, [item(f"i{n}") for n in range(200)])
    got = rows(admin, pid.id)
    assert len(got) == 200 and got[199]["name"] == "i199"


@pytest.mark.parametrize("items", [{"name": "x"}, "text", 5, None, [item()] * 201])
def test_non_array_or_too_many_items_rejected_and_old_list_kept(admin, pid, items):
    replace(admin, pid.id, [item("keep")])
    with pytest.raises(Exception):
        replace(admin, pid.id, items)
    assert [r["name"] for r in rows(admin, pid.id)] == ["keep"]


@pytest.mark.parametrize(
    "bad",
    [
        {"quantity": 0}, {"quantity": -1}, {"quantity": 10001}, {"unit_price": -1}, {"unit_price": 100000001},
        {"unit_price": 1.5}, {"name": ""}, {"name": "x" * 121}, {"name": None}, {"room": "r" * 61},
        {"category": "boat"}, {"unit": "kg"}, {"source": "ai"}, {"source": None}, {"note": "n" * 201},
    ],
)
def test_bad_item_rolls_back_the_whole_call(admin, pid, bad):
    replace(admin, pid.id, [item("keep")], currency="USD")
    with pytest.raises(Exception):
        replace(admin, pid.id, [item("new1"), item("bad", **bad)], currency="GBP")
    assert [r["name"] for r in rows(admin, pid.id)] == ["keep"]
    assert admin.table("project_estimates").select("currency").eq("project_id", pid.id).single().execute().data["currency"] == "USD"


def test_bad_currency_and_unknown_project_rejected(admin, pid):
    with pytest.raises(Exception):
        replace(admin, pid.id, [item()], currency="XYZ")
    with pytest.raises(Exception):
        replace(admin, "00000000-0000-0000-0000-000000000000", [item()])
    assert rows(admin, pid.id) == []


def test_parallel_replaces_never_interleave(admin, pid):
    from concurrent.futures import ThreadPoolExecutor

    lists = [[item(f"{tag}{n}") for n in range(30)] for tag in ("a", "b", "c", "d")]
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(lambda items: replace(admin, pid.id, items), lists))
    names = [r["name"] for r in rows(admin, pid.id)]
    assert names in [[i["name"] for i in items] for items in lists]


def test_deleting_the_project_cascades(admin, api, pid):
    replace(admin, pid.id, [item()])
    admin.table("projects").delete().eq("id", pid.id).execute()
    assert admin.table("project_estimates").select("*").eq("project_id", pid.id).execute().data == []
    assert rows(admin, pid.id) == []


# ---- users and anon: read-only through RLS ------------------------------------------------------------------


def test_users_cannot_write_or_call_the_function(world, admin):
    replace(admin, world.pid, [item("secret")])
    for user in (world.client_a, world.designer_a, world.stranger):
        db = user_client(user.token)
        with pytest.raises(Exception):
            db.table("project_estimates").insert({"project_id": world.pid, "currency": "USD"}).execute()
        with pytest.raises(Exception):
            db.table("estimate_items").insert({"project_id": world.pid, "position": 5, "name": "x", "quantity": 1,
                                               "unit_price": 1, "source": "user"}).execute()
        # Updates and deletes are denied outright (no grant), so they raise or match nothing.
        for call in (
            lambda: db.table("project_estimates").update({"currency": "USD"}).eq("project_id", world.pid).execute(),
            lambda: db.table("estimate_items").update({"name": "hacked"}).eq("project_id", world.pid).execute(),
            lambda: db.table("estimate_items").delete().eq("project_id", world.pid).execute(),
            lambda: db.table("project_estimates").delete().eq("project_id", world.pid).execute(),
        ):
            try:
                call()
            except Exception:
                pass
        with pytest.raises(Exception):
            db.rpc("replace_estimate", {"p_project": world.pid, "p_user": user.id, "p_currency": "USD", "p_items": []}).execute()
    assert [r["name"] for r in rows(admin, world.pid)] == ["secret"]
    assert admin.table("project_estimates").select("currency").eq("project_id", world.pid).single().execute().data["currency"] == "EUR"


def test_anon_sees_nothing_and_cannot_call_the_function(world, admin):
    replace(admin, world.pid, [item()])
    anon = user_client()
    for table in ("project_estimates", "estimate_items"):
        try:
            assert anon.table(table).select("*").execute().data == []
        except Exception:
            pass  # permission denied is the expected outcome
    with pytest.raises(Exception):
        anon.rpc("replace_estimate", {"p_project": world.pid, "p_user": None, "p_currency": "USD", "p_items": []}).execute()
    assert len(rows(admin, world.pid)) == 1


def test_read_access_follows_project_visibility(world, admin):
    replace(admin, world.pid, [item("one"), item("two")])
    replace(admin, world.solo, [item("mine")])

    def visible(user, project_id):
        db = user_client(user.token)
        heads = db.table("project_estimates").select("project_id").eq("project_id", project_id).execute().data
        lines = db.table("estimate_items").select("name").eq("project_id", project_id).order("position").execute().data
        return len(heads), [r["name"] for r in lines]

    assert visible(world.client_a, world.pid) == (1, ["one", "two"])  # the project's client
    assert visible(world.designer_a, world.pid) == (1, ["one", "two"])  # member of the project's studio
    assert visible(world.stranger, world.pid) == (0, [])
    assert visible(world.designer_b, world.pid) == (0, [])  # member of another studio
    # A project without a studio is visible to its owner only.
    assert visible(world.owner, world.solo) == (1, ["mine"])
    for other in (world.stranger, world.designer_a, world.designer_b, world.client_a):
        assert visible(other, world.solo) == (0, [])
