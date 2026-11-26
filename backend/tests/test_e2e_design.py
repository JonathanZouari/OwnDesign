"""Browser tests of the Phase 2 pages: design brief, styles & materials, moodboard, "In the room" and the consultant.

A client fills the brief, picks materials and builds a moodboard; everything survives a reload and is
visible to the studio's designer. Bad input is refused in the browser, markup stays text, and a stranger
sees nothing. No chat message is ever sent to the model: the POST is blocked in the browser.

On the "In the room" tab a client scans a photo of a room, confirms what was found, and edits and deletes
the listed items; the studio's designer sees the same list. The room scan is not mocked: it runs the real
YOLOv8 model on tests/fixtures/room.jpg (a CC0 photo with a sofa, a chair and a table), so the first scan
can take a while as the model loads.

Starts the backend and the static frontend itself unless they are already running.
"""

import re
import sys
import time
from pathlib import Path
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
    page.get_by_label("Email").fill(user.email)
    page.get_by_label("Password").fill(user.password)
    page.get_by_role("button", name="Sign in").click()
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
    room = page.get_by_role("region", name="Materials for Living room")
    room.get_by_role("group", name=surface, exact=True).get_by_text(material, exact=True).click()


def chosen(page, surface: str) -> str:
    room = page.get_by_role("region", name="Materials for Living room")
    return room.get_by_role("group", name=surface, exact=True).locator("label:has(input:checked)").inner_text().strip()


def image(name="tiny.png", mime="image/png", data=PNG) -> dict:
    return {"name": name, "mimeType": mime, "buffer": data}


def no_script_ran(page) -> bool:
    return page.evaluate("window.__xss === undefined") and page.locator("#design img[src='x'], #design b, #design script").count() == 0


