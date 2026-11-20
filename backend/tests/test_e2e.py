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
from tests.fixtures import make_plans

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
LATIN_ALLOWED = {"ATELIER", "PDF", "ESC", "Ctrl", "Tab", "Enter", "Delete"}

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


def test_every_page_is_hebrew_rtl_with_no_leftover_english(servers, page, api, make_user, tmp_path):
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

    page.goto(f"{SITE}/import.html")
    page.locator("#project-name").wait_for()
    check("import(file step)")
    make_plans.both_scales(tmp_path / "both.pdf")
    page.set_input_files("#pdf-file", str(tmp_path / "both.pdf"))
    page.locator("#step-review").wait_for(state="visible", timeout=30000)
    check("import(review)")
    page.locator("#calibrate").click()
    check("import(calibration panel)")
    make_plans.not_a_pdf(tmp_path / "bad.pdf")
    page.set_input_files("#pdf-file", str(tmp_path / "bad.pdf"))
    page.locator("#file-error").wait_for(state="visible")
    check("import(error)")

    page.goto(f"{SITE}/wizard.html")
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


# ---------------------------------------------------------------- PDF import


def _import(page, path, name="Imported flat", wait=True):
    page.goto(f"{SITE}/import.html")
    page.locator("#project-name").fill(name)
    page.set_input_files("#pdf-file", str(path))
    if wait:
        page.locator("#step-review").wait_for(state="visible", timeout=30000)


def _screen(page, x, y):
    """Plan cm in the review viewer -> screen pixels."""
    return page.evaluate(
        """([x, y]) => { const c = document.querySelector('#import-canvas'); const p = new DOMPoint(x, y).matrixTransform(c.getScreenCTM()); return [p.x, p.y]; }""",
        [x, y],
    )


