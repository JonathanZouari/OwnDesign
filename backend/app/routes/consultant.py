import logging
import time
from functools import lru_cache
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth import CurrentUser, current_user
from app.consultant_context import ContextError, build_context, context_ref, resolve_scope
from app.consultant_prompt import SYSTEM_PROMPT, build_input, render_context
from app.consultant_stream import stream_reply
from app.db import audit, service, settings
from app.responses import ok
from app.routes.design import _writable_project
from app.routes.projects import _project_or_404
from app.schemas import Geometry, Id

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/projects/{project_id}/consultant")

DAILY_MESSAGE_CAP = 30  # user messages per project and user in 24 hours: bounds the cost of one account
HISTORY_TURNS = 20
MAX_OUTPUT_TOKENS = 2500  # a reasoning model spends part of this on thinking
TIMEOUT_SECONDS = 30
MAX_SESSIONS_PER_PROJECT_AND_USER = 50
MAX_ACTIVE_STREAMS = 8  # per process: each stream holds a connection open for up to a minute
STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}

_active_users: set[str] = set()  # one live stream per user


class MessageBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context_type: Literal["plan", "room", "object"] = "plan"
    context_id: Id | None = None


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["plan", "room", "object"]
    id: Id | None = None
    ids: Annotated[list[Id], Field(max_length=20)] = []


class VersionSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["version"]
    version_id: UUID


class WorkingSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["working"]
    plan: Geometry


class StreamMessageBody(MessageBody):
    scope: Scope
    source: Annotated[VersionSource | WorkingSource, Field(discriminator="kind")]


@lru_cache
def _client():
    from openai import OpenAI

    return OpenAI(api_key=settings().openai_api_key)


@lru_cache
def _async_client():
    from openai import AsyncOpenAI

    return AsyncOpenAI(api_key=settings().openai_api_key)


def get_openai():
    """None when no key is configured. Tests override this dependency with a fake."""
    return _client() if settings().openai_api_key else None


def get_async_openai():
    """The streaming client; None when no key is configured. Tests override it with a fake."""
    return _async_client() if settings().openai_api_key else None


# ---- shared helpers ------------------------------------------------------------------------------------------------


def _latest_plan_geometry(user: CurrentUser, project_id: str) -> dict:
    plan = user.db.table("plan_versions").select("geometry").eq("project_id", project_id).order("version_no", desc=True).limit(1).execute().data
    return plan[0]["geometry"] if plan else {"schema": 1, "units": "cm", "rooms": [], "walls": [], "openings": [], "furniture": []}


def _brief_and_finishes(user: CurrentUser, project_id: str):
    brief = user.db.table("project_briefs").select("brief").eq("project_id", project_id).execute().data
    finishes = user.db.table("finish_selections").select("room_id, surface, material_id").eq("project_id", project_id).execute().data
    return (brief[0]["brief"] if brief else None), finishes


def _legacy_context(user: CurrentUser, project: dict) -> str:
    geometry = Geometry.model_validate(_latest_plan_geometry(user, project["id"]))
    brief, finishes = _brief_and_finishes(user, project["id"])
    context = build_context(
        geometry=geometry, scope={"type": "plan"}, source={"kind": "version"}, project=project, brief=brief, finishes=finishes,
        role="designer" if user.role_in(project["studio_id"]) else "client",
    )
    return render_context(context)


