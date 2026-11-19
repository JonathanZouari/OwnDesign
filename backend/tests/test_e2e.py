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
    page.get_by_role("heading", name="תכננו את הבית שלכם עם E2E Studio.").wait_for()
    page.get_by_role("link", name="התחילו לעצב").click()

    # Wizard: two default rooms -> eight walls on the canvas.
    page.get_by_label("שם הפרויקט").fill("E2E Flat")
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
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
    page.get_by_role("heading", name="יצירת חשבון כדי לשמור את התוכנית").wait_for()
    page.get_by_role("link", name="יצירת חשבון").click()
    page.get_by_label("אימייל").fill(client_email)
    page.get_by_label("סיסמה").fill("e2e-Password-123")
    page.get_by_role("button", name="יצירת חשבון").click()

    # Back in the editor with the draft intact; the save dialog opens by itself.
    page.get_by_label("הערת גרסה (לא חובה)").fill("first draft")
    page.keyboard.press("Enter")  # Enter in the note field saves (it must not act as Cancel)
    page.wait_for_url("**/editor.html?project=*")
    walls.first.wait_for(state="attached")
    page.get_by_text("נשמר · גרסה 1").wait_for()
    assert (walls.count(), furniture.count()) == (8, 2)

    # Scenario 2: move the sofa, save again, reload -> geometry and history are preserved.
    furniture.first.focus()
    page.keyboard.press("ArrowRight")
    page.get_by_text("שינויים שלא נשמרו").wait_for()
    page.locator("#save").click()
    page.get_by_role("button", name="שמירת גרסה").click()
    page.get_by_text("נשמר · גרסה 2").wait_for()
    # Dismissing the dialog with Escape must not save again.
    page.keyboard.press("Control+s")
    page.get_by_role("heading", name="שמירת גרסה חדשה").wait_for()
    page.keyboard.press("Escape")
    page.get_by_role("heading", name="שמירת גרסה חדשה").wait_for(state="hidden")
    # Selecting something without moving it is not a change.
    furniture.first.focus()
    page.wait_for_timeout(500)
    assert page.locator("#status-save").inner_text() == "נשמר · גרסה 2"
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
    page.get_by_label("שם הסטודיו").fill("Atelier E2E")
    page.get_by_label("אימייל").fill(unique_email("e2e-owner"))
    page.get_by_label("סיסמה").fill("e2e-Password-123")
    page.get_by_role("button", name="יצירת חשבון").click()
    page.wait_for_url("**/studio.html")
    page.get_by_role("heading", name="Atelier E2E").wait_for()
    studio_url = page.get_by_label("קישור הסטודיו").input_value()
    slug = studio_url.split("studio=")[1]
    assert studio_url.startswith(f"{SITE}/entry.html?studio=atelier-e2e-")

    # Personal invite: appears as pending, and its link resolves publicly to this studio.
    page.get_by_label("שם הלקוח").fill("Dana Client")
    page.get_by_label("אימייל הלקוח").fill("dana@example.com")
    page.get_by_role("button", name="יצירת קישור הזמנה").click()
    page.get_by_role("cell", name="ממתין").wait_for()

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
    row.get_by_role("link", name="פתיחה").click()
    page.get_by_text("עריכה כמעצב").wait_for()
    page.locator("#canvas [data-kind=furniture]").first.focus()
    page.keyboard.press("r")
    page.locator("#save").click()
    page.get_by_label("הערת גרסה (לא חובה)").fill("rotated the sofa")
    page.get_by_role("button", name="שמירת גרסה").click()
    page.get_by_text("נשמר · גרסה 2").wait_for()
    page.get_by_text("גרסה 2 · מעצב").wait_for()

    # The client sees the designer's revision, labelled as such, and the original is untouched.
    versions = api.get(f"/v1/projects/{project['id']}/versions", headers=client.headers).json()["data"]
    assert [(v["version_no"], v["author_role"]) for v in versions] == [(2, "designer"), (1, "client")]
    latest = api.get(f"/v1/projects/{project['id']}/versions/latest", headers=client.headers).json()["data"]["geometry"]
    assert latest["furniture"][0]["rotation"] == 90


