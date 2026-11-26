import re
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path
from postgrest.exceptions import APIError

from app import mailer
from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.responses import ok
from app.schemas import InviteCreate, StudioCreate

router = APIRouter(prefix="/v1")

Slug = Path(pattern=r"^[a-z0-9-]{3,60}$")
Token = Path(pattern=r"^[A-Za-z0-9_-]{20,64}$")
ACTIVITY_METADATA = ("version_no", "author_role")  # the only audit metadata the dashboard is given
EMAILS_PER_DAY = 20  # per studio: keeps a compromised designer account from using us to spam
INVITE_DAYS = 14
RESEND_GUARD = timedelta(seconds=60)  # a double click must not send the same email twice
INVITE_COLUMNS = (
    "id, client_email, client_name, token, accepted_at, accepted_by, expires_at, created_at, "
    "revoked_at, replaced_by, last_send_at, last_send_status"
)


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "studio"
    return f"{base}-{secrets.token_hex(3)}"


def _require_member(user: CurrentUser, studio_id: UUID) -> dict:
    # RLS-scoped: only a member can see the studio row at all, and a suspended studio is treated the same.
    rows = user.db.table("studio_memberships").select("role, studio:studios(status, name)").eq("studio_id", str(studio_id)).execute().data
    if not rows or rows[0]["studio"]["status"] != "active":
        raise HTTPException(403, "You are not a member of an active studio with this id")
    return rows[0]["studio"]


def _emails_today(studio_id: UUID) -> int:
    since = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    query = service().table("audit_events").select("id", count="exact").eq("studio_id", str(studio_id))
    return query.eq("action", "invite.emailed").gte("created_at", since).limit(1).execute().count or 0


def _claim_send(invite_id: str) -> bool:
    """Atomically marks the invite as being emailed now. False when a send started or succeeded in the last minute,
    so a double click or a parallel request never sends twice; after a failure the claim is free again."""
    cutoff = (datetime.now(UTC) - RESEND_GUARD).isoformat()
    free = f'last_send_at.is.null,last_send_at.lt."{cutoff}",last_send_status.in.(failed,not_configured,daily_limit)'
    claimed = (
        service()
        .table("studio_invites")
        .update({"last_send_at": datetime.now(UTC).isoformat(), "last_send_status": None})  # null status: sending
        .eq("id", invite_id)
        .or_(free)
        .execute()
        .data
    )
    return bool(claimed)


def _email_invite(user: CurrentUser, studio_id: UUID, studio_name: str, invite: dict) -> dict:
    """Sends the invite email and records the attempt on the invite. Returns the invite as stored afterwards, plus
    "emailed": true when the email was sent now or is already on its way from a request a moment ago."""
    if not _claim_send(invite["id"]):
        # A second click or a retry right after a success: the first send covers it.
        current = service().table("studio_invites").select(INVITE_COLUMNS).eq("id", invite["id"]).execute().data[0]
        return {**current, "emailed": current["last_send_status"] in ("sent", None)}
    # shortcut: the count-then-send cap can be overshot by a few parallel requests; move it into SQL if that matters.
    if not mailer.enabled():
        status = "not_configured"
    elif _emails_today(studio_id) >= EMAILS_PER_DAY:
        status = "daily_limit"
    else:
        status = "sent" if mailer.send_invite(invite["client_email"], invite["client_name"], studio_name, invite["token"]) else "failed"
    stored = service().table("studio_invites").update({"last_send_status": status}).eq("id", invite["id"]).execute().data[0]
    if status == "sent":
        audit("invite.emailed", user.id, studio_id=str(studio_id), invite_id=invite["id"])
    return {**_public(stored), "emailed": status == "sent"}


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


def _new_expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=INVITE_DAYS)).isoformat()


def _expired(invite: dict) -> bool:
    return datetime.fromisoformat(invite["expires_at"]) <= datetime.now(UTC)


def _open_invite(studio_id: UUID, email: str) -> dict | None:
    query = service().table("studio_invites").select(INVITE_COLUMNS).eq("studio_id", str(studio_id)).eq("client_email", email)
    rows = query.is_("accepted_at", "null").is_("revoked_at", "null").execute().data
    return rows[0] if rows else None


