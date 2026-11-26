"""Phase 2 integration tests: brief, catalog, isolation between studios and clients."""

from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase

pytestmark = needs_supabase


@pytest.fixture(scope="module")
def world(api, make_user, admit):
    designer_a, client_a, other_client_a, designer_b = (make_user(p) for p in ("d-a", "c-a", "c2-a", "d-b"))
    studio_a = api.post("/v1/studios", json={"name": "Design A"}, headers=designer_a.headers).json()["data"]
    api.post("/v1/studios", json={"name": "Design B"}, headers=designer_b.headers)

    def project(user, name):
        admit(studio_a["id"], user)
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


# ---- finishes -------------------------------------------------------------------------------------------------

from tests.test_geometry import VALID  # noqa: E402


@pytest.fixture(scope="module")
def planned(api, world):
    api.post(f"/v1/projects/{world.project['id']}/versions", json={"label": "p", "geometry": VALID}, headers=world.client_a.headers)
    return world.project["id"], VALID["rooms"][0]["id"]


def test_finishes_save_replace_and_reload(api, world, planned):
    project_id, room = planned
    url = f"/v1/projects/{project_id}/finishes"
    assert api.get(url, headers=world.client_a.headers).json()["data"] == []
    one = {"selections": [{"room_id": room, "surface": "floor", "material_id": "oak-floor"}]}
    assert api.put(url, json=one, headers=world.client_a.headers).status_code == 200
    two = {"selections": [{"room_id": room, "surface": "walls", "material_id": "sage-paint"}]}
    assert api.put(url, json=two, headers=world.client_a.headers).status_code == 200
    rows = api.get(url, headers=world.designer_a.headers).json()["data"]
    assert [(r["room_id"], r["surface"], r["material_id"]) for r in rows] == [(room, "walls", "sage-paint")]
    assert api.put(url, json={"selections": []}, headers=world.client_a.headers).status_code == 200
    assert api.get(url, headers=world.client_a.headers).json()["data"] == []


@pytest.mark.parametrize(
    "selection",
    [
        {"room_id": "ROOM", "surface": "floor", "material_id": "nope"},
        {"room_id": "ROOM", "surface": "floor", "material_id": "sage-paint"},  # paint is not a floor
        {"room_id": "ROOM", "surface": "roof", "material_id": "oak-floor"},
        {"room_id": "no-such-room", "surface": "floor", "material_id": "oak-floor"},
        {"room_id": "../x", "surface": "floor", "material_id": "oak-floor"},
    ],
)
def test_invalid_finish_rejected(api, world, planned, selection):
    project_id, room = planned
    selection = {**selection, "room_id": room if selection["room_id"] == "ROOM" else selection["room_id"]}
    url = f"/v1/projects/{project_id}/finishes"
    assert api.put(url, json={"selections": [selection]}, headers=world.client_a.headers).status_code == 422


def test_duplicate_finish_and_isolation(api, world, planned):
    project_id, room = planned
    url = f"/v1/projects/{project_id}/finishes"
    row = {"room_id": room, "surface": "floor", "material_id": "oak-floor"}
    assert api.put(url, json={"selections": [row, row]}, headers=world.client_a.headers).status_code == 422
    assert api.put(url, json={"selections": [row] * 401}, headers=world.client_a.headers).status_code == 422
    for stranger in (world.other_client_a, world.designer_b):
        assert api.get(url, headers=stranger.headers).status_code == 404
        assert api.put(url, json={"selections": [row]}, headers=stranger.headers).status_code == 404


# ---- assets and moodboard -------------------------------------------------------------------------------------

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3690000000049454e44ae426082"
)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32


def upload(api, user, project_id, data, name="x.png", mime="image/png", kind="inspiration"):
    return api.post(
        f"/v1/projects/{project_id}/assets",
        files={"file": (name, data, mime)},
        data={"kind": kind, "caption": "cap"},
        headers=user.headers,
    )