def test_client_fills_brief_materials_and_moodboard(servers, page, api, world):
    open_design(page, world.client, world.pid)
    assert page.locator("#studio-brand").inner_text() == "Design E2E Studio"
    assert page.get_by_role("tab", name="Brief", exact=True).get_attribute("aria-selected") == "true"

    # Brief: an empty brief starts with nothing chosen.
    assert page.locator("#style-count").inner_text() == "0 / 5"
    for style in ("japandi", "modern"):
        page.locator(f"#brief-styles button[data-style={style}]").click()
    page.get_by_role("button", name="Add colour").click()
    page.get_by_label("Minimum").fill("20000")
    page.get_by_label("Maximum").fill("45000")
    page.get_by_label("Currency").select_option("ILS")
    page.get_by_label("Adults").fill("2")
    page.get_by_label("Children").fill("3")
    page.get_by_label("Pets live here").check()
    page.get_by_label("Lifestyle", exact=True).fill("We cook a lot\nand host on weekends.")
    page.get_by_label("Needs", exact=True).fill("A desk for two")
    page.get_by_role("button", name="Save brief").click()
    page.get_by_text("Brief saved.").wait_for()

    page.reload()
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()
    assert pressed_styles(page) == ["modern", "japandi"]  # shown in catalog order
    assert page.locator("#style-count").inner_text() == "2 / 5"
    assert page.locator("#brief-colors li").all_inner_texts()[0].startswith("#bf542c")
    assert (page.get_by_label("Minimum").input_value(), page.get_by_label("Maximum").input_value()) == ("20000", "45000")
    assert page.get_by_label("Currency").input_value() == "ILS"
    assert (page.get_by_label("Adults").input_value(), page.get_by_label("Children").input_value()) == ("2", "3")
    assert page.get_by_label("Pets live here").is_checked()
    assert page.get_by_label("Lifestyle", exact=True).input_value() == "We cook a lot\nand host on weekends."
    assert page.get_by_label("Needs", exact=True).input_value() == "A desk for two"

    # Styles & materials: one material per surface of the room in the saved plan.
    open_tab(page, "Styles & materials")
    assert (chosen(page, "Floor"), chosen(page, "Walls")) == ("Not chosen", "Not chosen")
    # Only materials that suit a surface are offered: paint is not a floor.
    floor = page.get_by_role("region", name="Materials for Living room").get_by_role("group", name="Floor", exact=True)
    assert floor.get_by_text("Sage green paint").count() == 0
    choose(page, "Floor", "Natural oak")
    choose(page, "Walls", "Sage green paint")
    page.get_by_text("Unsaved changes.").wait_for()
    page.get_by_role("button", name="Save materials").click()
    page.get_by_text("Materials saved.").wait_for()

    page.reload()  # the open tab is kept in the address
    page.get_by_role("region", name="Materials for Living room").wait_for()
    assert (chosen(page, "Floor"), chosen(page, "Walls"), chosen(page, "Ceiling")) == ("Natural oak", "Sage green paint", "Not chosen")

    # Moodboard: upload an image, add it with a style and a material, annotate, reorder.
    open_tab(page, "Moodboard")
    page.get_by_text("The board is empty.").wait_for()
    page.get_by_text("No images uploaded yet.").wait_for()
    page.get_by_label("Image (JPEG, PNG or WebP, up to 5 MB)").set_input_files(image())
    page.get_by_label("Caption (optional)").fill("Oak hallway")
    page.get_by_role("button", name="Upload image").click()
    page.get_by_text("Image uploaded.").wait_for()
    assert page.locator("#asset-count").inner_text() == "1"
    page.get_by_role("img", name="Oak hallway").wait_for()

    page.get_by_role("button", name="Add image Oak hallway to the board").click()
    page.get_by_role("button", name="Add Japandi to the board").click()
    page.get_by_role("button", name="Add Natural oak to the board").click()
    assert board_titles(page) == ["Oak hallway", "Japandi", "Natural oak"]
    assert page.locator("#board-count").inner_text() == "3 / 40"
    assert page.get_by_role("button", name="Add Japandi to the board").is_disabled()  # an item appears once
    page.get_by_label("Note for Japandi").fill("calm and warm")
    page.get_by_role("button", name="Move Natural oak up").click()
    page.get_by_text("Natural oak moved to position 2 of 3.").wait_for()
    assert board_titles(page) == ["Oak hallway", "Natural oak", "Japandi"]
    assert page.get_by_role("button", name="Move Oak hallway up").is_disabled()
    page.get_by_role("button", name="Save moodboard").click()
    page.get_by_text("Moodboard saved.").wait_for()

    page.reload()
    page.locator("#board > li").first.wait_for()
    assert board_titles(page) == ["Oak hallway", "Natural oak", "Japandi"]
    assert page.get_by_label("Note for Japandi").input_value() == "calm and warm"
    assert page.get_by_label("Note for Natural oak").input_value() == ""
    assert page.locator("#asset-count").inner_text() == "1"

    # The three tabs fit a phone without pushing the page sideways.
    page.set_viewport_size({"width": 390, "height": 800})
    for tab in ("Moodboard", "Styles & materials", "Brief"):
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
    assert page.get_by_role("link", name="All projects").get_attribute("href") == "studio.html"
    assert pressed_styles(page) == ["industrial", "classic"]
    assert page.locator("#brief-colors li").all_inner_texts()[0].startswith("#26364f")
    assert (page.get_by_label("Minimum").input_value(), page.get_by_label("Maximum").input_value()) == ("1000", "9000")
    assert page.get_by_label("Currency").input_value() == "EUR"
    assert page.get_by_label("Lifestyle", exact=True).input_value() == "Quiet evenings"
    assert page.get_by_label("Constraints", exact=True).input_value() == "Rental"

    open_tab(page, "Styles & materials")
    assert (chosen(page, "Floor"), chosen(page, "Walls"), chosen(page, "Cabinets")) == ("Walnut", "Lime plaster", "Not chosen")

    open_tab(page, "Moodboard")
    assert board_titles(page) == ["Industrial", "Grandma's sofa", "Walnut"]
    assert page.get_by_label("Note for Industrial").input_value() == "love the metal"
    assert page.get_by_label("Note for Grandma's sofa").input_value() == "keep this"
    page.get_by_role("img", name="Grandma's sofa").wait_for()
    assert page.locator("#assets .chip").inner_text() == "Item I own"
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
    page.get_by_label("Minimum").fill("9000")
    page.get_by_label("Maximum").fill("100")
    page.get_by_role("button", name="Save brief").click()
    page.get_by_text("Minimum budget must not exceed maximum budget.").wait_for()
    assert "error" in page.locator("#brief-status").get_attribute("class")
    stored = api.get(f"{world.base}/brief", headers=world.client.headers).json()["data"]["brief"]
    assert (stored["budget_min"], stored["styles"]) == (None, [])

    # Markup typed into the brief is saved and shown as plain text.
    page.get_by_label("Minimum").fill("100")
    page.get_by_label("Maximum").fill("9000")
    page.get_by_label("Lifestyle", exact=True).fill(MARKUP)
    page.get_by_role("button", name="Save brief").click()
    page.get_by_text("Brief saved.").wait_for()

    # Uploads: a text file and a 6 MB image are refused in the browser, with a message.
    open_tab(page, "Moodboard")
    picker = page.get_by_label("Image (JPEG, PNG or WebP, up to 5 MB)")
    page.get_by_role("button", name="Upload image").click()
    page.get_by_text("Choose an image first.").wait_for()
    picker.set_input_files(image("notes.txt", "text/plain", b"just some text"))
    page.get_by_role("button", name="Upload image").click()
    page.get_by_text("Only JPEG, PNG and WebP images are accepted.").wait_for()
    picker.set_input_files(image("huge.png", "image/png", PNG + b"\x00" * (6 * 1024 * 1024)))
    page.get_by_role("button", name="Upload image").click()
    page.get_by_text("Images can be at most 5 MB.").wait_for()
    assert "error" in page.locator("#upload-status").get_attribute("class")
    assert page.locator("#asset-count").inner_text() == "0"
    assert api.get(f"{world.base}/assets", headers=world.client.headers).json()["data"] == []

    # Markup in an image caption and in a moodboard note stays text.
    picker.set_input_files(image())
    page.get_by_label("Caption (optional)").fill(MARKUP)
    page.get_by_role("button", name="Upload image").click()
    page.get_by_text("Image uploaded.").wait_for()
    page.get_by_role("button", name=f"Add image {MARKUP} to the board").click()
    page.get_by_role("button", name="Add Modern to the board").click()
    page.get_by_label("Note for Modern").fill(MARKUP)
    page.get_by_role("button", name="Save moodboard").click()
    page.get_by_text("Moodboard saved.").wait_for()
    assert no_script_ran(page)

    page.reload()
    page.locator("#board > li").first.wait_for()
    assert board_titles(page) == [MARKUP, "Modern"]
    assert page.get_by_label("Note for Modern").input_value() == MARKUP
    assert page.locator("#assets .caption").inner_text() == MARKUP
    open_tab(page, "Brief")
    assert page.get_by_label("Lifestyle", exact=True).input_value() == MARKUP
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
        assert "not found" in message.lower(), message
        assert "Traceback" not in message and "{" not in message
        # Nothing of the project is shown.
        assert page.locator("main").is_hidden()
        assert page.locator("#crumb-name").inner_text() == ""
        assert "Design Flat" not in page.content() and "private words" not in page.content()
        page.get_by_role("button", name="Sign out").click()
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
    page.get_by_role("heading", name="Sign in").wait_for()
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
    page.get_by_role("heading", name="Design consultant", level=1).wait_for()
    assert page.locator("#project-name").inner_text() == "Design Flat"
    assert page.locator("#plan-summary").inner_text() == "Version 1 · 1 room · 1 furniture item"
    page.locator("#plan-figure svg").wait_for(state="attached")

    # Empty history, a counter at zero, and nothing to send yet.
    page.get_by_text("No messages yet. Ask your first question below.").wait_for()
    assert page.locator("#thread > li").count() == 0
    assert page.locator("#message-counter").inner_text() == "0 / 2000"
    send = page.get_by_role("button", name="Send")
    box = page.get_by_label("Your message")
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


