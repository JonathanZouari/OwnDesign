"""Invite emails, sent through the Resend HTTP API. Without RESEND_API_KEY, EMAIL_FROM and APP_URL nothing is sent."""

import logging
from html import escape
from urllib.parse import quote

from app.db import _http, settings

log = logging.getLogger(__name__)
RESEND_URL = "https://api.resend.com/emails"


def invite_url(token: str) -> str:
    # Built from configuration, never from the request, so a caller cannot point the link at another host.
    return f"{settings().app_url.rstrip('/')}/entry.html?invite={quote(token)}"


def enabled() -> bool:
    s = settings()
    return bool(s.resend_api_key and s.email_from and s.app_url)


def _one_line(text: str) -> str:
    return " ".join(text.split())  # no line breaks in the subject


def invite_message(to: str, client_name: str, studio_name: str, url: str) -> dict:
    name, studio = escape(client_name), escape(studio_name)
    return {
        "from": settings().email_from,
        "to": [to],
        "subject": _one_line(f"{studio_name} invited you to your design project"),
        "text": f"Hi {client_name},\n\n{studio_name} invited you to plan your home with them.\n"
        f"Open your personal link:\n{url}\n\nThis link is for you only. Do not forward it.",
        "html": f"<p>Hi {name},</p><p>{studio} invited you to plan your home with them.</p>"
        f'<p><a href="{escape(url)}">Open your personal invitation</a></p>'
        "<p>This link is for you only. Do not forward it.</p>",
    }


def send_invite(to: str, client_name: str, studio_name: str, token: str) -> bool:
    """True when Resend accepted the email. Never raises: the invite exists either way."""
    if not enabled():
        return False
    try:
        response = _http().post(
            RESEND_URL,
            json=invite_message(to, client_name, studio_name, invite_url(token)),
            headers={"Authorization": f"Bearer {settings().resend_api_key}"},
        )
    except Exception as error:
        log.warning("Invite email failed: %s", type(error).__name__)
        return False
    if response.status_code >= 300:
        log.warning("Invite email rejected: HTTP %s", response.status_code)
        return False
    return True
