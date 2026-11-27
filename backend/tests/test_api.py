"""Integration tests against a real Supabase project (reads backend/.env).

They create throw-away users and studios and delete them afterwards.
Covers PRD acceptance scenarios 2 (save/reload geometry), 6 (designer sees the
client's plan) and 7 (Studio A cannot read or mutate Studio B's records, through
the API or directly against the Data API).
"""

import json
import logging
import uuid
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase
from tests.fake_llm import FakeLlm
from tests.test_geometry import VALID

pytestmark = needs_supabase


@pytest.fixture(scope="module")
def world(api, make_user):
    """Studio A (designer + client with a saved plan) and an unrelated Studio B."""
    designer_a, client_a, designer_b, client_b = (make_user(p) for p in ("designer-a", "client-a", "designer-b", "client-b"))
    studio_a = api.post("/v1/studios", json={"name": "Studio A"}, headers=designer_a.headers).json()["data"]
    studio_b = api.post("/v1/studios", json={"name": "Studio B"}, headers=designer_b.headers).json()["data"]
    project_a = api.post(
        "/v1/projects",
        json={"studio_id": studio_a["id"], "name": "Flat A", "property_type": "existing"},
        headers=client_a.headers,
    ).json()["data"]
    version_a = api.post(
        f"/v1/projects/{project_a['id']}/versions", json={"label": "first", "geometry": VALID}, headers=client_a.headers
    ).json()["data"]
    project_b = api.post(
        "/v1/projects",
        json={"studio_id": studio_b["id"], "name": "Flat B", "property_type": "new_build"},
        headers=client_b.headers,
    ).json()["data"]
    return SimpleNamespace(**locals())


def test_health(api):
    assert api.get("/health").json() == {"success": True, "data": {"status": "ok"}, "error": None}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-token"}])
def test_requires_valid_session(api, headers):
    for path in ("/v1/me", "/v1/projects"):
        response = api.get(path, headers=headers)
        assert response.status_code == 401
        assert response.json()["success"] is False


def test_studio_owner_and_public_lookup(api, world):
    me = api.get("/v1/me", headers=world.designer_a.headers).json()["data"]
    assert [(m["role"], m["studio"]["id"]) for m in me["memberships"]] == [("owner", world.studio_a["id"])]
    public = api.get(f"/v1/studios/by-slug/{world.studio_a['slug']}").json()["data"]
    assert public == {"id": world.studio_a["id"], "name": "Studio A", "slug": world.studio_a["slug"]}
    assert api.post("/v1/studios", json={"name": "Second"}, headers=world.designer_a.headers).status_code == 409


def test_plan_saves_reloads_and_tracks_author(api, world):
    base = f"/v1/projects/{world.project_a['id']}"
    assert world.version_a["version_no"] == 1 and world.version_a["author_role"] == "client"

    # The designer of the same studio sees the client's project and plan.
    seen = api.get(base, headers=world.designer_a.headers).json()["data"]
    assert seen["my_role"] == "designer" and seen["client_email"] == world.client_a.email
    assert api.get(f"{base}/versions/latest", headers=world.designer_a.headers).json()["data"]["geometry"] == VALID

    revised = {**VALID, "furniture": [{**VALID["furniture"][0], "x": 250}]}
    saved = api.post(f"{base}/versions", json={"label": "designer pass", "geometry": revised}, headers=world.designer_a.headers)
    assert saved.status_code == 201 and saved.json()["data"]["author_role"] == "designer"

    versions = api.get(f"{base}/versions", headers=world.client_a.headers).json()["data"]
    assert [(v["version_no"], v["author_role"]) for v in versions] == [(2, "designer"), (1, "client")]
    assert api.get(f"{base}/versions/latest", headers=world.client_a.headers).json()["data"]["geometry"] == revised
    # Earlier versions stay inspectable and unchanged.
    first = api.get(f"{base}/versions/{world.version_a['id']}", headers=world.client_a.headers).json()["data"]
    assert first["geometry"] == VALID


def test_invalid_geometry_is_rejected(api, world):
    base = f"/v1/projects/{world.project_a['id']}"
    before = len(api.get(f"{base}/versions", headers=world.client_a.headers).json()["data"])
    broken = {**VALID, "openings": [{**VALID["openings"][0], "wallId": "missing"}]}
    response = api.post(f"{base}/versions", json={"geometry": broken}, headers=world.client_a.headers)
    assert response.status_code == 422 and response.json()["success"] is False
    assert len(api.get(f"{base}/versions", headers=world.client_a.headers).json()["data"]) == before


