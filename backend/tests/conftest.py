"""Shared fixtures for tests that talk to the real Supabase project configured in backend/.env.

Every user and studio a test creates is deleted again at the end of the session.
"""

import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

needs_supabase = pytest.mark.skipif(
    not (os.getenv("SUPABASE_URL") or Path(".env").exists()),
    reason="Supabase is not configured (backend/.env missing)",
)

TEST_EMAIL_DOMAIN = f"{uuid.uuid4().hex}.owndesign-test.example.com"


@pytest.fixture(scope="session")
def api():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture(scope="session")
def admin():
    """A service client of its own, so nothing a test does can affect the app's client."""
    from supabase import create_client

    from app.db import settings

    return create_client(settings().supabase_url, settings().supabase_secret_key)


def unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@{TEST_EMAIL_DOMAIN}"


@pytest.fixture(scope="session")
def make_user(admin):
    from supabase import create_client

    from app.db import settings

    def make(prefix: str) -> SimpleNamespace:
        email = unique_email(prefix)
        password = uuid.uuid4().hex + "Aa1!"
        user = admin.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
        signed_in = create_client(settings().supabase_url, settings().supabase_publishable_key)
        token = signed_in.auth.sign_in_with_password({"email": email, "password": password}).session.access_token
        return SimpleNamespace(id=user.id, email=email, password=password, token=token, headers={"Authorization": f"Bearer {token}"})

    yield make

    # Removes every test account, including ones created through the browser sign-up form.
    users = [user for user in admin.auth.admin.list_users(per_page=1000) if (user.email or "").endswith(f"@{TEST_EMAIL_DOMAIN}")]
    user_ids = [user.id for user in users]
    if user_ids:
        owned = admin.table("studio_memberships").select("studio_id").in_("user_id", user_ids).execute().data
        if owned:
            admin.table("studios").delete().in_("id", [row["studio_id"] for row in owned]).execute()
    for user_id in user_ids:
        admin.auth.admin.delete_user(user_id)
