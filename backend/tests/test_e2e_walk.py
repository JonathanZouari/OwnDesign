"""Browser tests of "How we move": trace a path from a video, save it, pin notes, and see it as the designer.

The test video is drawn on a canvas in the browser (MediaRecorder), so no fixture file is needed. A drawn
rectangle is not a person to YOLOv8, so the journey test replaces the ONNX runtime with a stub that reports
a person walking left to right; a separate test loads the real YOLOv8 model and runs it on a frame.
"""

import base64
from types import SimpleNamespace

import pytest

from tests.conftest import needs_supabase
from tests.test_e2e import FRONTEND, SITE, overflows
from tests.test_e2e_design import MARKUP, servers, sign_in  # noqa: F401 (servers is a fixture)

pytestmark = [
    needs_supabase,
    pytest.mark.skipif(not (FRONTEND / "js" / "config.js").exists(), reason="frontend/js/config.js missing"),
]

# Records `seconds` of a 320x180 canvas with a dark box moving left to right; returns the WebM as base64.
RECORD_VIDEO = """async (seconds) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
  const ctx = canvas.getContext('2d');
  const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const start = performance.now();
  const draw = () => {
    const t = (performance.now() - start) / 1000;
    ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = '#333'; ctx.fillRect(20 + t * 50, 60, 20, 100);
    if (t < seconds) requestAnimationFrame(draw);
  };
  recorder.start(); draw();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  recorder.stop();
  await new Promise((r) => (recorder.onstop = r));
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let text = ''; for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}"""

# Stands in for onnxruntime-web: each run reports one person whose feet move left to right across the frame.
ORT_STUB = """
globalThis.ort = {
  env: { wasm: {} },
  Tensor: class { constructor(type, data, dims) { this.data = data; this.dims = dims; } },
  InferenceSession: { create: async () => {
    let call = 0;
    return { inputNames: ['images'], outputNames: ['output0'], run: async () => {
      const n = 1, out = new Float32Array(84 * n);
      out[0] = 80 + call * 25; out[1] = 300; out[2] = 40; out[3] = 120; out[4] = 0.9; // cx, cy, w, h, person
      call += 1;
      return { output0: { data: out, dims: [1, 84, n] } };
    } };
  } },
};
"""


def video_file(page, seconds: float) -> dict:
    page.goto(f"{SITE}/index.html")
    data = base64.b64decode(page.evaluate(RECORD_VIDEO, seconds))
    return {"name": "walk.webm", "mimeType": "video/webm", "buffer": data}


@pytest.fixture
def world(api, make_user):
    designer = make_user("e2e-w-designer")
    client = make_user("e2e-w-client")
    studio = api.post("/v1/studios", json={"name": "Walk E2E Studio"}, headers=designer.headers).json()["data"]
    project = api.post(
        "/v1/projects", json={"studio_id": studio["id"], "name": "Walk Flat", "property_type": "existing"}, headers=client.headers
    ).json()["data"]
    return SimpleNamespace(designer=designer, client=client, pid=project["id"], base=f"/v1/projects/{project['id']}/walk-paths")


def open_walk(page, user, pid):
    sign_in(page, user, f"walk.html?project={pid}")
    page.get_by_role("heading", name="Walk Flat", level=1).wait_for()


