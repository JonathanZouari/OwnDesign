"""Invite emails: the message itself (no network, no Supabase) and the route's behaviour (real Supabase, Resend faked)."""

from types import SimpleNamespace

import httpx
import pytest

from app import mailer
from tests.conftest import needs_supabase

CONFIG = SimpleNamespace(resend_api_key="re_test", email_from="Atelier <invites@example.com>", app_url="https://app.example.com/")


class FakeHttp:
    def __init__(self, status=200, error=None):
        self.status, self.error, self.calls = status, error, []

    def post(self, url, json, headers):
        self.calls.append((url, json, headers))
        if self.error:
            raise self.error
        return SimpleNamespace(status_code=self.status)


@pytest.fixture
def configured(monkeypatch):
    http = FakeHttp()
    monkeypatch.setattr(mailer, "settings", lambda: CONFIG)
    monkeypatch.setattr(mailer, "_http", lambda: http)
    return http


def test_link_is_built_from_configuration(configured):
    assert mailer.invite_url("abc_DEF-123") == "https://app.example.com/entry.html?invite=abc_DEF-123"


def test_names_are_escaped_and_subject_is_one_line(configured):
    message = mailer.invite_message("a@x.com", "<b>Dana</b>", "Evil\r\nBcc: x@y.com <script>", "https://app.example.com/e?a=1&b=2")
    assert "<b>Dana</b>" not in message["html"] and "&lt;b&gt;Dana&lt;/b&gt;" in message["html"]
    assert "<script>" not in message["html"]
    assert "&amp;b=2" in message["html"]
    assert "\n" not in message["subject"] and "\r" not in message["subject"]
    assert message["to"] == ["a@x.com"] and message["from"] == CONFIG.email_from
    assert "$" not in message["html"]  # every template placeholder was filled


def test_message_has_hero_tagline_and_link(configured):
    message = mailer.invite_message("a@x.com", "Dana", "Studio", "https://app.example.com/entry.html?invite=t")
    assert "Your space, your style." in message["text"]
    assert 'src="https://app.example.com/img/email-hero.jpg"' in message["html"]
    assert 'href="https://app.example.com/entry.html?invite=t"' in message["html"]


def test_send_posts_to_resend_with_key(configured):
    assert mailer.send_invite("a@x.com", "Dana", "Studio", "tok") is True
    url, body, headers = configured.calls[0]
    assert url == mailer.RESEND_URL and headers == {"Authorization": "Bearer re_test"}
    assert "https://app.example.com/entry.html?invite=tok" in body["text"]


@pytest.mark.parametrize("http", [FakeHttp(status=422), FakeHttp(status=500), FakeHttp(error=httpx.ConnectTimeout("t"))])
def test_send_failure_returns_false_and_never_raises(monkeypatch, http):
    monkeypatch.setattr(mailer, "settings", lambda: CONFIG)
    monkeypatch.setattr(mailer, "_http", lambda: http)
    assert mailer.send_invite("a@x.com", "Dana", "Studio", "tok") is False


@pytest.mark.parametrize("missing", ["resend_api_key", "email_from", "app_url"])
def test_disabled_without_full_configuration(monkeypatch, missing):
    http = FakeHttp()
    monkeypatch.setattr(mailer, "settings", lambda: SimpleNamespace(**{**vars(CONFIG), missing: ""}))
    monkeypatch.setattr(mailer, "_http", lambda: http)
    assert mailer.send_invite("a@x.com", "Dana", "Studio", "tok") is False and http.calls == []


@needs_supabase
def test_create_invite_emails_audits_and_caps(api, make_user, monkeypatch):
    from app.routes import studios

    sent = []
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send_invite", lambda *args: sent.append(args) or True)
    monkeypatch.setattr(studios, "EMAILS_PER_DAY", 2)
    designer, outsider = make_user("mail-designer"), make_user("mail-outsider")
    studio = api.post("/v1/studios", json={"name": "Mail Studio"}, headers=designer.headers).json()["data"]
    url = f"/v1/studios/{studio['id']}/invites"

    results = [
        api.post(url, json={"client_email": f"c{i}@example.com", "client_name": f"C{i}"}, headers=designer.headers) for i in range(3)
    ]
    assert [r.status_code for r in results] == [201] * 3
    assert [r.json()["data"]["emailed"] for r in results] == [True, True, False]  # third is over the cap, still created
    assert sent[0] == ("c0@example.com", "C0", "Mail Studio", results[0].json()["data"]["token"])

    assert api.post(url, json={"client_email": "x@example.com", "client_name": "X"}, headers=outsider.headers).status_code == 403
    assert len(sent) == 2

    monkeypatch.setattr(mailer, "send_invite", lambda *args: False)  # Resend down: invite still created
    monkeypatch.setattr(studios, "EMAILS_PER_DAY", 100)
    failed = api.post(url, json={"client_email": "y@example.com", "client_name": "Y"}, headers=designer.headers)
    assert failed.status_code == 201 and failed.json()["data"]["emailed"] is False