def _review_walls(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('#import-canvas .iw')].map(g => {
            const l = g.querySelector('.body'); const n = (a) => Number(l.getAttribute(a));
            return { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), t: n('stroke-width'), len: Number(g.dataset.length), on: g.getAttribute('aria-pressed') === 'true' } })"""
    )


def _assert_matches_truth(walls, tol=2.0):
    expected = make_plans.truth()
    assert len(walls) == len(expected), walls
    left = list(walls)
    for ex1, ey1, ex2, ey2, et in expected:
        for i, w in enumerate(left):
            got = (w["x1"], w["y1"], w["x2"], w["y2"])
            thick = abs(w["thickness"] - et) <= tol
            same = all(abs(a - b) <= tol for a, b in zip(got, (ex1, ey1, ex2, ey2)))
            flip = all(abs(a - b) <= tol for a, b in zip(got, (ex2, ey2, ex1, ey1)))
            if thick and (same or flip):
                left.pop(i)
                break
        else:
            raise AssertionError(f"wall {(ex1, ey1, ex2, ey2, et)} not found in {left}")


def _draft(page):
    return page.evaluate("JSON.parse(localStorage.getItem('od.draft'))")


def _to_editor(page):
    page.locator("#continue").click()
    page.wait_for_url("**/editor.html")
    page.locator("#canvas").wait_for()


def test_import_apartment_1_50_matches_ground_truth_and_shows_underlay(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "a.pdf"))
    assert page.locator("#import-canvas .iw").count() == 7
    assert "1:50" in page.locator("#scale-text").inner_text()
    _to_editor(page)
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    assert page.locator("#canvas [data-kind=walls]").count() == 7
    page.locator("#canvas image").wait_for(state="attached")
    draft = _draft(page)
    _assert_matches_truth(draft["plan"]["walls"])
    assert draft["underlay"]["key"].startswith("draft:") and draft["underlay"]["width"] > 1000
    # The background can be hidden and shown again; the control states that it stays in this browser.
    page.get_by_text("השרטוט נשמר בדפדפן הזה בלבד.").wait_for()
    page.locator("#underlay-toggle").click()
    assert page.locator("#canvas image").count() == 0
    page.locator("#underlay-toggle").click()
    assert page.locator("#canvas image").count() == 1


def test_import_toggling_a_wall_off_leaves_it_out_of_the_plan(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "a.pdf"))
    page.locator("#import-canvas .iw").first.focus()
    page.keyboard.press("Enter")  # keyboard toggle
    assert page.locator("#import-canvas .iw[aria-pressed=false]").count() == 1
    # Mouse toggle on the shortest wall, clicked at its middle.
    shortest = min(_review_walls(page), key=lambda w: w["len"])
    x, y = _screen(page, (shortest["x1"] + shortest["x2"]) / 2, (shortest["y1"] + shortest["y2"]) / 2)
    page.mouse.click(x, y)
    assert page.locator("#import-canvas .iw[aria-pressed=false]").count() == 2
    page.get_by_text("5 מתוך 7 קירות נבחרו").wait_for()
    _to_editor(page)
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    assert page.locator("#canvas [data-kind=walls]").count() == 5


def test_import_1_20_gives_the_same_walls_as_1_50(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "a20.pdf", ratio=20))
    assert "1:20" in page.locator("#scale-text").inner_text()
    assert page.locator("#import-canvas .iw").count() == 7
    _to_editor(page)
    _assert_matches_truth(_draft(page)["plan"]["walls"])


def test_import_parallel_line_walls(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "l.pdf", style="lines"))
    assert page.locator("#import-canvas .iw").count() == 7
    _to_editor(page)
    _assert_matches_truth(_draft(page)["plan"]["walls"])


def test_import_scale_candidates_can_be_switched(servers, page, tmp_path):
    _import(page, make_plans.both_scales(tmp_path / "both.pdf"))
    assert page.locator("input[name=scale-candidate]").count() == 2
    assert page.locator("input[name=scale-candidate][value='50']").is_checked()
    before = max(w["len"] for w in _review_walls(page))
    page.locator("input[name=scale-candidate][value='20']").check()
    page.wait_for_function("document.querySelector('#scale-text').textContent.includes('1:20')")
    after = max(w["len"] for w in _review_walls(page))
    assert abs(after / before - 0.4) < 0.03, (before, after)


def test_import_calibration_by_two_clicks_rescales(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "a.pdf"))
    longest = max(_review_walls(page), key=lambda w: w["len"])
    before = longest["len"]
    page.locator("#calibrate").click()
    page.mouse.click(*_screen(page, longest["x1"], longest["y1"]))
    page.mouse.click(*_screen(page, longest["x2"], longest["y2"]))
    page.get_by_text("המרחק שסימנתם כרגע").wait_for()
    # The real wall is declared twice as long: everything doubles.
    page.locator("#real-length").fill(str(round(before * 2 / 100, 2)).replace(".", ","))
    page.locator("#calibrate-apply").click()
    page.get_by_text("כויל ידנית").wait_for()
    after = max(w["len"] for w in _review_walls(page))
    assert abs(after / before - 2) < 0.03, (before, after)
    # A garbage length is refused with a Hebrew message.
    page.locator("#calibrate").click()
    box = page.locator("#import-canvas").bounding_box()
    page.mouse.click(box["x"] + 100, box["y"] + 100)
    page.mouse.click(box["x"] + 300, box["y"] + 100)
    page.locator("#real-length").fill("abc")
    page.locator("#calibrate-apply").click()
    page.locator("#calibrate-error").wait_for(state="visible")
    assert "אורך חיובי" in page.locator("#calibrate-error").inner_text()


def test_import_without_scale_text_requires_calibration(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "ns.pdf", scale_texts=[]))
    assert page.locator("#continue").is_disabled()
    page.get_by_text("קנה מידה משוער").first.wait_for()  # no ratio text: a suggestion the user must confirm or calibrate
    longest = max(_review_walls(page), key=lambda w: w["len"])
    page.locator("#calibrate").click()
    page.mouse.click(*_screen(page, longest["x1"], longest["y1"]))
    page.mouse.click(*_screen(page, longest["x2"], longest["y2"]))
    page.locator("#real-length").fill("800")
    page.locator("#real-unit").select_option("cm")
    page.locator("#calibrate-apply").click()
    page.wait_for_function("!document.querySelector('#continue').disabled")
    _to_editor(page)
    walls = _draft(page)["plan"]["walls"]
    assert len(walls) == 7
    assert max(((w["x2"] - w["x1"]) ** 2 + (w["y2"] - w["y1"]) ** 2) ** 0.5 for w in walls) == pytest.approx(800, rel=0.03)


def _plan_area(page):
    return page.evaluate(
        """() => { const r = document.querySelector('#import-canvas [data-area]'); const n = (a) => Number(r.getAttribute(a));
            return { x: n('x'), y: n('y'), w: n('width'), h: n('height') } }"""
    )


def _score_against_truth(walls, truth, tol=2.0):
    """(matched share of truth length, junk share of detected length) for centre-line walls."""
    def length(w):
        return ((w[2] - w[0]) ** 2 + (w[3] - w[1]) ** 2) ** 0.5

    detected = [(w["x1"], w["y1"], w["x2"], w["y2"], w["t"]) for w in walls]
    good = 0.0
    matched_det = set()
    for t in truth:
        for i, d in enumerate(detected):
            same = all(abs(a - b) <= tol for a, b in zip(d[:4], t[:4]))
            flip = all(abs(a - b) <= tol for a, b in zip(d[:4], (t[2], t[3], t[0], t[1])))
            if (same or flip) and abs(d[4] - t[4]) <= tol and i not in matched_det:
                matched_det.add(i)
                good += length(t)
                break
    total_truth = sum(length(t) for t in truth)
    total_det = sum(length(d) for d in detected)
    junk = sum(length(d) for i, d in enumerate(detected) if i not in matched_det)
    return good / total_truth, junk / total_det


def test_import_realistic_sheet_excludes_title_block_and_matches_truth(servers, page, tmp_path):
    _import(page, make_plans.realistic(tmp_path / "real.pdf"))
    # The automatic plan area leaves out the title block (right) and the legend table (bottom).
    area = _plan_area(page)
    ox, oy = make_plans.REAL_OX - 10, make_plans.REAL_OY - 10  # page cm of the plan origin
    tx, ty, _, _ = make_plans.REAL_TITLE_BLOCK
    _, ly, _, _ = make_plans.REAL_LEGEND
    assert area["x"] + area["w"] + ox <= tx, area
    assert area["y"] + area["h"] + oy <= ly, area
    walls = _review_walls(page)
    assert len(walls) == len(make_plans.REAL_WALLS), walls
    matched, junk = _score_against_truth(walls, make_plans.real_truth())
    assert matched >= 0.9 and junk <= 0.1, (matched, junk, walls)
    assert page.locator("#import-canvas .ow").count() == 0
    # No ratio text exists (the scale is drawn as outlines): a suggestion, confirmed by the user.
    scale = page.locator("#scale-text").inner_text()
    assert "קנה מידה משוער" in scale and "1:20" in scale, scale
    assert page.locator("#continue").is_disabled()
    assert "בדקו" in page.locator("#confidence").inner_text() or "טוב" in page.locator("#confidence").inner_text()
    page.locator("#scale-confirm").click()
    page.wait_for_function("!document.querySelector('#continue').disabled")
    _to_editor(page)
    _assert_matches_truth_real(_draft(page)["plan"]["walls"])


def _assert_matches_truth_real(walls):
    detected = [{"x1": w["x1"], "y1": w["y1"], "x2": w["x2"], "y2": w["y2"], "t": w["thickness"]} for w in walls]
    matched, junk = _score_against_truth(detected, make_plans.real_truth())
    assert matched >= 0.9 and junk <= 0.1, (matched, junk, walls)


def test_import_switched_off_wall_survives_recalibration(servers, page, tmp_path):
    _import(page, make_plans.realistic(tmp_path / "real.pdf"))
    page.locator("#scale-confirm").click()
    walls = _review_walls(page)
    victim = min(walls, key=lambda w: w["len"])
    page.mouse.click(*_screen(page, (victim["x1"] + victim["x2"]) / 2, (victim["y1"] + victim["y2"]) / 2))
    assert page.locator("#import-canvas .iw[aria-pressed=false]").count() == 1
    longest = max(walls, key=lambda w: w["len"])
    page.locator("#calibrate").click()
    page.mouse.click(*_screen(page, longest["x1"], longest["y1"]))
    page.mouse.click(*_screen(page, longest["x2"], longest["y2"]))
    page.locator("#real-length").fill(str(round(longest["len"] * 1.5)))
    page.locator("#real-unit").select_option("cm")
    page.locator("#calibrate-apply").click()
    page.get_by_text("כויל ידנית").wait_for()
    after = _review_walls(page)
    off = [w for w in after if not w["on"]]
    assert len(off) == 1 and len(after) == len(walls), off
    assert off[0]["len"] == pytest.approx(victim["len"] * 1.5, rel=0.05)


def test_import_dragging_the_plan_area_changes_the_included_walls(servers, page, tmp_path):
    _import(page, make_plans.realistic(tmp_path / "real.pdf"))
    page.locator("#scale-confirm").click()
    assert page.locator("#import-canvas .iw").count() == 8
    a = _plan_area(page)
    # Drag a rectangle around the left part only: the left wall and the short partition stay (middle point inside).
    page.locator("#area-draw").click()
    page.mouse.move(*_screen(page, a["x"], a["y"]))
    page.mouse.down()
    page.mouse.move(*_screen(page, 150, 200), steps=4)
    page.mouse.move(*_screen(page, 300, a["y"] + a["h"]), steps=4)
    page.mouse.up()
    page.wait_for_function("document.querySelectorAll('#import-canvas .iw').length === 2")
    assert page.locator("#import-canvas .ow").count() == 6  # the rest is shown dimmed, not selectable
    assert "ידנית" in page.locator("#area-hint").inner_text()
    _to_editor_walls = page.locator("#walls-count").inner_text()
    assert "2 מתוך 2" in _to_editor_walls
    # Numeric fallback (keyboard): widen it back over everything.
    page.locator("#area-card summary").click()
    for name, value in (("x0", -20), ("y0", -20), ("x1", 800), ("y1", 600)):
        page.locator(f"#area-{name}").fill(str(value))
    page.locator("#area-apply").click()
    page.wait_for_function("document.querySelectorAll('#import-canvas .iw').length === 8")
    # Reset goes back to the automatic guess.
    page.locator("#area-reset").click()
    page.wait_for_function("document.querySelector('#area-reset').disabled")
    assert page.locator("#import-canvas .iw").count() == 8


def test_import_image_only_pdf_explains_and_still_works_as_a_background(servers, page, tmp_path):
    _import(page, make_plans.image_only(tmp_path / "scan.pdf"))
    page.get_by_text("תמונה סרוקה").wait_for()
    assert page.locator("#import-canvas .iw").count() == 0
    assert page.locator("#continue").is_disabled()
    page.locator("#calibrate").click()
    box = page.locator("#import-canvas").bounding_box()
    page.mouse.click(box["x"] + 100, box["y"] + 200)
    page.mouse.click(box["x"] + 300, box["y"] + 200)
    page.locator("#real-length").fill("4")
    page.locator("#calibrate-apply").click()
    page.wait_for_function("!document.querySelector('#continue').disabled")
    _to_editor(page)
    page.locator("#canvas image").wait_for(state="attached")
    assert page.locator("#canvas [data-kind=walls]").count() == 0
    assert _draft(page)["plan"]["walls"] == []


def test_import_multi_page_pdf_lets_you_pick_page_two(servers, page, tmp_path):
    _import(page, make_plans.two_pages(tmp_path / "two.pdf"), wait=False)
    page.locator("#step-pages").wait_for(state="visible", timeout=30000)
    assert page.locator("#step-review").is_hidden()
    page.locator("#page-select").select_option("2")
    page.locator("#page-go").click()
    page.locator("#step-review").wait_for(state="visible", timeout=30000)
    assert page.locator("#import-canvas .iw").count() == 7


def test_import_bad_files_show_hebrew_errors(servers, page, tmp_path):
    for builder, message in (
        (make_plans.corrupt, "לא הצלחנו לקרוא את הקובץ"),
        (make_plans.not_a_pdf, "אינו קובץ PDF"),
        (make_plans.too_large, "גדול מדי"),
    ):
        _import(page, builder(tmp_path / f"{builder.__name__}.pdf"), wait=False)
        page.locator("#file-error").wait_for(state="visible", timeout=30000)
        assert message in page.locator("#file-error").inner_text()
        assert page.locator("#step-review").is_hidden()


def test_import_requires_a_project_name(servers, page, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "a.pdf"), name="")
    page.locator("#continue").click()
    page.get_by_text("תנו שם לפרויקט.").wait_for()
    assert "import.html" in page.url


def test_import_guest_saves_registers_and_background_survives_reload(servers, page, admin, tmp_path):
    _import(page, make_plans.apartment(tmp_path / "a.pdf"), name="Imported Flat")
    _to_editor(page)
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    page.locator("#save").click()
    page.get_by_role("heading", name="יצירת חשבון כדי לשמור את התוכנית").wait_for()
    page.get_by_role("link", name="יצירת חשבון").click()
    page.get_by_label("אימייל").fill(unique_email("e2e-import"))
    page.get_by_label("סיסמה").fill("e2e-Password-123")
    page.get_by_role("button", name="יצירת חשבון").click()
    page.get_by_label("הערת גרסה (לא חובה)").fill("imported")
    page.keyboard.press("Enter")
    page.wait_for_url("**/editor.html?project=*")
    page.get_by_text("נשמר · גרסה 1").wait_for()
    page.locator("#canvas image").wait_for(state="attached")
    assert page.locator("#canvas [data-kind=walls]").count() == 7
    project_id = page.url.split("project=")[1]

    page.reload()
    page.locator("#canvas [data-kind=walls]").first.wait_for(state="attached")
    page.locator("#canvas image").wait_for(state="attached")
    assert page.evaluate("localStorage.getItem('od.underlay.' + new URLSearchParams(location.search).get('project')) !== null")

    # The server only ever sees plain geometry: no underlay anywhere in what was saved.
    rows = admin.table("plan_versions").select("geometry").eq("project_id", project_id).execute().data
    assert len(rows) == 1
    geometry = rows[0]["geometry"]
    assert set(geometry) == {"schema", "units", "rooms", "walls", "openings", "furniture"}
    assert "underlay" not in str(rows).lower()
    assert len(geometry["walls"]) == 7


# ---------------------------------------------------------------- PDF import: furniture


def _review_furniture(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('#import-canvas .if')].map(g => ({
            id: g.dataset.furn, type: g.dataset.type, on: g.getAttribute('aria-pressed') === 'true' }))"""
    )


