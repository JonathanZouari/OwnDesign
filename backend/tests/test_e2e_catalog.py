"""Browser journeys of the product catalog: filter, sort, favorites, shopping list, export and approval.

The catalog is mock data kept in the browser; only the project itself comes from the backend.
"""

from pathlib import Path

import pytest

from tests.conftest import needs_supabase
from tests.test_e2e import FRONTEND, SITE, overflows
from tests.test_e2e_design import servers, sign_in, studio, world  # noqa: F401 (fixtures)

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]


def open_catalog(page, user, pid: str):
    sign_in(page, user, f"catalog.html?project={pid}")
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()


def tab(page, name: str):
    page.get_by_role("tab", name=name).click()


def names(page) -> list[str]:
    return page.locator("#grid h3").all_inner_texts()


def prices(page) -> list[int]:
    return [int("".join(filter(str.isdigit, t))) for t in page.locator("#grid article > strong").all_inner_texts()]


def add_sofa(page, color: str, quantity: str = "1"):
    tab(page, "Catalog")
    page.get_by_role("button", name="Add Modern Sofa to list").click()
    dialog = page.locator("#select-dialog")
    dialog.get_by_label(color, exact=True).check()
    dialog.get_by_label("3-seater").check()
    dialog.get_by_label("Quantity").fill(quantity)
    dialog.get_by_role("button", name="Add to shopping list").click()


def test_client_browses_builds_exports_and_approves(servers, page, world):
    open_catalog(page, world.client, world.pid)
    total = len(names(page))
    assert total >= 20

    page.get_by_label("Category").select_option("lighting")
    page.get_by_label("Colour").select_option("Black")
    page.locator("#f-max").fill("400")
    assert names(page) == ["Dome Pendant", "Wall Sconce"]
    page.get_by_label("Sort").select_option("price-asc")
    assert prices(page) == sorted(prices(page))
    page.get_by_label("Sort").select_option("price-desc")
    assert prices(page) == sorted(prices(page), reverse=True)
    page.locator("#f-min").fill("4000")  # drags the upper slider with it
    page.get_by_text("No products match these filters.").wait_for()
    page.get_by_role("button", name="Clear filters").click()
    page.locator("#grid article").nth(total - 1).wait_for()

    page.get_by_role("button", name="Favorite Modern Sofa").click()
    tab(page, "Favorites")
    assert page.locator("#fav-grid h3").all_inner_texts() == ["Modern Sofa"]
    tab(page, "Shopping list")
    assert page.locator("#list li").count() == 0
    assert page.locator("#approve").is_disabled() and page.locator("#export-csv").is_disabled()

    # A missing choice or an out-of-range quantity keeps the dialog open and adds nothing.
    tab(page, "Catalog")
    page.get_by_role("button", name="Add Modern Sofa to list").click()
    dialog = page.locator("#select-dialog")
    dialog.get_by_role("button", name="Add to shopping list").click()
    assert dialog.is_visible()
    dialog.get_by_role("button", name="Cancel").click()
    assert not dialog.is_visible()

    add_sofa(page, "Beige")
    add_sofa(page, "Black")
    add_sofa(page, "Beige")
    tab(page, "Shopping list")
    assert page.locator("#list li").count() == 2
    assert page.locator("#list .qty").all_inner_texts() == ["2", "1"]
    assert page.locator("#list .shop-line-total").all_inner_texts() == ["$9,000", "$4,500"]
    assert page.locator("#list-total").inner_text() == "$13,500"
    assert page.get_by_role("button", name="Decrease quantity of Modern Sofa, Black").is_disabled()

    with page.expect_download() as download:
        page.get_by_role("button", name="Export CSV").click()
    assert download.value.suggested_filename == "shopping-list-design-flat.csv"
    rows = Path(download.value.path()).read_text(encoding="utf-8-sig").splitlines()
    assert rows[0] == "Product ID,Product Name,Category,Color,Size,Quantity,Unit Price,Line Total"
    assert rows[1] == "FUR-001,Modern Sofa,Furniture,Beige,3-seater,2,4500,9000"
    assert rows[-1] == "TOTAL,,,,,,,13500"

    # PDF is the browser's print: only the list, with product ids and the status, even from another tab.
    page.get_by_role("button", name="Approve list").click()
    assert page.locator("#list-status").inner_text() == "Approved"
    tab(page, "Catalog")
    page.emulate_media(media="print")
    assert page.get_by_text("FUR-001 · Furniture").first.is_visible()
    assert page.get_by_text("Status: Approved").is_visible()
    assert not page.locator("#grid").is_visible() and not page.locator(".appbar").is_visible()
    page.emulate_media(media="screen")

    page.reload()
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()
    tab(page, "Shopping list")
    assert page.locator("#list-status").inner_text() == "Approved"
    page.get_by_role("button", name="Increase quantity of Modern Sofa, Black").click()
    assert page.locator("#list-status").inner_text() == "Draft"
    page.get_by_text("Changed since approval, back to Draft.").wait_for()
    page.get_by_role("button", name="Remove Modern Sofa, Black").click()
    assert page.locator("#list-total").inner_text() == "$9,000"


def test_designer_sees_status_without_approving_on_a_phone(servers, page, world):
    page.set_viewport_size({"width": 375, "height": 800})
    open_catalog(page, world.designer, world.pid)
    assert not overflows(page)
    add_sofa(page, "Red")
    tab(page, "Shopping list")
    assert page.locator("#list-status").inner_text() == "Draft"
    assert not page.locator("#approve").is_visible()
    assert not overflows(page)


def test_tampered_storage_and_bad_addresses(servers, page, make_user, world):
    open_catalog(page, world.client, world.pid)
    page.evaluate(
        """pid => localStorage.setItem(`od.shop.${pid}`, JSON.stringify(
            {favorites: ['<img src=x>'], status: 'approved', items: [{productId: 'NOPE', quantity: 5}]}))""",
        world.pid,
    )
    page.reload()
    page.get_by_role("heading", name="Design Flat", level=1).wait_for()
    tab(page, "Shopping list")
    assert page.locator("#list li").count() == 0
    assert page.locator("#list-status").inner_text() == "Draft"

    page.goto(f"{SITE}/catalog.html?project=..")
    page.wait_for_url(f"{SITE}/projects.html")

    stranger = make_user("e2e-catalog-stranger")
    page.context.clear_cookies()
    page.evaluate("localStorage.clear()")
    sign_in(page, stranger, f"catalog.html?project={world.pid}")
    page.locator("#toasts .error").wait_for()
    assert not page.locator("#shop").is_visible()
