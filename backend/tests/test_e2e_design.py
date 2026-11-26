"""Browser tests of the Phase 2 pages: design brief, styles & materials, moodboard and the consultant.

A client fills the brief, picks materials and builds a moodboard; everything survives a reload and is
visible to the studio's designer. Bad input is refused in the browser, markup stays text, and a stranger
sees nothing. No chat message is ever sent to the model: the POST is blocked in the browser.

Starts the backend and the static frontend itself unless they are already running.
"""

import re
import sys
import time
from types import SimpleNamespace
from urllib.parse import quote

import pytest

from tests.conftest import needs_supabase
from tests.test_design import PNG
from tests.test_e2e import BACKEND, FRONTEND, SITE, _listening, _serve, overflows
from tests.test_geometry import VALID

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]

@pytest.fixture(scope="module")
def servers():
    """Same servers as test_e2e.py. When both files run in one session the other module's servers may
    still be shutting down as this one starts (and the reverse), so wait for ports to settle both ways."""
    if _listening(8000) or _listening(5500):
        time.sleep(1)  # a server that was just terminated is gone after this; one left running stays
    started = [
        _serve(8000, [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], BACKEND),
        _serve(5500, [sys.executable, "-m", "http.server", "5500", "--bind", "127.0.0.1"], FRONTEND),
    ]
    yield
    for process in started:
        if process:
            process.terminate()
            process.wait(timeout=10)


MARKUP ='<img src=x onerror="window.__xss=1"><script>window.__xss=1</script><b>bold</b>'


@pytest.fixture(scope="module")
def studio(api, make_user):
    designer = make_user("e2e-d2-designer")
    data = api.post("/v1/studios", json={"name": "Design E2E Studio"}, headers=designer.headers).json()["data"]
    return SimpleNamespace(designer=designer, id=data["id"])


@pytest.fixture
def world(api, make_user, studio):
    """A client of the studio with one project that has a saved plan (one room: Living room)."""
    client = make_user("e2e-d2-client")
    project = api.post(
        "/v1/projects", json={"studio_id": studio.id, "name": "Design Flat", "property_type": "existing"}, headers=client.headers
    ).json()["data"]
    assert api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers).status_code == 201
    return SimpleNamespace(designer=studio.designer, client=client, pid=project["id"], base=f"/v1/projects/{project['id']}")


def sign_in(page, user, target: str):
    """Signs in through the form and lands on `target` (a page of the site, with its query)."""
    page.goto(f"{SITE}/auth.html?next={quote(target, safe='')}")
    page.get_by_label("אימייל").fill(user.email)
    page.get_by_label("סיסמה", exact=True).fill(user.password)
    page.get_by_role("button", name="התחברות").click()
    page.wait_for_url(lambda url: url.split("#")[0] == f"{SITE}/{target}")


def open_design(page, user, pid: str):
    sign_in(page, user, f"design.html?project={pid}")
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()


def open_tab(page, name: str):
    page.get_by_role("tab", name=name, exact=True).click()


def pressed_styles(page) -> list[str]:
    return page.locator("#brief-styles button[aria-pressed=true]").evaluate_all("nodes => nodes.map(n => n.dataset.style)")


def board_titles(page) -> list[str]:
    return page.locator("#board > li strong").all_inner_texts()


def choose(page, surface: str, material: str):
    room = page.get_by_role("region", name="חומרים עבור Living room")
    room.get_by_role("group", name=surface, exact=True).get_by_text(material, exact=True).click()


def chosen(page, surface: str) -> str:
    room = page.get_by_role("region", name="חומרים עבור Living room")
    return room.get_by_role("group", name=surface, exact=True).locator("label:has(input:checked)").inner_text().strip()


def image(name="tiny.png", mime="image/png", data=PNG) -> dict:
    return {"name": name, "mimeType": mime, "buffer": data}


def no_script_ran(page) -> bool:
    return page.evaluate("window.__xss === undefined") and page.locator("#design img[src='x'], #design b, #design script").count() == 0