def test_asset_upload_list_signed_url_delete(api, world):
    pid = world.project["id"]
    for data, mime in ((PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp")):
        assert upload(api, world.client_a, pid, data, mime=mime).status_code == 201
    listed = api.get(f"/v1/projects/{pid}/assets", headers=world.designer_a.headers).json()["data"]
    assert len(listed) == 3 and all(a["url"].startswith("http") and "storage_path" not in a for a in listed)
    import httpx

    assert httpx.get(next(a["url"] for a in listed if a["mime"] == "image/png")).status_code == 200
    for asset in listed:
        assert api.delete(f"/v1/projects/{pid}/assets/{asset['id']}", headers=world.client_a.headers).status_code == 200
    assert api.get(f"/v1/projects/{pid}/assets", headers=world.client_a.headers).json()["data"] == []


@pytest.mark.parametrize(
    "data,name,mime,kind",
    [
        (b"GIF89a....", "a.png", "image/png", "inspiration"),  # wrong content behind a png name
        (b"<svg onload=alert(1)>", "a.svg", "image/svg+xml", "inspiration"),
        (PNG, "a.png", "image/png", "other"),  # unknown kind
        (b"", "a.png", "image/png", "inspiration"),  # empty
        (PNG + b"\x00" * (5 * 1024 * 1024), "big.png", "image/png", "inspiration"),  # over 5 MB
    ],
)
def test_bad_uploads_rejected(api, world, data, name, mime, kind):
    response = upload(api, world.client_a, world.project["id"], data, name, mime, kind)
    assert response.status_code in (413, 415, 422)


def test_asset_isolation_and_quota(api, world):
    pid = world.project["id"]
    created = upload(api, world.client_a, pid, PNG).json()["data"]
    for stranger in (world.other_client_a, world.designer_b):
        assert upload(api, stranger, pid, PNG).status_code == 404
        assert api.get(f"/v1/projects/{pid}/assets", headers=stranger.headers).status_code == 404
        assert api.delete(f"/v1/projects/{pid}/assets/{created['id']}", headers=stranger.headers).status_code == 404
    # An asset id from another project cannot be deleted through this one.
    other = upload(api, world.other_client_a, world.other_project["id"], PNG).json()["data"]
    assert api.delete(f"/v1/projects/{pid}/assets/{other['id']}", headers=world.client_a.headers).status_code == 404
    for _ in range(29):
        assert upload(api, world.client_a, pid, PNG).status_code == 201
    assert upload(api, world.client_a, pid, PNG).status_code == 409  # 30 per project


def test_moodboard_roundtrip_and_validation(api, world):
    pid = world.project["id"]
    url = f"/v1/projects/{pid}/moodboard"
    asset = api.get(f"/v1/projects/{pid}/assets", headers=world.client_a.headers).json()["data"][0]
    items = [
        {"kind": "style", "ref": "japandi", "note": "calm"},
        {"kind": "material", "ref": "oak-floor"},
        {"kind": "asset", "ref": asset["id"]},
    ]
    assert api.put(url, json={"items": items}, headers=world.client_a.headers).status_code == 200
    got = api.get(url, headers=world.designer_a.headers).json()["data"]
    assert [(i["kind"], i["ref"]) for i in got] == [(i["kind"], i["ref"]) for i in items]
    assert got[2]["url"].startswith("http")
    # Reordering and removing replace the board.
    assert api.put(url, json={"items": items[::-1][:2]}, headers=world.client_a.headers).status_code == 200
    assert [i["ref"] for i in api.get(url, headers=world.client_a.headers).json()["data"]] == [asset["id"], "oak-floor"]
    bad = [
        [{"kind": "style", "ref": "nope"}],
        [{"kind": "material", "ref": "nope"}],
        [{"kind": "asset", "ref": "00000000-0000-0000-0000-000000000000"}],
        [{"kind": "style", "ref": "japandi"}] * 2,
        [{"kind": "style", "ref": "japandi", "note": "x" * 201}],
        [{"kind": "style", "ref": "japandi"}] * 41,
    ]
    for payload in bad:
        assert api.put(url, json={"items": payload}, headers=world.client_a.headers).status_code == 422
    for stranger in (world.other_client_a, world.designer_b):
        assert api.get(url, headers=stranger.headers).status_code == 404
        assert api.put(url, json={"items": []}, headers=stranger.headers).status_code == 404
    other_asset = api.get(f"/v1/projects/{world.other_project['id']}/assets", headers=world.other_client_a.headers).json()["data"][0]
    foreign = {"items": [{"kind": "asset", "ref": other_asset["id"]}]}
    assert api.put(url, json=foreign, headers=world.client_a.headers).status_code == 422


def test_suspended_studio_blocks_every_write(api, world, admin):
    pid = world.project["id"]
    studio_id = api.get(f"/v1/projects/{pid}", headers=world.client_a.headers).json()["data"]["studio_id"]
    admin.table("studios").update({"status": "suspended"}).eq("id", studio_id).execute()
    try:
        h = world.client_a.headers
        assert api.put(f"/v1/projects/{pid}/brief", json={}, headers=h).status_code == 403
        assert api.put(f"/v1/projects/{pid}/finishes", json={"selections": []}, headers=h).status_code == 403
        assert api.put(f"/v1/projects/{pid}/moodboard", json={"items": []}, headers=h).status_code == 403
        assert upload(api, world.client_a, pid, PNG).status_code == 403
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", studio_id).execute()


def test_parallel_uploads_cannot_exceed_the_quota(api, world, admin):
    from concurrent.futures import ThreadPoolExecutor

    studio_id = api.get(f"/v1/projects/{world.project['id']}", headers=world.client_a.headers).json()["data"]["studio_id"]
    body = {"studio_id": studio_id, "name": "Race", "property_type": "existing"}
    pid = api.post("/v1/projects", json=body, headers=world.client_a.headers).json()["data"]["id"]
    for _ in range(27):
        assert upload(api, world.client_a, pid, PNG).status_code == 201
    with ThreadPoolExecutor(6) as pool:
        codes = list(pool.map(lambda _: upload(api, world.client_a, pid, PNG).status_code, range(6)))
    assert sorted(codes) == [201] * 3 + [409] * 3
    assert len(admin.table("inspiration_assets").select("id").eq("project_id", pid).execute().data) == 30