def _sign_in(page, user):
    page.goto(f"{SITE}/auth.html")
    page.get_by_label("אימייל").fill(user.email)
    page.get_by_label("סיסמה").fill(user.password)
    page.get_by_role("button", name="התחברות").click()


def _place_sofa(page):
    box = page.locator("#canvas").bounding_box()
    page.keyboard.press("f")
    page.locator("#catalog button[data-type=sofa]").click()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def test_homeowner_designs_without_a_studio_and_saves(servers, page):
    walls = page.locator("#canvas [data-kind=walls]")
    furniture = page.locator("#canvas [data-kind=furniture]")
    page.goto(f"{SITE}/index.html")
    assert page.get_by_text("מעצב פנים").count() == 0
    page.get_by_role("link", name="התחילו לעצב").click()
    page.wait_for_url("**/wizard.html")
    page.get_by_label("שם הפרויקט").fill("Home Flat")
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
    page.wait_for_url("**/editor.html")
    walls.first.wait_for(state="attached")
    _place_sofa(page)
    assert furniture.count() == 1

    page.locator("#save").click()
    page.get_by_role("heading", name="יצירת חשבון כדי לשמור את התוכנית").wait_for()
    page.get_by_role("link", name="יצירת חשבון").click()
    page.get_by_label("אימייל").fill(unique_email("e2e-home"))
    page.get_by_label("סיסמה").fill("e2e-Password-123")
    page.get_by_role("button", name="יצירת חשבון").click()
    page.get_by_label("הערת גרסה (לא חובה)").fill("first")
    page.keyboard.press("Enter")
    page.wait_for_url("**/editor.html?project=*")
    page.get_by_text("נשמר · גרסה 1").wait_for()
    project_id = page.url.split("project=")[1]

    page.goto(f"{SITE}/projects.html")
    row = page.get_by_role("row", name="Home Flat")
    row.wait_for()
    assert page.locator("#studio-link").count() == 0 and page.get_by_text("הסטודיו שלי").count() == 0
    row.get_by_role("link", name="פתיחה").click()
    page.wait_for_url(f"**/editor.html?project={project_id}")
    page.get_by_text("עריכה כלקוח").wait_for()
    page.goto(f"{SITE}/projects.html")
    page.get_by_role("row", name="Home Flat").wait_for()  # the page's script has run and bound the button
    page.locator("#new-project").click()
    page.wait_for_url("**/wizard.html")


def test_wizard_draft_in_the_old_format_with_a_studio_still_saves(servers, page, api, make_user):
    designer = make_user("e2e-olddraft-designer")
    studio = api.post("/v1/studios", json={"name": "Old Draft Studio"}, headers=designer.headers).json()["data"]
    user = make_user("e2e-olddraft")
    _sign_in(page, user)
    page.wait_for_url("**/projects.html")
    page.goto(f"{SITE}/wizard.html")
    page.get_by_label("שם הפרויקט").fill("Old Draft Flat")
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
    page.wait_for_url("**/editor.html")
    # Rewrite the draft the way the previous version stored it: with the studio inside.
    page.evaluate(
        "s => { const d = JSON.parse(localStorage.getItem('od.draft')); d.studio = s; localStorage.setItem('od.draft', JSON.stringify(d)); }",
        {"id": studio["id"], "name": studio["name"], "slug": studio["slug"]},
    )
    page.goto(f"{SITE}/editor.html")
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    page.locator("#save").click()
    page.get_by_role("button", name="שמירת גרסה").click()
    page.get_by_text("נשמר · גרסה 1").wait_for()
    project_id = page.url.split("project=")[1]
    assert api.get(f"/v1/projects/{project_id}", headers=user.headers).json()["data"]["studio"]["name"] == "Old Draft Studio"