def test_client_fills_brief_materials_and_moodboard(servers, page, api, world):
    open_design(page, world.client, world.pid)
    assert page.locator("#studio-brand").inner_text() == "Design E2E Studio"
    assert page.get_by_role("tab", name="בריף", exact=True).get_attribute("aria-selected") == "true"

    # Brief: an empty brief starts with nothing chosen.
    assert page.locator("#style-count").inner_text() == "0 / 5"
    for style in ("japandi", "modern"):
        page.locator(f"#brief-styles button[data-style={style}]").click()
    page.get_by_role("button", name="הוספת צבע").click()
    page.get_by_label("מינימום").fill("20000")
    page.get_by_label("מקסימום").fill("45000")
    page.get_by_label("מטבע").select_option("ILS")
    page.get_by_label("מבוגרים").fill("2")
    page.get_by_label("ילדים").fill("3")
    page.get_by_label("יש חיות מחמד בבית").check()
    page.get_by_label("אורח חיים", exact=True).fill("We cook a lot\nand host on weekends.")
    page.get_by_label("צרכים", exact=True).fill("A desk for two")
    page.get_by_role("button", name="שמירת הבריף").click()
    page.get_by_text("הבריף נשמר.").wait_for()

    page.reload()
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()
    assert pressed_styles(page) == ["modern", "japandi"]  # shown in catalog order
    assert page.locator("#style-count").inner_text() == "2 / 5"
    assert page.locator("#brief-colors li").all_inner_texts()[0].startswith("#bf542c")
    assert (page.get_by_label("מינימום").input_value(), page.get_by_label("מקסימום").input_value()) == ("20000", "45000")
    assert page.get_by_label("מטבע").input_value() == "ILS"
    assert (page.get_by_label("מבוגרים").input_value(), page.get_by_label("ילדים").input_value()) == ("2", "3")
    assert page.get_by_label("יש חיות מחמד בבית").is_checked()
    assert page.get_by_label("אורח חיים", exact=True).input_value() == "We cook a lot\nand host on weekends."
    assert page.get_by_label("צרכים", exact=True).input_value() == "A desk for two"

    # Styles & materials: one material per surface of the room in the saved plan.
    open_tab(page, "סגנונות וחומרים")
    assert (chosen(page, "רצפה"), chosen(page, "קירות")) == ("לא נבחר", "לא נבחר")
    # Only materials that suit a surface are offered: paint is not a floor.
    floor = page.get_by_role("region", name="חומרים עבור Living room").get_by_role("group", name="רצפה", exact=True)
    assert floor.get_by_text("צבע ירוק מרווה").count() == 0
    choose(page, "רצפה", "אלון טבעי")
    choose(page, "קירות", "צבע ירוק מרווה")
    page.get_by_text("יש שינויים שלא נשמרו.").wait_for()
    page.get_by_role("button", name="שמירת החומרים").click()
    page.get_by_text("החומרים נשמרו.").wait_for()

    page.reload()  # the open tab is kept in the address
    page.get_by_role("region", name="חומרים עבור Living room").wait_for()
    assert (chosen(page, "רצפה"), chosen(page, "קירות"), chosen(page, "תקרה")) == ("אלון טבעי", "צבע ירוק מרווה", "לא נבחר")

    # Moodboard: upload an image, add it with a style and a material, annotate, reorder.
    open_tab(page, "לוח השראה")
    page.get_by_text("הלוח ריק.").wait_for()
    page.get_by_text("עדיין לא הועלו תמונות.").wait_for()
    page.get_by_label("תמונה (JPEG, PNG או WebP, עד 5 מ״ב)").set_input_files(image())
    page.get_by_label("כיתוב (לא חובה)").fill("Oak hallway")
    page.get_by_role("button", name="העלאת תמונה").click()
    page.get_by_text("התמונה הועלתה.").wait_for()
    assert page.locator("#asset-count").inner_text() == "1"
    page.get_by_role("img", name="Oak hallway").wait_for()

    page.get_by_role("button", name="הוספת התמונה Oak hallway ללוח").click()
    page.get_by_role("button", name="הוספת ג׳פנדי ללוח").click()
    page.get_by_role("button", name="הוספת אלון טבעי ללוח").click()
    assert board_titles(page) == ["Oak hallway", "ג׳פנדי", "אלון טבעי"]
    assert page.locator("#board-count").inner_text() == "3 / 40"
    assert page.get_by_role("button", name="הוספת ג׳פנדי ללוח").is_disabled()  # an item appears once
    page.get_by_label("הערה על ג׳פנדי").fill("calm and warm")
    page.get_by_role("button", name="הזזת אלון טבעי למעלה").click()
    page.get_by_text("אלון טבעי הועבר למקום 2 מתוך 3.").wait_for()
    assert board_titles(page) == ["Oak hallway", "אלון טבעי", "ג׳פנדי"]
    assert page.get_by_role("button", name="הזזת Oak hallway למעלה").is_disabled()
    page.get_by_role("button", name="שמירת לוח ההשראה").click()
    page.get_by_text("לוח ההשראה נשמר.").wait_for()

    page.reload()
    page.locator("#board > li").first.wait_for()
    assert board_titles(page) == ["Oak hallway", "אלון טבעי", "ג׳פנדי"]
    assert page.get_by_label("הערה על ג׳פנדי").input_value() == "calm and warm"
    assert page.get_by_label("הערה על אלון טבעי").input_value() == ""
    assert page.locator("#asset-count").inner_text() == "1"

    # The three tabs fit a phone without pushing the page sideways.
    page.set_viewport_size({"width": 390, "height": 800})
    for tab in ("לוח השראה", "סגנונות וחומרים", "בריף"):
        open_tab(page, tab)
        assert not overflows(page), tab
    page.set_viewport_size({"width": 1280, "height": 720})

    # What the browser saved is what the API holds.
    saved = api.get(f"{world.base}/brief", headers=world.client.headers).json()["data"]["brief"]
    assert (sorted(saved["styles"]), saved["budget_min"], saved["budget_max"], saved["currency"], saved["pets"]) == (
        ["japandi", "modern"], 20000, 45000, "ILS", True,
    )  # fmt: skip
    finishes = api.get(f"{world.base}/finishes", headers=world.client.headers).json()["data"]
    assert {(f["room_id"], f["surface"], f["material_id"]) for f in finishes} == {("r1", "floor", "oak-floor"), ("r1", "walls", "sage-paint")}
    board = api.get(f"{world.base}/moodboard", headers=world.client.headers).json()["data"]
    assert [(item["kind"], item["note"]) for item in board] == [("asset", ""), ("material", ""), ("style", "calm and warm")]