def _match_furnished(furniture, truth, tol=2.0):
    """Every ground-truth item has one drawn match of its type, position, size and rotation; returns what is left."""
    left = list(furniture)
    for kind, x, y, w, d, rot in truth:
        for i, f in enumerate(left):
            same = f["type"] == kind and abs(f["x"] - x) <= tol and abs(f["y"] - y) <= tol
            sized = abs(f["w"] - w) <= tol and abs(f["d"] - d) <= tol
            if same and sized and (abs(w - d) <= 4 or round(f["rotation"]) % 180 == rot):
                left.pop(i)
                break
        else:
            raise AssertionError(f"{(kind, x, y, w, d, rot)} not found in {left}")
    return left


def _import_furnished(page, tmp_path):
    _import(page, make_plans.furnished(tmp_path / "furnished.pdf"))
    page.wait_for_function("document.querySelectorAll('#import-canvas .if').length > 0")


def test_import_furnished_sheet_review_choose_type_and_continue(servers, page, tmp_path):
    truth = make_plans.furnished_truth()
    _import_furnished(page, tmp_path)
    assert page.locator("#import-canvas .iw").count() == 7
    assert page.locator("#furniture-count").inner_text() == f"ריהוט: {len(truth)} זוהו, 1 לא זוהו"
    items = _review_furniture(page)
    assert len(items) == len(truth) + 1 and all(i["on"] for i in items if i["type"])
    unknown = [i for i in items if not i["type"]]
    assert len(unknown) == 1 and not unknown[0]["on"]
    assert page.locator("#import-canvas .if[data-type='']").text_content() == "בחרו סוג"
    assert "מיטה זוגית" in page.locator("#furniture-kinds").inner_text()
    assert _english_words(page) == [], _english_words(page)

    sofa = page.locator("#import-canvas .if[data-type=sofa]")
    sofa.focus()
    page.keyboard.press("Enter")
    assert sofa.get_attribute("aria-pressed") == "false"
    fridge = page.locator("#import-canvas .if[data-type=fridge]")
    box = fridge.locator("rect").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    assert fridge.get_attribute("aria-pressed") == "false"
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    assert fridge.get_attribute("aria-pressed") == "true"
    odd = page.locator("#import-canvas .if[data-type='']")
    odd.focus()
    page.keyboard.press("Enter")  # nothing to switch on until a type is chosen
    assert odd.get_attribute("aria-pressed") == "false"

    page.locator(f"[data-furn-row='{unknown[0]['id']}'] select").select_option("armchair")
    armchair = page.locator("#import-canvas .if[data-type=armchair]")
    assert armchair.get_attribute("aria-pressed") == "true"
    assert armchair.text_content() == "כורסה"
    assert _english_words(page) == [], _english_words(page)

    shown = "(sel) => getComputedStyle(document.querySelector(sel)).display !== 'none'"
    page.get_by_label("רק קירות").check()
    assert not page.evaluate(shown, "#import-canvas .if") and page.evaluate(shown, "#import-canvas .iw")
    page.get_by_label("רק ריהוט").check()
    assert page.evaluate(shown, "#import-canvas .if") and not page.evaluate(shown, "#import-canvas .iw")
    page.get_by_label("הכל").check()
    assert page.evaluate(shown, "#import-canvas .if") and page.evaluate(shown, "#import-canvas .iw")

    _to_editor(page)
    page.locator("#canvas [data-kind=furniture]").first.wait_for(state="attached")
    furniture = _draft(page)["plan"]["furniture"]
    left = _match_furnished(furniture, [t for t in truth if t[0] != "sofa"])
    assert len(left) == 1 and left[0]["type"] == "armchair", left
    assert abs(max(left[0]["w"], left[0]["d"]) - 120) <= 3 and abs(min(left[0]["w"], left[0]["d"]) - 90) <= 3
    assert page.locator("#canvas [data-kind=furniture]").count() == len(furniture)
    assert len({f["id"] for f in furniture}) == len(furniture)
    assert all(set(f) == {"id", "type", "x", "y", "w", "d", "rotation"} for f in furniture)
    page.locator("#canvas image").wait_for(state="attached")


