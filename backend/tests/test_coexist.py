"""The two AI features live in one app: the streaming advisor (Groq) and the saved-chat consultant (OpenAI).

No Supabase and no network. Each feature is configured by its own settings, and neither depends on the other.
"""

import pytest

from app import advisor
from app.db import Settings
from app.routes import consultant
from tests.conftest import needs_supabase


def settings_with(**values):
    # _env_file=None: a developer's real .env must not leak into the test.
    return Settings(_env_file=None, supabase_url="http://x", supabase_publishable_key="x", supabase_secret_key="x", **values)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    # A key exported in the developer's shell overrides a default; none of these tests may depend on it.
    for name in ("GROQ_API_KEY", "GROQ_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL"):
        monkeypatch.delenv(name, raising=False)
    advisor._client.cache_clear()
    consultant._client.cache_clear()
    yield
    advisor._client.cache_clear()
    consultant._client.cache_clear()


def use(monkeypatch, config):
    monkeypatch.setattr(advisor, "settings", lambda: config)
    monkeypatch.setattr(consultant, "settings", lambda: config)


@needs_supabase
def test_each_feature_has_its_own_route():
    from app.main import app

    paths = app.openapi()["paths"]
    assert list(paths["/v1/projects/{project_id}/advisor"]) == ["post"]
    assert sorted(paths["/v1/projects/{project_id}/consultant/messages"]) == ["get", "post"]


def test_the_advisor_needs_groq_settings_and_ignores_the_openai_ones(monkeypatch):
    use(monkeypatch, settings_with(openai_api_key="sk-x", openai_model="gpt-x"))
    assert advisor.get_llm() is None
    assert consultant.get_openai() is not None


def test_the_consultant_needs_an_openai_key_and_ignores_the_groq_ones(monkeypatch):
    use(monkeypatch, settings_with(groq_api_key="gsk-x", groq_model="openai/gpt-oss-120b"))
    assert consultant.get_openai() is None
    assert isinstance(advisor.get_llm(), advisor.GroqLlm)


def test_with_both_configured_both_are_available(monkeypatch):
    use(monkeypatch, settings_with(groq_api_key="gsk-x", groq_model="m", openai_api_key="sk-x"))
    assert isinstance(advisor.get_llm(), advisor.GroqLlm)
    assert consultant.get_openai() is not None


def test_with_neither_configured_both_are_unavailable(monkeypatch):
    use(monkeypatch, settings_with())
    assert advisor.get_llm() is None
    assert consultant.get_openai() is None


def test_each_client_gets_only_its_own_key_and_host(monkeypatch):
    """The Groq key must never be sent to OpenAI, and the OpenAI key never to Groq."""
    use(monkeypatch, settings_with(groq_api_key="gsk-x", groq_model="m", openai_api_key="sk-x"))
    groq_client = advisor.get_llm()._client
    openai_client = consultant.get_openai()
    assert (groq_client.api_key, groq_client.base_url.host) == ("gsk-x", "api.groq.com")
    assert (openai_client.api_key, openai_client.base_url.host) == ("sk-x", "api.openai.com")


def test_the_consultants_default_model_does_not_leak_into_the_advisor(monkeypatch):
    config = settings_with(groq_api_key="gsk-x")  # no GROQ_MODEL: the advisor has no default model
    use(monkeypatch, config)
    assert config.openai_model == "gpt-5-mini"
    assert config.groq_model is None
    assert advisor.get_llm() is None