def test_designer_sees_the_clients_brief_materials_and_moodboard(servers, page, api, world):
    # The client's choices (saved through the API, as the design page would).
    client = world.client.headers
    brief = {
        "styles": ["industrial", "classic"], "colors": ["#26364f"], "budget_min": 1000, "budget_max": 9000, "currency": "EUR",
        "adults": 2, "children": 1, "pets": False, "lifestyle": "Quiet evenings", "needs": "", "constraints": "Rental", "existing_items": "",
    }  # fmt: skip
    assert api.put(f"{world.base}/brief", json=brief, headers=client).status_code == 200
    selections = [{"room_id": "r1", "surface": "floor", "material_id": "walnut-floor"}, {"room_id": "r1", "surface": "walls", "material_id": "lime-plaster"}]
    assert api.put(f"{world.base}/finishes", json={"selections": selections}, headers=client).status_code == 200
    uploaded = api.post(
        f"{world.base}/assets", files={"file": ("sofa.png", PNG, "image/png")}, data={"kind": "existing_item", "caption": "Grandma's sofa"}, headers=client
    )
    assert uploaded.status_code == 201
    items = [
        {"kind": "style", "ref": "industrial", "note": "love the metal"},
        {"kind": "asset", "ref": uploaded.json()["data"]["id"], "note": "keep this"},
        {"kind": "material", "ref": "walnut-floor", "note": ""},
    ]
    assert api.put(f"{world.base}/moodboard", json={"items": items}, headers=client).status_code == 200

    # The studio's designer opens the same project.
    open_design(page, world.designer, world.pid)
    assert page.get_by_role("link", name="כל הפרויקטים").get_attribute("href") == "studio.html"
    assert pressed_styles(page) == ["industrial", "classic"]
    assert page.locator("#brief-colors li").all_inner_texts()[0].startswith("#26364f")
    assert (page.get_by_label("מינימום").input_value(), page.get_by_label("מקסימום").input_value()) == ("1000", "9000")
    assert page.get_by_label("מטבע").input_value() == "EUR"
    assert page.get_by_label("אורח חיים", exact=True).input_value() == "Quiet evenings"
    assert page.get_by_label("מגבלות", exact=True).input_value() == "Rental"

    open_tab(page, "סגנונות וחומרים")
    assert (chosen(page, "רצפה"), chosen(page, "קירות"), chosen(page, "ארונות")) == ("אגוז", "טיח סיד", "לא נבחר")

    open_tab(page, "לוח השראה")
    assert board_titles(page) == ["תעשייתי", "Grandma's sofa", "אגוז"]
    assert page.get_by_label("הערה על תעשייתי").input_value() == "love the metal"
    assert page.get_by_label("הערה על Grandma's sofa").input_value() == "keep this"
    page.get_by_role("img", name="Grandma's sofa").wait_for()
    assert page.locator("#assets .chip").inner_text() == "פריט שכבר יש לי"
    # The signed link really serves the client's image to the designer.
    picture = page.get_by_role("img", name="Grandma's sofa")
    picture.scroll_into_view_if_needed()
    deadline = time.monotonic() + 15  # polled from here: the page's CSP forbids wait_for_function
    while not picture.evaluate("img => img.complete && img.naturalWidth > 0"):
        assert time.monotonic() < deadline, "the uploaded image did not load from its signed link"
        page.wait_for_timeout(200)


