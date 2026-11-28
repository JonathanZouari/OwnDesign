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
        ("1,5", "פסיק מותר בכמות רק להפרדת אלפים (למשל 1,000). לשבר עשרוני השתמשו בנקודה."),
    )
    for bad, message in cases:
        field(page, 0, "quantity").fill(bad)
        assert rows(page).nth(0).locator(".field-error:not([hidden])").inner_text() == message
        assert field(page, 0, "quantity").get_attribute("aria-invalid") == "true"
        save.click()
        page.locator("#error-summary").get_by_text("יש לתקן שדה אחד").wait_for()
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
    wait_until(page, page.get_by_role("button", name=IMPORT_BUTTON).is_enabled)  # once the dialog has closed

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


# ---- saving, concurrency, errors, dialog, print ------------------------------------------------------

SAVE_BUTTON = "שמירה"
CONFLICT_TITLE = "הרשימה בשרת שונה מזו שנטענה"
EXPORT_MINE = "ייצוא השינויים שלי ל־CSV"
LOAD_LATEST = "טעינת הגרסה העדכנית"


def save_button(page):
    return page.get_by_role("button", name=SAVE_BUTTON, exact=True)


def watch_puts(page) -> list:
    """The JSON bodies of the list saves the page sends."""
    sent = []
    page.on("request", lambda r: sent.append(r.post_data_json) if r.method == "PUT" and r.url.endswith("/estimate") else None)
    return sent


def wait_saved(page):
    page.locator("#save-status").get_by_text("הכול שמור").wait_for()


def focused(locator) -> bool:
    return locator.evaluate("node => node === document.activeElement")


def visible_errors(page) -> list[str]:
    return page.locator("#rows .field-error:not([hidden])").all_inner_texts()


def only(method: str, action):
    """A route handler that applies `action` to one method and lets the rest through. It takes exactly one argument:
    Playwright passes the request too to a handler that accepts two."""

    def handle(route):
        if route.request.method == method:
            action(route)
        else:
            route.fallback()

    return handle


def only_puts(action):
    return only("PUT", action)


def hold_puts(page) -> list:
    """Keeps every save waiting until the test continues its route."""
    held = []
    page.route("**/estimate", only_puts(held.append))
    return held


def wait_until(page, condition):
    for _ in range(100):
        if condition():
            return
        page.wait_for_timeout(100)
    raise AssertionError("condition was never met")


