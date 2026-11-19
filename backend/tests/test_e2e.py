"""Browser test of the critical journey (PRD acceptance scenarios 1, 2 and 6):

a guest follows a studio link, builds a plan, is asked to register before it can be
saved, registers, and the saved geometry survives a reload and is visible to the designer.

Starts the backend and the static frontend itself unless they are already running.
"""

import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tests.conftest import needs_supabase, unique_email

BACKEND = Path(__file__).resolve().parents[1]
FRONTEND = BACKEND.parent / "frontend"
SITE = "http://127.0.0.1:5500"

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]


def _listening(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def _serve(port: int, command: list[str], cwd: Path):
    if _listening(port):
        return None
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 30
    while not _listening(port):
        if process.poll() is not None or time.monotonic() > deadline:
            process.kill()
            raise RuntimeError(f"Could not start server on port {port}")
        time.sleep(0.2)
    return process


@pytest.fixture(scope="module")
def servers():
    started = [
        _serve(8000, [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], BACKEND),
        _serve(5500, [sys.executable, "-m", "http.server", "5500", "--bind", "127.0.0.1"], FRONTEND),
    ]
    yield
    for process in started:
        if process:
            process.terminate()


def test_guest_builds_plan_registers_and_saves(servers, page, api, make_user):
    designer = make_user("e2e-designer")
    studio = api.post("/v1/studios", json={"name": "E2E Studio"}, headers=designer.headers).json()["data"]
    client_email = unique_email("e2e-client")
    walls = page.locator("#canvas [data-kind=walls]")
    furniture = page.locator("#canvas [data-kind=furniture]")

    # Guest arrives through the studio link and sees the studio's name.
    page.goto(f"{SITE}/entry.html?studio={studio['slug']}")
    page.get_by_role("heading", name="Plan your home with E2E Studio.").wait_for()
    page.get_by_role("link", name="Start designing").click()

    # Wizard: two default rooms -> eight walls on the canvas.
    page.get_by_label("Project name").fill("E2E Flat")
    page.get_by_role("button", name="Generate 2D canvas").click()
    page.wait_for_url("**/editor.html")
    walls.first.wait_for(state="attached")
    assert walls.count() == 8

    # Place a sofa in the middle of the canvas.
    box = page.locator("#canvas").bounding_box()
    page.keyboard.press("f")
    page.locator("#catalog button[data-type=sofa]").click()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    assert furniture.count() == 1
    # The same can be done without a pointer: choose from the catalog and press Enter to place it.
    page.keyboard.press("f")
    page.locator("#catalog button[data-type=chair]").press("Enter")
    page.keyboard.press("Enter")
    assert furniture.count() == 2

    # Scenario 1: a guest cannot persist; saving asks for an account.
    page.locator("#save").click()
    page.get_by_role("heading", name="Create an account to save your plan").wait_for()
    page.get_by_role("link", name="Create account").click()
    page.get_by_label("Email").fill(client_email)
    page.get_by_label("Password").fill("e2e-Password-123")
    page.get_by_role("button", name="Create account").click()

    # Back in the editor with the draft intact; the save dialog opens by itself.
    page.get_by_label("Version note (optional)").fill("first draft")
    page.keyboard.press("Enter")  # Enter in the note field saves (it must not act as Cancel)
    page.wait_for_url("**/editor.html?project=*")
    walls.first.wait_for(state="attached")
    page.get_by_text("Saved · v1").wait_for()
    assert (walls.count(), furniture.count()) == (8, 2)

    # Scenario 2: move the sofa, save again, reload -> geometry and history are preserved.
    furniture.first.focus()
    page.keyboard.press("ArrowRight")
    page.get_by_text("Unsaved changes").wait_for()
    page.locator("#save").click()
    page.get_by_role("button", name="Save version").click()
    page.get_by_text("Saved · v2").wait_for()
    # Dismissing the dialog with Escape must not save again.
    page.keyboard.press("Control+s")
    page.get_by_role("heading", name="Save a new version").wait_for()
    page.keyboard.press("Escape")
    page.get_by_role("heading", name="Save a new version").wait_for(state="hidden")
    # Selecting something without moving it is not a change.
    furniture.first.focus()
    page.wait_for_timeout(500)
    assert page.locator("#status-save").inner_text() == "Saved · v2"
    page.reload()
    walls.first.wait_for(state="attached")
    assert (walls.count(), furniture.count()) == (8, 2)
    assert page.locator(".version").count() == 2

    # Scenario 6: the studio's designer sees the client's project and its latest plan.
    project_id = page.url.split("project=")[1]
    seen = api.get(f"/v1/projects/{project_id}", headers=designer.headers).json()["data"]
    assert (seen["name"], seen["client_email"], seen["my_role"]) == ("E2E Flat", client_email, "designer")
    versions = api.get(f"/v1/projects/{project_id}/versions", headers=designer.headers).json()["data"]
    assert [(v["version_no"], v["author_role"], v["label"]) for v in versions] == [(2, "client", ""), (1, "client", "first draft")]
    first = api.get(f"/v1/projects/{project_id}/versions/{versions[1]['id']}", headers=designer.headers).json()["data"]["geometry"]
    latest = api.get(f"/v1/projects/{project_id}/versions/latest", headers=designer.headers).json()["data"]["geometry"]
    assert latest["furniture"][0]["x"] == first["furniture"][0]["x"] + 10
    assert latest["walls"] == first["walls"]


def test_designer_opens_studio_invites_and_revises_client_plan(servers, page, api, make_user):
    from tests.test_geometry import VALID

    # A new designer signs up through the UI and gets a studio with its own link.
    page.goto(f"{SITE}/auth.html?mode=signup&role=studio")
    page.get_by_label("Studio name").fill("Atelier E2E")
    page.get_by_label("Email").fill(unique_email("e2e-owner"))
    page.get_by_label("Password").fill("e2e-Password-123")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_url("**/studio.html")
    page.get_by_role("heading", name="Atelier E2E").wait_for()
    studio_url = page.get_by_label("Studio link").input_value()
    slug = studio_url.split("studio=")[1]
    assert studio_url.startswith(f"{SITE}/entry.html?studio=atelier-e2e-")

    # Personal invite: appears as pending, and its link resolves publicly to this studio.
    page.get_by_label("Client name").fill("Dana Client")
    page.get_by_label("Client email").fill("dana@example.com")
    page.get_by_role("button", name="Create invite link").click()
    page.get_by_role("cell", name="Pending").wait_for()

    # A client of this studio saves a plan (through the API, as the editor would).
    client = make_user("e2e-invited")
    studio = api.get(f"/v1/studios/by-slug/{slug}").json()["data"]
    project = api.post(
        "/v1/projects", json={"studio_id": studio["id"], "name": "Dana's flat", "property_type": "new_build"}, headers=client.headers
    ).json()["data"]
    assert api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers).status_code == 201

    # The designer finds it on the dashboard, opens it, revises it and saves a designer version.
    page.reload()
    row = page.get_by_role("row", name="Dana's flat")
    row.get_by_text(client.email).wait_for()
    row.get_by_role("link", name="Open").click()
    page.get_by_text("Editing as designer").wait_for()
    page.locator("#canvas [data-kind=furniture]").first.focus()
    page.keyboard.press("r")
    page.locator("#save").click()
    page.get_by_label("Version note (optional)").fill("rotated the sofa")
    page.get_by_role("button", name="Save version").click()
    page.get_by_text("Saved · v2").wait_for()
    page.get_by_text("v2 · designer").wait_for()

    # The client sees the designer's revision, labelled as such, and the original is untouched.
    versions = api.get(f"/v1/projects/{project['id']}/versions", headers=client.headers).json()["data"]
    assert [(v["version_no"], v["author_role"]) for v in versions] == [(2, "designer"), (1, "client")]
    latest = api.get(f"/v1/projects/{project['id']}/versions/latest", headers=client.headers).json()["data"]["geometry"]
    assert latest["furniture"][0]["rotation"] == 90