def test_import_unidentified_furniture_is_left_out_until_a_type_is_chosen(servers, page, tmp_path):
    truth = make_plans.furnished_truth()
    _import_furnished(page, tmp_path)
    assert [i["on"] for i in _review_furniture(page) if not i["type"]] == [False]
    _to_editor(page)
    page.locator("#canvas [data-kind=furniture]").first.wait_for(state="attached")
    furniture = _draft(page)["plan"]["furniture"]
    assert _match_furnished(furniture, truth) == []
    assert len(furniture) == len(truth)


def test_import_furniture_choices_survive_recalibration(servers, page, tmp_path):
    _import_furnished(page, tmp_path)
    page.locator("#import-canvas .if[data-type=sofa]").focus()
    page.keyboard.press("Enter")
    unknown = [i for i in _review_furniture(page) if not i["type"]][0]
    page.locator(f"[data-furn-row='{unknown['id']}'] select").select_option("desk")
    before = len(_review_furniture(page))
    longest = max(_review_walls(page), key=lambda w: w["len"])
    page.locator("#calibrate").click()
    page.evaluate("window.scrollTo(0, 0)")  # the type list scrolled the page: bring the drawing back under the pointer
    page.mouse.click(*_screen(page, longest["x1"], longest["y1"]))
    page.mouse.click(*_screen(page, longest["x2"], longest["y2"]))
    page.locator("#real-length").fill(str(round(longest["len"] * 1.05)))
    page.locator("#real-unit").select_option("cm")
    page.locator("#calibrate-apply").click()
    page.get_by_text("כויל ידנית").wait_for()
    after = _review_furniture(page)
    assert len(after) == before
    assert [i["on"] for i in after if i["type"] == "sofa"] == [False]
    assert len([i for i in after if i["type"] == "desk" and i["on"]]) == 2


