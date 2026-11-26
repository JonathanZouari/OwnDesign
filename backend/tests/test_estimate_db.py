"""Database-level tests for the estimates schema: read-only RLS for users, atomic replace_estimate for the backend.

These need the migrations 20261127090000_estimates.sql and 20261127100000_estimate_version_check.sql applied to
the Supabase project in backend/.env.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError

from tests.conftest import needs_supabase

pytestmark = needs_supabase

STALE = "PT409"  # raised by replace_estimate; PostgREST answers it with HTTP 409


def item(name="Sofa", **over):
    base = {"category": "furniture", "name": name, "room": "Living", "quantity": 1, "unit": "unit",
            "unit_price": 1200, "source": "synthetic", "note": ""}
    return {**base, **over}


def replace(admin, project_id, items, user_id=None, currency="EUR", **version):
    """Without keyword arguments this sends the original four named parameters; pass p_check / p_base to add them."""
    return admin.rpc("replace_estimate", {"p_project": project_id, "p_user": user_id, "p_currency": currency,
                                          "p_items": items, **version}).execute()


def head(admin, project_id):
    """The estimate's header row, or None when no list was ever saved."""
    data = admin.table("project_estimates").select("*").eq("project_id", project_id).execute().data
    return data[0] if data else None


def race(project_id, lists, **version):
    """Runs one replace per list in parallel and returns, per call, None on success or the error code."""
    from supabase import create_client

    from app.db import settings

    def one(items):
        # httpx clients are not safe to share between threads on Windows: one service client per thread.
        client = create_client(settings().supabase_url, settings().supabase_secret_key)
        try:
            replace(client, project_id, items, **version)
        except APIError as error:
            return error.code
        return None

    with ThreadPoolExecutor(len(lists)) as pool:
        return list(pool.map(one, lists))


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
    replace(admin, pid.id, [item("A"), item("B", unit_price=0), item("C", quantity=0.5, unit="m2", room=None)],
            user_id=pid.user.id)
    got = rows(admin, pid.id)
    assert [(r["position"], r["name"]) for r in got] == [(0, "A"), (1, "B"), (2, "C")]
    assert got[2]["room"] is None and got[2]["note"] == ""
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
        {"category": "boat"}, {"category": None}, {"unit": "kg"}, {"unit": None}, {"source": "ai"}, {"source": None}, {"note": "n" * 201},
    ],
)
def test_bad_item_rolls_back_the_whole_call(admin, pid, bad):
    replace(admin, pid.id, [item("keep")], currency="USD")
    with pytest.raises(Exception):
        replace(admin, pid.id, [item("new1"), item("bad", **bad)], currency="GBP")
    assert [r["name"] for r in rows(admin, pid.id)] == ["keep"]
    assert admin.table("project_estimates").select("currency").eq("project_id", pid.id).single().execute().data["currency"] == "USD"


@pytest.mark.parametrize("missing", ["category", "unit"])
def test_missing_category_or_unit_is_rejected(admin, pid, missing):
    replace(admin, pid.id, [item("keep")], currency="USD")
    broken = item("bad")
    del broken[missing]
    with pytest.raises(Exception):
        replace(admin, pid.id, [item("new1"), broken], currency="GBP")
    assert [r["name"] for r in rows(admin, pid.id)] == ["keep"]


def test_bad_currency_and_unknown_project_rejected(admin, pid):
    with pytest.raises(Exception):
        replace(admin, pid.id, [item()], currency="XYZ")
    with pytest.raises(Exception):
        replace(admin, "00000000-0000-0000-0000-000000000000", [item()])
    assert rows(admin, pid.id) == []


def test_parallel_replaces_never_interleave(admin, pid):
    lists = [[item(f"{tag}{n}") for n in range(30)] for tag in ("a", "b", "c", "d")]
    assert race(pid.id, lists) == [None] * 4
    names = [r["name"] for r in rows(admin, pid.id)]
    assert names in [[i["name"] for i in items] for items in lists]


def test_deleting_the_project_cascades(admin, api, pid):
    replace(admin, pid.id, [item()])
    admin.table("projects").delete().eq("id", pid.id).execute()
    assert admin.table("project_estimates").select("*").eq("project_id", pid.id).execute().data == []
    assert rows(admin, pid.id) == []


# ---- service role: version check -----------------------------------------------------------------------------


def assert_stale(admin, project_id, **version):
    """The checked call raises PT409 and leaves the header and the list exactly as they were."""
    before = head(admin, project_id), rows(admin, project_id)
    with pytest.raises(APIError) as error:
        replace(admin, project_id, [item("rejected")], currency="GBP", p_check=True, **version)
    assert error.value.code == STALE
    assert (head(admin, project_id), rows(admin, project_id)) == before


def test_without_check_the_list_is_overwritten_whatever_the_base(admin, pid):
    replace(admin, pid.id, [item("first")])
    old = head(admin, pid.id)["updated_at"]
    replace(admin, pid.id, [item("second")])  # the original four-parameter call
    replace(admin, pid.id, [item("third")], p_check=False, p_base=old)  # a stale base is ignored
    replace(admin, pid.id, [item("fourth")], p_base=old)  # p_check defaults to false
    assert [r["name"] for r in rows(admin, pid.id)] == ["fourth"]