def _sign_in(page, user):
    page.goto(f"{SITE}/auth.html")
    page.get_by_label("Email").fill(user.email)
    page.get_by_label("Password").fill(user.password)
    page.get_by_role("button", name="Sign in").click()


def test_client_account_opens_a_studio_from_projects(servers, page, api, make_user):
    client = make_user("e2e-opener")
    _sign_in(page, client)
    page.wait_for_url("**/projects.html")
    page.get_by_role("heading", name="Are you a designer? Open your studio").wait_for()

    # Without a studio the new-project toast points at the card.
    page.locator("#new-project").click()
    page.get_by_text("To start a project, open your designer's link, or open your own studio below.").wait_for()

    page.get_by_label("Studio name").fill("Opened Later Studio")
    page.get_by_role("button", name="Open studio").click()
    page.wait_for_url("**/studio.html")
    page.get_by_role("heading", name="Opened Later Studio").wait_for()
    assert page.get_by_label("Studio link").input_value().startswith(f"{SITE}/entry.html?studio=")

    me = api.get("/v1/me", headers=client.headers).json()["data"]
    assert [m["role"] for m in me["memberships"]] == ["owner"]
    # A second studio is refused by the API.
    assert api.post("/v1/studios", json={"name": "Second"}, headers=client.headers).status_code == 409

    # Back on the projects page the card is gone.
    page.goto(f"{SITE}/projects.html")
    page.locator("#studio-link").wait_for(state="visible")
    assert not page.get_by_role("heading", name="Are you a designer? Open your studio").is_visible()