def test_import_furnished_sheet_saves_with_furniture_as_guest_then_registered(servers, page, admin, tmp_path):
    truth = make_plans.furnished_truth()
    _import_furnished(page, tmp_path)
    _to_editor(page)
    page.locator("#canvas [data-kind=furniture]").first.wait_for(state="attached")
    page.locator("#save").click()
    page.get_by_role("heading", name="יצירת חשבון כדי לשמור את התוכנית").wait_for()
    page.get_by_role("link", name="יצירת חשבון").click()
    page.get_by_label("אימייל").fill(unique_email("e2e-furn"))
    page.get_by_label("סיסמה").fill("e2e-Password-123")
    page.get_by_role("button", name="יצירת חשבון").click()
    page.get_by_label("הערת גרסה (לא חובה)").fill("furnished")
    page.keyboard.press("Enter")
    page.wait_for_url("**/editor.html?project=*")
    page.get_by_text("נשמר · גרסה 1").wait_for()
    assert page.locator("#canvas [data-kind=furniture]").count() == len(truth)
    project_id = page.url.split("project=")[1]
    rows = admin.table("plan_versions").select("geometry").eq("project_id", project_id).execute().data
    assert len(rows) == 1
    geometry = rows[0]["geometry"]
    assert len(geometry["walls"]) == 7
    assert _match_furnished(geometry["furniture"], truth) == []