def _renew(invite_id: str, changes: dict | None = None) -> dict:
    # Same token, a fresh 14 days: a link the client already has keeps working.
    update = {"expires_at": _new_expiry(), **(changes or {})}
    return service().table("studio_invites").update(update).eq("id", invite_id).execute().data[0]


def _studio_invite(studio_id: UUID, invite_id: UUID) -> dict:
    """The invite in this studio, or 404 when it does not exist there or was cancelled."""
    invite = _studio_invite_any(studio_id, invite_id)
    if invite["revoked_at"]:
        raise HTTPException(404, "Invitation not found")
    return invite


def _studio_invite_any(studio_id: UUID, invite_id: UUID) -> dict:
    """The invite in this studio, cancelled or not."""
    rows = service().table("studio_invites").select(INVITE_COLUMNS).eq("id", str(invite_id)).eq("studio_id", str(studio_id)).execute().data
    if not rows:
        raise HTTPException(404, "Invitation not found")
    return rows[0]


def _public(invite: dict) -> dict:
    return {key: invite[key] for key in INVITE_COLUMNS.split(", ")}


def _insert_invite(studio_id: UUID, email: str, name: str, user: CurrentUser) -> dict | None:
    """The new invite, or None when a parallel request created the open invite for this address first."""
    row = {
        "studio_id": str(studio_id),
        "client_email": email,
        "client_name": name,
        "token": secrets.token_urlsafe(24),
        "created_by": user.id,
        "expires_at": _new_expiry(),
    }
    try:
        invite = service().table("studio_invites").insert(row).execute().data[0]
    except APIError as error:
        if error.code == "23505":  # unique violation on studio_invites_one_open_idx
            return None
        raise
    audit("invite.created", user.id, studio_id=str(studio_id), invite_id=invite["id"])
    return invite


@router.post("/studios/{studio_id}/invites", status_code=201)
def create_invite(studio_id: UUID, body: InviteCreate, user: CurrentUser = Depends(current_user)):
    """One open invite per client: inviting the same address again resends the same link."""
    studio = _require_member(user, studio_id)
    email = body.client_email.lower()  # stored lower-case so lookups and the unique index agree
    invite = _open_invite(studio_id, email)
    if invite is None:
        invite = _insert_invite(studio_id, email, body.client_name, user) or _open_invite(studio_id, email)
        if invite is None:
            raise HTTPException(409, "Please try again")  # the parallel invite was accepted or revoked in between
    else:
        invite = _renew(invite["id"], {"client_name": body.client_name})
    return ok(_email_invite(user, studio_id, studio["name"], _public(invite)))


@router.post("/studios/{studio_id}/invites/{invite_id}/send")
def resend_invite(studio_id: UUID, invite_id: UUID, user: CurrentUser = Depends(current_user)):
    studio = _require_member(user, studio_id)
    invite = _studio_invite(studio_id, invite_id)
    if invite["accepted_at"]:
        raise HTTPException(409, "This invitation was already accepted")
    return ok(_email_invite(user, studio_id, studio["name"], _public(_renew(invite["id"]))))


@router.delete("/studios/{studio_id}/invites/{invite_id}")
def revoke_invite(studio_id: UUID, invite_id: UUID, user: CurrentUser = Depends(current_user)):
    _require_member(user, studio_id)
    invite = _studio_invite(studio_id, invite_id)
    revoked = (
        service()
        .table("studio_invites")
        .update({"revoked_at": datetime.now(UTC).isoformat()})
        .eq("id", invite["id"])
        .is_("accepted_at", "null")  # an accepted invite is history, not a live link
        .execute()
        .data
    )
    if not revoked:
        raise HTTPException(409, "This invitation was already accepted")
    audit("invite.revoked", user.id, studio_id=str(studio_id), invite_id=invite["id"])
    return ok({"id": invite["id"]})


CORRECT_ERRORS = {  # errors raised by public.correct_invite
    "P0002": (404, "Invitation not found"),
    "P0001": (409, "Only an invitation that is still open can be corrected"),
    "22023": (422, "The corrected address is the same as the original"),
}


