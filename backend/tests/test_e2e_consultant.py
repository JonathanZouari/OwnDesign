"""Browser journey of the editor's Consultant panel, with the API mocked.

No Supabase and no OpenAI: a signed-in session is seeded in localStorage and every /v1 call is answered
by the test, so this checks what the user sees and what the panel sends (context, plan source, drafts, XSS).
Real streaming over the network is verified separately (see wiki/testing.md).
"""

import json
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
FRONTEND = BACKEND.parent / "frontend"
PORT = 5599
SITE = f"http://127.0.0.1:{PORT}"
PID = "11111111-1111-1111-1111-111111111111"
SID = "22222222-2222-2222-2222-222222222222"
VID = "33333333-3333-3333-3333-333333333333"

PLAN = {
    "schema": 1,
    "units": "cm",
    "rooms": [{"id": "r1", "name": "Living room", "type": "living"}],
    "walls": [
        {"id": "w1", "x1": 0, "y1": 0, "x2": 400, "y2": 0, "thickness": 10, "kind": "exterior", "roomId": "r1"},
        {"id": "w2", "x1": 400, "y1": 0, "x2": 400, "y2": 300, "thickness": 10, "kind": "exterior", "roomId": "r1"},
        {"id": "w3", "x1": 400, "y1": 300, "x2": 0, "y2": 300, "thickness": 10, "kind": "exterior", "roomId": "r1"},
        {"id": "w4", "x1": 0, "y1": 300, "x2": 0, "y2": 0, "thickness": 10, "kind": "exterior", "roomId": "r1"},
    ],
    "openings": [],
    "furniture": [{"id": "f1", "type": "sofa", "x": 200, "y": 150, "w": 200, "d": 90, "rotation": 0}],
}
PROJECT = {
    "id": PID, "studio_id": "s1", "name": "Test flat", "my_role": "client", "property_type": "existing",
    "studio": {"name": "Test Studio", "slug": "test", "status": "active"},
}
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE"}


def sse(*events):
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events)


def reply(text):
    return sse(("message_start", {}), ("status", {"status": "generating_response"}), ("token", {"text": text}), ("message_complete", {"message_id": 1, "status": "complete"}))


def listening() -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.3)
        return probe.connect_ex(("127.0.0.1", PORT)) == 0


@pytest.fixture(scope="module")
def site():
    config = FRONTEND / "js" / "config.js"
    created = not config.exists()
    if created:
        config.write_text('export const config = { apiUrl: "http://127.0.0.1:8000", supabaseUrl: "http://127.0.0.1:54321", supabasePublishableKey: "test" };\n')
    process = None
    if not listening():
        process = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=FRONTEND, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 20
        while not listening():
            assert time.monotonic() < deadline, "static server did not start"
            time.sleep(0.2)
    supabase_url = re.search(r'supabaseUrl:\s*"([^"]+)"', config.read_text()).group(1)
    yield supabase_url
    if process:
        process.terminate()
    if created:
        config.unlink()