def test_studio_remembered_from_an_old_link_is_not_attached_to_a_new_project(servers, page, api, make_user):
    designer = make_user("e2e-stale-designer")
    studio = api.post("/v1/studios", json={"name": "Stale Link Studio"}, headers=designer.headers).json()["data"]
    user = make_user("e2e-stale")
    # This browser once opened the studio's link, which remembered the studio.
    page.goto(f"{SITE}/entry.html?studio={studio['slug']}")
    page.get_by_role("link", name="התחילו לעצב").wait_for()
    # Later the homeowner starts from the home page: the remembered studio must not be used.
    page.goto(f"{SITE}/index.html")
    page.get_by_role("link", name="התחילו לעצב").click()
    page.get_by_label("שם הפרויקט").fill("My Own Flat")
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
    page.wait_for_url("**/editor.html")
    assert page.evaluate("JSON.parse(localStorage.getItem('od.draft')).studio") is None
    _sign_in(page, user)
    page.wait_for_url("**/editor.html")  # signing in with a draft returns to it
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    page.locator("#save").click()
    page.get_by_role("button", name="שמירת גרסה").click()
    page.get_by_text("נשמר · גרסה 1").wait_for()
    project_id = page.url.split("project=")[1]
    assert api.get(f"/v1/projects/{project_id}", headers=user.headers).json()["data"]["studio"] is None
    # The designer of that studio cannot see the homeowner's project.
    assert api.get(f"/v1/projects/{project_id}", headers=designer.headers).status_code == 404


FORGOT_MESSAGE = "אם קיים חשבון עבור האימייל הזה, קישור לאיפוס סיסמה בדרך אליכם. בדקו את תיבת הדואר."


def test_forgot_password_message_is_the_same_for_known_and_unknown_emails(servers, page, make_user):
    known = make_user("e2e-forgot")
    # The built-in mailer is rate limited; the request itself is stubbed so it is never hammered.
    page.route("**/auth/v1/recover**", lambda route: route.fulfill(status=200, content_type="application/json", body="{}"))
    page.goto(f"{SITE}/auth.html")
    page.get_by_role("button", name="שכחתי סיסמה").click()
    page.get_by_role("heading", name="איפוס סיסמה").wait_for()
    assert not page.get_by_label("סיסמה").is_visible()
    for email in (known.email, unique_email("e2e-unknown")):
        page.get_by_label("אימייל").fill(email)
        page.get_by_role("button", name="שליחת קישור לאיפוס").click()
        page.get_by_text(FORGOT_MESSAGE).wait_for()
        page.get_by_text(FORGOT_MESSAGE).wait_for(state="hidden", timeout=15000)
    page.get_by_role("button", name="חזרה להתחברות").click()
    page.get_by_role("heading", name="התחברות").wait_for()
    assert page.get_by_label("סיסמה").is_visible()


def _recovery_link(admin, email):
    return admin.auth.admin.generate_link(
        {"type": "recovery", "email": email, "options": {"redirect_to": f"{SITE}/auth.html?mode=reset"}}
    ).properties.action_link


def test_reset_password_with_a_recovery_link(servers, page, admin, make_user):
    from supabase import create_client

    from app.db import settings

    user = make_user("e2e-reset")
    page.goto(_recovery_link(admin, user.email))
    page.get_by_role("heading", name="בחירת סיסמה חדשה").wait_for()
    assert not page.get_by_label("אימייל").is_visible()

    new_password = "e2e-New-Password-456"
    page.get_by_label("סיסמה חדשה").fill(new_password)
    page.get_by_label("אישור סיסמה").fill(new_password + "x")
    page.get_by_role("button", name="עדכון סיסמה").click()
    page.get_by_text("הסיסמאות אינן תואמות").wait_for()
    assert "mode=reset" in page.url

    page.get_by_label("אישור סיסמה").fill(new_password)
    page.get_by_role("button", name="עדכון סיסמה").click()
    page.wait_for_url("**/projects.html")

    fresh = create_client(settings().supabase_url, settings().supabase_publishable_key)
    with pytest.raises(Exception):
        fresh.auth.sign_in_with_password({"email": user.email, "password": user.password})
    assert fresh.auth.sign_in_with_password({"email": user.email, "password": new_password}).session