# ---- In the room -------------------------------------------------------------------------------------

ROOM_PHOTO = Path(__file__).parent / "fixtures" / "room.jpg"
FOUND_IN_ROOM_JPG = {"Sofa", "Chair", "Table"}  # what the real YOLOv8 model finds on the fixture photo
SCAN_TIMEOUT = 120_000  # ms: the first scan loads the model


def open_room(page, user, pid: str):
    """Signs in and opens the "In the room" tab from the address (design.html?project=<id>#room)."""
    open_design(page, user, pid)
    page.goto(f"{SITE}/design.html?project={pid}#room")
    page.reload()  # a fresh load reads the tab from the address
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()
    page.locator("#panel-room").wait_for()
    assert page.locator("#tab-room").get_attribute("aria-selected") == "true"


def sign_out(page):
    page.get_by_role("button", name="Sign out").click()
    page.wait_for_url("**/index.html")


def item_row(page, label: str):
    return page.locator("#items-groups li.room-item").filter(has=page.get_by_text(label, exact=True))


def add_label(page) -> str:
    return page.locator("#review-add-text").inner_text()


def test_client_scans_a_room_and_manages_the_item_list(servers, page, api, world):
    open_room(page, world.client, world.pid)
    page.locator("#items-empty").wait_for()
    assert page.locator("#items-count").inner_text() == "0"
    assert page.locator("#review").is_hidden()
    # The room choice offers the whole home first, then the rooms of the saved plan.
    options = page.locator("#scan-room option").evaluate_all("nodes => nodes.map(n => [n.value, n.textContent])")
    assert options == [["", "Whole home"], ["r1", "Living room"]]

    # Scan the photo for the living room; the real model runs on the server.
    page.locator("#scan-file").set_input_files(str(ROOM_PHOTO))
    page.locator("#scan-room").select_option(label="Living room")
    page.locator("#scan-send").click()
    page.locator("#review").wait_for(timeout=SCAN_TIMEOUT)
    status = page.locator("#scan-status").inner_text()
    assert re.fullmatch(r"Found \d+ items? in Living room\. Check them below\.", status), status
    assert "error" not in (page.locator("#scan-status").get_attribute("class") or "")

    # Boxes on the photo and one ticked draft per detection, named as the model names them.
    drafts = page.locator("#review-list > li").count()
    assert drafts >= 1
    assert page.locator("#review-photo [data-box]").count() == drafts
    names = [page.locator(f"#draft-{n}-name").input_value() for n in range(1, drafts + 1)]
    assert names[0] in FOUND_IN_ROOM_JPG and set(names) <= FOUND_IN_ROOM_JPG, names
    assert all(page.locator(f"#draft-{n}-pick").is_checked() for n in range(1, drafts + 1))
    assert add_label(page) == f"Add {drafts} item{'' if drafts == 1 else 's'}"
    assert page.get_by_role("img", name="The scanned photo of the room").count() == 1

    # Unticking everything leaves nothing to add; ticking the first back allows one.
    for n in range(1, drafts + 1):
        page.get_by_label(f"Include item {n}", exact=True).uncheck()
    assert add_label(page) == "Add 0 items"
    assert page.locator("#review-add").is_disabled()
    page.get_by_label("Include item 1", exact=True).check()
    assert add_label(page) == "Add 1 item"
    assert page.locator("#review-add").is_enabled()
    first_category = page.locator("#draft-1-category").input_value()
    page.locator("#draft-1-name").fill("Grey sofa")
    page.locator("#review-add").click()
    page.locator("#review").wait_for(state="hidden")
    page.get_by_text("Added 1 item.", exact=True).wait_for()

    # The item is listed under its room, marked as found in the photo.
    groups = page.locator("#items-groups section.room-group")
    assert groups.count() == 1
    assert groups.locator("h3").inner_text().startswith("Living room")
    assert page.locator("#items-count").inner_text() == "1"
    assert page.locator("#items-empty").is_hidden()
    assert item_row(page, "Grey sofa").count() == 1
    assert item_row(page, "Grey sofa").get_by_text("From photo", exact=True).is_visible()

    # What the browser added is what the API holds; the scanned photo is kept with the images.
    items = api.get(f"{world.base}/items", headers=world.client.headers).json()["data"]
    assert len(items) == 1
    item = items[0]
    assert (item["label"], item["category"], item["room_id"], item["source"], item["note"]) == ("Grey sofa", first_category, "r1", "scan", "")
    assert item["asset_id"] and len(item["box"]) == 4 and 0 < item["confidence"] <= 1
    assets = api.get(f"{world.base}/assets", headers=world.client.headers).json()["data"]
    assert [(asset["id"], asset["kind"]) for asset in assets] == [(item["asset_id"], "existing_item")]
    assert page.locator(f'#items-groups li.room-item[data-item="{item["id"]}"]').count() == 1

    # A reload keeps the tab and the list.
    page.reload()
    page.locator("#items-groups li.room-item").first.wait_for()
    assert page.locator("#tab-room").get_attribute("aria-selected") == "true"
    assert item_row(page, "Grey sofa").get_by_text("From photo", exact=True).is_visible()
    assert page.locator("#items-groups section.room-group > h3").inner_text().startswith("Living room")

    # The studio's designer sees the same list.
    sign_out(page)
    open_room(page, world.designer, world.pid)
    page.locator("#items-groups li.room-item").first.wait_for()
    assert page.locator("#items-count").inner_text() == "1"
    assert page.locator("#items-groups section.room-group > h3").inner_text().startswith("Living room")
    assert item_row(page, "Grey sofa").get_by_text("From photo", exact=True).is_visible()
    sign_out(page)

    # The client adds a note to the item.
    open_room(page, world.client, world.pid)
    page.get_by_role("button", name="Edit Grey sofa", exact=True).click()
    editing = page.locator(f'#items-groups li.room-item[data-item="{item["id"]}"]')
    assert page.locator(f'#edit-{item["id"]}-name').input_value() == "Grey sofa"
    assert page.locator(f'#edit-{item["id"]}-room').input_value() == "r1"
    page.locator(f'#edit-{item["id"]}-note').fill("By the window")
    editing.get_by_role("button", name="Save", exact=True).click()
    page.get_by_text("Grey sofa saved.", exact=True).wait_for()
    assert page.locator(f'#edit-{item["id"]}-note').count() == 0  # the form closed
    assert item_row(page, "Grey sofa").get_by_text("By the window", exact=True).is_visible()
    saved = api.get(f"{world.base}/items", headers=world.client.headers).json()["data"]
    assert [(i["label"], i["note"], i["room_id"]) for i in saved] == [("Grey sofa", "By the window", "r1")]

    # Cancel leaves the item as it was.
    page.get_by_role("button", name="Edit Grey sofa", exact=True).click()
    page.locator(f'#edit-{item["id"]}-note').fill("Not this")
    editing.get_by_role("button", name="Cancel", exact=True).click()
    assert item_row(page, "Grey sofa").get_by_text("By the window", exact=True).is_visible()
    assert api.get(f"{world.base}/items", headers=world.client.headers).json()["data"][0]["note"] == "By the window"

    # Deleting asks first; the empty state returns.
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Delete Grey sofa", exact=True).click()
    page.get_by_text("Grey sofa deleted.", exact=True).wait_for()
    page.locator("#items-empty").wait_for()
    assert page.locator("#items-count").inner_text() == "0"
    assert page.locator("#items-groups section.room-group").count() == 0
    assert api.get(f"{world.base}/items", headers=world.client.headers).json()["data"] == []
    page.reload()
    page.locator("#items-empty").wait_for()