@router.post("/studios/{studio_id}/invites/{invite_id}/correct", status_code=201)
def correct_invite(studio_id: UUID, invite_id: UUID, body: InviteCreate, user: CurrentUser = Depends(current_user)):
    """Cancels the invite (its link stops working) and invites the corrected address with a new link, in one
    transaction. Retrying the same correction returns the same new invite and does not email twice."""
    studio = _require_member(user, studio_id)
    _studio_invite_any(studio_id, invite_id)  # 404 unless the invite belongs to this studio
    try:
        new_id = (
            service()
            .rpc(
                "correct_invite",
                {
                    "p_invite": str(invite_id),
                    "p_email": body.client_email.lower(),
                    "p_name": body.client_name,
                    "p_token": secrets.token_urlsafe(24),
                    "p_expires": _new_expiry(),
                    "p_actor": user.id,
                },
            )
            .execute()
            .data
        )
    except APIError as error:
        if error.code in CORRECT_ERRORS:
            raise HTTPException(*CORRECT_ERRORS[error.code]) from None
        raise
    replacement = service().table("studio_invites").select(INVITE_COLUMNS).eq("id", new_id).execute().data[0]
    audit("invite.corrected", user.id, studio_id=str(studio_id), invite_id=str(invite_id), replaced_by=new_id)
    return ok(_email_invite(user, studio_id, studio["name"], replacement))


@router.get("/studios/{studio_id}/invites")
def list_invites(studio_id: UUID, user: CurrentUser = Depends(current_user)):
    _require_member(user, studio_id)
    rows = (
        user.db.table("studio_invites")
        .select(INVITE_COLUMNS)
        .eq("studio_id", str(studio_id))
        .order("created_at", desc=True)  # the whole history, cancelled and replaced invites included
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


def _live_invite(token: str) -> dict:
    """The invite behind a token, or 404 when it does not exist, was revoked, or expired before being accepted."""
    rows = (
        service()
        .table("studio_invites")
        .select("id, studio_id, client_name, client_email, accepted_by, accepted_at, expires_at, revoked_at, studio:studios(id, name, slug)")
        .eq("token", token)
        .execute()
        .data
    )
    if not rows or rows[0]["revoked_at"] or (not rows[0]["accepted_at"] and _expired(rows[0])):
        raise HTTPException(404, "This invitation is not valid any more. Ask the studio to send it again.")
    return rows[0]


@router.get("/invites/{token}")
def invite_by_token(token: str = Token):
    """Public: shows whom the link greets. Never returns the email; entering still needs that verified address."""
    invite = _live_invite(token)
    return ok({key: invite[key] for key in ("client_name", "accepted_at", "studio")})


def _verified_email(user_id: str) -> str | None:
    # Read from Supabase Auth, not from the token: an address counts only once its owner confirmed it.
    account = service().auth.admin.get_user_by_id(user_id).user
    return (account.email or "").lower() if account and account.email_confirmed_at else None


@router.post("/invites/{token}/accept")
def accept_invite(token: str = Token, user: CurrentUser = Depends(current_user)):
    """Only the invited client may accept: the account's confirmed email must be the invited address."""
    invite = _live_invite(token)
    if invite["accepted_by"] == user.id:
        return ok({"studio_id": invite["studio_id"]})
    if invite["accepted_by"]:
        raise HTTPException(409, "This invitation was already used")
    email = _verified_email(user.id)
    if email is None:
        raise HTTPException(403, "Confirm your email address first, then open the invitation again.")
    if email != invite["client_email"].lower():
        raise HTTPException(403, "This invitation was sent to a different email address. Sign in with that address.")
    updated = (
        service()
        .table("studio_invites")
        .update({"accepted_by": user.id, "accepted_at": datetime.now(UTC).isoformat()})
        .eq("id", invite["id"])
        .is_("accepted_by", "null")  # guards against two requests racing for one invite
        .is_("revoked_at", "null")
        .execute()
        .data
    )
    if not updated:
        raise HTTPException(409, "This invitation was already used")
    audit("invite.accepted", user.id, studio_id=invite["studio_id"], invite_id=invite["id"])
    return ok({"studio_id": invite["studio_id"]})