@pytest.mark.parametrize("outsider", ["designer_b", "client_b"])
def test_other_studio_cannot_use_api(api, world, outsider):
    headers = getattr(world, outsider).headers
    base = f"/v1/projects/{world.project_a['id']}"
    assert api.get(base, headers=headers).status_code == 404
    assert api.get(f"{base}/versions", headers=headers).status_code == 404
    assert api.get(f"{base}/versions/latest", headers=headers).status_code == 404
    assert api.get(f"{base}/versions/{world.version_a['id']}", headers=headers).status_code == 404
    assert api.post(f"{base}/versions", json={"geometry": VALID}, headers=headers).status_code == 404
    listed = api.get("/v1/projects", params={"studio_id": world.studio_a["id"]}, headers=headers).json()["data"]
    assert listed == []
    assert api.get(f"/v1/studios/{world.studio_a['id']}/invites", headers=headers).status_code == 403
    invite = {"client_email": "x@example.com", "client_name": "X"}
    assert api.post(f"/v1/studios/{world.studio_a['id']}/invites", json=invite, headers=headers).status_code == 403


@pytest.mark.parametrize("outsider", ["designer_b", "client_b"])
def test_other_studio_cannot_read_data_api_directly(world, outsider):
    from app.db import user_client

    db = user_client(getattr(world, outsider).token)
    studio_id, project_id = world.studio_a["id"], world.project_a["id"]
    assert db.table("projects").select("id").eq("id", project_id).execute().data == []
    assert db.table("plan_versions").select("id").eq("project_id", project_id).execute().data == []
    assert db.table("studios").select("id").eq("id", studio_id).execute().data == []
    assert db.table("studio_memberships").select("user_id").eq("studio_id", studio_id).execute().data == []
    assert db.table("studio_invites").select("id").eq("studio_id", studio_id).execute().data == []
    assert db.table("audit_events").select("id").eq("studio_id", studio_id).execute().data == []


def test_nobody_can_write_data_api_directly(world):
    """Even on their own project, users cannot bypass backend validation or forge history."""
    from postgrest.exceptions import APIError

    from app.db import user_client

    db = user_client(world.client_a.token)
    project_id = world.project_a["id"]
    forged = {"project_id": project_id, "version_no": 99, "author_role": "designer", "geometry": {"junk": True}}
    with pytest.raises(APIError):
        db.table("plan_versions").insert(forged).execute()
    with pytest.raises(APIError):
        db.table("audit_events").insert({"action": "forged"}).execute()
    with pytest.raises(APIError):
        db.table("projects").update({"studio_id": world.studio_b["id"]}).eq("id", project_id).execute()
    with pytest.raises(APIError):
        db.table("plan_versions").delete().eq("project_id", project_id).execute()
    assert db.table("projects").select("studio_id").eq("id", project_id).execute().data == [{"studio_id": world.studio_a["id"]}]


def test_anonymous_key_sees_nothing(world):
    from postgrest.exceptions import APIError
    from supabase import create_client

    from app.db import settings

    anon = create_client(settings().supabase_url, settings().supabase_publishable_key)
    for table in ("studios", "projects", "plan_versions", "studio_invites", "audit_events"):
        try:
            assert anon.table(table).select("*").execute().data == []
        except APIError:
            pass  # permission denied is the expected outcome


def test_invite_flow(api, world):
    created = api.post(
        f"/v1/studios/{world.studio_a['id']}/invites",
        json={"client_email": world.client_a.email, "client_name": "Client A"},
        headers=world.designer_a.headers,
    )
    assert created.status_code == 201
    token = created.json()["data"]["token"]

    public = api.get(f"/v1/invites/{token}").json()["data"]
    assert public == {"client_name": "Client A", "accepted_at": None, "studio": {k: world.studio_a[k] for k in ("id", "name", "slug")}}
    assert api.get("/v1/invites/" + "x" * 32).status_code == 404

    assert api.post(f"/v1/invites/{token}/accept", headers=world.client_a.headers).json()["data"] == {"studio_id": world.studio_a["id"]}
    assert api.post(f"/v1/invites/{token}/accept", headers=world.client_a.headers).status_code == 200  # idempotent
    assert api.post(f"/v1/invites/{token}/accept", headers=world.client_b.headers).status_code == 409
    listed = api.get(f"/v1/studios/{world.studio_a['id']}/invites", headers=world.designer_a.headers).json()["data"]
    assert len(listed) == 1 and listed[0]["accepted_at"] is not None


def test_changes_are_audited(world):
    from app.db import user_client

    actions = {row["action"] for row in user_client(world.designer_a.token).table("audit_events").select("action").execute().data}
    assert {"studio.created", "project.created", "plan_version.created"} <= actions


