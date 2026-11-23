import threading
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import advisor
from app.advisor import Llm, build_messages, get_llm, stream_reply
from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.routes.projects import _project_or_404
from app.schemas import AdvisorAsk

router = APIRouter(prefix="/v1/projects")

# Stopgap cost guard. To be reconciled with the AI cost budget (wiki/open-items.md).
MAX_QUESTIONS_PER_DAY = 50
# The lock is per server process. An entry older than this counts as released, so a stream that never
# started (client gone before the first byte) cannot block its user for long.
LOCK_EXPIRY_S = advisor.TOTAL_TIMEOUT_S + 30

_active: dict[str, float] = {}
_active_guard = threading.Lock()


def _acquire(user_id: str) -> bool:
    with _active_guard:
        started = _active.get(user_id)
        if started is not None and time.monotonic() - started < LOCK_EXPIRY_S:
            return False
        _active[user_id] = time.monotonic()
        return True


def _release(user_id: str) -> None:
    with _active_guard:
        _active.pop(user_id, None)


def _questions_today(user_id: str) -> int:
    since = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    result = (
        service()
        .table("audit_events")
        .select("id", count="exact")
        .eq("actor_id", user_id)
        .eq("action", "advisor.asked")
        .gte("created_at", since)
        .execute()
    )
    return result.count or 0


def _project_context(user: CurrentUser, project: dict) -> dict:
    """What the advisor may know about the project. Read with the caller's JWT, so RLS applies."""
    rows = (
        user.db.table("plan_versions")
        .select("geometry")
        .eq("project_id", project["id"])
        .order("version_no", desc=True)
        .limit(1)
        .execute()
        .data
    )
    plan = rows[0]["geometry"] if rows else {}
    return {
        "name": project["name"],
        "property_type": project["property_type"],
        "rooms": [{"name": room["name"], "type": room["type"]} for room in plan.get("rooms", [])],
        "counts": {kind: len(plan.get(kind, [])) for kind in ("walls", "openings", "furniture")},
    }


@router.post("/{project_id}/advisor")
def ask_advisor(
    project_id: UUID,
    body: AdvisorAsk,
    user: CurrentUser = Depends(current_user),
    llm: Llm | None = Depends(get_llm),
):
    """Streams the advisor's reply as Server-Sent Events. Every check runs before the stream opens."""
    project = _project_or_404(user, project_id)
    # Only the client who owns the project. Studio members see it through RLS but get no advisor.
    if user.role_in(project["studio_id"]):
        raise HTTPException(403, "The advisor is for the client who owns this project")
    if project["client_user_id"] != user.id:
        raise HTTPException(404, "Project not found")
    if project["studio"]["status"] != "active":
        raise HTTPException(403, "This studio is not active")
    if llm is None:
        raise HTTPException(503, "The advisor is not available right now")
    if _questions_today(user.id) >= MAX_QUESTIONS_PER_DAY:
        raise HTTPException(429, "You have reached today's limit of advisor questions. Please try again tomorrow.")
    if not _acquire(user.id):
        raise HTTPException(429, "The advisor is already answering another question for you")
    try:
        audit("advisor.asked", user.id, project_id=project["id"])  # no studio_id, no text: members never see it
        messages = build_messages(
            _project_context(user, project), [turn.model_dump() for turn in body.history], body.question
        )
    except BaseException:
        _release(user.id)
        raise

    async def events() -> AsyncIterator[str]:
        try:
            async with aclosing(stream_reply(llm, messages)) as replies:
                async for event in replies:
                    yield event
        finally:
            _release(user.id)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
