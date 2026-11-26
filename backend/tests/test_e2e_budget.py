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

SAMPLE_BUTTON = "טעינת רשימת דוגמה"


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


@pytest.fixture
def solo(api, make_user):
    owner = make_user("e2e-b-solo")
    project = api.post("/v1/projects", json={"name": "Budget Flat", "property_type": "existing"}, headers=owner.headers).json()["data"]
    assert project["studio_id"] is None
    return SimpleNamespace(owner=owner, pid=project["id"], base=f"/v1/projects/{project['id']}")


def put_items(api, solo, items, currency="ILS"):
    base = {"category": "furniture", "name": "x", "room": None, "quantity": 1, "unit": "unit", "unit_price": 100, "source": "user", "note": None}
    response = api.put(f"{solo.base}/estimate", json={"currency": currency, "items": [base | i for i in items]}, headers=solo.owner.headers)
    assert response.status_code == 200, response.text


def test_homeowner_builds_edits_and_saves_the_list(servers, page, api, solo, sample):
    sign_in(page, solo.owner, "projects.html")
    page.get_by_role("link", name="תקציב של Budget Flat").click()
    page.wait_for_url(f"{SITE}/budget.html?project={solo.pid}")
    page.locator("#budget").wait_for()

    assert page.get_by_role("heading", name="Budget Flat", level=1).is_visible()
    assert "הערכה לא מחייבת" in page.locator(".disclaimer").inner_text()
    assert "סינתטיים" in page.locator(".disclaimer").inner_text()
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
    assert page.locator("#save-status").inner_text() == "יש שינויים שלא נשמרו"

    # Delete the last row, add a new one.
    last = sample.items[-1]
    rows(page).nth(24).locator("button.danger").click()
    assert rows(page).count() == 24
    expected -= line(last["quantity"], last["unit_price"])
    assert total(page) == expected
    page.get_by_role("button", name="הוספת שורה").click()
    assert rows(page).count() == 25
    field(page, 24, "name").fill("Reading lamp")
    field(page, 24, "quantity").fill("2")
    field(page, 24, "price").fill("250")
    expected += 500
    assert total(page) == expected

    page.get_by_role("button", name="שמירה", exact=True).click()
    page.locator("#save-status").get_by_text("הכול שמור").wait_for()

    page.reload()
    page.locator("#budget").wait_for()
    assert rows(page).count() == 25
    assert total(page) == expected
    assert field(page, 24, "name").input_value() == "Reading lamp"
    assert field(page, 0, "quantity").input_value() == "3"
    stored = api.get(f"{solo.base}/estimate", headers=solo.owner.headers).json()["data"]
    assert stored["totals"]["total"] == expected and len(stored["items"]) == 25


def test_load_sample_asks_for_confirmation_when_items_exist(servers, page, api, solo, sample):
    put_items(api, solo, [{"name": "Mine A"}, {"name": "Mine B"}])
    open_budget(page, solo.owner, solo.pid)
    assert rows(page).count() == 2

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    assert "להחליף את הרשימה?" in dialog.inner_text()
    dialog.get_by_role("button", name="ביטול").click()
    assert page.get_by_role("alertdialog").is_hidden()
    assert rows(page).count() == 2 and field(page, 0, "name").input_value() == "Mine A"

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    dialog.wait_for()
    page.keyboard.press("Escape")  # Escape cancels as well
    assert page.get_by_role("alertdialog").is_hidden() and rows(page).count() == 2

    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    dialog.get_by_role("button", name="החלפה").click()
    page.locator("#rows > tr:nth-child(25)").wait_for()
    assert rows(page).count() == 25 and total(page) == sample.total
    # Replaced only in the page until saved.
    assert len(api.get(f"{solo.base}/estimate", headers=solo.owner.headers).json()["data"]["items"]) == 2


