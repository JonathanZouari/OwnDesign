"""Streams a provider reply to the browser as Server-Sent Events and stores it exactly once.

stream_reply is provider-agnostic: `create` returns an async iterator of OpenAI Responses stream events
(response.output_text.delta, response.completed, response.failed, ...). `persist(text, status, metadata)`
is called once, at the end, because ai_messages is insert-only for the service role. Whatever happens
(normal end, provider failure, the client closing the connection) the text received so far is kept,
unless it is empty.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

log = logging.getLogger(__name__)

MAX_STORED_CHARS = 8000  # ai_messages.content check
IDLE_TIMEOUT_SECONDS = 30
USER_ERROR = "The design consultant could not answer. Please try again."


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


def parse_sse(text: str) -> list[tuple[str, dict]]:
    """Parses complete frames; used by tests and mirrors what the browser client does."""
    events = []
    for frame in text.split("\n\n"):
        if not frame.strip():
            continue
        name, data = "message", []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].lstrip())
        events.append((name, json.loads("\n".join(data))))
    return events


def _usage(response) -> dict:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}
    return {"input_tokens": getattr(usage, "input_tokens", None), "output_tokens": getattr(usage, "output_tokens", None)}


async def stream_reply(
    *,
    create: Callable[[], Awaitable[AsyncIterator]],
    persist: Callable[[str, str, dict], dict | None],
    idle_timeout: float = IDLE_TIMEOUT_SECONDS,
) -> AsyncIterator[str]:
    parts: list[str] = []
    metadata: dict = {}
    finished = False  # set once the reply ended normally or with a reported error
    stored = False

    def store(final_status: str) -> dict | None:
        nonlocal stored
        text = "".join(parts)[:MAX_STORED_CHARS].strip()
        if stored or not text:
            return None
        stored = True
        return persist(text, final_status, metadata)

    try:
        yield sse("message_start", {})
        yield sse("status", {"status": "generating_response"})
        events = (await create()).__aiter__()
        while True:
            try:
                event = await asyncio.wait_for(events.__anext__(), idle_timeout)
            except StopAsyncIteration:
                break
            kind = getattr(event, "type", "")
            if kind == "response.output_text.delta":
                parts.append(event.delta)
                yield sse("token", {"text": event.delta})
            elif kind in ("response.completed", "response.incomplete"):
                metadata = _usage(getattr(event, "response", None))
            elif kind in ("response.failed", "error"):
                raise RuntimeError("provider reported a failure")
        if not "".join(parts).strip():
            raise RuntimeError("empty reply")
        saved = store("complete")
        finished = True
        yield sse("message_complete", {"message_id": saved["id"] if saved else None, "status": "complete"})
    except Exception as error:  # provider, timeout, empty reply or storage failure
        finished = True
        log.warning("Consultant stream failed: %s", type(error).__name__)
        try:
            store("error")
        except Exception as storage_error:
            log.warning("Consultant partial reply not stored: %s", type(storage_error).__name__)
        yield sse("error", {"message": USER_ERROR})
    finally:
        if not finished:  # GeneratorExit or cancellation: the client went away, keep what it received
            try:
                store("interrupted")
            except Exception as storage_error:
                log.warning("Consultant partial reply not stored: %s", type(storage_error).__name__)
