"""Phase 2 integration tests: brief, catalog, isolation between studios and clients."""

from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase

pytestmark = needs_supabase


@pytest.fixture(scope="module")
def world(api, make_user):
    designer_a, client_a, other_client_a, designer_b = (make_user(p) for p in ("d-a", "c-a", "c2-a", "d-b"))
    studio_a = api.post("/v1/studios", json={"name": "Design A"}, headers=designer_a.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Design B"}, headers=designer_b.headers)

    def project(user, name):
        body = {"studio_id": studio_a["id"], "name": name, "property_type": "existing"}
        return api.post("/v1/projects", json=body, headers=user.headers).json()["data"]

    return SimpleNamespace(
        designer_a=designer_a,
        client_a=client_a,
        other_client_a=other_client_a,
        designer_b=designer_b,
        project=project(client_a, "Mine"),
        other_project=project(other_client_a, "Theirs"),
    )


def test_catalog_requires_sign_in_and_lists_styles(api, world):
    assert api.get("/v1/catalog").status_code == 401
    data = api.get("/v1/catalog", headers=world.client_a.headers).json()["data"]
    assert {"modern", "scandinavian"} <= {s["id"] for s in data["styles"]}
    assert all(set(m["surfaces"]) <= set(data["surfaces"]) for m in data["materials"])


def test_empty_brief_defaults_then_save_and_reload(api, world):
    url = f"/v1/projects/{world.project['id']}/brief"
    first = api.get(url, headers=world.client_a.headers).json()["data"]
    assert first["updated_at"] is None and first["brief"]["styles"] == []

    brief = {"styles": ["japandi", "modern"], "colors": ["#aabbcc"], "budget_min": 1000, "budget_max": 5000,
             "currency": "EUR", "adults": 2, "children": 1, "pets": True, "lifestyle": "Works from home",
             "needs": "Storage", "constraints": "No wall changes", "existing_items": "Grand piano"}
    assert api.put(url, json=brief, headers=world.client_a.headers).status_code == 200
    # Saving again replaces the brief (repeated saves are fine).
    assert api.put(url, json={**brief, "adults": 3}, headers=world.client_a.headers).status_code == 200
    saved = api.get(url, headers=world.client_a.headers).json()["data"]["brief"]
    assert saved == {**brief, "adults": 3}
    # The studio's designer sees the client's brief.
    assert api.get(url, headers=world.designer_a.headers).json()["data"]["brief"]["adults"] == 3


@pytest.mark.parametrize(
    "patch",
    [
        {"styles": ["not-a-style"]},
        {"styles": ["modern", "modern"]},
        {"styles": ["modern", "japandi", "classic", "bohemian", "industrial", "scandinavian"]},
        {"colors": ["red"]},
        {"colors": ["#aabbcc", "#aabbcc"]},
        {"budget_min": 10, "budget_max": 5},
        {"budget_min": -1},
        {"budget_max": 10**12},
        {"currency": "XYZ"},
        {"adults": -1},
        {"children": 21},
        {"lifestyle": "x" * 1001},
        {"unknown_field": 1},
    ],
)
def test_invalid_brief_is_rejected(api, world, patch):
    url = f"/v1/projects/{world.project['id']}/brief"
    assert api.put(url, json=patch, headers=world.client_a.headers).status_code == 422


def test_brief_boundaries_are_accepted(api, world):
    url = f"/v1/projects/{world.project['id']}/brief"
    edge = {"budget_min": 0, "budget_max": 0, "adults": 0, "children": 0, "lifestyle": "x" * 1000}
    assert api.put(url, json=edge, headers=world.client_a.headers).status_code == 200
    assert api.put(url, json={}, headers=world.client_a.headers).status_code == 200


def test_brief_text_is_stored_as_plain_data(api, world):
    url = f"/v1/projects/{world.project['id']}/brief"
    payload = '<script>alert(1)</script> "; drop table projects; --'
    api.put(url, json={"needs": payload}, headers=world.client_a.headers)
    assert api.get(url, headers=world.client_a.headers).json()["data"]["brief"]["needs"] == payload


def test_brief_isolation(api, world):
    url = f"/v1/projects/{world.project['id']}/brief"
    for stranger in (world.other_client_a, world.designer_b):
        assert api.get(url, headers=stranger.headers).status_code == 404
        assert api.put(url, json={"adults": 9}, headers=stranger.headers).status_code == 404
    assert api.put(url, json={}, headers={}).status_code == 401
    assert api.get("/v1/projects/00000000-0000-0000-0000-000000000000/brief", headers=world.client_a.headers).status_code == 404


def test_users_cannot_write_or_read_briefs_through_the_data_api(world, admin):
    from supabase import create_client

    from app.db import settings

    api = create_client(settings().supabase_url, settings().supabase_publishable_key)
    api.postgrest.auth(world.other_client_a.token)
    assert api.table("project_briefs").select("*").eq("project_id", world.project["id"]).execute().data == []
    with pytest.raises(Exception):
        api.table("project_briefs").insert({"project_id": world.other_project["id"], "brief": {}}).execute()
