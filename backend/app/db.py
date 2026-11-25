"""Settings and Supabase clients.

Reads use a client carrying the caller's JWT, so Postgres RLS decides what is visible.
Writes use the service client, only after the route has validated the payload and
confirmed access with an RLS-scoped read.
"""

from functools import lru_cache

import httpx
from pydantic_settings import BaseSettings, SettingsConfigDict
from supabase import Client, ClientOptions, create_client


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_publishable_key: str
    supabase_secret_key: str
    allowed_origins: str = "http://localhost:5500"
    openai_api_key: str = ""  # empty: the consultant answers 503
    openai_model: str = "gpt-5-mini"


@lru_cache
def settings() -> Settings:
    return Settings()


@lru_cache
def _http() -> httpx.Client:
    # One connection pool for all Supabase calls, so requests do not each pay for a new TLS handshake.
    # Every Supabase client sends its own headers with each request, so sharing the pool never shares credentials.
    return httpx.Client(timeout=15)


@lru_cache
def service() -> Client:
    # Never sign a user in on this client: that would swap its key for the user's token.
    return create_client(settings().supabase_url, settings().supabase_secret_key, ClientOptions(httpx_client=_http()))


def user_client(access_token: str) -> Client:
    return create_client(
        settings().supabase_url,
        settings().supabase_publishable_key,
        ClientOptions(httpx_client=_http(), headers={"Authorization": f"Bearer {access_token}"}),
    )


def audit(action: str, actor_id: str, studio_id: str | None = None, project_id: str | None = None, **metadata) -> None:
    service().table("audit_events").insert(
        {"action": action, "actor_id": actor_id, "studio_id": studio_id, "project_id": project_id, "metadata": metadata}
    ).execute()