def test_reset_page_without_a_recovery_session_is_refused(servers, page):
    page.goto(f"{SITE}/auth.html?mode=reset")
    page.get_by_text("הקישור אינו תקף או שפג תוקפו. בקשו קישור חדש.").wait_for()
    assert not page.locator("#auth-form").is_visible()
    page.get_by_role("button", name="בקשת קישור חדש").click()
    page.get_by_role("heading", name="איפוס סיסמה").wait_for()


def test_reset_password_rejects_a_short_password(servers, page, admin, make_user):
    user = make_user("e2e-short")
    page.goto(_recovery_link(admin, user.email))
    page.get_by_role("heading", name="בחירת סיסמה חדשה").wait_for()
    page.get_by_label("סיסמה חדשה").fill("short")
    page.get_by_label("אישור סיסמה").fill("short")
    page.get_by_role("button", name="עדכון סיסמה").click()
    page.wait_for_timeout(500)
    assert "mode=reset" in page.url
    assert page.get_by_label("סיסמה חדשה").evaluate("el => el.validity.tooShort")


# ---- Hebrew / right-to-left UI ----

# Product and keyboard-key names that stay in Latin letters on purpose.
LATIN_ALLOWED = {"ATELIER", "ESC", "Ctrl", "Tab", "Enter", "Delete"}

LATIN_WORDS_JS = r"""
() => {
  const out = [];
  const skip = (el) => !el || el.closest('.icon, script, style, [hidden]') || !el.checkVisibility();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!skip(node.parentElement)) out.push(node.nodeValue);
  }
  for (const el of document.querySelectorAll('[placeholder], [aria-label], [title]')) {
    if (el.closest('[hidden]')) continue;
    for (const attr of ['placeholder', 'aria-label', 'title']) if (el.hasAttribute(attr)) out.push(el.getAttribute(attr));
  }
  return out.join('\n');
}
"""


def _english_words(page):
    import re

    text = page.evaluate(LATIN_WORDS_JS)
    text = re.sub(r"\S+@\S+", " ", text)  # email addresses
    return sorted({w for w in re.findall(r"[A-Za-z]{3,}", text) if w not in LATIN_ALLOWED})


def _is_hebrew_rtl(page):
    return page.evaluate("document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl'")


def test_every_page_is_hebrew_rtl_with_no_leftover_english(servers, page, api, make_user):
    problems = {}

    def check(name):
        if not _is_hebrew_rtl(page):
            problems[f"{name}:direction"] = ["html is not lang=he dir=rtl"]
        words = _english_words(page)
        if words:
            problems[name] = words

    page.goto(f"{SITE}/index.html")
    page.get_by_role("link", name="התחילו לעצב").wait_for()
    check("index")

    for mode in ("", "?mode=forgot", "?mode=signup", "?mode=signup&role=studio"):
        page.goto(f"{SITE}/auth.html{mode}")
        page.locator("#title").wait_for()
        page.wait_for_timeout(200)
        check(f"auth{mode}")

    page.goto(f"{SITE}/wizard.html")
    page.get_by_label("שם הפרויקט").wait_for()
    check("wizard")

    page.get_by_label("שם הפרויקט").fill("דירה לבדיקה")
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
    page.wait_for_url("**/editor.html")
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    _place_sofa(page)  # puts the furniture inspector, catalog button state and selection actions on screen
    check("editor(draft)")
    page.keyboard.press("f")
    page.locator("#catalog button[data-type=sofa]").wait_for()
    check("editor(draft, catalog open)")
    page.keyboard.press("Escape")
    assert page.locator("#canvas").evaluate("el => getComputedStyle(el).direction") == "ltr"

    user = make_user("e2e-he-scan")
    project = api.post("/v1/projects", json={"name": "פרויקט לבדיקה", "property_type": "existing"}, headers=user.headers).json()["data"]
    _sign_in(page, user)
    page.wait_for_url("**/editor.html")  # a draft is in this browser, so sign-in returns to it
    page.goto(f"{SITE}/projects.html")
    page.get_by_role("row", name="פרויקט לבדיקה").wait_for()
    check("projects")
    page.goto(f"{SITE}/editor.html?project={project['id']}")
    page.get_by_text("עריכה כלקוח").wait_for()
    check("editor(saved project)")

    assert not problems, f"Leftover English or non-RTL pages: {problems}"