def test_design_page_refuses_bad_input_and_keeps_markup_as_text(servers, page, api, world):
    dialogs = []
    page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.dismiss()))
    open_design(page, world.client, world.pid)

    # A sixth style cannot be chosen: the remaining styles are switched off.
    for style in ("modern", "scandinavian", "industrial", "mid-century", "japandi"):
        page.locator(f"#brief-styles button[data-style={style}]").click()
    assert page.locator("#style-count").inner_text() == "5 / 5"
    sixth = page.locator("#brief-styles button[data-style=classic]")
    assert sixth.is_disabled()
    sixth.click(force=True)
    sixth.dispatch_event("click")
    assert page.locator("#style-count").inner_text() == "5 / 5"
    assert len(pressed_styles(page)) == 5 and "classic" not in pressed_styles(page)
    # Dropping one frees a place again.
    page.locator("#brief-styles button[data-style=modern]").click()
    assert sixth.is_enabled()

    # A minimum budget above the maximum is reported and nothing is sent.
    page.get_by_label("מינימום").fill("9000")
    page.get_by_label("מקסימום").fill("100")
    page.get_by_role("button", name="שמירת הבריף").click()
    page.get_by_text("תקציב המינימום לא יכול להיות גבוה מתקציב המקסימום.").wait_for()
    assert "error" in page.locator("#brief-status").get_attribute("class")
    stored = api.get(f"{world.base}/brief", headers=world.client.headers).json()["data"]["brief"]
    assert (stored["budget_min"], stored["styles"]) == (None, [])

    # Markup typed into the brief is saved and shown as plain text.
    page.get_by_label("מינימום").fill("100")
    page.get_by_label("מקסימום").fill("9000")
    page.get_by_label("אורח חיים", exact=True).fill(MARKUP)
    page.get_by_role("button", name="שמירת הבריף").click()
    page.get_by_text("הבריף נשמר.").wait_for()

    # Uploads: a text file and a 6 MB image are refused in the browser, with a message.
    open_tab(page, "לוח השראה")
    picker = page.get_by_label("תמונה (JPEG, PNG או WebP, עד 5 מ״ב)")
    page.get_by_role("button", name="העלאת תמונה").click()
    page.get_by_text("בחרו תמונה קודם.").wait_for()
    picker.set_input_files(image("notes.txt", "text/plain", b"just some text"))
    page.get_by_role("button", name="העלאת תמונה").click()
    page.get_by_text("אפשר להעלות רק תמונות JPEG, PNG ו-WebP.").wait_for()
    picker.set_input_files(image("huge.png", "image/png", PNG + b"\x00" * (6 * 1024 * 1024)))
    page.get_by_role("button", name="העלאת תמונה").click()
    page.get_by_text("גודל התמונה יכול להגיע עד 5 מ״ב.").wait_for()
    assert "error" in page.locator("#upload-status").get_attribute("class")
    assert page.locator("#asset-count").inner_text() == "0"
    assert api.get(f"{world.base}/assets", headers=world.client.headers).json()["data"] == []

    # Markup in an image caption and in a moodboard note stays text.
    picker.set_input_files(image())
    page.get_by_label("כיתוב (לא חובה)").fill(MARKUP)
    page.get_by_role("button", name="העלאת תמונה").click()
    page.get_by_text("התמונה הועלתה.").wait_for()
    page.get_by_role("button", name=f"הוספת התמונה {MARKUP} ללוח").click()
    page.get_by_role("button", name="הוספת מודרני ללוח").click()
    page.get_by_label("הערה על מודרני").fill(MARKUP)
    page.get_by_role("button", name="שמירת לוח ההשראה").click()
    page.get_by_text("לוח ההשראה נשמר.").wait_for()
    assert no_script_ran(page)

    page.reload()
    page.locator("#board > li").first.wait_for()
    assert board_titles(page) == [MARKUP, "מודרני"]
    assert page.get_by_label("הערה על מודרני").input_value() == MARKUP
    assert page.locator("#assets .caption").inner_text() == MARKUP
    open_tab(page, "בריף")
    assert page.get_by_label("אורח חיים", exact=True).input_value() == MARKUP
    assert no_script_ran(page)
    assert dialogs == []


