import re
import secrets
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path

from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.responses import ok
from app.schemas import InviteCreate, StudioCreate

router = APIRouter(prefix="/v1")

Slug = Path(pattern=r"^[a-z0-9-]{3,60}$")
Token = Path(pattern=r"^[A-Za-z0-9_-]{20,64}$")
ACTIVITY_METADATA = ("version_no", "author_role")  # the only audit metadata the dashboard is given


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "studio"
    return f"{base}-{secrets.token_hex(3)}"


def _require_member(user: CurrentUser, studio_id: UUID) -> None:
    # RLS-scoped: only a member can see the studio row at all, and a suspended studio is treated the same.
    rows = user.db.table("studio_memberships").select("role, studio:studios(status)").eq("studio_id", str(studio_id)).execute().data
    if not rows or rows[0]["studio"]["status"] != "active":
        raise HTTPException(403, "You are not a member of an active studio with this id")


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    memberships = user.db.table("studio_memberships").select("role, studio:studios(id, name, slug)").execute().data
    return ok({"id": user.id, "email": user.email, "memberships": memberships})


@router.post("/studios", status_code=201)
def create_studio(body: StudioCreate, user: CurrentUser = Depends(current_user)):
    owned = user.db.table("studio_memberships").select("studio_id").eq("role", "owner").execute().data
    if owned:
        raise HTTPException(409, "You already own a studio")
    studio = service().table("studios").insert({"name": body.name, "slug": _slug(body.name)}).execute().data[0]
    try:
        service().table("studio_memberships").insert(
            {"studio_id": studio["id"], "user_id": user.id, "role": "owner"}
        ).execute()
    except Exception:
        service().table("studios").delete().eq("id", studio["id"]).execute()  # no ownerless studios
        raise
    audit("studio.created", user.id, studio_id=studio["id"])
    return ok({"id": studio["id"], "name": studio["name"], "slug": studio["slug"]})


@router.get("/studios/by-slug/{slug}")
def studio_by_slug(slug: str = Slug):
    """Public: the studio entry page shows this before anyone signs in."""
    rows = service().table("studios").select("id, name, slug").eq("slug", slug).eq("status", "active").execute().data
    if not rows:
        raise HTTPException(404, "Studio not found")
    return ok(rows[0])


@router.post("/studios/{studio_id}/invites", status_code=201)
def create_invite(studio_id: UUID, body: InviteCreate, user: CurrentUser = Depends(current_user)):
    _require_member(user, studio_id)
    invite = (
        service()
        .table("studio_invites")
        .insert(
            {
                "studio_id": str(studio_id),
                "client_email": body.client_email,
                "client_name": body.client_name,
                "token": secrets.token_urlsafe(24),
                "created_by": user.id,
            }
        )
        .execute()
        .data[0]
    )
    audit("invite.created", user.id, studio_id=str(studio_id), invite_id=invite["id"])
    return ok(invite)


@router.get("/studios/{studio_id}/invites")
def list_invites(studio_id: UUID, user: CurrentUser = Depends(current_user)):
    _require_member(user, studio_id)
    rows = (
        user.db.table("studio_invites")
        .select("id, client_email, client_name, token, accepted_at, created_at")
        .eq("studio_id", str(studio_id))
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return ok(rows)


@router.get("/studios/{studio_id}/audit")
def list_activity(studio_id: UUID, user: CurrentUser = Depends(current_user)):
    """The studio's latest audit events. Read with the caller's JWT, so RLS limits it to their studio."""
    _require_member(user, studio_id)
    rows = (
        user.db.table("audit_events")
        .select("id, action, metadata, created_at, project:projects(name)")
        .eq("studio_id", str(studio_id))
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )
    return ok([{**row, "metadata": {key: row["metadata"][key] for key in ACTIVITY_METADATA if key in row["metadata"]}} for row in rows])


@router.get("/invites/{token}")
def invite_by_token(token: str = Token):
    """Public: possession of the unguessable token is the credential. Never returns the email."""
    rows = (
        service()
        .table("studio_invites")
        .select("client_name, accepted_at, studio:studios(id, name, slug)")
        .eq("token", token)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Invitation not found")
    return ok(rows[0])


@router.post("/invites/{token}/accept")
def accept_invite(token: str = Token, user: CurrentUser = Depends(current_user)):
    rows = service().table("studio_invites").select("id, studio_id, accepted_by").eq("token", token).execute().data
    if not rows:
        raise HTTPException(404, "Invitation not found")
    invite = rows[0]
    if invite["accepted_by"] == user.id:
        return ok({"studio_id": invite["studio_id"]})
    updated = (
        service()
        .table("studio_invites")
        .update({"accepted_by": user.id, "accepted_at": datetime.now(UTC).isoformat()})
        .eq("id", invite["id"])
        .is_("accepted_by", "null")  # guards against two people racing for one invite
        .execute()
        .data
    )
    if not updated:
        raise HTTPException(409, "This invitation was already used")
    audit("invite.accepted", user.id, studio_id=invite["studio_id"], invite_id=invite["id"])
    return ok({"studio_id": invite["studio_id"]})
