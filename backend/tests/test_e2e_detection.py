"""Browser journeys for existing-item detection (specs/item-detection.md), with the real model.

A client uploads a photo of their living room as "Item I own", detects the items, keeps some of them, and finds
them in the brief and under "My items" in the editor palette; the designer sees them and the studio activity.
Skipped when the model is not in this Supabase project's `models` bucket (scripts/publish_model.py).
"""

import pytest

from app.detection.model import BUCKET, MODEL_OBJECT
from tests.conftest import needs_supabase
from tests.test_e2e import FRONTEND, SITE
from tests.test_e2e import servers  # noqa: F401  (fixture)
from tests.test_e2e_design import sign_in
from tests.test_geometry import VALID

PHOTO = FRONTEND.parent / "design" / "stitch" / "render-concept-a.jpg"

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]


@pytest.fixture(scope="module")
def flat(api, make_user, admin):
    if not any(item["name"] == MODEL_OBJECT for item in admin.storage.from_(BUCKET).list()):
        pytest.skip("detection model not uploaded to this Supabase project")
    designer, client = make_user("e2e-det-designer"), make_user("e2e-det-client")
    studio = api.post("/v1/studios", json={"name": "Detection Studio"}, headers=designer.headers).json()["data"]
    project = api.post("/v1/projects", json={"studio_id": studio["id"], "name": "Living room flat", "property_type": "existing"},
                       headers=client.headers).json()["data"]
    api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers)
    return designer, client, project


def test_client_detects_keeps_items_and_places_one(servers, page, flat):  # noqa: F811
    _, client, project = flat
    pid = project["id"]
    sign_in(page, client, f"design.html?project={pid}")
    page.get_by_role("tab", name="Moodboard").click()
    page.get_by_label("Image (JPEG, PNG or WebP, up to 5 MB)").set_input_files(str(PHOTO))
    page.get_by_label("This image shows").select_option("existing_item")
    page.get_by_role("button", name="Upload image").click()

    # Inspiration images have no detection; the photo of my own items has.
    page.get_by_role("button", name="Detect items in image Item I own").click()
    dialog = page.get_by_role("dialog", name="Items in this photo")
    dialog.locator("#detect-list li").first.wait_for(timeout=60_000)
    labels = dialog.locator("#detect-list label").all_inner_texts()
    assert {"Sofa", "Chair", "Table"} <= set(labels)
    assert dialog.get_by_role("checkbox", name="Sofa", exact=True).is_checked()
    assert dialog.locator(".detect-box").count() >= 3

    # Keep the sofa and the chairs, not the table.
    dialog.get_by_role("checkbox", name="Table", exact=True).uncheck()
    dialog.get_by_role("button", name="Add to brief").click()
    page.get_by_text("Added to your brief").wait_for()

    page.goto(f"{SITE}/design.html?project={pid}#brief")
    page.reload()
    page.locator("#owned-items li").first.wait_for()  # the page fills the brief once its data has loaded
    brief = page.get_by_label("Existing items").input_value()
    assert brief.startswith("From a photo: ") and "Sofa" in brief and "Table" not in brief
    mine = page.locator("#owned-items li").all_inner_texts()
    assert any(text.startswith("Sofa") for text in mine) and not any(text.startswith("Table") for text in mine)

    # In the editor the sofa is offered under "My items" and placed like any furniture.
    page.goto(f"{SITE}/editor.html?project={pid}")
    page.get_by_text("Saved · v1").wait_for()
    page.get_by_role("button", name="Furniture catalog").click()
    group = page.get_by_role("group", name="My items")
    assert "Table" not in group.inner_text()
    before = page.locator("#canvas [data-kind=furniture]").count()
    group.get_by_role("button", name="My sofa").click()
    page.locator("#canvas").focus()
    page.keyboard.press("Enter")
    page.wait_for_function(f"document.querySelectorAll('#canvas [data-kind=furniture]').length === {before + 1}")


def test_designer_sees_the_items_and_the_activity(servers, page, flat):  # noqa: F811
    designer, _, project = flat
    sign_in(page, designer, f"design.html?project={project['id']}")
    page.locator("#owned-items li").first.wait_for()
    assert any(text.startswith("Sofa") for text in page.locator("#owned-items li").all_inner_texts())
    page.goto(f"{SITE}/studio.html")
    page.locator("#activity li").filter(has_text="added to the brief").first.wait_for()
    page.locator("#activity li").filter(has_text="Items detected in a photo").first.wait_for()


def test_client_removes_an_item(servers, page, flat):  # noqa: F811
    _, client, project = flat
    sign_in(page, client, f"design.html?project={project['id']}")
    page.locator("#owned-items li").first.wait_for()
    count = page.locator("#owned-items li").count()
    page.get_by_role("button", name="Remove Sofa from my items").click()
    page.get_by_text("Removed Sofa from my items").wait_for()
    assert page.locator("#owned-items li").count() == count - 1
    page.reload()
    assert not any(text.startswith("Sofa") for text in page.locator("#owned-items li").all_inner_texts())