def test_room_tab_refuses_bad_input_and_keeps_markup_as_text(servers, page, api, world):
    scans = []
    page.on("request", lambda request: scans.append(request.url) if request.method == "POST" and "/scans" in request.url else None)
    open_room(page, world.client, world.pid)
    scan_status = page.locator("#scan-status")

    # No photo chosen: refused in the browser, nothing sent.
    page.locator("#scan-send").click()
    page.get_by_text("Choose or take a photo first.", exact=True).wait_for()
    assert "error" in scan_status.get_attribute("class")

    # A text file named like a photo, an empty photo and one over 5 MB are refused in the browser too.
    picker = page.locator("#scan-file")
    for upload, message in (
        (image("notes.jpg", "text/plain", b"just some text"), "Use a JPEG, PNG or WebP photo."),
        (image("empty.jpg", "image/jpeg", b""), "The file is empty."),
        (image("huge.jpg", "image/jpeg", ROOM_PHOTO.read_bytes() + b"\x00" * (6 * 1024 * 1024)), "Photos can be at most 5 MB."),
    ):
        picker.set_input_files(upload)
        page.locator("#scan-send").click()
        page.get_by_text(message, exact=True).wait_for()
        assert "error" in scan_status.get_attribute("class"), message
    page.wait_for_timeout(300)
    assert scans == []
    assert page.locator("#review").is_hidden()
    assert api.get(f"{world.base}/assets", headers=world.client.headers).json()["data"] == []

    # Adding by hand: a name and a category are required.
    manual_status = page.locator("#manual-status")
    assert page.locator("#manual-category").input_value() == ""
    page.locator("#manual-add").click()
    page.get_by_text("Give the item a name.", exact=True).wait_for()
    assert "error" in manual_status.get_attribute("class")
    page.locator("#manual-name").fill("   ")
    page.locator("#manual-add").click()
    page.get_by_text("Give the item a name.", exact=True).wait_for()
    page.locator("#manual-name").fill("Bookcase")
    page.locator("#manual-add").click()
    page.get_by_text("Choose a category.", exact=True).wait_for()
    assert api.get(f"{world.base}/items", headers=world.client.headers).json()["data"] == []

    # A name longer than 80 characters is cut at the field's limit.
    page.locator("#manual-name").fill("x" * 81)
    assert page.locator("#manual-name").evaluate("node => node.value.length") == 80

    # Markup as a name and a note is saved and shown as plain text.
    page.locator("#manual-name").fill(MARKUP)
    page.locator("#manual-category").select_option("decor")
    page.locator("#manual-room").select_option(label="Living room")
    page.locator("#manual-note").fill(MARKUP)
    page.locator("#manual-add").click()
    page.get_by_text(f"{MARKUP} added to Living room.", exact=True).wait_for()
    assert "error" not in (manual_status.get_attribute("class") or "")
    assert page.locator("#manual-name").input_value() == "" and page.locator("#manual-note").input_value() == ""
    row = page.locator("#items-groups li.room-item")
    assert row.count() == 1
    assert row.locator("strong").inner_text() == MARKUP
    assert row.locator(".room-item-note").inner_text() == MARKUP
    assert row.get_by_text("From photo").count() == 0  # typed by hand
    assert no_script_ran(page)
    stored = api.get(f"{world.base}/items", headers=world.client.headers).json()["data"]
    assert [(i["label"], i["note"], i["category"], i["room_id"], i["source"]) for i in stored] == [(MARKUP, MARKUP, "decor", "r1", "manual")]

    page.reload()
    page.locator("#items-groups li.room-item").first.wait_for()
    assert page.locator("#items-groups li.room-item strong").inner_text() == MARKUP
    assert no_script_ran(page)

    # An emptied name is refused in the edit form too, and nothing changes.
    page.get_by_role("button", name=f"Edit {MARKUP}", exact=True).click()
    page.locator(f'#edit-{stored[0]["id"]}-name').fill("")
    page.locator("#items-groups li.room-item").get_by_role("button", name="Save", exact=True).click()
    page.locator("#items-groups li.room-item").get_by_text("Give the item a name.", exact=True).wait_for()
    assert api.get(f"{world.base}/items", headers=world.client.headers).json()["data"][0]["label"] == MARKUP

    # The tab fits a 375 px phone, with the edit form open and with the list.
    page.set_viewport_size({"width": 375, "height": 800})
    assert not overflows(page)
    page.locator("#items-groups li.room-item").get_by_role("button", name="Cancel", exact=True).click()
    assert not overflows(page)
    page.set_viewport_size({"width": 1280, "height": 720})
    assert no_script_ran(page)


def test_stranger_sees_no_room_items(servers, page, api, make_user, world):
    added = api.post(
        f"{world.base}/items",
        json={"items": [{"label": "Secret armchair", "category": "seating", "room_id": "r1", "note": "private words", "source": "manual"}]},
        headers=world.client.headers,
    )
    assert added.status_code == 201
    stranger = make_user("e2e-d2-room-stranger")
    assert api.get(f"{world.base}/items", headers=stranger.headers).status_code == 404

    sign_in(page, stranger, "projects.html")
    page.goto(f"{SITE}/design.html?project={world.pid}#room")
    page.locator(".toast.error").wait_for()
    message = page.locator(".toast.error").inner_text()
    assert "not found" in message.lower(), message
    assert "Traceback" not in message and "{" not in message
    assert page.locator("main").is_hidden()
    assert page.locator("#items-groups li.room-item").count() == 0
    content = page.content()
    assert "Secret armchair" not in content and "private words" not in content and "Design Flat" not in content