def test_oversized_body_is_refused_even_without_content_length(api):
    def chunks():
        for _ in range(40):
            yield b"x" * 100_000  # 4 MB sent with Transfer-Encoding: chunked

    response = api.post("/v1/studios", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_quotas_bound_what_one_account_can_store(api, world, monkeypatch):
    from app.routes import projects

    monkeypatch.setattr(projects, "MAX_PROJECTS_PER_CLIENT", 1)  # client_b already has one project in studio B
    blocked = api.post(
        "/v1/projects", json={"studio_id": world.studio_b["id"], "name": "One too many", "property_type": "existing"}, headers=world.client_b.headers
    )
    assert blocked.status_code == 409

    monkeypatch.setattr(projects, "MAX_VERSIONS_PER_PROJECT", 1)
    base = f"/v1/projects/{world.project_b['id']}/versions"
    assert api.post(base, json={"geometry": VALID}, headers=world.client_b.headers).status_code == 201
    assert api.post(base, json={"geometry": VALID}, headers=world.client_b.headers).status_code == 409


def test_database_refuses_a_second_owned_studio(world):
    """The API check can be raced; the unique index is what guarantees one owned studio per user."""
    from postgrest.exceptions import APIError

    from app.db import service

    with pytest.raises(APIError) as error:
        service().table("studio_memberships").insert(
            {"studio_id": world.studio_b["id"], "user_id": world.designer_a.id, "role": "owner"}
        ).execute()
    assert error.value.code == "23505"


def test_studio_activity_is_listed_for_members_only(api, world):
    path = f"/v1/studios/{world.studio_a['id']}/audit"
    events = api.get(path, headers=world.designer_a.headers).json()["data"]
    assert 0 < len(events) <= 10
    assert events == sorted(events, key=lambda event: event["created_at"], reverse=True)
    assert set(events[0]) == {"id", "action", "metadata", "created_at", "project"}  # no actor ids leave the API
    assert all(set(event["metadata"]) <= {"version_no", "author_role"} for event in events)
    names = {event["project"]["name"] for event in events if event["project"]}
    assert names and "Flat B" not in names

    # The studio's own client and another studio's designer are not members.
    for outsider in (world.client_a, world.designer_b):
        assert api.get(path, headers=outsider.headers).status_code == 403
    assert api.get(path).status_code == 401
    assert api.get("/v1/studios/not-a-uuid/audit", headers=world.designer_a.headers).status_code == 422

    other = api.get(f"/v1/studios/{world.studio_b['id']}/audit", headers=world.designer_b.headers).json()["data"]
    assert other and "Flat A" not in {event["project"]["name"] for event in other if event["project"]}


# --- AI advisor: Groq is always replaced by FakeLlm ---


@pytest.fixture
def llm(api):
    from app.advisor import get_llm

    fake = FakeLlm(["Hello ", "there."])
    api.app.dependency_overrides[get_llm] = lambda: fake
    yield fake
    api.app.dependency_overrides.pop(get_llm, None)


def ask(api, project_id, headers=None, question="Which sofa fits?", **extra):
    return api.post(f"/v1/projects/{project_id}/advisor", json={"question": question, **extra}, headers=headers or {})


def events_of(response):
    events = []
    for block in response.text.split("\n\n")[:-1]:
        name, data = block.split("\n")
        events.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


def test_client_gets_a_streamed_advisor_reply_about_their_project(api, world, llm):
    response = ask(api, world.project_a["id"], world.client_a.headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert [name for name, _ in events_of(response)] == ["delta", "delta", "done"]
    assert len(llm.calls) == 1
    context = llm.calls[0][1]["content"]  # the project data message
    assert "Flat A" in context and "Flat B" not in context


@pytest.mark.parametrize(
    "who, expected",
    [
        ("client_a", 200),
        ("designer_a", 403),  # a member of the studio, not the client
        ("designer_b", 404),  # another studio
        ("client_b", 404),  # another client
        (None, 401),
    ],
)
def test_only_the_owning_client_may_use_the_advisor(api, world, llm, who, expected):
    headers = getattr(world, who).headers if who else {}
    assert ask(api, world.project_a["id"], headers).status_code == expected
    assert len(llm.calls) == (1 if expected == 200 else 0)  # Groq is never reached by a refused request


@pytest.mark.parametrize("project_id, expected", [(str(uuid.uuid4()), 404), ("not-a-uuid", 422)])
def test_advisor_refuses_unknown_and_malformed_project_ids(api, world, llm, project_id, expected):
    assert ask(api, project_id, world.client_a.headers).status_code == expected
    assert llm.calls == []


def test_advisor_refuses_a_bad_token(api, world, llm):
    assert ask(api, world.project_a["id"], {"Authorization": "Bearer not-a-token"}).status_code == 401
    assert llm.calls == []


@pytest.mark.parametrize(
    "payload",
    [
        {"question": ""},
        {"question": "   "},
        {"question": "\n\t "},
        {"question": "x" * 2001},
        {"question": "ש" * 2001},
        {"question": None},
        {"question": ["a"]},
        {"question": "ok", "extra": 1},
        {"question": "ok", "history": [{"role": "system", "content": "x"}]},
        {"question": "ok", "history": [{"role": "user", "content": ""}]},
        {"question": "ok", "history": [{"role": "user", "content": "x" * 8001}]},
        {"question": "ok", "history": [{"role": "user", "content": "x"}] * 11},
        {},
    ],
)
def test_advisor_rejects_invalid_input_before_calling_groq(api, world, llm, payload):
    response = api.post(f"/v1/projects/{world.project_a['id']}/advisor", json=payload, headers=world.client_a.headers)
    assert response.status_code == 422
    assert llm.calls == []


def test_advisor_rejects_a_body_that_is_not_json(api, world, llm):
    headers = {**world.client_a.headers, "Content-Type": "application/json"}
    response = api.post(f"/v1/projects/{world.project_a['id']}/advisor", content=b"{not json", headers=headers)
    assert response.status_code == 422
    assert llm.calls == []


def test_advisor_accepts_the_longest_question(api, world, llm):
    assert ask(api, world.project_a["id"], world.client_a.headers, question="ש" * 2000).status_code == 200


def test_advisor_accepts_the_shortest_question_and_a_full_history(api, world, llm):
    turns = [{"role": "user" if i % 2 == 0 else "assistant", "content": "ש" * 8000 if i == 0 else "x"} for i in range(10)]
    assert ask(api, world.project_a["id"], world.client_a.headers, question="?", history=turns).status_code == 200
    assert len(llm.calls[0]) == 3 + 10  # system, project data, ten turns, the question


def test_a_groq_rate_limit_is_a_friendly_error_event_and_frees_the_user_for_the_next_question(api, world, llm):
    from app.advisor import ERRORS
    from tests.test_advisor import rate_limit_error

    llm.fail_at, llm.error = 0, rate_limit_error("PROVIDER-TEXT")
    response = ask(api, world.project_a["id"], world.client_a.headers)
    assert response.status_code == 200  # the stream was already open when Groq refused
    assert events_of(response) == [("error", {"code": "rate_limited", "message": ERRORS["rate_limited"]})]
    assert "PROVIDER-TEXT" not in response.text

    llm.fail_at, llm.error = None, None  # the one-open-reply lock was released, so the next question is not refused
    assert [name for name, _ in events_of(ask(api, world.project_a["id"], world.client_a.headers))] == ["delta", "delta", "done"]


def test_the_largest_advisor_request_passes_the_upstream_body_limit(api, world, llm):
    """2000 characters plus 10 turns of 8000, all outside the basic plane: well under the 2 MB cap (only .../assets gets 6 MB)."""
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": "😀" * 8000} for i in range(10)]
    response = ask(api, world.project_a["id"], world.client_a.headers, question="😀" * 2000, history=history)
    assert response.status_code == 200
    assert [name for name, _ in events_of(response)] == ["delta", "delta", "done"]


def test_the_advisor_and_the_consultant_have_independent_daily_caps(api, world, llm, monkeypatch):
    from app.routes import advisor as advisor_route
    from app.routes import consultant
    from tests.test_consultant import FakeOpenAI

    api.app.dependency_overrides[consultant.get_openai] = lambda: FakeOpenAI()
    project, headers = world.project_a["id"], world.client_a.headers

    def message():
        return api.post(f"/v1/projects/{project}/consultant/messages", json={"message": "hello"}, headers=headers)

    try:
        used = advisor_route._questions_today(world.client_a.id)
        monkeypatch.setattr(advisor_route, "MAX_QUESTIONS_PER_DAY", used)  # the advisor is at its cap
        assert ask(api, project, headers).status_code == 429
        assert message().status_code == 201  # the consultant still answers

        monkeypatch.setattr(advisor_route, "MAX_QUESTIONS_PER_DAY", used + 5)
        monkeypatch.setattr(consultant, "DAILY_MESSAGE_CAP", 0)  # now the consultant is at its cap
        assert message().status_code == 429
        assert ask(api, project, headers).status_code == 200  # the advisor still answers
    finally:
        api.app.dependency_overrides.pop(consultant.get_openai, None)


def test_advisor_is_unavailable_when_groq_is_not_configured(api, world):
    from app.advisor import get_llm

    api.app.dependency_overrides[get_llm] = lambda: None
    try:
        assert ask(api, world.project_a["id"], world.client_a.headers).status_code == 503
        # An outsider still learns nothing about the configuration.
        assert ask(api, world.project_a["id"], world.client_b.headers).status_code == 404
    finally:
        api.app.dependency_overrides.pop(get_llm, None)


def test_advisor_daily_quota_and_one_stream_at_a_time(api, world, llm, monkeypatch):
    from app.routes import advisor as route

    used = route._questions_today(world.client_a.id)
    monkeypatch.setattr(route, "MAX_QUESTIONS_PER_DAY", used)
    assert ask(api, world.project_a["id"], world.client_a.headers).status_code == 429
    monkeypatch.setattr(route, "MAX_QUESTIONS_PER_DAY", used + 5)

    assert route._acquire(world.client_a.id)  # as if the user had a reply streaming in another tab
    try:
        assert ask(api, world.project_a["id"], world.client_a.headers).status_code == 429
    finally:
        route._release(world.client_a.id)
    assert llm.calls == []
    assert ask(api, world.project_a["id"], world.client_a.headers).status_code == 200


def test_advisor_refuses_a_suspended_studio(api, world, llm, admin):
    admin.table("studios").update({"status": "suspended"}).eq("id", world.studio_a["id"]).execute()
    try:
        assert ask(api, world.project_a["id"], world.client_a.headers).status_code == 403
    finally:
        admin.table("studios").update({"status": "active"}).eq("id", world.studio_a["id"]).execute()
    assert llm.calls == []


def test_advisor_audit_event_is_private_and_holds_no_text(api, world, llm, admin):
    from app.db import user_client

    marker = f"AUDITMARK-{uuid.uuid4().hex}"
    assert ask(api, world.project_a["id"], world.client_a.headers, question=marker).status_code == 200
    rows = admin.table("audit_events").select("*").eq("actor_id", world.client_a.id).eq("action", "advisor.asked").execute().data
    assert rows and all(row["studio_id"] is None and row["metadata"] == {} for row in rows)
    assert marker not in json.dumps(rows)
    # Studio members read audit events through RLS: they never see these, nor in the activity feed.
    seen = user_client(world.designer_a.token).table("audit_events").select("action").execute().data
    assert "advisor.asked" not in {row["action"] for row in seen}
    feed = api.get(f"/v1/studios/{world.studio_a['id']}/audit", headers=world.designer_a.headers).json()["data"]
    assert "advisor.asked" not in {event["action"] for event in feed}


def test_advisor_never_logs_question_history_or_reply_text(api, world, llm, admin, caplog, monkeypatch):
    from app import advisor
    from tests.test_advisor import api_error, rate_limit_error

    question, history, reply = (f"{kind}-{uuid.uuid4().hex}" for kind in ("QMARK", "HMARK", "RMARK"))
    turns = [{"role": "user", "content": history}, {"role": "assistant", "content": history}]
    caplog.set_level(logging.DEBUG)
    base = world.project_a["id"], world.client_a.headers

    llm.pieces = [reply, reply]  # a normal stream
    assert ask(api, *base, question=question, history=turns).status_code == 200

    llm.pieces, llm.fail_at, llm.error = [reply, reply], 1, api_error(reply)  # Groq fails mid-stream
    assert "error" in [name for name, _ in events_of(ask(api, *base, question=question, history=turns))]

    llm.error = rate_limit_error(reply)  # Groq's free-tier limit is reached mid-stream
    assert "rate_limited" in json.dumps(events_of(ask(api, *base, question=question, history=turns)))

    monkeypatch.setattr(advisor, "FIRST_PIECE_TIMEOUT_S", 0.05)  # Groq never answers
    llm.pieces, llm.fail_at, llm.hang_at = [reply], None, 0
    assert "timeout" in json.dumps(events_of(ask(api, *base, question=question, history=turns)))

    too_long = ask(api, *base, question=question + "x" * 2001, history=turns)  # rejected input
    assert too_long.status_code == 422 and question not in too_long.text

    assert any(record.name.startswith("app.") for record in caplog.records)  # logging was really captured
    for marker in (question, history, reply):
        assert marker not in caplog.text
    audit_text = json.dumps(admin.table("audit_events").select("*").eq("actor_id", world.client_a.id).execute().data)
    assert not any(marker in audit_text for marker in (question, history, reply))
    for name in ("openai", "httpx", "httpx2", "httpcore2"):
        assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING, name