def test_stranger_cannot_open_another_clients_design_page(servers, page, api, make_user, world):
    api.put(
        f"{world.base}/brief",
        json={"styles": ["modern"], "colors": [], "budget_min": 1, "budget_max": 2, "currency": "USD", "adults": 1, "children": 0,
              "pets": False, "lifestyle": "private words", "needs": "", "constraints": "", "existing_items": ""},
        headers=world.client.headers,
    )  # fmt: skip
    stranger = make_user("e2e-d2-stranger")
    for target in (f"design.html?project={world.pid}", f"consultant.html?project={world.pid}"):
        sign_in(page, stranger, target)
        page.locator(".toast.error").wait_for()
        message = page.locator(".toast.error").inner_text()
        assert "הפריט המבוקש לא נמצא" in message, message
        assert "Traceback" not in message and "{" not in message
        # Nothing of the project is shown.
        assert page.locator("main").is_hidden()
        assert page.locator("#crumb-name").inner_text() == ""
        assert "Design Flat" not in page.content() and "private words" not in page.content()
        page.get_by_role("button", name="התנתקות").click()
        page.wait_for_url("**/index.html")

    # Without a project in the address the page goes back to the project list.
    sign_in(page, stranger, "projects.html")
    page.goto(f"{SITE}/design.html")
    page.wait_for_url("**/projects.html")
    page.goto(f"{SITE}/consultant.html")
    page.wait_for_url("**/projects.html")


def test_signed_out_visitor_is_sent_to_sign_in(servers, page, world):
    page.goto(f"{SITE}/design.html?project={world.pid}")
    page.wait_for_url("**/auth.html?next=*")
    page.get_by_role("heading", name="התחברות").wait_for()
    assert "Design Flat" not in page.content()


def test_consultant_page_starts_empty_and_limits_the_message(servers, page, world):
    # Safety net: no message may reach the model from this test. Any POST is answered here, in the browser.
    posts = []

    def block(route):
        if route.request.method == "POST":
            posts.append(route.request.url)
            return route.fulfill(status=503, content_type="application/json", body='{"success": false, "error": "blocked by the test"}')
        return route.continue_()

    page.route("**/consultant/messages", block)

    sign_in(page, world.client, f"consultant.html?project={world.pid}")
    page.get_by_role("heading", name="יועץ העיצוב", level=1).wait_for()
    assert page.locator("#project-name").inner_text() == "Design Flat"
    assert page.locator("#plan-summary").inner_text() == "גרסה 1 · חדר אחד · פריט ריהוט אחד"
    page.locator("#plan-figure svg").wait_for(state="attached")

    # Empty history, a counter at zero, and nothing to send yet.
    page.get_by_text("אין עדיין הודעות. כתבו למטה את השאלה הראשונה.").wait_for()
    assert page.locator("#thread > li").count() == 0
    assert page.locator("#message-counter").inner_text() == "0 / 2000"
    send = page.get_by_role("button", name="שליחה")
    box = page.get_by_label("ההודעה שלכם")
    assert send.is_disabled()

    # The counter follows the text; blank text cannot be sent.
    box.fill("   ")
    assert page.locator("#message-counter").inner_text() == "3 / 2000"
    assert send.is_disabled()
    box.fill("Hello")
    assert page.locator("#message-counter").inner_text() == "5 / 2000"
    assert send.is_enabled()

    # Typing stops at 2000 characters.
    box.fill("a" * 2000)
    assert send.is_enabled()
    box.press("End")
    box.press("b")
    assert box.evaluate("node => node.value.length") == 2000
    assert page.locator("#message-counter").inner_text() == "2000 / 2000"

    # A longer text (set past the field's limit by a script) cannot be sent, by button or by Enter.
    box.evaluate("node => { node.value = 'a'.repeat(2001); node.dispatchEvent(new Event('input', { bubbles: true })); }")
    assert page.locator("#message-counter").inner_text() == "2001 / 2000"
    assert send.is_disabled()
    box.press("Enter")
    page.locator("#composer").evaluate("form => form.requestSubmit()")
    page.wait_for_timeout(300)
    assert box.evaluate("node => node.value.length") == 2001  # Enter neither sent nor added a line
    assert page.locator("#thread > li").count() == 0
    assert posts == []

    # The page links back to this project's brief and plan.
    assert page.locator("#brief-link").get_attribute("href") == f"design.html?project={world.pid}"
    assert page.locator("#plan-link").get_attribute("href") == f"editor.html?project={world.pid}"
    page.set_viewport_size({"width": 390, "height": 800})
    assert not overflows(page)


