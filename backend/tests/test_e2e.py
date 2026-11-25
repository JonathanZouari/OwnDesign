"""Browser test of the critical journey (PRD acceptance scenarios 1, 2 and 6):

a guest follows a studio link, builds a plan, is asked to register before it can be
saved, registers, and the saved geometry survives a reload and is visible to the designer.

Starts the backend and the static frontend itself unless they are already running.
"""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from playwright.sync_api import expect

from tests.conftest import needs_supabase, unique_email
from tests.fake_llm import ENGLISH_REPLY, HEBREW_REPLY

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


def _serve(port: int, command: list[str], cwd: Path, env: dict[str, str] | None = None):
    if _listening(port):
        return None
    process = subprocess.Popen(
        command, cwd=cwd, env={**os.environ, **(env or {})}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    deadline = time.monotonic() + 30
    while not _listening(port):
        if process.poll() is not None or time.monotonic() > deadline:
            process.kill()
            raise RuntimeError(f"Could not start server on port {port}")
        time.sleep(0.2)
    return process


@pytest.fixture(scope="module")
def servers():
    # The backend is tests/e2e_app.py: the real app with Groq replaced by a scripted fake.
    # The browser opens the site at SITE (127.0.0.1), which the default allowed origin (localhost) does not cover,
    # so the backend this fixture starts is told to accept it. An environment variable overrides backend/.env.
    origins = {"ALLOWED_ORIGINS": f"{SITE},http://localhost:5500"}
    started = [
        _serve(8000, [sys.executable, "-m", "uvicorn", "tests.e2e_app:app", "--host", "127.0.0.1", "--port", "8000"], BACKEND, origins),
        _serve(5500, [sys.executable, "-m", "http.server", "5500", "--bind", "127.0.0.1"], FRONTEND),
    ]
    yield {"scripted_backend": started[0] is not None}
    for process in started:
        if process:
            process.terminate()


@pytest.fixture
def advisor_servers(servers):
    """The advisor journeys need the scripted backend. A server that was already running on port 8000 would call real Groq."""
    if not servers["scripted_backend"]:
        pytest.skip("port 8000 is already served by another backend; stop it so the advisor journeys can use the scripted one")
    return servers


def metric(page, name: str) -> str:
    return page.locator(f"[data-metric={name}]").inner_text().strip()


def overflows(page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth > window.innerWidth")


def test_guest_builds_plan_registers_and_saves(servers, page, api, make_user):
    designer = make_user("e2e-designer")
    studio = api.post("/v1/studios", json={"name": "E2E Studio"}, headers=designer.headers).json()["data"]
    client_email = unique_email("e2e-client")
    walls = page.locator("#canvas [data-kind=walls]")
    furniture = page.locator("#canvas [data-kind=furniture]")

    # Guest arrives through the studio link and sees the studio's name.
    page.goto(f"{SITE}/entry.html?studio={studio['slug']}")
    page.get_by_role("heading", name="Plan your home with E2E Studio.").wait_for()
    assert page.locator("#entry-kind").inner_text() == "Studio link"
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
    # A new studio has nothing yet: every metric is zero and the directory shows its empty state.
    assert [metric(page, name) for name in ("projects", "clients", "pending-invites", "new-this-month")] == ["0"] * 4
    page.get_by_text("No projects yet").wait_for()

    # Personal invite: appears as pending, and its link resolves publicly to this studio.
    page.get_by_label("Client name").fill("Dana Client")
    page.get_by_label("Client email").fill("dana@example.com")
    page.get_by_role("button", name="Create invite link").click()
    page.get_by_role("cell", name="Pending").wait_for()
    assert metric(page, "pending-invites") == "1"

    # A client of this studio saves a plan (through the API, as the editor would).
    client = make_user("e2e-invited")
    studio = api.get(f"/v1/studios/by-slug/{slug}").json()["data"]
    project = api.post(
        "/v1/projects", json={"studio_id": studio["id"], "name": "Dana's flat", "property_type": "new_build"}, headers=client.headers
    ).json()["data"]
    assert api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers).status_code == 201

    # The designer finds it on the dashboard, opens it, revises it and saves a designer version.
    # A second project that was created but never saved has no plan to draw.
    unsaved = "Penthouse" + "W" * 50
    api.post("/v1/projects", json={"studio_id": studio["id"], "name": unsaved, "property_type": "existing"}, headers=client.headers)

    page.reload()
    card = page.get_by_role("article", name="Dana's flat")
    card.get_by_text(client.email).wait_for()
    card.scroll_into_view_if_needed()  # a plan preview is fetched when its card comes into view
    card.locator("svg.thumb").wait_for(state="attached")
    page.get_by_role("article", name=unsaved).locator(".thumb.empty").wait_for(state="attached")
    assert [metric(page, name) for name in ("projects", "clients", "new-this-month")] == ["2", "1", "2"]
    page.locator("#activity li").filter(has_text="Dana's flat").first.wait_for()

    # The search box narrows the directory in the browser.
    search = page.get_by_label("Search projects")
    search.fill("no such project")
    page.get_by_text("No projects match").wait_for()
    assert card.is_hidden()
    search.fill("dana")
    card.wait_for()
    assert page.get_by_role("article", name=unsaved).is_hidden()
    search.fill("")

    # A long unbroken project name must not push the page sideways on a phone.
    page.set_viewport_size({"width": 390, "height": 800})
    assert not overflows(page)
    page.set_viewport_size({"width": 1280, "height": 720})

    card.get_by_role("link", name="Launch 2D canvas").click()
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

    # The dashboard's activity feed records the designer's save.
    page.goto(f"{SITE}/studio.html")
    page.locator("#activity li").filter(has_text="designer").first.wait_for()


def test_client_portal_entry_points(servers, page, api, make_user):
    designer = make_user("e2e-portal")
    # Markup in a studio name is shown as text, and a long unbroken word must not widen the page.
    name = ("<i>Studio</i> " + "Supercalifragilistic" * 4)[:80]
    studio = api.post("/v1/studios", json={"name": name}, headers=designer.headers).json()["data"]
    invite = api.post(
        f"/v1/studios/{studio['id']}/invites",
        json={"client_name": "Noa Levi", "client_email": "noa@example.com"},
        headers=designer.headers,
    ).json()["data"]

    # A personal invite greets the client by name.
    page.goto(f"{SITE}/entry.html?invite={invite['token']}")
    page.get_by_role("heading", name=f"Hi Noa Levi, plan your home with {name}.").wait_for()
    assert page.locator("#entry-kind").inner_text() == "Personal invitation"
    assert page.locator("h1 i").count() == 0
    page.set_viewport_size({"width": 390, "height": 800})
    assert not overflows(page)
    page.set_viewport_size({"width": 1280, "height": 720})

    # Skipping the wizard opens the editor on an empty plan.
    page.get_by_role("button", name="Open a blank canvas").click()
    page.wait_for_url("**/editor.html")
    page.locator("#canvas").wait_for()
    assert page.locator("#canvas [data-kind=walls]").count() == 0

    # With a draft in the browser, a blank canvas asks before replacing it. Declining keeps the draft.
    page.goto(f"{SITE}/entry.html?invite={invite['token']}")
    page.get_by_text("You have an unsaved plan in this browser").wait_for()
    page.get_by_role("button", name="Open a blank canvas").click()  # Playwright dismisses the confirm by default
    page.wait_for_timeout(300)
    assert "entry.html" in page.url
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Open a blank canvas").click()
    page.wait_for_url("**/editor.html")

    # Unknown, malformed and missing links all end on the same message, never on an error.
    for query in ("?studio=no-such-studio-000000", "?invite=short", "?invite=" + "x" * 32, ""):
        page.goto(f"{SITE}/entry.html{query}")
        page.get_by_role("heading", name="This link is not valid").wait_for()
        assert page.get_by_role("link", name="Start designing").count() == 0


# --- AI advisor journeys: the backend answers with the scripted fake from tests/e2e_app.py ---

ENGLISH_TEXT = "".join(ENGLISH_REPLY)
HEBREW_TEXT = "".join(HEBREW_REPLY)
STREAM_WAIT_MS = 15_000


def sign_in(page, user, destination: str):
    page.goto(f"{SITE}/auth.html?next={quote(destination, safe='')}")
    page.get_by_label("Email").fill(user.email)
    page.get_by_label("Password").fill(user.password)
    page.get_by_role("button", name="Sign in").click()


def advisor_world(api, make_user):
    """A designer, a studio, and a client with a saved project."""
    from tests.test_geometry import VALID

    designer, client = make_user("e2e-adv-designer"), make_user("e2e-adv-client")
    studio = api.post("/v1/studios", json={"name": "Advisor Studio"}, headers=designer.headers).json()["data"]
    project = api.post(
        "/v1/projects", json={"studio_id": studio["id"], "name": "Advisor Flat", "property_type": "existing"}, headers=client.headers
    ).json()["data"]
    assert api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers).status_code == 201
    return SimpleNamespace(designer=designer, client=client, project=project)