def test_client_traces_a_path_adds_a_note_and_designer_sees_it(servers, page, api, world):  # noqa: F811
    clip = video_file(page, 3)
    page.route("**/vendor/ort-1.20.1/ort.wasm.min.js", lambda route: route.fulfill(body=ORT_STUB, content_type="text/javascript"))
    open_walk(page, world.client, world.pid)
    assert page.get_by_text("No paths yet.").is_visible()

    page.get_by_label("Video").set_input_files(clip)
    page.get_by_label("Name of the route (optional)").fill("Door to kitchen")
    page.get_by_role("button", name="Trace my path").click()
    page.get_by_text("Check it, then save.").wait_for(timeout=60_000)
    assert page.locator("#preview-figure polyline").count() == 1
    page.get_by_role("button", name="Save path").click()
    page.get_by_text("Path saved.").wait_for()

    card = page.locator(".walk-card")
    assert card.get_by_role("heading", name="Door to kitchen").is_visible()
    # Markup in a note stays text.
    card.get_by_label("Note").fill(MARKUP)
    card.get_by_role("button", name="Add note").click()
    card.get_by_text("Note added.").wait_for()
    card.get_by_label("Note").fill("Tight here with shopping bags")
    card.get_by_role("button", name="Add note").click()
    card.locator(".walk-notes li").nth(1).wait_for()
    assert page.evaluate("window.__xss === undefined") and page.locator("#paths img[src='x'], #paths b, #paths script").count() == 0

    saved = api.get(world.base, headers=world.client.headers).json()["data"]
    assert len(saved) == 1 and saved[0]["label"] == "Door to kitchen" and len(saved[0]["points"]) >= 2
    xs = [p[0] for p in saved[0]["points"]]
    assert xs == sorted(xs)  # the walker went left to right
    assert [n["text"] for n in saved[0]["notes"]] == [MARKUP, "Tight here with shopping bags"]

    # The designer of the studio sees the same path and notes after a fresh sign-in, and can reply.
    page.context.clear_cookies()
    page.evaluate("localStorage.clear()")
    open_walk(page, world.designer, world.pid)
    card = page.locator(".walk-card")
    card.get_by_text("Tight here with shopping bags").wait_for()
    card.get_by_label("Note").fill("Keep this clear in the new layout?")
    card.get_by_role("button", name="Add note").click()
    card.get_by_text("Designer").first.wait_for()

    # Narrow screen: nothing spills sideways.
    page.set_viewport_size({"width": 360, "height": 740})
    assert not overflows(page)

    page.once("dialog", lambda dialog: dialog.accept())
    card.get_by_role("button", name="Delete path").click()
    page.get_by_text("No paths yet.").wait_for()
    assert api.get(world.base, headers=world.client.headers).json()["data"] == []


def test_page_refuses_bad_files_and_videos_without_a_walker(servers, page, world):  # noqa: F811
    open_walk(page, world.client, world.pid)
    status = page.locator("#trace-status")

    page.get_by_role("button", name="Trace my path").click()
    assert status.text_content() == "Choose a video first."

    page.get_by_label("Video").set_input_files({"name": "notes.txt", "mimeType": "text/plain", "buffer": b"hello"})
    page.get_by_role("button", name="Trace my path").click()
    assert status.text_content() == "This file is not a video."

    page.get_by_label("Video").set_input_files({"name": "broken.webm", "mimeType": "video/webm", "buffer": b"not a video"})
    page.get_by_role("button", name="Trace my path").click()
    page.get_by_text("cannot be played in this browser").wait_for()

    # The real YOLOv8 model runs on the drawn video and finds no person in it.
    clip = video_file(page, 2)
    page.goto(f"{SITE}/walk.html?project={world.pid}")  # still signed in
    page.get_by_role("heading", name="Walk Flat", level=1).wait_for()
    page.get_by_label("Video").set_input_files(clip)
    page.get_by_role("button", name="Trace my path").click()
    page.get_by_text("We could not see anyone walking").wait_for(timeout=120_000)
    assert page.locator("#preview").is_hidden()


def test_stranger_and_signed_out_visitor_see_nothing(servers, page, make_user, world):  # noqa: F811
    stranger = make_user("e2e-w-stranger")
    sign_in(page, stranger, f"walk.html?project={world.pid}")
    page.get_by_text("Project not found").wait_for()
    assert page.locator("#walk").is_hidden()

    page.context.clear_cookies()
    page.evaluate("localStorage.clear()")
    page.goto(f"{SITE}/walk.html?project={world.pid}")
    page.wait_for_url(lambda url: "auth.html" in url)