def test_homeowner_without_a_studio_saves_a_brief_from_the_projects_list(servers, page, api, make_user):
    owner = make_user("e2e-d2-solo")
    created = api.post("/v1/projects", json={"name": "Solo Flat", "property_type": "existing"}, headers=owner.headers).json()["data"]
    assert created["studio_id"] is None
    sign_in(page, owner, "projects.html")
    page.get_by_role("link", name="בריף וחומרים של Solo Flat").click()
    page.wait_for_url(f"{SITE}/design.html?project={created['id']}")
    page.get_by_role("heading", name="Solo Flat", level=1).wait_for()
    page.get_by_label("צרכים", exact=True).fill("Quiet reading corner")
    page.get_by_role("button", name="שמירת הבריף").click()
    page.get_by_text("הבריף נשמר.").wait_for()
    page.reload()
    page.get_by_role("heading", name="Solo Flat", level=1).wait_for()
    assert page.get_by_label("צרכים", exact=True).input_value() == "Quiet reading corner"
    saved = api.get(f"/v1/projects/{created['id']}/brief", headers=owner.headers).json()["data"]["brief"]
    assert saved["needs"] == "Quiet reading corner"


# ---- Hebrew, right to left ---------------------------------------------------------------------------

# Latin words that stay: the product name, "AI", currency codes, file formats and keycap names.
ALLOWED_LATIN = {"ATELIER", "AI", "USD", "EUR", "GBP", "ILS", "JPEG", "PNG", "WebP", "Enter", "Shift"}
USER_DATA = "#project-name, #crumb-name, #studio-brand, .room-finishes h2, #plan-figure"

# Visible text (and labels) of the elements matching `selector`, without icon ligatures and without user data.
COLLECT = """([selector, userData]) => {
  const seen = [];
  for (const node of document.querySelectorAll(selector)) {
    if (!node.checkVisibility()) continue;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const parent = text.parentElement;
      if (parent.checkVisibility() && !parent.closest(`.icon, script, style, ${userData}`)) seen.push(text.data);
    }
    for (const el of [node, ...node.querySelectorAll("*")]) {
      if (el.closest(userData) || el.matches(".room-finishes")) continue;
      for (const name of ["aria-label", "placeholder", "title"]) if (el.hasAttribute(name)) seen.push(el.getAttribute(name));
    }
  }
  return seen.join(" ");
}"""


def english_words(page, selector: str) -> set[str]:
    text = page.evaluate(COLLECT, [selector, USER_DATA])
    text = re.sub(r"#[0-9a-fA-F]{6}\b", "", text)  # hex colour codes
    return set(re.findall(r"[A-Za-z]{2,}", text)) - ALLOWED_LATIN


def assert_hebrew_page(page, where: str):
    root = page.locator("html")
    assert (root.get_attribute("lang"), root.get_attribute("dir")) == ("he", "rtl"), where
    assert page.evaluate("getComputedStyle(document.body).direction") == "rtl", where
    assert english_words(page, "h1, h2, h3, legend, nav, [role=tablist]") == set(), where
    assert english_words(page, "body") == set(), where
    assert re.search(r"[\u0590-\u05FF]", page.title()), where
    assert not overflows(page), where


