"""Browser tests of the mobile web version.

On a phone (a touch context 390 px wide) the plan editor offers view and light edits only: select,
move, rotate, undo, furniture and save. Drawing walls, doors and windows needs a larger screen. No page
scrolls sideways from 320 to 767 px, long names and markup included.

Starts the backend and the static frontend itself unless they are already running.
"""

import re

import pytest
from playwright.sync_api import expect

from tests.conftest import needs_supabase
from tests.test_e2e import FRONTEND, SITE, overflows
from tests.test_e2e_design import MARKUP, servers, sign_in, studio, world  # noqa: F401  (fixtures)
from tests.test_geometry import VALID

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]

PHONE = {"width": 390, "height": 844}
ALL_TOOLS = ["select", "exterior", "partition", "door", "window", "furniture"]
PHONE_TOOLS = ["select", "furniture"]


@pytest.fixture
def phone(browser):
    context = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True, device_scale_factor=3)
    page = context.new_page()
    yield page
    context.close()


def rail(page) -> list[str]:
    return page.locator("#tools button").evaluate_all("nodes => nodes.map(n => n.dataset.tool)")


def active_tool(page) -> str:
    return page.locator("#canvas").get_attribute("data-tool")


def open_editor(page, user, pid: str):
    sign_in(page, user, f"editor.html?project={pid}")
    page.locator("#canvas [data-kind=furniture]").first.wait_for(state="attached")


def drag(page, locator, dx: float, dy: float):
    box = locator.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx / 2, y + dy / 2)
    page.mouse.move(x + dx, y + dy)
    page.mouse.up()


def test_phone_editor_offers_view_and_light_edits(servers, phone, api, world):
    page = phone
    furniture = page.locator("#canvas [data-kind=furniture]")
    walls = page.locator("#canvas [data-kind=walls]")
    open_editor(page, world.client, world.pid)
    wall_count = walls.count()

    # Only the light-edit tools are offered, and the page says why.
    assert rail(page) == PHONE_TOOLS
    notice = page.locator("#phone-notice")
    assert notice.is_visible()
    assert "tablet or computer" in notice.inner_text()
    assert not overflows(page)

    # A drawing shortcut from an attached keyboard does nothing.
    for key in ("w", "p", "d", "n"):
        page.keyboard.press(key)
        assert active_tool(page) == "select"

    # Tap to select, rotate, undo.
    furniture.first.tap()
    page.locator("#actions").wait_for()
    page.locator("#rotate").tap()
    page.get_by_text("Unsaved changes").wait_for(state="attached")
    page.locator("#undo").tap()
    page.get_by_text("Saved · v1").wait_for(state="attached")

    # Drag to move.
    drag(page, furniture.first, 40, 30)
    page.get_by_text("Unsaved changes").wait_for(state="attached")

    # Add furniture from the catalog with a tap on the canvas.
    page.locator("#tools button[data-tool=furniture]").tap()
    page.locator("#catalog button[data-type=chair]").tap()
    box = page.locator("#canvas").bounding_box()
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    assert furniture.count() == 2
    assert active_tool(page) == "select"

    # Save, reload: the edits are kept and no wall was added.
    page.locator("#save").tap()
    page.get_by_role("button", name="Save version").tap()
    page.get_by_text("Saved · v2").wait_for(state="attached")
    page.reload()
    furniture.first.wait_for(state="attached")
    assert (furniture.count(), walls.count()) == (2, wall_count)
    latest = api.get(f"{world.base}/versions/latest", headers=world.client.headers).json()["data"]["geometry"]
    assert [item["type"] for item in latest["furniture"]] == ["sofa", "chair"]
    assert (latest["furniture"][0]["x"], latest["furniture"][0]["y"]) != (100, 100)