def open_advisor(page, world):
    sign_in(page, world.client, f"advisor.html?project={world.project['id']}")
    page.get_by_role("heading", name="Advisor Flat").wait_for()


def ask(page, question: str):
    page.get_by_label("Your question").fill(question)
    page.get_by_role("button", name="Send").click()


def wait_until_answered(page):
    expect(page.get_by_label("Your question")).to_be_enabled(timeout=STREAM_WAIT_MS)


def direction(locator) -> str:
    return locator.evaluate("element => getComputedStyle(element).direction")


def test_client_reads_the_advisor_reply_as_it_is_written(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)

    # The editor offers the tab to the client, and the advisor page's styles do not reach the editor.
    sign_in(page, world.client, f"editor.html?project={world.project['id']}")
    tab = page.get_by_role("link", name="AI Consultant")
    tab.wait_for()
    assert not page.evaluate("document.body.classList.contains('advisor')")
    assert not page.evaluate("[...document.styleSheets].some(sheet => (sheet.href || '').endsWith('advisor.css'))")
    tab.click()
    page.wait_for_url("**/advisor.html?project=*")
    page.get_by_role("heading", name="Advisor Flat").wait_for()
    assert page.evaluate("document.body.classList.contains('advisor')")

    # The page says plainly that nothing is saved and that questions go to Groq (and no longer says OpenAI).
    privacy = page.locator(".privacy").inner_text()
    for phrase in (
        "Each question",
        "earlier messages in this conversation",
        "project's name, type, room names and room types",
        "sent to Groq",
        "does not save the conversation",
    ):
        assert phrase in privacy, phrase
    assert "OpenAI" not in page.content()
    assert "Conceptual guidance only" in page.locator(".notices").inner_text()

    box, send = page.get_by_label("Your question"), page.get_by_role("button", name="Send")
    assert send.is_disabled()  # nothing typed yet
    box.fill("What sofa suits the living room?")
    assert send.is_enabled()
    send.click()

    # Until the first piece arrives there is a typing indicator, and the input is locked while the reply is written.
    page.locator(".typing").wait_for()
    assert box.is_disabled() and send.is_disabled()
    reply = page.locator(".msg.advisor .text").last
    assert page.locator(".msg.advisor").last.get_attribute("aria-busy") == "true"

    # The reply grows: part of it is on screen while the rest is still being written.
    expect(reply).to_contain_text(ENGLISH_REPLY[0].strip())
    partway = reply.inner_text()
    assert partway != ENGLISH_TEXT and ENGLISH_TEXT.startswith(partway.rstrip())
    assert box.is_disabled() and page.locator(".typing").count() == 0

    wait_until_answered(page)
    assert reply.inner_text().strip() == ENGLISH_TEXT
    expect(page.locator("#status")).to_have_text("Reply complete.")
    assert page.locator(".msg.advisor").last.get_attribute("aria-busy") is None
    assert page.locator(".msg.user .text").last.inner_text() == "What sofa suits the living room?"
    assert direction(reply) == "ltr"


