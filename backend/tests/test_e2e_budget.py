"""Browser journeys of the budget / shopping list page (budget.html).

Uses the `servers` fixture of test_e2e_design (it reuses servers that are already running).
"""

import re
from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase
from tests.test_e2e import FRONTEND, SITE, overflows
from tests.test_e2e_design import servers, sign_in  # noqa: F401  (servers is a fixture)
from tests.test_geometry import VALID

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]

BRIEF = {
    "styles": [], "colors": [], "budget_min": None, "budget_max": None, "currency": "ILS", "adults": 1, "children": 0,
    "pets": False, "lifestyle": "", "needs": "", "constraints": "", "existing_items": "",
}  # fmt: skip

SAMPLE_BUTTON = "Load sample list"


def digits(text: str) -> int:
    return int(re.sub(r"\D", "", text))


def line(quantity, price) -> int:
    return int((Decimal(str(quantity)) * price).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def rows(page):
    return page.locator("#rows > tr")


def field(page, index: int, name: str):
    """Text inputs of a row, in order: name, room, quantity, unit price."""
    return rows(page).nth(index).locator("input").nth({"name": 0, "room": 1, "quantity": 2, "price": 3}[name])


def total(page) -> int:
    return digits(page.locator("#grand-total").inner_text())


def open_budget(page, user, pid: str):
    sign_in(page, user, f"budget.html?project={pid}")
    page.locator("#budget").wait_for()


@pytest.fixture(scope="module")
def sample(api, make_user):
    user = make_user("e2e-b-sample")
    data = api.get("/v1/estimate/sample", headers=user.headers).json()["data"]
    assert len(data["items"]) == 25
    return SimpleNamespace(currency=data["currency"], items=data["items"], total=sum(line(i["quantity"], i["unit_price"]) for i in data["items"]))


@pytest.fixture(scope="module")
def studio(api, make_user):
    designer = make_user("e2e-b-studio")
    data = api.post("/v1/studios", json={"name": "Budget Studio"}, headers=designer.headers).json()["data"]
    return SimpleNamespace(designer=designer, id=data["id"])


@pytest.fixture
def flat(api, make_user, studio):
    """A client of the studio with one project and nothing saved on it."""
    client = make_user("e2e-b-client")
    body = {"studio_id": studio.id, "name": "Budget Flat", "property_type": "existing"}
    project = api.post("/v1/projects", json=body, headers=client.headers).json()["data"]
    return SimpleNamespace(client=client, designer=studio.designer, pid=project["id"], base=f"/v1/projects/{project['id']}")


def put_items(api, flat, items, currency="ILS"):
    base = {"category": "furniture", "name": "x", "room": None, "quantity": 1, "unit": "unit", "unit_price": 100, "source": "user", "note": None}
    response = api.put(f"{flat.base}/estimate", json={"currency": currency, "items": [base | i for i in items]}, headers=flat.client.headers)
    assert response.status_code == 200, response.text


def test_client_builds_edits_and_saves_the_list(servers, page, api, flat, sample):
    sign_in(page, flat.client, "projects.html")
    page.get_by_role("link", name="Budget of Budget Flat").click()
    page.wait_for_url(f"{SITE}/budget.html?project={flat.pid}")
    page.locator("#budget").wait_for()

    assert page.get_by_role("heading", name="Budget Flat", level=1).is_visible()
    assert "Non-binding estimate" in page.locator(".disclaimer").inner_text()
    assert "Synthetic prices" in page.locator(".disclaimer").inner_text()
    assert page.locator("#empty").is_visible() and page.locator("#table-wrap").is_hidden()
    assert page.locator("#export").is_disabled()

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    rows(page).first.wait_for()
    assert rows(page).count() == 25
    assert page.locator("#currency").input_value() == sample.currency
    assert total(page) == sample.total

    # Editing a row updates its amount and the total before saving.
    first = sample.items[0]
    field(page, 0, "quantity").fill("3")
    field(page, 0, "price").fill("1000")
    assert digits(rows(page).nth(0).locator("td.num").inner_text()) == 3000
    expected = sample.total - line(first["quantity"], first["unit_price"]) + 3000
    assert total(page) == expected
    assert page.locator("#save-status").inner_text() == "Unsaved changes"

    # Delete the last row, add a new one.
    last = sample.items[-1]
    rows(page).nth(24).locator("button.danger").click()
    assert rows(page).count() == 24
    expected -= line(last["quantity"], last["unit_price"])
    assert total(page) == expected
    page.get_by_role("button", name="Add row").click()
    assert rows(page).count() == 25
    field(page, 24, "name").fill("Reading lamp")
    field(page, 24, "quantity").fill("2")
    field(page, 24, "price").fill("250")
    expected += 500
    assert total(page) == expected

    page.get_by_role("button", name="Save", exact=True).click()
    page.locator("#save-status").get_by_text("All changes saved").wait_for()

    page.reload()
    page.locator("#budget").wait_for()
    assert rows(page).count() == 25
    assert total(page) == expected
    assert field(page, 24, "name").input_value() == "Reading lamp"
    assert field(page, 0, "quantity").input_value() == "3"
    stored = api.get(f"{flat.base}/estimate", headers=flat.client.headers).json()["data"]
    assert stored["totals"]["total"] == expected and len(stored["items"]) == 25


def test_load_sample_asks_for_confirmation_when_items_exist(servers, page, api, flat, sample):
    put_items(api, flat, [{"name": "Mine A"}, {"name": "Mine B"}])
    open_budget(page, flat.client, flat.pid)
    assert rows(page).count() == 2

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    assert "Replace the list?" in dialog.inner_text()
    dialog.get_by_role("button", name="Cancel").click()
    assert page.get_by_role("alertdialog").is_hidden()
    assert rows(page).count() == 2 and field(page, 0, "name").input_value() == "Mine A"

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    dialog.wait_for()
    page.keyboard.press("Escape")  # Escape cancels as well
    assert page.get_by_role("alertdialog").is_hidden() and rows(page).count() == 2

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    dialog.get_by_role("button", name="Replace").click()
    page.locator("#rows > tr:nth-child(25)").wait_for()
    assert rows(page).count() == 25 and total(page) == sample.total
    # Replaced only in the page until saved.
    assert len(api.get(f"{flat.base}/estimate", headers=flat.client.headers).json()["data"]["items"]) == 2


def test_budget_comparison_statuses(servers, page, api, flat):
    put_items(api, flat, [{"name": "Sofa", "quantity": 2, "unit_price": 1000}])  # total 2000 ILS

    def brief(**changes):
        return api.put(f"/v1/projects/{flat.pid}/brief", json=BRIEF | changes, headers=flat.client.headers)

    assert brief(budget_min=100, budget_max=1500).status_code == 200
    open_budget(page, flat.client, flat.pid)
    text = page.locator("#compare-text").inner_text()
    assert "Over budget" in text and digits(text) == 500
    assert page.locator("#compare-tag").inner_text() == "Over budget"

    assert brief(budget_min=1500, budget_max=2500).status_code == 200
    page.reload()
    page.locator("#budget").wait_for()
    assert page.locator("#compare-text").inner_text() == "Within budget."

    assert brief(budget_min=1500, budget_max=2500, currency="USD").status_code == 200
    page.reload()
    page.locator("#budget").wait_for()
    text = page.locator("#compare-text").inner_text()
    assert "USD" in text and "ILS" in text and "not compared" in text
    assert page.locator("#brief-link").is_visible()


def test_export_csv(servers, page, api, flat):
    put_items(api, flat, [
        {"name": "=HYPERLINK(1)", "quantity": 2, "unit_price": 300, "room": "Salon"},
        {"name": "Normal chair", "quantity": 1.5, "unit_price": 200},
    ])  # fmt: skip
    open_budget(page, flat.client, flat.pid)
    with page.expect_download() as info:
        page.get_by_role("button", name="Export CSV").click()
    with open(info.value.path(), "rb") as handle:
        raw = handle.read()
    assert raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("Item,Category,Room,Quantity,Unit,Unit price,Amount (ILS),Note")
    assert "'=HYPERLINK(1)" in text and "\n=HYPERLINK" not in text
    assert "Normal chair" in text and "Salon" in text
    last = [ln for ln in text.splitlines() if ln.strip()][-1]
    assert last.startswith("Total") and "900" in last  # 600 + 300
    assert info.value.suggested_filename == "budget-Budget-Flat.csv"


def test_invalid_input_blocks_saving_and_markup_stays_text(servers, page, api, flat):
    put_items(api, flat, [{"name": "Table"}])
    puts = []
    page.on("request", lambda r: puts.append(r.url) if r.method == "PUT" and "/estimate" in r.url else None)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    open_budget(page, flat.client, flat.pid)
    save = page.get_by_role("button", name="Save", exact=True)

    cases = (
        ("0", "Quantity must be a number above zero."),
        ("1.234", "Quantity can have at most two decimal places."),
        ("", "Quantity must be a number above zero."),
    )
    for bad, message in cases:
        field(page, 0, "quantity").fill(bad)
        assert rows(page).nth(0).locator(".field-error:not([hidden])").inner_text() == message
        assert field(page, 0, "quantity").get_attribute("aria-invalid") == "true"
        save.click()
        page.locator(".toast.error").first.wait_for()
    field(page, 0, "quantity").fill("1")
    field(page, 0, "name").fill("   ")
    assert "Enter a name." in rows(page).nth(0).inner_text()
    save.click()
    page.wait_for_timeout(300)
    assert puts == []
    assert api.get(f"{flat.base}/estimate", headers=flat.client.headers).json()["data"]["items"][0]["name"] == "Table"

    markup = "<img src=x onerror=alert(1)>"
    field(page, 0, "name").fill(markup)
    save.click()
    page.locator("#save-status").get_by_text("All changes saved").wait_for()
    assert len(puts) == 1
    page.reload()
    page.locator("#budget").wait_for()
    assert field(page, 0, "name").input_value() == markup
    assert page.locator("#budget img").count() == 0
    assert dialogs == []


def test_stranger_and_signed_out_visitor(servers, page, api, make_user, flat):
    put_items(api, flat, [{"name": "Secret sofa"}])
    stranger = make_user("e2e-b-stranger")
    sign_in(page, stranger, f"budget.html?project={flat.pid}")
    page.locator(".toast.error").wait_for()
    assert "Project not found" in page.locator(".toast.error").inner_text()
    assert page.locator("#budget").is_hidden()
    content = page.content()
    assert "Secret sofa" not in content and "Budget Flat" not in content
    page.get_by_role("button", name="Sign out").click()
    page.wait_for_url("**/index.html")

    page.goto(f"{SITE}/budget.html?project={flat.pid}")
    page.wait_for_url("**/auth.html?next=*")
    assert "Secret sofa" not in page.content()

    # A malformed project id never reaches the API.
    sign_in(page, stranger, "projects.html")
    page.goto(f"{SITE}/budget.html?project=not-a-uuid")
    page.wait_for_url("**/projects.html")


def test_studio_designer_sees_the_clients_list(servers, page, api, flat):
    assert api.post(f"{flat.base}/versions", json={"geometry": VALID}, headers=flat.client.headers).status_code == 201
    put_items(api, flat, [{"name": "Pendant", "category": "lighting", "quantity": 2, "unit_price": 400}])

    open_budget(page, flat.designer, flat.pid)
    assert page.get_by_role("heading", name="Budget Flat", level=1).is_visible()
    assert rows(page).count() == 1 and field(page, 0, "name").input_value() == "Pendant"
    assert total(page) == 800
    assert page.locator("#studio-brand").inner_text() == "Budget Studio"
    assert page.locator("#nav-projects").get_attribute("href") == "studio.html"


def test_suspended_studio_refuses_the_save_and_keeps_the_typed_list(servers, page, api, make_user, admin):
    designer, client = make_user("e2e-b-sus-d"), make_user("e2e-b-sus-c")
    studio = api.post("/v1/studios", json={"name": "Paused Studio"}, headers=designer.headers).json()["data"]
    body = {"studio_id": studio["id"], "name": "Paused Flat", "property_type": "existing"}
    project = api.post("/v1/projects", json=body, headers=client.headers).json()["data"]
    admin.table("studios").update({"status": "suspended"}).eq("id", studio["id"]).execute()
    open_budget(page, client, project["id"])
    page.get_by_role("button", name="Add row").click()
    field(page, 0, "name").fill("Chair")
    page.locator("#currency").select_option("ILS")
    page.get_by_role("button", name="Save", exact=True).click()
    page.locator(".toast.error").get_by_text("This studio is not active").wait_for()
    assert field(page, 0, "name").input_value() == "Chair"
    assert page.locator("#save-status").inner_text() == "Unsaved changes"
    assert page.get_by_role("button", name="Save", exact=True).is_enabled()


@pytest.mark.parametrize("target", ["design.html", "consultant.html", "editor.html"])
def test_budget_is_linked_from_the_project_pages(servers, page, flat, api, target):
    assert api.post(f"{flat.base}/versions", json={"geometry": VALID}, headers=flat.client.headers).status_code == 201
    sign_in(page, flat.client, f"{target}?project={flat.pid}")
    link = page.locator(f'a[href="budget.html?project={flat.pid}"]:visible')
    link.first.wait_for()
    if target == "editor.html":
        # Below 1200 px the sidebar is hidden and the header tab takes over, without widening the page.
        for width in (768, 900, 1199):
            page.set_viewport_size({"width": width, "height": 800})
            assert page.locator("#tab-budget").is_visible()
            assert not overflows(page), width
    link = page.locator(f'a[href="budget.html?project={flat.pid}"]:visible').first
    link.click()
    page.wait_for_url(f"{SITE}/budget.html?project={flat.pid}")
    page.locator("#budget").wait_for()
    assert page.locator("#nav-budget").get_attribute("aria-current") == "page"


def test_print_view_hides_the_controls(servers, page, api, flat):
    put_items(api, flat, [{"name": "Sofa"}])
    open_budget(page, flat.client, flat.pid)
    page.emulate_media(media="print")
    for selector in (".appbar", ".project-nav", "#save", "#add-row", "#rows button.danger"):
        assert page.locator(selector).first.is_hidden(), selector
    assert page.locator("#grand-total").is_visible() and page.locator(".disclaimer").is_visible()


def test_no_horizontal_overflow_on_a_phone(servers, page, api, flat, sample):
    put_items(api, flat, [{"name": "A very long item name that keeps going and going", "room": "A long room name too"}])
    page.set_viewport_size({"width": 375, "height": 800})
    open_budget(page, flat.client, flat.pid)
    assert not overflows(page)
    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    page.get_by_role("alertdialog").get_by_role("button", name="Replace").click()
    page.locator("#rows > tr:nth-child(25)").wait_for()
    assert not overflows(page)


# ---- CSV import --------------------------------------------------------------------------------------

IMPORT_BUTTON = "Import CSV"
CSV_HEADER = "Item,Category,Room,Quantity,Unit,Unit price,Amount (ILS),Note"
SAMPLE_FILE = FRONTEND / "samples" / "shopping-list-example.csv"


def csv_bytes(*lines: str, encoding: str = "utf-8-sig") -> bytes:
    return ("\r\n".join(lines) + "\r\n").encode(encoding)


def choose_file(page, content: bytes, name: str = "list.csv"):
    """Goes through the button and the file chooser, as a user does."""
    with page.expect_file_chooser() as info:
        page.get_by_role("button", name=IMPORT_BUTTON).click()
    info.value.set_files({"name": name, "mimeType": "text/csv", "buffer": content})


def import_report(page):
    return page.locator("#import-report")


def stored_items(api, flat) -> list[dict]:
    return api.get(f"{flat.base}/estimate", headers=flat.client.headers).json()["data"]["items"]


def test_import_replaces_the_list_after_confirmation_and_saves(servers, page, api, flat):
    put_items(api, flat, [{"name": "Old chair"}])
    open_budget(page, flat.client, flat.pid)
    assert "template" in page.locator("#import-hint").inner_text()
    assert page.locator("#import-file").get_attribute("accept") == ".csv,text/csv"
    content = SAMPLE_FILE.read_bytes()

    choose_file(page, content)
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    assert "Replace the list?" in dialog.inner_text() and "6" in dialog.inner_text()
    assert page.get_by_role("button", name=IMPORT_BUTTON).is_disabled()
    assert page.get_by_role("button", name=SAMPLE_BUTTON).is_disabled()
    dialog.get_by_role("button", name="Cancel").click()
    assert rows(page).count() == 1 and field(page, 0, "name").input_value() == "Old chair"
    assert page.locator("#save-status").inner_text() == "All changes saved"
    assert page.get_by_role("button", name=IMPORT_BUTTON).is_enabled()

    choose_file(page, content)  # the same file again must work
    dialog.get_by_role("button", name="Replace").click()
    page.locator("#rows > tr:nth-child(6)").wait_for()
    assert rows(page).count() == 6 and total(page) == 13026
    assert "6 items imported" in import_report(page).inner_text()
    assert page.locator("#save-status").inner_text() == "Unsaved changes"
    assert [i["name"] for i in stored_items(api, flat)] == ["Old chair"]  # nothing saved yet

    page.get_by_role("button", name="Save", exact=True).click()
    page.locator("#save-status").get_by_text("All changes saved").wait_for()
    assert import_report(page).inner_text() == ""
    page.reload()
    page.locator("#budget").wait_for()
    assert rows(page).count() == 6 and total(page) == 13026
    assert field(page, 1, "name").input_value() == "Oak parquet floor"
    saved = stored_items(api, flat)
    assert [i["source"] for i in saved] == ["user"] * 6
    assert saved[1]["unit"] == "m2" and saved[1]["note"] == "Installation included"


def test_export_then_import_round_trips(servers, page, api, flat):
    put_items(api, flat, [
        {"name": '=Table, "big"', "quantity": 2.35, "unit_price": 1200, "room": "Salon café 北", "note": "a, b\nc", "source": "synthetic"},
        {"name": "-minus", "category": "lighting", "unit": "set", "quantity": 1, "unit_price": 0},
    ])  # fmt: skip
    before = stored_items(api, flat)
    open_budget(page, flat.client, flat.pid)
    with page.expect_download() as info:
        page.get_by_role("button", name="Export CSV").click()
    with open(info.value.path(), "rb") as handle:
        exported = handle.read()
    field(page, 0, "name").fill("changed")

    choose_file(page, exported)
    page.get_by_role("alertdialog").get_by_role("button", name="Replace").click()
    import_report(page).get_by_text("2 items imported").wait_for()
    page.get_by_role("button", name="Save", exact=True).click()
    page.locator("#save-status").get_by_text("All changes saved").wait_for()

    kept = ("category", "name", "room", "quantity", "unit", "unit_price", "note")
    after = stored_items(api, flat)
    assert [[i[k] for k in kept] for i in after] == [[i[k] for k in kept] for i in before]


def test_invalid_file_shows_errors_and_keeps_the_list(servers, page, api, flat):
    put_items(api, flat, [{"name": "Keep me"}])
    open_budget(page, flat.client, flat.pid)
    bad = [",Furniture,,0,unit,1,,"] * 7  # two errors per row
    choose_file(page, csv_bytes(CSV_HEADER, "Good,Furniture,,1,unit,10,,", *bad))
    report = import_report(page)
    report.locator(".error").wait_for()
    assert report.get_attribute("aria-live") == "polite"
    assert "the list was not changed" in report.inner_text()
    lines = report.locator("li").all_inner_texts()
    assert len(lines) == 11 and lines[0] == "Line 3: Enter a name."
    assert lines[-1] == "And 4 more errors."
    assert page.get_by_role("alertdialog").is_hidden()
    assert rows(page).count() == 1 and field(page, 0, "name").input_value() == "Keep me"
    assert page.locator("#save-status").inner_text() == "All changes saved"

    for content, message in (
        (csv_bytes("Item,Quantity", "x,1"), 'Line 1: The column "Category" is missing.'),
        (b"", "The file is empty."),
        (csv_bytes(CSV_HEADER), "No items were found in the file."),
        (csv_bytes(CSV_HEADER, *["x,Furniture,,1,unit,1,,"] * 201), "Up to 200 items can be imported."),
    ):
        choose_file(page, content)
        report.get_by_text(message).wait_for()
    assert rows(page).count() == 1

    # A successful import afterwards clears the errors.
    choose_file(page, csv_bytes(CSV_HEADER, "Good,Furniture,,1,unit,10,,"))
    page.get_by_role("alertdialog").get_by_role("button", name="Replace").click()
    report.get_by_text("1 item imported from the file.").wait_for()
    assert report.locator(".error").count() == 0


def test_binary_and_oversized_files_are_rejected(servers, page, api, flat):
    open_budget(page, flat.client, flat.pid)
    choose_file(page, b"PK\x03\x04\x14\x00\x00\x00" + bytes(200), name="list.xlsx")
    import_report(page).get_by_text("CSV UTF-8").wait_for()
    choose_file(page, b"a" * (1024 * 1024 + 1))
    import_report(page).get_by_text("The file is too large").wait_for()
    assert rows(page).count() == 0 and page.locator("#empty").is_visible()


def test_windows_1252_file_and_currency_choice(servers, page, api, flat):
    open_budget(page, flat.client, flat.pid)
    assert page.locator("#currency").input_value() == ""
    # Excel's plain CSV: windows-1252, semicolons, no currency in the amount header. An empty list needs no confirmation.
    content = csv_bytes("Item;Category;Quantity;Unit;Unit price", "Café tile “A” €;Finishes;12;m²;1,200", encoding="cp1252")
    choose_file(page, content)
    rows(page).first.wait_for()
    assert page.get_by_role("alertdialog").is_hidden()
    assert field(page, 0, "name").input_value() == "Café tile “A” €" and total(page) == 14400
    assert page.locator("#currency").input_value() == "ILS"
    assert "shekels (ILS)" in import_report(page).inner_text()

    # A currency that is already selected stays, and the user is told the file says otherwise.
    page.locator("#currency").select_option("USD")
    choose_file(page, SAMPLE_FILE.read_bytes())
    page.get_by_role("alertdialog").get_by_role("button", name="Replace").click()
    import_report(page).get_by_text("Prices were not converted").wait_for()
    assert page.locator("#currency").input_value() == "USD"


def test_currency_comes_from_the_file_or_the_brief(servers, page, api, flat):
    response = api.put(f"{flat.base}/brief", json=BRIEF | {"budget_max": 100, "currency": "EUR"}, headers=flat.client.headers)
    assert response.status_code == 200
    open_budget(page, flat.client, flat.pid)
    choose_file(page, csv_bytes(CSV_HEADER.replace(" (ILS)", ""), "x,Furniture,,1,unit,1,,"))
    import_report(page).get_by_text("from the brief: EUR").wait_for()
    assert page.locator("#currency").input_value() == "EUR"

    page.once("dialog", lambda d: d.accept())  # leaving with unsaved changes
    page.reload()
    page.locator("#budget").wait_for()
    choose_file(page, csv_bytes(CSV_HEADER.replace("ILS", "GBP"), "x,Furniture,,1,unit,1,,"))
    import_report(page).get_by_text("from the file: GBP").wait_for()
    assert page.locator("#currency").input_value() == "GBP"


def test_imported_markup_stays_text(servers, page, api, flat):
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    open_budget(page, flat.client, flat.pid)
    markup = "<img src=x onerror=alert(1)>"
    choose_file(page, csv_bytes(CSV_HEADER, f"{markup},Furniture,<b>room</b>,1,unit,1,,"))
    rows(page).first.wait_for()
    assert field(page, 0, "name").input_value() == markup
    choose_file(page, csv_bytes(f"{markup},<b>x</b>", "x,y"))  # a bad file made of markup
    import_report(page).locator(".error").wait_for()
    page.get_by_role("button", name="Save", exact=True).click()
    page.locator("#save-status").get_by_text("All changes saved").wait_for()
    assert stored_items(api, flat)[0]["name"] == markup
    assert page.locator("#budget img").count() == 0 and page.locator("#budget b").count() == 0
    assert dialogs == []


def test_import_has_no_horizontal_overflow_on_a_phone(servers, page, api, flat):
    page.set_viewport_size({"width": 375, "height": 800})
    open_budget(page, flat.client, flat.pid)
    assert not overflows(page)
    choose_file(page, csv_bytes("x" * 300, "y"))
    import_report(page).locator(".error").wait_for()
    assert not overflows(page)
    choose_file(page, SAMPLE_FILE.read_bytes())
    page.locator("#rows > tr:nth-child(6)").wait_for()
    assert not overflows(page)
    choose_file(page, SAMPLE_FILE.read_bytes())
    page.get_by_role("alertdialog").wait_for()
    assert not overflows(page)