@pytest.fixture()
def rig(site, page):
    host = re.sub(r"^https?://", "", site).split(".")[0].split(":")[0]
    session = {
        "access_token": "test-token", "refresh_token": "r", "token_type": "bearer", "expires_in": 3600,
        "expires_at": int(time.time()) + 10 * 365 * 24 * 3600,
        "user": {"id": "u1", "aud": "authenticated", "role": "authenticated", "email": "c@example.com", "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"},
    }
    page.add_init_script(f"localStorage.setItem('sb-{host}-auth-token', {json.dumps(json.dumps(session))});")
    state = type("State", (), {"sent": [], "next": [], "sessions": []})()

    def handler(route, request):
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=CORS)
        path = request.url.split("/v1", 1)[1].split("?")[0]
        ok = lambda data, status=200: route.fulfill(status=status, headers=CORS, content_type="application/json", body=json.dumps({"success": True, "data": data, "error": None}))
        if path == f"/projects/{PID}":
            return ok(PROJECT)
        if path == f"/projects/{PID}/versions":
            return ok([{"id": VID, "version_no": 1, "label": "", "author_role": "client", "created_at": "2026-11-26T08:00:00Z"}])
        if path == f"/projects/{PID}/versions/latest":
            return ok({"id": VID, "version_no": 1, "geometry": PLAN})
        if path == f"/projects/{PID}/consultant/sessions" and request.method == "GET":
            return ok(state.sessions)
        if path == f"/projects/{PID}/consultant/sessions" and request.method == "POST":
            row = {"id": SID, "title": None, "status": "active", "context_type": "plan", "context_id": None, "created_at": "2026-11-26T08:00:00Z", "updated_at": "2026-11-26T08:00:00Z"}
            state.sessions = [row]
            return ok(row, 201)
        if path == f"/projects/{PID}/consultant/sessions/{SID}/messages":
            state.sent.append(request.post_data_json)
            outcome = state.next.pop(0) if state.next else reply("OK")
            if isinstance(outcome, int):
                return route.fulfill(status=outcome, headers=CORS, content_type="application/json", body=json.dumps({"success": False, "data": None, "error": "Daily message limit reached. Please come back tomorrow."}))
            return route.fulfill(status=200, headers={**CORS, "Cache-Control": "no-cache"}, content_type="text/event-stream", body=outcome)
        return route.fulfill(status=404, headers=CORS, content_type="application/json", body='{"success":false,"error":"unmocked"}')

    page.route("**/v1/**", handler)
    page.route("**/127.0.0.1:54321/**", lambda route: route.fulfill(status=404, body="{}"))
    page.goto(f"{SITE}/editor.html?project={PID}")
    page.locator("#consultant-toggle").wait_for()
    state.page = page
    return state


def open_panel(rig):
    rig.page.locator("#consultant-toggle").click()
    rig.page.locator("#consultant-panel").wait_for()
    return rig.page


def ask(page, text):
    page.locator("#consultant-input").fill(text)
    page.keyboard.press("Enter")


def test_panel_opens_beside_the_plan_with_context_and_prompts(rig):
    page = open_panel(rig)
    assert page.locator("#consultant-toggle").get_attribute("aria-expanded") == "true"
    assert page.locator("#canvas").is_visible()  # the plan stays visible
    assert "Entire plan" in page.locator("#consultant-context").inner_text()
    assert "Saved version 1" in page.locator("#consultant-context").inner_text()
    assert page.get_by_text("I can help you analyze your floor plan").is_visible()
    assert page.locator(".consultant-suggestions button").count() == 4


def test_selecting_furniture_changes_the_context_and_the_prompts(rig):
    page = open_panel(rig)
    page.locator("#canvas [data-kind=furniture]").first.focus()
    page.locator("#consultant-context", has_text="sofa").wait_for()
    assert "Is this furniture placement optimal?" in page.locator(".consultant-suggestions").inner_text()


def test_question_sends_the_selected_object_and_saved_version_and_renders_markdown(rig):
    rig.next.append(reply("The sofa blocks the **door**.\n\n- Move it\n- Rotate it"))
    page = open_panel(rig)
    page.locator("#canvas [data-kind=furniture]").first.focus()
    page.locator("#consultant-context", has_text="sofa").wait_for()
    ask(page, "Is this placement good?")
    page.locator(".msg.assistant strong", has_text="door").wait_for()
    assert page.locator(".msg.assistant li").count() == 2
    assert page.locator("#consultant-input").input_value() == ""
    sent = rig.sent[0]
    assert sent["message"] == "Is this placement good?"
    assert sent["scope"] == {"type": "object", "ids": ["f1"]}
    assert sent["source"] == {"kind": "version", "version_id": VID}


def test_unsaved_changes_are_sent_as_the_working_plan(rig):
    page = open_panel(rig)
    page.locator("#canvas [data-kind=furniture]").first.focus()
    page.locator("#rotate").click()
    page.locator("#consultant-context", has_text="unsaved").wait_for()
    ask(page, "Now?")
    page.locator(".msg.assistant", has_text="OK").wait_for()
    source = rig.sent[0]["source"]
    assert source["kind"] == "working" and source["plan"]["furniture"][0]["rotation"] == 90