def test_hebrew_question_and_reply_are_laid_out_right_to_left(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    open_advisor(page, world)

    ask(page, "איזו ספה מתאימה לסלון של 18 מ״ר?")
    wait_until_answered(page)
    question, reply = page.locator(".msg.user .text").last, page.locator(".msg.advisor .text").last
    assert reply.inner_text().strip() == HEBREW_TEXT
    assert direction(question) == "rtl" and direction(reply) == "rtl"
    assert reply.evaluate("element => element.matches(':dir(rtl)')")

    # An English question on the same page stays left to right.
    ask(page, "And which rug?")
    wait_until_answered(page)
    assert direction(page.locator(".msg.advisor .text").last) == "ltr"
    assert direction(page.locator(".msg.user .text").last) == "ltr"
    # `reply` ends in .last and locators are re-evaluated, so the first reply is looked up again by position.
    assert direction(page.locator(".msg.advisor .text").first) == "rtl"  # the earlier Hebrew reply is unchanged
    assert not overflows(page)


def test_advisor_shows_a_failed_reply_and_retries_the_same_question(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    open_advisor(page, world)

    ask(page, "[flaky] Which lamp?")  # Groq fails after two pieces on the first attempt
    failed = page.locator(".msg.advisor.failed")
    failed.wait_for(timeout=STREAM_WAIT_MS)
    shown = failed.inner_text()
    assert "Reply interrupted" in shown and "could not finish this reply" in shown
    assert "A warm oak floor pairs well with" in shown  # what had arrived stays on screen
    expect(page.get_by_label("Your question")).to_be_enabled()  # the page is usable again

    page.get_by_role("button", name="Try again").click()
    expect(page.locator(".msg.advisor.failed")).to_have_count(0)
    wait_until_answered(page)
    assert page.locator(".msg.advisor .text").last.inner_text().strip() == ENGLISH_TEXT
    assert page.locator(".msg.user").count() == 1  # the question was not duplicated
    assert page.get_by_role("button", name="Try again").count() == 0

    # A question that always fails keeps failing visibly, and a new question replaces the old retry button.
    ask(page, "[error] Which rug?")
    page.locator(".msg.advisor.failed").wait_for(timeout=STREAM_WAIT_MS)
    ask(page, "Which curtains?")
    wait_until_answered(page)
    assert page.get_by_role("button", name="Try again").count() == 0


def test_advisor_says_it_is_busy_when_groq_rate_limits_and_works_again_on_retry(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    open_advisor(page, world)
    busy = "The advisor is busy right now. Please try again in a little while."

    # Rate limit before any text: the friendly message, not the generic failure, and a working retry.
    ask(page, "[busy] Which lamp?")
    failed = page.locator(".msg.advisor.failed")
    failed.wait_for(timeout=STREAM_WAIT_MS)
    assert busy in failed.inner_text() and "could not finish" not in failed.inner_text()
    assert "Reply interrupted" not in failed.inner_text()  # nothing had been written yet
    expect(page.get_by_label("Your question")).to_be_enabled()
    page.get_by_role("button", name="Try again").click()
    expect(page.locator(".msg.advisor.failed")).to_have_count(0)
    wait_until_answered(page)
    assert page.locator(".msg.advisor .text").last.inner_text().strip() == ENGLISH_TEXT
    assert page.locator(".msg.user").count() == 1

    # Rate limit after some text: the text stays, marked as interrupted, with the same message.
    ask(page, "[busy-late] Which rug?")
    failed = page.locator(".msg.advisor.failed")
    failed.wait_for(timeout=STREAM_WAIT_MS)
    shown = failed.inner_text()
    assert "Reply interrupted" in shown and busy in shown and "A warm oak floor pairs well with" in shown
    page.get_by_role("button", name="Try again").click()
    wait_until_answered(page)
    assert page.locator(".msg.advisor .text").last.inner_text().strip() == ENGLISH_TEXT


def test_hebrew_question_that_meets_the_rate_limit_keeps_its_direction_and_retries_in_hebrew(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    open_advisor(page, world)

    ask(page, "איזו ספה מתאימה לסלון? [busy]")
    page.locator(".msg.advisor.failed").wait_for(timeout=STREAM_WAIT_MS)
    assert "The advisor is busy right now" in page.locator(".msg.advisor.failed").inner_text()
    assert direction(page.locator(".msg.user .text").last) == "rtl"
    assert not overflows(page)

    page.get_by_role("button", name="Try again").click()
    wait_until_answered(page)
    reply = page.locator(".msg.advisor .text").last
    assert reply.inner_text().strip() == HEBREW_TEXT
    assert direction(reply) == "rtl"
    assert page.locator(".msg.user").count() == 1


def test_advisor_reports_a_connection_that_drops_mid_reply(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    open_advisor(page, world)
    cors = {"access-control-allow-origin": SITE, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST"}

    def cut_off(route):
        if route.request.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        # Some text, then the connection simply ends: no "done" and no "error" event.
        route.fulfill(status=200, headers={**cors, "content-type": "text/event-stream"}, body='event: delta\ndata: {"text":"Half an ans"}\n\n')

    page.route("**/v1/projects/*/advisor", cut_off)
    ask(page, "Hello")
    failed = page.locator(".msg.advisor.failed")
    failed.wait_for()
    shown = failed.inner_text()
    assert "Connection lost" in shown and "Reply interrupted" in shown and "Half an ans" in shown
    page.get_by_role("button", name="Try again").wait_for()
    expect(page.get_by_label("Your question")).to_be_enabled()

    # The server refusing the request before the stream shows its message.
    limit = '{"success":false,"data":null,"error":"You have reached today\'s limit of advisor questions. Please try again tomorrow."}'

    def refuse(route):
        if route.request.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        route.fulfill(status=429, headers={**cors, "content-type": "application/json"}, body=limit)

    page.unroute("**/v1/projects/*/advisor")
    page.route("**/v1/projects/*/advisor", refuse)
    ask(page, "Another one")
    page.locator("#thread").get_by_text("reached today's limit").wait_for()  # the live region repeats it for screen readers
    expect(page.get_by_label("Your question")).to_be_enabled()


def test_advisor_input_limits_and_keys(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    open_advisor(page, world)
    box, send, count = page.get_by_label("Your question"), page.get_by_role("button", name="Send"), page.locator("#count")

    box.fill("   \n  ")  # only spaces
    assert send.is_disabled() and count.inner_text() == "0 / 2000"

    box.fill("x" * 2001)
    assert count.inner_text() == "2001 / 2000" and "over" in (count.get_attribute("class") or "")
    assert send.is_disabled() and "too long" in page.locator("#hint").inner_text()
    box.press("Enter")  # Enter must not get past the limit either
    assert page.locator(".msg").count() == 0

    box.fill("x" * 2000)
    assert send.is_enabled() and count.inner_text() == "2000 / 2000"

    box.fill("🛋" * 2000)  # characters are counted like the server counts them, not as UTF-16 units
    assert send.is_enabled() and count.inner_text() == "2000 / 2000"

    box.fill("Line one")
    box.press("Shift+Enter")
    box.type("line two")
    assert "\n" in box.input_value() and page.locator(".msg").count() == 0
    box.press("Enter")  # Enter alone sends
    page.locator(".msg.user").wait_for()
    assert page.locator(".msg.user .text").inner_text() == "Line one\nline two"
    assert box.input_value() == "" and box.is_disabled()
    wait_until_answered(page)


def test_advisor_is_closed_to_the_designer_and_to_other_users(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    outsider = make_user("e2e-adv-outsider")
    project_page = f"advisor.html?project={world.project['id']}"

    # The studio's designer sees the project in the editor, but has no AI Consultant tab and no advisor page.
    sign_in(page, world.designer, f"editor.html?project={world.project['id']}")
    page.get_by_text("Editing as designer").wait_for()
    assert page.locator("#tab-advisor").is_hidden()
    page.goto(f"{SITE}/{project_page}")
    page.locator("#blocked").wait_for()
    assert "for the client who owns this project" in page.locator("#blocked").inner_text()
    assert page.locator("#chat").is_hidden()

    # Another user cannot even tell that the project exists.
    page.evaluate("localStorage.clear()")
    sign_in(page, outsider, project_page)
    page.locator("#blocked").wait_for()
    assert "not found" in page.locator("#blocked").inner_text()
    assert page.locator("#chat").is_hidden() and "Advisor Flat" not in page.content()

    # No project, and a malformed one, end on a message and not on a broken page.
    for query in ("", "?project=not-a-uuid"):
        page.goto(f"{SITE}/advisor.html{query}")
        page.locator("#blocked").wait_for()
        assert page.locator("#chat").is_hidden()


def test_advisor_fits_a_phone(advisor_servers, page, api, make_user):
    world = advisor_world(api, make_user)
    page.set_viewport_size({"width": 390, "height": 800})
    open_advisor(page, world)
    assert not overflows(page)

    ask(page, "ש" * 300)  # one very long unbroken Hebrew word
    wait_until_answered(page)
    assert not overflows(page)
    assert page.get_by_role("button", name="Send").is_visible()
    assert page.get_by_label("Your question").is_visible()