@pytest.mark.parametrize("kind", ["walls", "openings"])
def test_phone_shows_walls_and_openings_read_only(servers, phone, world, kind):
    page = phone
    open_editor(page, world.client, world.pid)
    element = page.locator(f"#canvas [data-kind={kind}]").first
    element.focus()  # selects it; a straight wall has no height for Playwright to tap

    # Selected and readable, but every field is disabled and the sheet says where to change it.
    page.locator("#locked-note").wait_for()
    fields = page.locator("#inspector .fields").locator("input, select")
    assert fields.count() == 3
    for i in range(fields.count()):
        expect(fields.nth(i)).to_be_disabled()
    # No end handles to drag, and no delete action.
    assert page.locator("#canvas [data-kind=handle]").count() == 0
    assert page.locator("#delete").is_hidden()

    # Delete and the arrow keys from an attached keyboard change nothing; a drag on it pans the view instead.
    for key in ("Delete", "Backspace", "ArrowRight", "ArrowDown"):
        element.focus()
        page.keyboard.press(key)
    if kind == "openings":  # a door has a body to grab; dragging it used to slide it along its wall
        before = page.locator("#canvas").get_attribute("viewBox")
        drag(page, element, 60, 0)
        expect(page.locator("#canvas")).not_to_have_attribute("viewBox", before)
    page.wait_for_timeout(200)
    assert page.locator("#status-save").inner_text() == "Saved · v1"
    assert page.locator(f"#canvas [data-kind={kind}]").count() == (2 if kind == "walls" else 1)


def test_phone_renames_a_room_but_cannot_drag_its_walls(servers, phone, api, world):
    page = phone
    open_editor(page, world.client, world.pid)
    room = page.get_by_role("button", name="Room Living room")
    drag(page, room, 80, 60)  # on a large screen this moves every wall of the room
    room.focus()
    expect(page.locator("#delete")).to_be_hidden()
    page.get_by_label("Name").fill("Lounge")
    page.get_by_label("Name").press("Enter")
    page.locator("#save").tap()
    page.get_by_role("button", name="Save version").tap()
    page.get_by_text("Saved · v2").wait_for(state="attached")
    latest = api.get(f"{world.base}/versions/latest", headers=world.client.headers).json()["data"]["geometry"]
    assert latest["rooms"][0]["name"] == "Lounge"
    assert latest["walls"] == VALID["walls"]


def test_phone_notice_can_be_dismissed_and_stays_dismissed(servers, phone, world):
    page = phone
    open_editor(page, world.client, world.pid)
    notice = page.locator("#phone-notice")
    expect(notice).to_be_visible()
    page.get_by_role("button", name="Dismiss notice").tap()
    expect(notice).to_be_hidden()
    page.reload()
    page.locator("#canvas [data-kind=furniture]").first.wait_for(state="attached")
    expect(notice).to_be_hidden()


def test_menu_works_when_the_editor_cannot_load_its_project(servers, phone, world):
    page = phone
    missing = "00000000-0000-4000-8000-000000000000"
    sign_in(page, world.client, f"editor.html?project={world.pid}")
    page.goto(f"{SITE}/editor.html?project={missing}")
    page.get_by_role("button", name="Open menu").tap()
    drawer(page).wait_for()
    # Project pages are offered only for a project that loaded.
    assert drawer(page).get_by_role("link", name="Brief & Materials").count() == 0


def test_drawer_offers_no_links_from_a_page_that_did_not_load(servers, phone, world):
    page = phone
    missing = "00000000-0000-4000-8000-000000000000"
    sign_in(page, world.client, f"design.html?project={world.pid}")
    page.goto(f"{SITE}/design.html?project={missing}")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Open menu").tap()
    drawer(page).wait_for()
    hrefs = drawer(page).locator("a").evaluate_all("nodes => nodes.map(n => n.getAttribute('href'))")
    assert not any(href in ("editor.html", "design.html", "consultant.html") for href in hrefs), hrefs


def test_drawing_tools_appear_from_768_px(servers, page, world):
    open_editor(page, world.client, world.pid)
    page.set_viewport_size({"width": 768, "height": 900})
    expect(page.locator("#tools button")).to_have_count(6)  # string predicates are blocked by the page's CSP
    assert rail(page) == ALL_TOOLS
    assert page.locator("#phone-notice").is_hidden()
    page.set_viewport_size({"width": 767, "height": 900})
    expect(page.locator("#tools button")).to_have_count(2)
    assert rail(page) == PHONE_TOOLS
    assert page.locator("#phone-notice").is_visible()


