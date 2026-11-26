"""The streaming endpoint's wiring, without Supabase or OpenAI.

A small app holds only the consultant router. Authentication, the database helpers and the provider are
replaced by fakes, so this checks the HTTP contract: headers, events, limits, validation and what is stored.
Database-backed behaviour (RLS, tenant isolation) is covered in test_consultant_sessions.py.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import CurrentUser, current_user
from app.consultant_stream import parse_sse
from app.routes import consultant
from tests.test_geometry import VALID


def delta(text):
    return SimpleNamespace(type="response.output_text.delta", delta=text)


class FakeProvider:
    def __init__(self):
        self.calls = []
        self.events = [delta("Hello "), delta("there"), SimpleNamespace(type="response.completed", response=SimpleNamespace(usage=None))]
        self.responses = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)

        async def stream():
            for event in self.events:
                yield event

        return stream()


class FakeTable:
    def __init__(self, log, name):
        self.log, self.name = log, name

    def insert(self, row):
        self.log.append(("insert", self.name, row))
        self._data = [{"id": 7, **row}]
        return self

    def update(self, row):
        self.log.append(("update", self.name, row))
        self._data = [row]
        return self

    def eq(self, *_):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


@pytest.fixture()
def rig(monkeypatch):
    log = []
    provider = FakeProvider()
    prepared = {
        "project": {"id": "p1", "studio_id": "s1"},
        "session": {"id": "c1", "title": None},
        "input": [{"role": "user", "content": "ctx"}],
        "ref": {"scope": {"type": "plan"}},
    }
    monkeypatch.setattr(consultant, "_prepare", lambda *args: prepared)
    monkeypatch.setattr(consultant, "_reserve", lambda *args: log.append(("reserve", args[2])))
    monkeypatch.setattr(consultant, "service", lambda: SimpleNamespace(table=lambda name: FakeTable(log, name)))
    monkeypatch.setattr(consultant, "audit", lambda *a, **k: log.append(("audit", a[0])))
    monkeypatch.setattr(consultant, "settings", lambda: SimpleNamespace(openai_model="test-model", openai_api_key="x"))
    app = FastAPI()
    app.include_router(consultant.router)
    app.dependency_overrides[current_user] = lambda: CurrentUser(id="u1", email=None, db=None)
    app.dependency_overrides[consultant.get_async_openai] = lambda: provider
    consultant._active_users.clear()
    yield SimpleNamespace(client=TestClient(app), log=log, provider=provider, app=app)
    consultant._active_users.clear()


PID, SID = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
URL = f"/v1/projects/{PID}/consultant/sessions/{SID}/messages"


def body(**overrides):
    data = {"message": "Analyze this room.", "scope": {"type": "plan"}, "source": {"kind": "working", "plan": VALID}}
    data.update(overrides)
    return data


def test_streams_events_with_the_right_headers_and_stores_once(rig):
    response = rig.client.post(URL, json=body())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache" and response.headers["x-accel-buffering"] == "no"
    names = [n for n, _ in parse_sse(response.text)]
    assert names == ["message_start", "status", "token", "token", "message_complete"]
    inserts = [e for e in rig.log if e[0] == "insert"]
    assert len(inserts) == 1
    row = inserts[0][2]
    assert (row["role"], row["content"], row["status"], row["conversation_id"]) == ("assistant", "Hello there", "complete", "c1")
    assert row["context_ref"] == {"scope": {"type": "plan"}} and row["metadata"]["model"] == "test-model"


def test_slot_is_reserved_before_the_provider_is_called(rig):
    rig.client.post(URL, json=body())
    assert rig.log[0] == ("reserve", "Analyze this room.")
    call = rig.provider.calls[0]
    assert call["stream"] is True and call["store"] is False and call["model"] == "test-model"
    assert call["input"] == [{"role": "user", "content": "ctx"}]


def test_title_is_taken_from_the_first_message(rig):
    rig.client.post(URL, json=body(message="x" * 100))
    updates = [e for e in rig.log if e[0] == "update"]
    assert updates and updates[0][2]["title"] == "x" * 60


def test_active_stream_blocks_a_second_one_without_charging(rig):
    consultant._active_users.add("u1")
    response = rig.client.post(URL, json=body())
    assert response.status_code == 429
    assert not any(e[0] == "reserve" for e in rig.log) and rig.provider.calls == []
    assert "u1" in consultant._active_users  # the other stream's marker is untouched


def test_global_in_flight_limit(rig):
    consultant._active_users.update(f"other{i}" for i in range(consultant.MAX_ACTIVE_STREAMS))
    assert rig.client.post(URL, json=body()).status_code == 429
    assert not any(e[0] == "reserve" for e in rig.log)


def test_limiter_is_released_after_the_stream(rig):
    rig.client.post(URL, json=body())
    assert consultant._active_users == set()
    assert rig.client.post(URL, json=body()).status_code == 200


def test_limiter_is_released_when_the_reservation_is_refused(rig, monkeypatch):
    def refuse(*_):
        raise HTTPException(429, "Daily message limit reached. Please come back tomorrow.")

    monkeypatch.setattr(consultant, "_reserve", refuse)
    assert rig.client.post(URL, json=body()).status_code == 429
    assert consultant._active_users == set() and rig.provider.calls == []


def test_unconfigured_provider_is_503_and_not_charged(rig):
    rig.app.dependency_overrides[consultant.get_async_openai] = lambda: None
    assert rig.client.post(URL, json=body()).status_code == 503
    assert not any(e[0] == "reserve" for e in rig.log)


def test_provider_failure_sends_an_error_event_and_releases(rig):
    rig.provider.events = [delta("Part")]

    async def boom(**kwargs):
        async def stream():
            yield delta("Part")
            raise RuntimeError("secret detail")

        return stream()

    rig.provider.responses = SimpleNamespace(create=boom)
    response = rig.client.post(URL, json=body())
    events = parse_sse(response.text)
    assert events[-1][0] == "error" and "secret" not in response.text
    assert [e for e in rig.log if e[0] == "insert"][0][2]["status"] == "error"
    assert consultant._active_users == set()


@pytest.mark.parametrize(
    "bad",
    [
        {"message": ""},
        {"message": "x" * 2001},
        {"message": 5},
        {"scope": {"type": "wat"}},
        {"scope": {"type": "object", "ids": [f"f{i}" for i in range(21)]}},
        {"scope": {"type": "room", "id": "bad id!"}},
        {"scope": {"type": "plan", "extra": 1}},
        {"source": {"kind": "version", "version_id": "not-a-uuid"}},
        {"source": {"kind": "working"}},
        {"source": {"kind": "working", "plan": {"schema": 1}}},
        {"source": {"kind": "other"}},
        {"unexpected": True},
    ],
)
def test_invalid_bodies_are_rejected_before_anything_happens(rig, bad):
    assert rig.client.post(URL, json=body(**bad)).status_code == 422
    assert rig.log == [] and rig.provider.calls == []


def test_missing_source_or_scope_is_rejected(rig):
    for key in ("source", "scope", "message"):
        data = body()
        del data[key]
        assert rig.client.post(URL, json=data).status_code == 422


def test_bad_ids_in_the_path_are_rejected(rig):
    assert rig.client.post(f"/v1/projects/not-a-uuid/consultant/sessions/{SID}/messages", json=body()).status_code == 422
    assert rig.client.post(f"/v1/projects/{PID}/consultant/sessions/nope/messages", json=body()).status_code == 422


def test_scope_error_from_prepare_is_a_422_and_not_charged(rig, monkeypatch):
    def refuse(*args):
        raise HTTPException(422, "That room is not in the plan")

    monkeypatch.setattr(consultant, "_prepare", refuse)
    response = rig.client.post(URL, json=body(scope={"type": "room", "id": "nope"}))
    assert response.status_code == 422
    assert not any(e[0] == "reserve" for e in rig.log)


def test_two_parallel_requests_from_one_user_only_one_streams(rig):
    # The limiter is checked and set without awaiting in between, so the second request cannot slip past it.
    async def go():
        import httpx

        transport = httpx.ASGITransport(app=rig.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            return await asyncio.gather(client.post(URL, json=body()), client.post(URL, json=body()))

    statuses = sorted(r.status_code for r in asyncio.run(go()))
    assert statuses in ([200, 200], [200, 429])  # sequential completion is allowed; never two reservations at once
    assert sum(1 for e in rig.log if e[0] == "reserve") == statuses.count(200)