def test_budget_comparison_statuses(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa", "quantity": 2, "unit_price": 1000}])  # total 2000 ILS

    def brief(**changes):
        return api.put(f"/v1/projects/{solo.pid}/brief", json=BRIEF | changes, headers=solo.owner.headers)

    assert brief(budget_min=100, budget_max=1500).status_code == 200
    open_budget(page, solo.owner, solo.pid)
    text = page.locator("#compare-text").inner_text()
    assert "חריגה מהתקציב" in text and digits(text) == 500
    assert page.locator("#compare-tag").inner_text() == "חריגה"

    assert brief(budget_min=1500, budget_max=2500).status_code == 200
    page.reload()
    page.locator("#budget").wait_for()
    assert page.locator("#compare-text").inner_text() == "בתוך התקציב."

    assert brief(budget_min=1500, budget_max=2500, currency="USD").status_code == 200
    page.reload()
    page.locator("#budget").wait_for()
    text = page.locator("#compare-text").inner_text()
    assert "USD" in text and "ILS" in text and "שונה" in text
    assert page.locator("#brief-link").is_visible()


def test_export_csv(servers, page, api, solo):
    put_items(api, solo, [
        {"name": "=HYPERLINK(1)", "quantity": 2, "unit_price": 300, "room": "Salon"},
        {"name": "Normal chair", "quantity": 1.5, "unit_price": 200},
    ])  # fmt: skip
    open_budget(page, solo.owner, solo.pid)
    with page.expect_download() as info:
        page.get_by_role("button", name="ייצוא ל-CSV").click()
    with open(info.value.path(), "rb") as handle:
        raw = handle.read()
    assert raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    assert text.splitlines()[0].startswith("פריט,קטגוריה,חדר,כמות,יחידה,מחיר ליחידה,סכום")
    assert "'=HYPERLINK(1)" in text and "\n=HYPERLINK" not in text
    assert "Normal chair" in text and "Salon" in text
    last = [ln for ln in text.splitlines() if ln.strip()][-1]
    assert last.startswith("סה״כ") and "900" in last  # 600 + 300
    assert info.value.suggested_filename == "budget-Budget-Flat.csv"


def test_invalid_input_blocks_saving_and_markup_stays_text(servers, page, api, solo):
    put_items(api, solo, [{"name": "Table"}])
    puts = []
    page.on("request", lambda r: puts.append(r.url) if r.method == "PUT" and "/estimate" in r.url else None)
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    open_budget(page, solo.owner, solo.pid)
    save = page.get_by_role("button", name="שמירה", exact=True)

    cases = (
        ("0", "הכמות חייבת להיות מספר גדול מאפס."),
        ("1.234", "הכמות יכולה לכלול עד שתי ספרות אחרי הנקודה."),
        ("", "הכמות חייבת להיות מספר גדול מאפס."),
    )
    for bad, message in cases:
        field(page, 0, "quantity").fill(bad)
        assert rows(page).nth(0).locator(".field-error:not([hidden])").inner_text() == message
        assert field(page, 0, "quantity").get_attribute("aria-invalid") == "true"
        save.click()
        page.locator(".toast.error").first.wait_for()
    field(page, 0, "quantity").fill("1")
    field(page, 0, "name").fill("   ")
    assert "יש להזין שם." in rows(page).nth(0).inner_text()
    save.click()
    page.wait_for_timeout(300)
    assert puts == []
    assert api.get(f"{solo.base}/estimate", headers=solo.owner.headers).json()["data"]["items"][0]["name"] == "Table"

    markup = "<img src=x onerror=alert(1)>"
    field(page, 0, "name").fill(markup)
    save.click()
    page.locator("#save-status").get_by_text("הכול שמור").wait_for()
    assert len(puts) == 1
    page.reload()
    page.locator("#budget").wait_for()
    assert field(page, 0, "name").input_value() == markup
    assert page.locator("#budget img").count() == 0
    assert dialogs == []


def test_stranger_and_signed_out_visitor(servers, page, api, make_user, solo):
    put_items(api, solo, [{"name": "Secret sofa"}])
    stranger = make_user("e2e-b-stranger")
    sign_in(page, stranger, f"budget.html?project={solo.pid}")
    page.locator(".toast.error").wait_for()
    assert "הפריט המבוקש לא נמצא" in page.locator(".toast.error").inner_text()
    assert page.locator("#budget").is_hidden()
    content = page.content()
    assert "Secret sofa" not in content and "Budget Flat" not in content
    page.get_by_role("button", name="התנתקות").click()
    page.wait_for_url("**/index.html")

    page.goto(f"{SITE}/budget.html?project={solo.pid}")
    page.wait_for_url("**/auth.html?next=*")
    assert "Secret sofa" not in page.content()

    # A malformed project id never reaches the API.
    sign_in(page, stranger, "projects.html")
    page.goto(f"{SITE}/budget.html?project=not-a-uuid")
    page.wait_for_url("**/projects.html")


def test_studio_designer_sees_the_clients_list(servers, page, api, make_user):
    designer = make_user("e2e-b-designer")
    studio = api.post("/v1/studios", json={"name": "Budget Studio"}, headers=designer.headers).json()["data"]
    client = make_user("e2e-b-client")
    project = api.post("/v1/projects", json={"studio_id": studio["id"], "name": "Client Flat", "property_type": "existing"}, headers=client.headers).json()["data"]
    assert api.post(f"/v1/projects/{project['id']}/versions", json={"geometry": VALID}, headers=client.headers).status_code == 201
    items = [{"category": "lighting", "name": "Pendant", "room": None, "quantity": 2, "unit": "unit", "unit_price": 400, "source": "user", "note": None}]
    assert api.put(f"/v1/projects/{project['id']}/estimate", json={"currency": "ILS", "items": items}, headers=client.headers).status_code == 200

    open_budget(page, designer, project["id"])
    assert page.get_by_role("heading", name="Client Flat", level=1).is_visible()
    assert rows(page).count() == 1 and field(page, 0, "name").input_value() == "Pendant"
    assert total(page) == 800
    assert page.locator("#studio-brand").inner_text() == "Budget Studio"
    assert page.locator("#nav-projects").get_attribute("href") == "studio.html"


def test_no_horizontal_overflow_on_a_phone(servers, page, api, solo, sample):
    put_items(api, solo, [{"name": "A very long item name that keeps going and going", "room": "A long room name too"}])
    page.set_viewport_size({"width": 375, "height": 800})
    open_budget(page, solo.owner, solo.pid)
    assert not overflows(page)
    page.get_by_role("button", name=SAMPLE_BUTTON).click()
    page.get_by_role("alertdialog").get_by_role("button", name="החלפה").click()
    page.locator("#rows > tr:nth-child(25)").wait_for()
    assert not overflows(page)


# ---- CSV import --------------------------------------------------------------------------------------

IMPORT_BUTTON = "ייבוא מקובץ CSV"
CSV_HEADER = "פריט,קטגוריה,חדר,כמות,יחידה,מחיר ליחידה,סכום (ILS),הערה"
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


def stored_items(api, solo) -> list[dict]:
    return api.get(f"{solo.base}/estimate", headers=solo.owner.headers).json()["data"]["items"]


def test_import_replaces_the_list_after_confirmation_and_saves(servers, page, api, solo):
    put_items(api, solo, [{"name": "Old chair"}])
    open_budget(page, solo.owner, solo.pid)
    assert "תבנית" in page.locator("#import-hint").inner_text()
    assert page.locator("#import-file").get_attribute("accept") == ".csv,text/csv"
    content = SAMPLE_FILE.read_bytes()

    choose_file(page, content)
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    assert "להחליף את הרשימה?" in dialog.inner_text() and "6" in dialog.inner_text()
    assert page.get_by_role("button", name=IMPORT_BUTTON).is_disabled()
    assert page.get_by_role("button", name=SAMPLE_BUTTON).is_disabled()
    dialog.get_by_role("button", name="ביטול").click()
    assert rows(page).count() == 1 and field(page, 0, "name").input_value() == "Old chair"
    assert page.locator("#save-status").inner_text() == "הכול שמור"
    assert page.get_by_role("button", name=IMPORT_BUTTON).is_enabled()

    choose_file(page, content)  # the same file again must work
    dialog.get_by_role("button", name="החלפה").click()
    page.locator("#rows > tr:nth-child(6)").wait_for()
    assert rows(page).count() == 6 and total(page) == 13026
    assert "6 פריטים יובאו" in import_report(page).inner_text()
    assert page.locator("#save-status").inner_text() == "יש שינויים שלא נשמרו"
    assert [i["name"] for i in stored_items(api, solo)] == ["Old chair"]  # nothing saved yet

    page.get_by_role("button", name="שמירה", exact=True).click()
    page.locator("#save-status").get_by_text("הכול שמור").wait_for()
    assert import_report(page).inner_text() == ""
    page.reload()
    page.locator("#budget").wait_for()
    assert rows(page).count() == 6 and total(page) == 13026
    assert field(page, 1, "name").input_value() == "פרקט עץ אלון"
    saved = stored_items(api, solo)
    assert [i["source"] for i in saved] == ["user"] * 6
    assert saved[1]["unit"] == "m2" and saved[1]["note"] == "כולל התקנה"


def test_export_then_import_round_trips(servers, page, api, solo):
    put_items(api, solo, [
        {"name": '=Table, "big"', "quantity": 2.35, "unit_price": 1200, "room": "סלון", "note": "a, b\nc", "source": "synthetic"},
        {"name": "-minus", "category": "lighting", "unit": "set", "quantity": 1, "unit_price": 0},
    ])  # fmt: skip
    before = stored_items(api, solo)
    open_budget(page, solo.owner, solo.pid)
    with page.expect_download() as info:
        page.get_by_role("button", name="ייצוא ל-CSV").click()
    with open(info.value.path(), "rb") as handle:
        exported = handle.read()
    field(page, 0, "name").fill("changed")

    choose_file(page, exported)
    page.get_by_role("alertdialog").get_by_role("button", name="החלפה").click()
    import_report(page).get_by_text("2 פריטים יובאו").wait_for()
    page.get_by_role("button", name="שמירה", exact=True).click()
    page.locator("#save-status").get_by_text("הכול שמור").wait_for()

    kept = ("category", "name", "room", "quantity", "unit", "unit_price", "note")
    after = stored_items(api, solo)
    assert [[i[k] for k in kept] for i in after] == [[i[k] for k in kept] for i in before]


def test_invalid_file_shows_errors_and_keeps_the_list(servers, page, api, solo):
    put_items(api, solo, [{"name": "Keep me"}])
    open_budget(page, solo.owner, solo.pid)
    bad = [",רהיטים,,0,יחידה,1,,"] * 7  # two errors per row
    choose_file(page, csv_bytes(CSV_HEADER, "טוב,רהיטים,,1,יחידה,10,,", *bad))
    report = import_report(page)
    report.locator(".error").wait_for()
    assert report.get_attribute("aria-live") == "polite"
    assert "הרשימה לא השתנתה" in report.inner_text()
    lines = report.locator("li").all_inner_texts()
    assert len(lines) == 11 and lines[0] == "שורה 3: יש להזין שם."
    assert lines[-1] == "ועוד 4 שגיאות."
    assert page.get_by_role("alertdialog").is_hidden()
    assert rows(page).count() == 1 and field(page, 0, "name").input_value() == "Keep me"
    assert page.locator("#save-status").inner_text() == "הכול שמור"

    for content, message in (
        (csv_bytes("פריט,כמות", "x,1"), "שורה 1: חסרה העמודה ״קטגוריה״."),
        (b"", "הקובץ ריק."),
        (csv_bytes(CSV_HEADER), "לא נמצאו פריטים בקובץ."),
        (csv_bytes(CSV_HEADER, *["x,רהיטים,,1,יחידה,1,,"] * 201), "אפשר לייבא עד 200 פריטים."),
    ):
        choose_file(page, content)
        report.get_by_text(message).wait_for()
    assert rows(page).count() == 1

    # A successful import afterwards clears the errors.
    choose_file(page, csv_bytes(CSV_HEADER, "טוב,רהיטים,,1,יחידה,10,,"))
    page.get_by_role("alertdialog").get_by_role("button", name="החלפה").click()
    report.get_by_text("פריט אחד יובא מהקובץ.").wait_for()
    assert report.locator(".error").count() == 0


def test_binary_and_oversized_files_are_rejected(servers, page, api, solo):
    open_budget(page, solo.owner, solo.pid)
    choose_file(page, b"PK\x03\x04\x14\x00\x00\x00" + bytes(200), name="list.xlsx")
    import_report(page).get_by_text("CSV UTF-8").wait_for()
    choose_file(page, b"a" * (1024 * 1024 + 1))
    import_report(page).get_by_text("הקובץ גדול מדי").wait_for()
    assert rows(page).count() == 0 and page.locator("#empty").is_visible()


def test_windows_1255_file_and_currency_choice(servers, page, api, solo):
    open_budget(page, solo.owner, solo.pid)
    assert page.locator("#currency").input_value() == ""
    # Hebrew Excel: windows-1255, semicolons, no currency in the amount header. An empty list needs no confirmation.
    content = csv_bytes("פריט;קטגוריה;כמות;יחידה;מחיר ליחידה", "אריח רצפה;גימורים;12;מ״ר;1,200", encoding="cp1255")
    choose_file(page, content)
    rows(page).first.wait_for()
    assert page.get_by_role("alertdialog").is_hidden()
    assert field(page, 0, "name").input_value() == "אריח רצפה" and total(page) == 14400
    assert page.locator("#currency").input_value() == "ILS"
    assert "נקבע שקל" in import_report(page).inner_text()

    # A currency that is already selected stays, and the user is told the file says otherwise.
    page.locator("#currency").select_option("USD")
    choose_file(page, SAMPLE_FILE.read_bytes())
    page.get_by_role("alertdialog").get_by_role("button", name="החלפה").click()
    import_report(page).get_by_text("המחירים לא הומרו").wait_for()
    assert page.locator("#currency").input_value() == "USD"


def test_currency_comes_from_the_file_or_the_brief(servers, page, api, solo):
    response = api.put(f"{solo.base}/brief", json=BRIEF | {"budget_max": 100, "currency": "EUR"}, headers=solo.owner.headers)
    assert response.status_code == 200
    open_budget(page, solo.owner, solo.pid)
    choose_file(page, csv_bytes(CSV_HEADER.replace(" (ILS)", ""), "x,רהיטים,,1,יחידה,1,,"))
    import_report(page).get_by_text("לפי הבריף: EUR").wait_for()
    assert page.locator("#currency").input_value() == "EUR"

    page.once("dialog", lambda d: d.accept())  # leaving with unsaved changes
    page.reload()
    page.locator("#budget").wait_for()
    choose_file(page, csv_bytes(CSV_HEADER.replace("ILS", "GBP"), "x,רהיטים,,1,יחידה,1,,"))
    import_report(page).get_by_text("לפי הקובץ: GBP").wait_for()
    assert page.locator("#currency").input_value() == "GBP"


def test_imported_markup_stays_text(servers, page, api, solo):
    dialogs = []
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    open_budget(page, solo.owner, solo.pid)
    markup = "<img src=x onerror=alert(1)>"
    choose_file(page, csv_bytes(CSV_HEADER, f"{markup},רהיטים,<b>room</b>,1,יחידה,1,,"))
    rows(page).first.wait_for()
    assert field(page, 0, "name").input_value() == markup
    choose_file(page, csv_bytes(f"{markup},<b>x</b>", "x,y"))  # a bad file made of markup
    import_report(page).locator(".error").wait_for()
    page.get_by_role("button", name="שמירה", exact=True).click()
    page.locator("#save-status").get_by_text("הכול שמור").wait_for()
    assert stored_items(api, solo)[0]["name"] == markup
    assert page.locator("#budget img").count() == 0 and page.locator("#budget b").count() == 0
    assert dialogs == []


def test_import_has_no_horizontal_overflow_on_a_phone(servers, page, api, solo):
    page.set_viewport_size({"width": 375, "height": 800})
    open_budget(page, solo.owner, solo.pid)
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