def test_crossing_to_phone_mid_draw_drops_the_wall(servers, page, world):
    walls = page.locator("#canvas [data-kind=walls]")
    page.set_viewport_size({"width": 1280, "height": 800})
    open_editor(page, world.client, world.pid)
    before = walls.count()

    page.keyboard.press("w")
    assert active_tool(page) == "exterior"
    box = page.locator("#canvas").bounding_box()
    x, y = box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.8
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 150, y)
    page.set_viewport_size(PHONE)
    expect(page.locator("#tools button")).to_have_count(2)
    page.mouse.move(x + 200, y)
    page.mouse.up()

    assert active_tool(page) == "select"
    assert walls.count() == before
    assert page.locator("#canvas .preview").count() == 0
    assert page.locator("#status-save").inner_text() == "Saved · v1"

    # Back on a large screen the drawing tools return, and Select stays active.
    page.set_viewport_size({"width": 1280, "height": 800})
    expect(page.locator("#tools button")).to_have_count(6)  # string predicates are blocked by the page's CSP
    assert active_tool(page) == "select"


def drawer(page):
    return page.get_by_role("dialog", name="Menu")


def open_drawer(page):
    page.get_by_role("button", name="Open menu").tap()
    drawer(page).wait_for()
    expect(page.locator("#nav-menu")).to_have_attribute("aria-expanded", "true")


def test_phone_reaches_project_pages_and_sign_out_through_the_drawer(servers, phone, world):
    page = phone
    open_editor(page, world.client, world.pid)

    # The drawer lists the project's pages, which the phone's app bar has no room for.
    open_drawer(page)
    menu = drawer(page)
    menu.get_by_role("link", name="Brief & Materials").wait_for()
    menu.get_by_role("link", name="AI Consultant").wait_for()
    menu.get_by_role("button", name="Sign out").wait_for()
    menu.get_by_role("link", name="Brief & Materials").tap()
    page.wait_for_url(f"**/design.html?project={world.pid}")
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()

    open_drawer(page)
    drawer(page).get_by_role("link", name="Design consultant").tap()
    page.wait_for_url(f"**/consultant.html?project={world.pid}")

    # Sign out from the drawer ends the session.
    open_drawer(page)
    drawer(page).get_by_role("button", name="Sign out").tap()
    page.wait_for_url("**/index.html")
    page.goto(f"{SITE}/design.html?project={world.pid}")
    page.wait_for_url("**/auth.html*")  # signed out: the project page sends the visitor to sign in


def test_drawer_closes_with_escape_backdrop_and_close_button(servers, phone, world):
    page = phone
    open_editor(page, world.client, world.pid)
    menu_button = page.locator("#nav-menu")

    open_drawer(page)
    page.keyboard.press("Escape")
    drawer(page).wait_for(state="hidden")
    expect(menu_button).to_have_attribute("aria-expanded", "false")  # set by the dialog's close event, a task later
    expect(menu_button).to_be_focused()

    open_drawer(page)
    page.touchscreen.tap(PHONE["width"] - 10, PHONE["height"] / 2)  # outside the drawer: the backdrop
    drawer(page).wait_for(state="hidden")

    open_drawer(page)
    drawer(page).get_by_role("button", name="Close menu").tap()
    drawer(page).wait_for(state="hidden")

    # While closed it holds no copies, so the page never has two links with one name.
    assert drawer(page).locator("a").count() == 0
    # Opening and closing again and again leaves exactly one set of links.
    for _ in range(3):
        open_drawer(page)
        assert drawer(page).get_by_role("link", name="Brief & Materials").count() == 1
        page.keyboard.press("Escape")


def test_designer_reaches_dashboard_sections_through_the_drawer(servers, phone, world):
    page = phone
    sign_in(page, world.designer, "studio.html")
    page.get_by_role("article", name="Design Flat").first.wait_for()
    open_drawer(page)
    menu = drawer(page)
    assert menu.get_by_text("Design E2E Studio").is_visible()
    for later in ("Spatial Renders", "Dossier & Specs", "Studio Branding"):
        assert menu.get_by_role("link", name=later).count() == 0  # later phases are not links
    menu.get_by_role("link", name="Clients & invites").tap()
    drawer(page).wait_for(state="hidden")
    page.wait_for_url("**/studio.html#clients")
    assert page.get_by_label("Client email").is_visible()