def click_at(page, locator):
    """A raw pointer click where the control is, without Playwright's own checks that it can be clicked."""
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def test_the_list_cannot_be_edited_while_a_save_is_pending(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    open_budget(page, solo.owner, solo.pid)
    sent = watch_puts(page)
    held = hold_puts(page)
    field(page, 0, "name").fill("Edited sofa")
    save_button(page).click()
    page.locator("#saving").get_by_text("שומר…").wait_for()
    wait_until(page, lambda: held)
    assert page.locator("#saving").is_visible()
    assert page.locator("#list-card").evaluate("node => node.inert") is True

    # Typing, focusing and clicking do nothing, on every control of the card.
    name = field(page, 0, "name")
    click_at(page, name)
    page.keyboard.type("lost")
    assert name.input_value() == "Edited sofa" and not focused(name)
    for selector in ("#add-row", "#load-sample", "#import", "#currency", "#save", "#rows button.danger"):
        assert page.locator(selector).evaluate("node => { node.focus(); return node !== document.activeElement; }"), selector
    for selector in ("#add-row", "#rows button.danger", "#save"):
        click_at(page, page.locator(selector))
    assert rows(page).count() == 1 and len(held) == 1 and len(sent) == 1

    held[0].continue_()
    wait_saved(page)
    assert page.locator("#list-card").evaluate("node => node.inert") is False
    assert page.locator("#saving").inner_text() == ""
    assert focused(save_button(page))
    assert page.locator(".toast").count() == 0  # the status line is the only announcement
    assert stored_items(api, solo)[0]["name"] == "Edited sofa"


def test_a_failed_save_keeps_the_edits_and_can_be_retried(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    open_budget(page, solo.owner, solo.pid)
    sent = watch_puts(page)
    field(page, 0, "name").fill("Kept edit")
    cors = {"Access-Control-Allow-Origin": SITE}
    failures = (
        lambda route: route.abort(),
        lambda route: route.fulfill(status=500, headers=cors, content_type="application/json", body='{"success": false}'),
    )
    for failure in failures:
        page.route("**/estimate", only_puts(failure))
        save_button(page).click()
        page.locator(".toast.error").wait_for()
        page.evaluate("document.querySelector('#toasts').replaceChildren()")
        assert page.locator("#list-card").evaluate("node => node.inert") is False
        assert page.locator("#saving").inner_text() == ""
        assert field(page, 0, "name").input_value() == "Kept edit"
        assert page.locator("#save-status").inner_text() == "יש שינויים שלא נשמרו"
        assert page.get_by_role("alertdialog").is_hidden()
        assert focused(save_button(page))
        page.unroute("**/estimate")
    assert stored_items(api, solo)[0]["name"] == "Sofa"
    save_button(page).click()
    wait_saved(page)
    assert stored_items(api, solo)[0]["name"] == "Kept edit"
    assert len(sent) == 3 and len({body["base_updated_at"] for body in sent}) == 1  # a failure does not move the version


def commit_then(route, then):
    """Lets the save reach the server, which commits it, and gives the page `then` instead of the answer."""
    assert route.fetch().status == 200
    then(route)


def test_a_save_whose_answer_was_lost_succeeds_when_retried(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    open_budget(page, solo.owner, solo.pid)
    sent = watch_puts(page)
    field(page, 0, "name").fill("Committed sofa")
    field(page, 0, "quantity").fill("2.50")
    page.route("**/estimate", only_puts(lambda route: commit_then(route, lambda r: r.abort())))
    save_button(page).click()
    page.locator(".toast.error").wait_for()
    stored = stored_items(api, solo)
    assert [i["name"] for i in stored] == ["Committed sofa"]
    assert page.locator("#save-status").inner_text() == "יש שינויים שלא נשמרו"

    page.unroute("**/estimate")
    save_button(page).click()
    wait_saved(page)
    assert page.get_by_role("alertdialog").is_hidden()
    assert stored_items(api, solo) == stored  # nothing was written again
    assert len(sent) == 2 and sent[0] == sent[1]
    # The page moved on to the stored version, so the next change saves.
    field(page, 0, "name").fill("Next sofa")
    save_button(page).click()
    wait_saved(page)
    assert page.get_by_role("alertdialog").is_hidden() and [i["name"] for i in stored_items(api, solo)] == ["Next sofa"]


def test_two_tabs_the_second_save_conflicts_instead_of_overwriting(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    version = api.get(f"{solo.base}/estimate", headers=solo.owner.headers).json()["data"]["updated_at"]
    open_budget(page, solo.owner, solo.pid)
    other = page.context.new_page()
    other.goto(f"{SITE}/budget.html?project={solo.pid}")
    other.locator("#budget").wait_for()
    sent = watch_puts(page)

    field(other, 0, "name").fill("Their sofa")
    save_button(other).click()
    wait_saved(other)
    # The same tab saves again: it moved on to the version it received.
    field(other, 0, "price").fill("500")
    save_button(other).click()
    wait_saved(other)
    assert other.get_by_role("alertdialog").is_hidden()

    page.bring_to_front()
    field(page, 0, "name").fill("My sofa")
    save_button(page).click()
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    assert sent[0]["base_updated_at"] == version  # sent back exactly as received
    assert CONFLICT_TITLE in dialog.inner_text()
    assert [i["name"] for i in stored_items(api, solo)] == ["Their sofa"]
    assert page.locator("#list-card").evaluate("node => node.inert") is False
    cancel = dialog.get_by_role("button", name="ביטול")
    assert focused(cancel)
    assert dialog.get_by_role("button").all_inner_texts() == [EXPORT_MINE, LOAD_LATEST, "ביטול"]  # no way to force

    # Export: my changes go to a file; the dialog and the edits stay.
    with page.expect_download() as info:
        dialog.get_by_role("button", name=EXPORT_MINE).click()
    with open(info.value.path(), "rb") as handle:
        assert "My sofa" in handle.read().decode("utf-8-sig")
    dialog.get_by_text("הקובץ ירד למחשב").wait_for()
    assert dialog.is_visible() and field(page, 0, "name").input_value() == "My sofa"

    for _ in range(5):
        page.keyboard.press("Tab")
        assert page.evaluate("document.querySelector('#confirm').contains(document.activeElement)")

    # Cancel keeps editing, and the next save conflicts again.
    cancel.click()
    dialog.wait_for(state="hidden")
    assert field(page, 0, "name").input_value() == "My sofa"
    assert page.locator("#save-status").inner_text() == "יש שינויים שלא נשמרו"
    wait_until(page, lambda: focused(save_button(page)))
    save_button(page).click()
    dialog.wait_for()
    assert dialog.get_by_text("הקובץ ירד למחשב").count() == 0
    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden")
    assert field(page, 0, "name").input_value() == "My sofa"
    wait_until(page, lambda: focused(save_button(page)))
    assert len(sent) == 2 and sent[1]["base_updated_at"] == version
    assert [i["name"] for i in stored_items(api, solo)] == ["Their sofa"]

    # A failed load keeps the edits and the dialog.
    save_button(page).click()
    dialog.wait_for()
    page.route("**/estimate", only("GET", lambda route: route.abort()))
    dialog.get_by_role("button", name=LOAD_LATEST).click()
    dialog.locator("#confirm-note:not(:empty)").wait_for()
    assert dialog.is_visible() and field(page, 0, "name").input_value() == "My sofa"
    assert dialog.get_by_role("button", name=LOAD_LATEST).is_enabled()
    page.unroute("**/estimate")

    # Loading the latest version discards my changes, and saving works again.
    dialog.get_by_role("button", name=LOAD_LATEST).click()
    dialog.wait_for(state="hidden")
    wait_saved(page)
    assert field(page, 0, "name").input_value() == "Their sofa" and field(page, 0, "price").input_value() == "500"
    wait_until(page, lambda: focused(save_button(page)))
    field(page, 0, "name").fill("Agreed sofa")
    save_button(page).click()
    wait_saved(page)
    assert dialog.is_hidden() and [i["name"] for i in stored_items(api, solo)] == ["Agreed sofa"]


def test_cancelling_while_the_latest_version_loads_keeps_the_edits(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    open_budget(page, solo.owner, solo.pid)
    put_items(api, solo, [{"name": "Changed elsewhere"}])
    field(page, 0, "name").fill("My sofa")
    save_button(page).click()
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    held = []
    page.route("**/estimate", only("GET", held.append))
    dialog.get_by_role("button", name=LOAD_LATEST).click()
    wait_until(page, lambda: held)
    assert dialog.get_by_role("button", name=LOAD_LATEST).is_disabled()
    assert focused(dialog.get_by_role("button", name="ביטול"))
    page.keyboard.press("Escape")
    dialog.wait_for(state="hidden")
    wait_until(page, lambda: focused(save_button(page)))
    save_button(page).click()  # a new conflict dialog opens while the first load is still pending
    dialog.wait_for()
    with page.expect_response(lambda r: r.request.method == "GET" and r.url.endswith("/estimate")):
        held[0].continue_()
    page.wait_for_timeout(500)
    assert dialog.is_visible()  # the late answer neither closes it nor replaces the rows
    assert dialog.get_by_role("button", name=LOAD_LATEST).is_enabled()
    assert field(page, 0, "name").input_value() == "My sofa"
    page.keyboard.press("Escape")
    assert page.locator("#save-status").inner_text() == "יש שינויים שלא נשמרו"


def test_first_save_of_a_list_someone_else_created_meanwhile_conflicts(servers, page, api, solo):
    open_budget(page, solo.owner, solo.pid)
    sent = watch_puts(page)
    page.get_by_role("button", name="הוספת שורה").click()
    field(page, 0, "name").fill("Mine")
    page.locator("#currency").select_option("ILS")
    put_items(api, solo, [{"name": "Created meanwhile"}])
    save_button(page).click()
    page.get_by_role("alertdialog").get_by_text(CONFLICT_TITLE).wait_for()
    assert sent[0]["base_updated_at"] is None
    assert [i["name"] for i in stored_items(api, solo)] == ["Created meanwhile"]


def test_errors_show_only_on_touched_fields_until_a_save_attempt(servers, page, api, solo):
    open_budget(page, solo.owner, solo.pid)
    page.locator("#currency").select_option("ILS")
    add = page.get_by_role("button", name="הוספת שורה")
    summary = page.locator("#error-summary")
    assert summary.get_attribute("aria-live") == "polite"
    add.click()
    assert focused(field(page, 0, "name"))
    assert visible_errors(page) == [] and summary.inner_text() == ""

    # Leaving the empty name shows its error, and the click that caused it still lands.
    add.click()
    wait_until(page, lambda: rows(page).count() == 2 and visible_errors(page) == ["יש להזין שם."])
    summary.get_by_text("יש לתקן שדה אחד").wait_for()

    # Typing shows only that field's error; the summary waits for a pause instead of changing on every key.
    quantity = field(page, 1, "quantity")
    quantity.focus()  # leaves the second name, which shows its error
    summary.get_by_text("יש לתקן 2 שדות").wait_for()
    page.evaluate(
        """() => { window.__changes = 0;
        new MutationObserver(() => (window.__changes += 1))
          .observe(document.querySelector('#error-summary'), { childList: true, characterData: true, subtree: true }); }"""
    )
    quantity.fill("")
    quantity.press_sequentially("1,5555", delay=30)
    assert page.evaluate("window.__changes") == 0
    summary.get_by_text("יש לתקן 3 שדות").wait_for()
    assert page.evaluate("window.__changes") == 1
    assert len(visible_errors(page)) == 3

    quantity.fill("1")
    field(page, 0, "quantity").fill("1,000")
    field(page, 0, "price").fill("1,200")
    field(page, 0, "name").fill("Tiles")
    field(page, 1, "name").fill("Lamp")
    wait_until(page, lambda: summary.inner_text() == "")
    assert visible_errors(page) == [] and total(page) == 1_200_000

    # A new row shows nothing; saving straight from its empty name shows every error and no extra toast.
    add.click()
    assert visible_errors(page) == []
    field(page, 2, "price").evaluate("node => { node.value = 'x'; node.dispatchEvent(new Event('input')); }")
    field(page, 2, "name").focus()
    save_button(page).click()
    summary.get_by_text("יש לתקן 2 שדות").wait_for()
    assert focused(field(page, 2, "name"))
    assert page.locator(".toast").count() == 0
    add.click()  # rows added after the attempt start clean
    assert rows(page).count() == 4 and len(visible_errors(page)) == 2

    rows(page).nth(3).locator("button.danger").click()
    field(page, 2, "name").fill("Rug")
    field(page, 2, "price").fill("10")
    save_button(page).click()
    wait_saved(page)
    saved = stored_items(api, solo)
    assert [(i["name"], i["quantity"], i["unit_price"]) for i in saved] == [("Tiles", 1000, 1200), ("Lamp", 1, 0), ("Rug", 1, 10)]


def test_an_export_attempt_shows_the_errors(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    open_budget(page, solo.owner, solo.pid)
    field(page, 0, "price").fill("1,5")
    page.get_by_role("button", name="ייצוא ל-CSV").click()
    page.locator("#error-summary").get_by_text("יש לתקן שדה אחד").wait_for()
    assert visible_errors(page) == ["פסיק מותר במחיר רק להפרדת אלפים (למשל 1,200)."]
    assert focused(field(page, 0, "price"))
    assert page.locator(".toast").count() == 0


def test_the_confirm_dialog_traps_focus_and_returns_it(servers, page, api, solo):
    put_items(api, solo, [{"name": "Mine"}])
    open_budget(page, solo.owner, solo.pid)
    dialog = page.get_by_role("alertdialog")
    opener = page.locator("#load-sample")
    for close_with in ("Escape", "Enter"):
        opener.focus()
        page.keyboard.press("Enter")
        dialog.wait_for()
        assert page.locator("#confirm").evaluate("node => node.matches(':modal')")
        cancel, confirm = dialog.get_by_role("button", name="ביטול"), dialog.get_by_role("button", name="החלפה")
        assert focused(cancel)
        for key, expected in (("Tab", confirm), ("Tab", cancel), ("Shift+Tab", confirm), ("Shift+Tab", cancel)):
            page.keyboard.press(key)
            assert focused(expected), key
        page.keyboard.press(close_with)  # Enter presses the focused "cancel"
        dialog.wait_for(state="hidden")
        wait_until(page, lambda: focused(opener))
        assert field(page, 0, "name").input_value() == "Mine"

    choose_file(page, SAMPLE_FILE.read_bytes())
    dialog.wait_for()
    page.keyboard.press("Escape")
    wait_until(page, lambda: focused(page.locator("#import")))
    assert rows(page).count() == 1


def test_print_shows_long_text_in_full(servers, page, api, solo):
    long_name = ("ארון־מטבח־ארוך " * 4) + "W" * 60
    assert len(long_name) == 120
    put_items(api, solo, [
        {"name": long_name, "room": "R" * 60, "quantity": 10000, "unit_price": 100_000_000},
        *[{"name": f"item {n}"} for n in range(40)],
    ])  # fmt: skip
    page.set_viewport_size({"width": 700, "height": 1000})  # about the printable width of A4
    open_budget(page, solo.owner, solo.pid)
    first = rows(page).nth(0)
    printed = first.locator(".print-only")
    assert printed.first.is_hidden()
    field(page, 0, "room").fill("S" * 60)  # the printed text follows the edits

    page.emulate_media(media="print")
    assert printed.all_inner_texts() == [long_name, "רהיטים", "S" * 60, "10000", "יחידה", "100000000"]
    assert first.locator("input, select").evaluate_all("nodes => nodes.every(n => getComputedStyle(n).display === 'none')")
    for index in range(printed.count()):
        sizes = printed.nth(index).evaluate(
            """n => { const own = n.getBoundingClientRect(), cell = n.parentElement.getBoundingClientRect();
            return { clipped: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1,
                     outside: own.left < cell.left - 1 || own.right > cell.right + 1, left: own.left, right: own.right }; }"""
        )
        assert not sizes["clipped"] and not sizes["outside"], (index, sizes)
        assert sizes["left"] >= 0 and sizes["right"] <= 700, (index, sizes)
    assert printed.first.bounding_box()["height"] > 30  # it wrapped onto several lines
    assert not overflows(page)
    assert page.locator("#list-card").evaluate("n => getComputedStyle(n).breakInside") == "auto"
    assert first.evaluate("n => getComputedStyle(n).breakInside") == "avoid"
    assert page.locator("#save").is_hidden()


def test_conflict_saving_and_errors_fit_a_phone(servers, page, api, solo):
    put_items(api, solo, [{"name": "Sofa"}])
    page.set_viewport_size({"width": 375, "height": 700})
    open_budget(page, solo.owner, solo.pid)
    field(page, 0, "price").fill("1,5")
    save_button(page).click()
    page.locator("#error-summary").get_by_text("יש לתקן").wait_for()
    assert not overflows(page)
    field(page, 0, "price").fill("5")
    put_items(api, solo, [{"name": "Changed elsewhere"}])
    held = hold_puts(page)
    save_button(page).click()
    wait_until(page, lambda: held)
    assert page.locator("#saving").is_visible() and not overflows(page)
    held[0].continue_()
    dialog = page.get_by_role("alertdialog")
    dialog.wait_for()
    assert not overflows(page)
    box = dialog.bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 375 and box["y"] >= 0 and box["y"] + box["height"] <= 700
    for button in dialog.get_by_role("button").all():
        inner = button.bounding_box()
        assert inner["x"] >= box["x"] and inner["x"] + inner["width"] <= box["x"] + box["width"]