def test_check_with_matching_base_succeeds_repeatedly(admin, pid):
    replace(admin, pid.id, [item("first")])
    for name, currency in (("second", "ILS"), ("third", "USD")):
        replace(admin, pid.id, [item(name)], currency=currency, p_check=True, p_base=head(admin, pid.id)["updated_at"])
        assert [r["name"] for r in rows(admin, pid.id)] == [name]
        assert head(admin, pid.id)["currency"] == currency


def test_check_with_stale_base_is_rejected_and_nothing_changes(admin, pid):
    replace(admin, pid.id, [item("first")], currency="USD")
    stale = head(admin, pid.id)["updated_at"]
    replace(admin, pid.id, [item("second")], currency="ILS")
    assert_stale(admin, pid.id, p_base=stale)
    assert_stale(admin, pid.id, p_base=stale)  # repeating the request does not get it through


@pytest.mark.parametrize("microseconds", [-1, 1])
def test_check_compares_the_base_to_the_microsecond(admin, pid, microseconds):
    replace(admin, pid.id, [item("keep")])
    current = datetime.fromisoformat(head(admin, pid.id)["updated_at"])
    assert_stale(admin, pid.id, p_base=(current + timedelta(microseconds=microseconds)).isoformat())


@pytest.mark.parametrize("version", [{"p_base": None}, {}], ids=["null base", "base omitted"])
def test_check_with_null_base_creates_a_list_only_when_none_exists(admin, pid, version):
    replace(admin, pid.id, [item("first")], p_check=True, **version)
    assert [r["name"] for r in rows(admin, pid.id)] == ["first"]
    assert_stale(admin, pid.id, **version)


def test_check_with_null_base_is_rejected_when_the_saved_list_is_empty(admin, pid):
    replace(admin, pid.id, [])
    assert_stale(admin, pid.id, p_base=None)


def test_check_with_a_base_is_rejected_when_no_list_exists(admin, pid):
    assert_stale(admin, pid.id, p_base="2026-01-01T00:00:00+00:00")
    assert head(admin, pid.id) is None


def test_malformed_base_is_rejected_and_nothing_changes(admin, pid):
    replace(admin, pid.id, [item("keep")])
    before = head(admin, pid.id)
    with pytest.raises(APIError) as error:
        replace(admin, pid.id, [item("new")], p_check=True, p_base="not-a-timestamp")
    assert error.value.code == "22007"  # invalid datetime format
    assert head(admin, pid.id) == before
    assert [r["name"] for r in rows(admin, pid.id)] == ["keep"]


def test_failed_checked_save_keeps_the_base_valid(admin, pid):
    replace(admin, pid.id, [item("keep")])
    base = head(admin, pid.id)["updated_at"]
    with pytest.raises(APIError) as error:
        replace(admin, pid.id, [item("bad", quantity=0)], p_check=True, p_base=base)
    assert error.value.code == "23514"  # check constraint, not a version conflict
    replace(admin, pid.id, [item("fixed")], p_check=True, p_base=base)
    assert [r["name"] for r in rows(admin, pid.id)] == ["fixed"]


def test_updated_at_moves_forward_on_every_save(admin, pid):
    stamps = []
    for version in ({}, {}, {"p_check": False}, {}):
        replace(admin, pid.id, [item("same")], **version)  # identical content still makes a new version
        stamps.append(datetime.fromisoformat(head(admin, pid.id)["updated_at"]))
    replace(admin, pid.id, [item("same")], p_check=True, p_base=head(admin, pid.id)["updated_at"])
    stamps.append(datetime.fromisoformat(head(admin, pid.id)["updated_at"]))
    assert all(earlier < later for earlier, later in zip(stamps, stamps[1:]))


@pytest.mark.parametrize("existing", [True, False], ids=["existing list", "first save"])
def test_parallel_checked_saves_from_the_same_base_let_exactly_one_through(admin, pid, existing):
    base = None
    if existing:
        replace(admin, pid.id, [item("start")])
        base = head(admin, pid.id)["updated_at"]
    lists = [[item(f"{tag}{n}") for n in range(30)] for tag in ("a", "b")]
    results = race(pid.id, lists, p_check=True, p_base=base)
    assert sorted(results, key=str) == [None, STALE]
    winner = lists[results.index(None)]
    assert [r["name"] for r in rows(admin, pid.id)] == [i["name"] for i in winner]


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


@pytest.mark.parametrize("who", ["client_a", "designer_a", "stranger", "designer_b", "owner", None])
@pytest.mark.parametrize("check", [True, False])
def test_users_and_anon_cannot_execute_the_versioned_signature(world, admin, who, check):
    replace(admin, world.pid, [item("secret")])
    before = head(admin, world.pid)
    user = getattr(world, who) if who else None
    db = user_client(user.token if user else None)
    with pytest.raises(APIError) as error:
        replace(db, world.pid, [], user_id=user.id if user else None, currency="USD",
                p_check=check, p_base=before["updated_at"])
    assert error.value.code == "42501"  # permission denied, not a version conflict
    assert head(admin, world.pid) == before
    assert [r["name"] for r in rows(admin, world.pid)] == ["secret"]


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