def test_design_and_consultant_pages_are_hebrew_and_fit_a_phone(servers, page, world):
    page.set_viewport_size({"width": 375, "height": 740})
    open_design(page, world.client, world.pid)
    assert_hebrew_page(page, "brief")
    assert page.locator("#nav-budget").inner_text().strip().endswith("תקציב")
    page.locator("#color-add").click()
    assert_hebrew_page(page, "brief with a colour")
    page.locator("#color-add").click()
    page.get_by_text("הצבע הזה כבר ברשימה.").wait_for()

    open_tab(page, "סגנונות וחומרים")
    assert page.locator(".room-finishes .chip").inner_text() == "סלון"
    assert_hebrew_page(page, "finishes")

    open_tab(page, "לוח השראה")
    page.get_by_role("button", name="הוספת מודרני ללוח").click()
    assert_hebrew_page(page, "moodboard")
    # The file picker speaks Hebrew (not the browser's language) and shows the chosen file.
    name = page.locator("#upload-form .file-name")
    assert name.inner_text() == "לא נבחר קובץ"
    page.locator("#upload-file").set_input_files(image())
    assert name.inner_text() == "tiny.png"
    page.locator("#upload-form").evaluate("form => form.reset()")
    assert name.inner_text() == "לא נבחר קובץ"

    # In a right-to-left tab list the left arrow moves forward.
    page.get_by_role("tab", name="בריף", exact=True).click()
    page.keyboard.press("ArrowLeft")
    assert page.get_by_role("tab", name="סגנונות וחומרים", exact=True).get_attribute("aria-selected") == "true"
    page.keyboard.press("ArrowRight")
    assert page.get_by_role("tab", name="בריף", exact=True).get_attribute("aria-selected") == "true"

    page.goto(f"{SITE}/consultant.html?project={world.pid}")
    page.get_by_role("heading", name="יועץ העיצוב", level=1).wait_for()
    page.locator("#plan-figure svg").wait_for(state="attached")
    assert_hebrew_page(page, "consultant")
    assert page.locator("#plan-figure svg").get_attribute("aria-label") == "תוכנית קומה של Design Flat"


def test_invalid_brief_values_are_explained_in_hebrew(servers, page, api, world):
    open_design(page, world.client, world.pid)
    save = page.get_by_role("button", name="שמירת הבריף")
    status = page.locator("#brief-status")
    for label, value, message in (
        ("מינימום", "-1", "תקציב המינימום: יש להזין מספר שלם"),
        ("מקסימום", "100000001", "תקציב המקסימום: יש להזין מספר שלם"),
        ("מבוגרים", "21", "מבוגרים: יש להזין מספר שלם"),
    ):
        field = page.get_by_label(label)
        before = field.input_value()
        field.fill(value)
        save.click()
        page.get_by_text(message).wait_for()
        assert "error" in status.get_attribute("class")
        field.fill(before)
    page.get_by_label("מינימום").fill("2")
    page.get_by_label("מקסימום").fill("1")
    save.click()
    page.get_by_text("תקציב המינימום לא יכול להיות גבוה מתקציב המקסימום.").wait_for()
    assert api.get(f"{world.base}/brief", headers=world.client.headers).json()["data"]["brief"]["budget_max"] is None

    # A server refusal is shown in Hebrew too, never as the server's English text.
    page.route("**/brief", lambda route: route.fulfill(status=422, content_type="application/json", body='{"success": false, "error": "Invalid input"}')
               if route.request.method == "PUT" else route.continue_())
    page.get_by_label("מקסימום").fill("9")
    save.click()
    page.get_by_text("הנתונים שהוזנו אינם תקינים.").wait_for()
    assert "Invalid input" not in status.inner_text()


def test_consultant_failures_are_explained_in_hebrew(servers, page, world):
    # Every POST is answered in the browser, so nothing reaches the model.
    answers = [429, 502, 503, 422]

    def answer(route):
        if route.request.method != "POST":
            return route.continue_()
        return route.fulfill(status=answers.pop(0), content_type="application/json", body='{"success": false, "error": "English server text"}')

    page.route("**/consultant/messages", answer)
    sign_in(page, world.client, f"consultant.html?project={world.pid}")
    box = page.get_by_label("ההודעה שלכם")
    box.wait_for()
    for message in ("הגעתם למגבלת ההודעות היומית.", "היועץ לא הצליח לענות.", "יועץ העיצוב אינו זמין כרגע.", "הנתונים שהוזנו אינם תקינים."):
        box.fill("שאלה")
        box.press("Enter")
        page.locator("#chat-error").get_by_text(message).wait_for()
        assert "English" not in page.locator("#chat-error").inner_text()
    assert answers == []


def test_studio_dashboard_shows_the_role_in_hebrew(servers, page, studio):
    sign_in(page, studio.designer, "studio.html")
    page.locator("#role").get_by_text("בעלים").wait_for()