def test_reply_markup_is_never_interpreted(rig):
    rig.next.append(reply('<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> [a](javascript:window.__xss=3)'))
    page = open_panel(rig)
    ask(page, "hi")
    page.locator(".msg.assistant", has_text="<script>").wait_for()
    assert page.locator(".consultant-thread img, .consultant-thread script, .consultant-thread a").count() == 0
    assert page.evaluate("window.__xss") is None


def test_close_and_reopen_keeps_the_conversation(rig):
    page = open_panel(rig)
    ask(page, "Remember me")
    page.locator(".msg.assistant", has_text="OK").wait_for()
    page.locator("button[aria-label='Close consultant']").click()
    assert page.locator("#consultant-panel").is_hidden()
    page.locator("#consultant-toggle").click()
    assert page.locator(".msg.user", has_text="Remember me").is_visible()


def test_a_refused_request_keeps_the_draft_and_shows_the_server_message(rig):
    rig.next.append(429)
    page = open_panel(rig)
    ask(page, "Please keep this text")
    page.get_by_text("Daily message limit reached").wait_for()
    assert page.locator("#consultant-input").input_value() == "Please keep this text"
    assert page.locator(".msg.user").count() == 0


def test_a_stream_error_keeps_the_partial_reply_and_offers_retry(rig):
    rig.next.append(sse(("message_start", {}), ("token", {"text": "Partial answer"}), ("error", {"message": "The design consultant could not answer. Please try again."})))
    page = open_panel(rig)
    ask(page, "First question")
    page.get_by_text("could not answer").wait_for()
    assert page.locator(".msg.assistant", has_text="Partial answer").is_visible()
    page.get_by_role("button", name="Retry").click()
    assert page.locator("#consultant-input").input_value() == "First question"


def test_enter_sends_and_shift_enter_adds_a_line(rig):
    page = open_panel(rig)
    box = page.locator("#consultant-input")
    box.fill("line one")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("line two")
    assert box.input_value() == "line one\nline two"
    assert rig.sent == []
    page.keyboard.press("Enter")
    page.locator(".msg.user", has_text="line two").wait_for()
    assert rig.sent[0]["message"] == "line one\nline two"


def test_send_is_disabled_for_an_empty_message_and_the_limit_is_enforced(rig):
    page = open_panel(rig)
    assert page.get_by_role("button", name="Send").is_disabled()
    page.locator("#consultant-input").fill("   ")
    assert page.get_by_role("button", name="Send").is_disabled()
    page.locator("#consultant-input").fill("x")
    assert page.get_by_role("button", name="Send").is_enabled()
    assert page.locator("#consultant-input").get_attribute("maxlength") == "2000"


def test_new_conversation_clears_the_thread(rig):
    page = open_panel(rig)
    ask(page, "first")
    page.locator(".msg.assistant", has_text="OK").wait_for()
    page.locator("button[aria-label='New conversation']").click()
    assert page.locator(".msg.user").count() == 0
    assert page.get_by_text("I can help you analyze your floor plan").is_visible()


def test_typing_in_the_panel_does_not_trigger_editor_shortcuts(rig):
    page = open_panel(rig)
    page.locator("#canvas [data-kind=furniture]").first.focus()
    page.locator("#consultant-input").fill("")
    page.locator("#consultant-input").focus()
    page.keyboard.type("rdw")  # r, d and w are editor shortcuts
    assert page.locator("#tool-name").inner_text() == "Select and move"
    assert page.locator("#status-save").inner_text().startswith("Saved")


def test_escape_closes_the_panel_without_deselecting(rig):
    page = open_panel(rig)
    page.locator("#consultant-input").focus()
    page.keyboard.press("Escape")
    assert page.locator("#consultant-panel").is_hidden()


def test_panel_fits_a_phone_screen(rig):
    # The editor's app bar already overflows at 375 px (tracked in wiki/open-items.md); the panel itself must not.
    page = open_panel(rig)
    page.set_viewport_size({"width": 375, "height": 740})
    box = page.locator("#consultant-panel").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 375
    assert page.locator("#consultant-input").is_visible()