def test_open_studio_conflict_still_lands_on_studio_page(servers, page, api, make_user):
    client = make_user("e2e-race")
    _sign_in(page, client)
    page.wait_for_url("**/projects.html")
    page.get_by_role("heading", name="Are you a designer? Open your studio").wait_for()
    # The studio is created elsewhere after the page loaded.
    assert api.post("/v1/studios", json={"name": "Raced Studio"}, headers=client.headers).status_code == 201
    page.get_by_label("Studio name").fill("Raced Again")
    page.get_by_role("button", name="Open studio").click()
    page.wait_for_url("**/studio.html")
    page.get_by_role("heading", name="Raced Studio").wait_for()


def test_open_studio_requires_a_name(servers, page, make_user):
    client = make_user("e2e-noname")
    _sign_in(page, client)
    page.wait_for_url("**/projects.html")
    page.get_by_role("button", name="Open studio").click()
    page.wait_for_timeout(500)
    assert page.url.endswith("projects.html")


FORGOT_MESSAGE = "If an account exists for this email, a reset link is on its way. Check your inbox."


def test_forgot_password_message_is_the_same_for_known_and_unknown_emails(servers, page, make_user):
    known = make_user("e2e-forgot")
    # The built-in mailer is rate limited; the request itself is stubbed so it is never hammered.
    page.route("**/auth/v1/recover**", lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
    page.goto(f"{SITE}/auth.html")
    page.get_by_role("button", name="Forgot password?").click()
    page.get_by_role("heading", name="Reset your password").wait_for()
    assert not page.get_by_label("Password").is_visible()
    for email in (known.email, unique_email("e2e-unknown")):
        page.get_by_label("Email").fill(email)
        page.get_by_role("button", name="Send reset link").click()
        page.get_by_text(FORGOT_MESSAGE).wait_for()
        page.get_by_text(FORGOT_MESSAGE).wait_for(state="hidden", timeout=15000)
    page.get_by_role("button", name="Back to sign in").click()
    page.get_by_role("heading", name="Sign in").wait_for()
    assert page.get_by_label("Password").is_visible()


def _recovery_link(admin, email):
    return admin.auth.admin.generate_link(
        {"type": "recovery", "email": email, "options": {"redirect_to": f"{SITE}/auth.html?mode=reset"}}
    ).properties.action_link


def test_reset_password_with_a_recovery_link(servers, page, admin, make_user):
    from supabase import create_client

    from app.db import settings

    user = make_user("e2e-reset")
    page.goto(_recovery_link(admin, user.email))
    page.get_by_role("heading", name="Choose a new password").wait_for()
    assert not page.get_by_label("Email").is_visible()

    new_password = "e2e-New-Password-456"
    page.get_by_label("New password").fill(new_password)
    page.get_by_label("Confirm password").fill(new_password + "x")
    page.get_by_role("button", name="Update password").click()
    page.get_by_text("Passwords do not match").wait_for()
    assert "mode=reset" in page.url

    page.get_by_label("Confirm password").fill(new_password)
    page.get_by_role("button", name="Update password").click()
    page.wait_for_url("**/projects.html")

    fresh = create_client(settings().supabase_url, settings().supabase_publishable_key)
    with pytest.raises(Exception):
        fresh.auth.sign_in_with_password({"email": user.email, "password": user.password})
    assert fresh.auth.sign_in_with_password({"email": user.email, "password": new_password}).session


def test_reset_page_without_a_recovery_session_is_refused(servers, page):
    page.goto(f"{SITE}/auth.html?mode=reset")
    page.get_by_text("This link is invalid or expired. Request a new one.").wait_for()
    assert not page.locator("#auth-form").is_visible()
    page.get_by_role("button", name="Request a new link").click()
    page.get_by_role("heading", name="Reset your password").wait_for()


def test_reset_password_rejects_a_short_password(servers, page, admin, make_user):
    user = make_user("e2e-short")
    page.goto(_recovery_link(admin, user.email))
    page.get_by_role("heading", name="Choose a new password").wait_for()
    page.get_by_label("New password").fill("short")
    page.get_by_label("Confirm password").fill("short")
    page.get_by_role("button", name="Update password").click()
    page.wait_for_timeout(500)
    assert "mode=reset" in page.url
    assert page.get_by_label("New password").evaluate("el => el.validity.tooShort")