def test_canvas_and_rulers_stay_left_to_right_in_an_rtl_page(servers, page):
    page.goto(f"{SITE}/wizard.html")
    page.get_by_label("שם הפרויקט").fill("דירה")
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
    page.wait_for_url("**/editor.html")
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    assert page.evaluate("getComputedStyle(document.documentElement).direction") == "rtl"
    assert page.locator("#canvas").evaluate("el => getComputedStyle(el).direction") == "ltr"
    ruler = page.locator("#canvas .ruler-text").first
    assert ruler.evaluate("el => getComputedStyle(el).direction") == "ltr"
    assert "מ׳" in ruler.text_content()
    # Hebrew room names are drawn inside the plan and fit inside their hit area (not clipped to nothing).
    names = page.locator("#canvas .room-name")
    assert names.count() == 2 and names.first.text_content() == "סלון"
    assert names.first.bounding_box()["width"] > 20


def test_api_error_is_shown_in_hebrew_not_the_servers_english(servers, page, make_user):
    import uuid

    user = make_user("e2e-he-error")
    _sign_in(page, user)
    page.wait_for_url("**/projects.html")
    page.goto(f"{SITE}/editor.html?project={uuid.uuid4()}")
    toast = page.locator(".toast.error")
    toast.wait_for()
    assert toast.inner_text() == "הפריט המבוקש לא נמצא."
    page.route("**/v1/projects", lambda route: route.fulfill(status=500, content_type="application/json", body='{"success": false, "error": "Boom internal"}'))
    page.goto(f"{SITE}/projects.html")
    page.locator(".toast.error").wait_for()
    shown = page.locator(".toast.error").inner_text()
    assert "Boom" not in shown and "internal" not in shown
    assert "אירעה תקלה" in shown


def test_wrong_password_shows_a_hebrew_message(servers, page, make_user):
    user = make_user("e2e-he-wrongpw")
    page.goto(f"{SITE}/auth.html")
    page.get_by_label("אימייל").fill(user.email)
    page.get_by_label("סיסמה").fill("definitely-Wrong-1")
    page.get_by_role("button", name="התחברות").click()
    toast = page.locator(".toast.error")
    toast.wait_for()
    assert toast.inner_text() == "האימייל או הסיסמה שגויים."


def test_long_mixed_hebrew_project_name_saves_and_is_listed(servers, page, make_user):
    name = "דירת גן מרווחת ברחוב Herzl 12 קומה 3 - Penthouse 4B עם נוף לים"
    assert len(name) <= 80
    user = make_user("e2e-he-name")
    _sign_in(page, user)
    page.wait_for_url("**/projects.html")
    page.goto(f"{SITE}/wizard.html")
    page.get_by_label("שם הפרויקט").fill(name)
    page.get_by_role("button", name="יצירת קנבס דו־ממדי").click()
    page.wait_for_url("**/editor.html")
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    page.locator("#save").click()
    page.get_by_role("button", name="שמירת גרסה").click()
    page.wait_for_url("**/editor.html?project=*")
    page.get_by_text("נשמר · גרסה 1").wait_for()
    assert page.locator("#crumb-name").inner_text() == name
    page.goto(f"{SITE}/projects.html")
    page.get_by_role("row", name=name).wait_for()
    assert page.locator("#projects td").first.inner_text() == name