def _latest_session(user: CurrentUser, project_id: str) -> dict | None:
    rows = (
        user.db.table("ai_conversations")
        .select("id")
        .eq("project_id", project_id)
        .eq("user_id", user.id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _session_or_404(user: CurrentUser, project_id: UUID, session_id: UUID) -> dict:
    # The RLS policy shows a user only their own conversations: someone else's id looks like a missing one.
    rows = (
        user.db.table("ai_conversations")
        .select("id, project_id, title, status, context_type, context_id, created_at, updated_at")
        .eq("id", str(session_id))
        .eq("project_id", str(project_id))
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Conversation not found")
    return rows[0]


def _reserve(conversation_id: str, user_id: str, content: str) -> None:
    """Stores the user's message and claims a daily slot BEFORE the paid call (see the reservation migration)."""
    try:
        service().rpc(
            "reserve_ai_message", {"p_conversation": conversation_id, "p_user": user_id, "p_content": content, "p_cap": DAILY_MESSAGE_CAP}
        ).execute().data
    except APIError as error:
        if error.code == "P0001":
            raise HTTPException(429, "Daily message limit reached. Please come back tomorrow.") from None
        raise


# ---- legacy single-thread endpoints (consultant.html) --------------------------------------------------------------


@router.get("/messages")
def list_messages(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    conversation = _latest_session(user, str(project_id))
    if not conversation:
        return ok([])
    rows = (
        user.db.table("ai_messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversation["id"])
        .order("id", desc=True)
        .limit(100)
        .execute()
        .data
    )
    return ok(rows[::-1])


@router.post("/messages", status_code=201)
def send_message(project_id: UUID, body: MessageBody, user: CurrentUser = Depends(current_user), openai=Depends(get_openai)):
    project = _writable_project(user, project_id)
    if openai is None:
        raise HTTPException(503, "The design consultant is not available right now")
    conversation = _latest_session(user, project["id"])
    if conversation is None:
        conversation = service().table("ai_conversations").insert({"project_id": project["id"], "user_id": user.id}).execute().data[0]
    history = (
        service()
        .table("ai_messages")
        .select("role, content")
        .eq("conversation_id", conversation["id"])
        .order("id", desc=True)
        .limit(HISTORY_TURNS)
        .execute()
        .data[::-1]
    )
    turns = [*history, {"role": "user", "content": body.message}]
    _reserve(conversation["id"], user.id, body.message)
    try:
        response = openai.responses.create(
            model=settings().openai_model,
            instructions=SYSTEM_PROMPT,
            input=[{"role": "user", "content": _legacy_context(user, project)}, *turns],
            max_output_tokens=MAX_OUTPUT_TOKENS,
            reasoning={"effort": "low"},
            store=False,
            timeout=TIMEOUT_SECONDS,
        )
        reply = (response.output_text or "").strip()
        if not reply:
            raise ValueError("empty reply")
        saved = service().table("ai_messages").insert(
            {"conversation_id": conversation["id"], "role": "assistant", "content": reply[:8000]}
        ).execute().data[0]
    except Exception as error:
        log.warning("OpenAI call failed: %s", type(error).__name__)
        # The reserved slot stays used: a failed or empty answer may still have been billed, so retries are never free.
        raise HTTPException(502, "The design consultant could not answer. Please try again.") from None
    rows = [{"role": "user", "content": body.message, "created_at": saved["created_at"]}, saved]
    audit("consultant.message", user.id, studio_id=project["studio_id"], project_id=project["id"])
    return ok([{"role": row["role"], "content": row["content"], "created_at": row["created_at"]} for row in rows])


# ---- sessions ------------------------------------------------------------------------------------------------------


@router.post("/sessions", status_code=201)
def create_session(project_id: UUID, body: SessionCreate, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    existing = user.db.table("ai_conversations").select("id").eq("project_id", project["id"]).eq("user_id", user.id).execute().data
    if len(existing) >= MAX_SESSIONS_PER_PROJECT_AND_USER:
        raise HTTPException(409, "Too many conversations on this project")
    row = (
        service()
        .table("ai_conversations")
        .insert({"project_id": project["id"], "user_id": user.id, "context_type": body.context_type, "context_id": body.context_id})
        .execute()
        .data[0]
    )
    return ok({k: row[k] for k in ("id", "project_id", "title", "status", "context_type", "context_id", "created_at", "updated_at")})


@router.get("/sessions")
def list_sessions(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    rows = (
        user.db.table("ai_conversations")
        .select("id, title, status, context_type, context_id, created_at, updated_at")
        .eq("project_id", str(project_id))
        .eq("user_id", user.id)
        .order("updated_at", desc=True)
        .limit(MAX_SESSIONS_PER_PROJECT_AND_USER)
        .execute()
        .data
    )
    return ok(rows)


@router.get("/sessions/{session_id}")
def get_session(project_id: UUID, session_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    session = _session_or_404(user, project_id, session_id)
    rows = (
        user.db.table("ai_messages")
        .select("id, role, content, status, created_at")
        .eq("conversation_id", session["id"])
        .order("id", desc=True)
        .limit(100)
        .execute()
        .data
    )
    return ok({**session, "messages": rows[::-1]})


# ---- streaming message ---------------------------------------------------------------------------------------------


def _prepare(user: CurrentUser, project_id: UUID, session_id: UUID, body: StreamMessageBody) -> dict:
    """Everything that can be refused is checked here, before a daily slot is spent or a stream starts."""
    project = _writable_project(user, project_id)
    session = _session_or_404(user, project_id, session_id)
    if body.source.kind == "version":
        rows = (
            user.db.table("plan_versions")
            .select("id, version_no, geometry")
            .eq("project_id", project["id"])
            .eq("id", str(body.source.version_id))
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(404, "Plan version not found")
        geometry = Geometry.model_validate(rows[0]["geometry"])
        source = {"kind": "version", "version_id": rows[0]["id"], "version_no": rows[0]["version_no"]}
    else:
        geometry = body.source.plan  # untrusted data, validated by the schema: it grants no access to anything
        source = {"kind": "working"}
    try:
        scope = resolve_scope(geometry, body.scope.model_dump())
    except ContextError as error:
        raise HTTPException(422, str(error)) from None
    brief, finishes = _brief_and_finishes(user, project["id"])
    role = "designer" if user.role_in(project["studio_id"]) else "client"
    context = build_context(geometry=geometry, scope=scope, source=source, project=project, brief=brief, finishes=finishes, role=role)
    history = (
        service()
        .table("ai_messages")
        .select("role, content")
        .eq("conversation_id", session["id"])
        .order("id", desc=True)
        .limit(HISTORY_TURNS)
        .execute()
        .data[::-1]
    )
    return {
        "project": project,
        "session": session,
        "input": build_input(context, history, body.message),
        "ref": context_ref(geometry, scope, source),
    }


@router.post("/sessions/{session_id}/messages")
async def stream_message(
    project_id: UUID,
    session_id: UUID,
    body: StreamMessageBody,
    user: CurrentUser = Depends(current_user),
    openai=Depends(get_async_openai),
):
    prepared = await run_in_threadpool(_prepare, user, project_id, session_id, body)
    if openai is None:
        raise HTTPException(503, "The design consultant is not available right now")
    # Limits are checked before the slot is reserved, so a rejected request is never charged.
    if user.id in _active_users or len(_active_users) >= MAX_ACTIVE_STREAMS:
        raise HTTPException(429, "The consultant is busy. Please try again in a moment.")
    _active_users.add(user.id)
    try:
        await run_in_threadpool(_reserve, prepared["session"]["id"], user.id, body.message)
    except BaseException:
        _active_users.discard(user.id)
        raise
    project, session = prepared["project"], prepared["session"]
    started = time.monotonic()
    model = settings().openai_model

    async def create():
        return await openai.responses.create(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=prepared["input"],
            max_output_tokens=MAX_OUTPUT_TOKENS,
            reasoning={"effort": "low"},
            store=False,
            stream=True,
            timeout=TIMEOUT_SECONDS,
        )

    def persist(text: str, status: str, usage: dict) -> dict:
        saved = (
            service()
            .table("ai_messages")
            .insert(
                {
                    "conversation_id": session["id"],
                    "role": "assistant",
                    "content": text,
                    "status": status,
                    "context_ref": prepared["ref"],
                    "metadata": {**usage, "model": model, "latency_ms": round((time.monotonic() - started) * 1000)},
                }
            )
            .execute()
            .data[0]
        )
        update = {"updated_at": "now()"}
        if not session["title"]:
            update["title"] = body.message[:60]
        service().table("ai_conversations").update(update).eq("id", session["id"]).execute()
        audit("consultant.message", user.id, studio_id=project["studio_id"], project_id=project["id"], streamed=True)
        return saved

    async def frames():
        try:
            async for frame in stream_reply(create=create, persist=persist):
                yield frame
        finally:
            _active_users.discard(user.id)

    return StreamingResponse(frames(), media_type="text/event-stream", headers=STREAM_HEADERS)