def test_menu_button_is_hidden_on_a_large_screen(servers, page, world):
    page.set_viewport_size({"width": 1280, "height": 800})
    open_editor(page, world.client, world.pid)
    assert page.locator("#nav-menu").is_hidden()
    page.set_viewport_size({"width": 1199, "height": 800})
    page.locator("#nav-menu").wait_for()
    page.locator("#nav-menu").click()
    drawer(page).wait_for()
    page.set_viewport_size({"width": 1280, "height": 800})  # widening closes an open drawer
    drawer(page).wait_for(state="hidden")


def test_inspector_sheet_follows_the_selection_and_stays_as_the_user_left_it(servers, phone, world):
    page = phone
    open_editor(page, world.client, world.pid)
    sheet = page.locator("#inspector")
    toggle = page.locator("#sheet-toggle")
    assert "sheet-open" not in (sheet.get_attribute("class") or "")

    page.locator("#canvas [data-kind=furniture]").first.tap()
    expect(page.locator("#inspector")).to_have_class(re.compile(r"\bsheet-open\b"))
    expect(toggle).to_have_attribute("aria-expanded", "true")

    # Closed by hand while the item stays selected: an edit must not reopen it.
    toggle.tap()
    assert "sheet-open" not in sheet.get_attribute("class")
    page.locator("#rotate").tap()
    page.wait_for_timeout(200)
    assert "sheet-open" not in sheet.get_attribute("class")

    # Clearing the selection (tap on empty canvas) keeps it closed; a new selection opens it again.
    box = page.locator("#canvas").bounding_box()
    page.touchscreen.tap(box["x"] + 8, box["y"] + box["height"] - 8)
    page.locator("#canvas [data-kind=furniture]").first.tap()
    expect(page.locator("#inspector")).to_have_class(re.compile(r"\bsheet-open\b"))
    assert not overflows(page)


@pytest.mark.parametrize("width", [320, 390, 767, 768])
def test_no_page_scrolls_sideways_on_a_phone(servers, page, api, world, width):
    page.set_viewport_size({"width": width, "height": 800})
    pid = world.pid
    public = ["index.html", "auth.html", "auth.html?mode=signup&role=studio", "wizard.html"]
    client = ["projects.html", f"editor.html?project={pid}", f"design.html?project={pid}", f"consultant.html?project={pid}"]

    for target in public:
        page.goto(f"{SITE}/{target}")
        page.wait_for_load_state("networkidle")
        assert not overflows(page), target

    sign_in(page, world.client, client[0])
    for target in client:
        page.goto(f"{SITE}/{target}")
        page.wait_for_load_state("networkidle")
        assert not overflows(page), target

    page.context.clear_cookies()
    page.evaluate("localStorage.clear()")
    sign_in(page, world.designer, "studio.html")
    page.wait_for_load_state("networkidle")
    assert not overflows(page), "studio.html"


def test_long_names_and_markup_fit_a_320_px_screen(servers, page, api, make_user):
    designer = make_user("e2e-m-designer")
    studio_name = ("<i>Studio</i> " + "Supercalifragilistic" * 4)[:80]
    studio_data = api.post("/v1/studios", json={"name": studio_name}, headers=designer.headers).json()["data"]
    client = make_user("e2e-m-client")
    project_name = ("<b>Flat</b> " + "W" * 80)[:80]  # the longest name the API accepts, unbroken, with markup
    response = api.post(
        "/v1/projects", json={"studio_id": studio_data["id"], "name": project_name, "property_type": "existing"}, headers=client.headers
    )
    assert response.status_code == 201, response.text
    project = response.json()["data"]
    from tests.test_geometry import VALID

    api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers)

    page.set_viewport_size({"width": 320, "height": 700})
    page.goto(f"{SITE}/entry.html?studio={studio_data['slug']}")
    page.locator("h1").wait_for()
    assert not overflows(page)
    assert page.locator("h1 i").count() == 0

    sign_in(page, client, f"editor.html?project={project['id']}")
    page.locator("#canvas [data-kind=furniture]").first.wait_for(state="attached")
    for target in (f"editor.html?project={project['id']}", f"design.html?project={project['id']}", "projects.html"):
        page.goto(f"{SITE}/{target}")
        page.wait_for_load_state("networkidle")
        assert not overflows(page), target
        assert page.locator("h1 b, #crumb-name b, #context-name b").count() == 0, target  # markup stays text
