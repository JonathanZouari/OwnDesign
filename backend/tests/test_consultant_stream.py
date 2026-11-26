"""Pure tests for the streaming core: a fake provider stream, no network and no database."""

import asyncio
import json
from types import SimpleNamespace

from app.consultant_stream import parse_sse, sse, stream_reply


def delta(text):
    return SimpleNamespace(type="response.output_text.delta", delta=text)


def completed(tokens=7):
    return SimpleNamespace(
        type="response.completed", response=SimpleNamespace(usage=SimpleNamespace(input_tokens=5, output_tokens=tokens))
    )


async def agen(events, fail_with=None, delay=0.0):
    for event in events:
        if delay:
            await asyncio.sleep(delay)
        yield event
    if fail_with:
        raise fail_with


class Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, text, status, metadata):
        self.calls.append((text, status, metadata))
        return {"id": 42}


def run(events, fail_with=None, delay=0.0, **kwargs):
    persist = Recorder()

    async def create():
        return agen(events, fail_with, delay)

    async def collect():
        return [frame async for frame in stream_reply(create=create, persist=persist, **kwargs)]

    return asyncio.run(collect()), persist


def test_sse_frame_format():
    assert sse("token", {"text": "hé"}) == 'event: token\ndata: {"text":"hé"}\n\n'


def test_parse_sse_roundtrip():
    frames = sse("a", {"x": 1}) + sse("b", {"y": "two\nlines"})
    assert parse_sse(frames) == [("a", {"x": 1}), ("b", {"y": "two\nlines"})]


def test_happy_path_events_in_order_and_one_persist():
    frames, persist = run([delta("The "), delta("room"), completed()])
    events = parse_sse("".join(frames))
    assert [name for name, _ in events] == ["message_start", "status", "token", "token", "message_complete"]
    assert events[1][1] == {"status": "generating_response"}
    assert "".join(d["text"] for n, d in events if n == "token") == "The room"
    assert events[-1][1] == {"message_id": 42, "status": "complete"}
    assert persist.calls == [("The room", "complete", {"input_tokens": 5, "output_tokens": 7})]


def test_empty_reply_is_an_error_and_is_not_stored():
    frames, persist = run([completed()])
    names = [n for n, _ in parse_sse("".join(frames))]
    assert names[-1] == "error" and "message_complete" not in names
    assert persist.calls == []


def test_provider_failure_after_some_text_keeps_the_partial_reply():
    frames, persist = run([delta("Part"), delta("ial")], fail_with=RuntimeError("boom"))
    events = parse_sse("".join(frames))
    assert events[-1][0] == "error" and "boom" not in json.dumps(events[-1][1])  # no internal detail leaks
    assert persist.calls[0][:2] == ("Partial", "error")


def test_provider_failure_before_any_text_stores_nothing():
    _, persist = run([], fail_with=RuntimeError("boom"))
    assert persist.calls == []


def test_error_event_from_the_provider_stream():
    failed = SimpleNamespace(type="response.failed", response=SimpleNamespace(error=SimpleNamespace(message="secret")))
    frames, persist = run([delta("x"), failed])
    events = parse_sse("".join(frames))
    assert events[-1][0] == "error" and "secret" not in json.dumps(events[-1][1])
    assert persist.calls[0][1] == "error"


def test_incomplete_stream_is_stored_with_its_text():
    incomplete = SimpleNamespace(type="response.incomplete", response=SimpleNamespace(usage=None))
    frames, persist = run([delta("Cut off"), incomplete])
    assert parse_sse("".join(frames))[-1][0] == "message_complete"
    assert persist.calls[0][:2] == ("Cut off", "complete")


def test_client_disconnect_keeps_the_partial_reply_as_interrupted():
    persist = Recorder()

    async def create():
        return agen([delta("one "), delta("two "), delta("three")])

    async def go():
        stream = stream_reply(create=create, persist=persist)
        async for frame in stream:
            if "one " in frame:
                break
        await stream.aclose()

    asyncio.run(go())
    assert len(persist.calls) == 1
    assert persist.calls[0][:2] == ("one", "interrupted")


def test_disconnect_before_any_text_stores_nothing():
    persist = Recorder()

    async def create():
        return agen([delta("x")])

    async def go():
        stream = stream_reply(create=create, persist=persist)
        await stream.__anext__()  # message_start
        await stream.aclose()

    asyncio.run(go())
    assert persist.calls == []


def test_stored_text_is_capped_but_the_client_still_gets_everything():
    frames, persist = run([delta("a" * 5000), delta("b" * 5000), completed()])
    assert len(persist.calls[0][0]) == 8000
    assert sum(len(d["text"]) for n, d in parse_sse("".join(frames)) if n == "token") == 10000


def test_idle_timeout_ends_the_stream_with_an_error():
    frames, persist = run([delta("x")], delay=0.3, idle_timeout=0.05)
    assert parse_sse("".join(frames))[-1][0] == "error"
    assert persist.calls == []


def test_persist_failure_is_reported_not_raised():
    def broken(text, status, metadata):
        raise RuntimeError("db down")

    async def create():
        return agen([delta("hi"), completed()])

    async def collect():
        return [f async for f in stream_reply(create=create, persist=broken)]

    events = parse_sse("".join(asyncio.run(collect())))
    assert events[-1][0] == "error"
