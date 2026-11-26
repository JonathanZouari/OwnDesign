"""Browser journeys for plan export (specs/plan-export.md): the client and the designer download the saved plan
from the editor in each format, choose an earlier version, see which saved version is exported when the canvas
has unsaved changes, and the export shows up in the studio's activity.

Starts the backend and the static frontend itself unless they are already running.
"""

import io

import ezdxf.recover
import pytest
from PIL import Image
from pypdf import PdfReader

from tests.conftest import needs_supabase
from tests.test_e2e import FRONTEND, SITE
from tests.test_e2e import servers  # noqa: F401  (fixture)
from tests.test_e2e_design import sign_in
from tests.test_export_api import two_rooms
from tests.test_geometry import VALID

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]


@pytest.fixture(scope="module")
def flat(api, make_user):
    designer, client = make_user("e2e-exp-designer"), make_user("e2e-exp-client")
    studio = api.post("/v1/studios", json={"name": "Export Studio"}, headers=designer.headers).json()["data"]
    project = api.post(
        "/v1/projects", json={"studio_id": studio["id"], "name": "Herzl 5 flat", "property_type": "existing"},
        headers=client.headers,
    ).json()["data"]
    base = f"/v1/projects/{project['id']}/versions"
    api.post(base, json={"label": "first sketch", "geometry": VALID}, headers=client.headers)
    api.post(base, json={"label": "two rooms", "geometry": two_rooms()}, headers=client.headers)
    return designer, client, project


def download(page, format_label: str, version_text: str | None = None, paper: str | None = None):
    page.get_by_role("button", name="Export plan").click()
    dialog = page.get_by_role("dialog", name="Export plan")
    dialog.get_by_label(format_label).check()
    if version_text:
        dialog.get_by_label("Saved version").select_option(label=version_text)
    if paper:
        dialog.get_by_label("Paper size").select_option(paper)
    with page.expect_download() as info:
        dialog.get_by_role("button", name="Download").click()
    file = info.value
    return file.suggested_filename, open(file.path(), "rb").read()


def test_client_exports_each_format_and_an_earlier_version(servers, page, flat):  # noqa: F811
    _, client, project = flat
    sign_in(page, client, f"editor.html?project={project['id']}")
    page.get_by_text("Saved · v2").wait_for()

    # The dialog preselects the latest saved version and offers the earlier one.
    page.get_by_role("button", name="Export plan").click()
    dialog = page.get_by_role("dialog", name="Export plan")
    version = dialog.get_by_label("Saved version")
    assert version.locator("option:checked").inner_text() == "v2 · client · two rooms"
    assert version.locator("option").all_inner_texts() == ["v2 · client · two rooms", "v1 · client · first sketch"]
    dialog.get_by_text("Exports saved version v2.").wait_for()
    # Paper size applies to PDF and PNG only.
    dialog.get_by_label("DXF for CAD").check()
    assert dialog.get_by_label("Paper size").is_hidden()
    dialog.get_by_label("PDF").check()
    assert dialog.get_by_label("Paper size").is_visible()
    dialog.get_by_role("button", name="Cancel").click()

    name, content = download(page, "PDF", paper="a3")
    assert name == "herzl-5-flat-v2.pdf"
    pdf = PdfReader(io.BytesIO(content))
    text = pdf.pages[0].extract_text()
    assert len(pdf.pages) == 1 and "Living room" in text and "Version 2" in text and "Scale not guaranteed" in text
    assert sorted([round(float(pdf.pages[0].mediabox.width)), round(float(pdf.pages[0].mediabox.height))]) == [842, 1191]
    page.get_by_text("Downloaded herzl-5-flat-v2.pdf").wait_for()

    name, content = download(page, "PNG image", paper="a4")  # the dialog keeps the last paper size (A3) otherwise
    image = Image.open(io.BytesIO(content))
    assert name == "herzl-5-flat-v2.png" and image.size == (3508, 2480)  # A4 landscape: the two rooms are wide

    name, content = download(page, "DXF for CAD", version_text="v1 · client · first sketch")
    assert name == "herzl-5-flat-v1.dxf"
    doc, auditor = ezdxf.recover.read(io.BytesIO(content))
    assert not auditor.has_errors
    assert len([e for e in doc.modelspace() if e.dxf.layer == "WALLS"]) == 3  # version 1, not version 2


def test_unsaved_changes_are_not_exported_and_the_dialog_says_so(servers, page, flat):  # noqa: F811
    _, client, project = flat
    sign_in(page, client, f"editor.html?project={project['id']}")
    page.get_by_text("Saved · v2").wait_for()
    page.locator("#canvas [data-kind=walls]").first.focus()
    page.keyboard.press("Delete")
    page.get_by_text("Unsaved changes").wait_for()

    page.get_by_role("button", name="Export plan").click()
    dialog = page.get_by_role("dialog", name="Export plan")
    dialog.get_by_text("Exports saved version v2. Unsaved changes on the canvas are not included.").wait_for()
    dialog.get_by_label("DXF for CAD").check()
    with page.expect_download() as info:
        dialog.get_by_role("button", name="Download").click()
    doc, _ = ezdxf.recover.read(io.BytesIO(open(info.value.path(), "rb").read()))
    assert len([e for e in doc.modelspace() if e.dxf.layer == "WALLS"]) == 8  # the saved walls, not the edited canvas


def test_designer_exports_and_sees_it_in_activity(servers, page, flat):  # noqa: F811
    designer, _, project = flat
    sign_in(page, designer, f"editor.html?project={project['id']}")
    page.get_by_text("Editing as designer").wait_for()
    name, content = download(page, "PDF")
    assert name == "herzl-5-flat-v2.pdf" and content.startswith(b"%PDF-")

    page.goto(f"{SITE}/studio.html")
    page.locator("#activity li").filter(has_text="Version 2 exported as PDF by the designer").first.wait_for()
    page.locator("#activity li").filter(has_text="exported as DXF by the client").first.wait_for()


def test_no_export_button_before_anything_is_saved(servers, page, api, make_user):  # noqa: F811
    designer, client = make_user("e2e-exp-d2"), make_user("e2e-exp-c2")
    studio = api.post("/v1/studios", json={"name": "Empty Export"}, headers=designer.headers).json()["data"]
    project = api.post("/v1/projects", json={"studio_id": studio["id"], "name": "Nothing yet", "property_type": "existing"},
                       headers=client.headers).json()["data"]
    sign_in(page, client, f"editor.html?project={project['id']}")
    page.get_by_text("Nothing saved yet", exact=True).wait_for()
    assert page.get_by_role("button", name="Export plan").is_hidden()
