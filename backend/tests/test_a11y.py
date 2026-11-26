"""Automated accessibility checks (axe-core, WCAG 2.2 A/AA) on every static page.

Needs no Supabase: it serves a copy of the frontend with the example config, so each page renders
its signed-out / backend-unreachable state. Signed-in states are covered by test_e2e*.py journeys.
"""

import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
AXE = FRONTEND / "node_modules" / "axe-core" / "axe.min.js"
PORT = 5511
SITE = f"http://127.0.0.1:{PORT}"
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
PAGES = [
    "index.html", "auth.html", "entry.html", "wizard.html", "editor.html",
    "studio.html", "projects.html", "design.html", "consultant.html",
]

pytestmark = pytest.mark.skipif(not AXE.exists(), reason="run `npm install` in frontend/ for axe-core")


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    root = tmp_path_factory.mktemp("site")
    shutil.copytree(FRONTEND, root, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", ".venv", "tests", "__pycache__"))
    shutil.copy(root / "js" / "config.example.js", root / "js" / "config.js")
    process = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=root,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while True:
        with socket.socket() as probe:
            probe.settimeout(0.3)
            if probe.connect_ex(("127.0.0.1", PORT)) == 0:
                break
        if time.monotonic() > deadline:
            process.kill()
            raise RuntimeError("static server did not start")
        time.sleep(0.2)
    yield
    process.terminate()


def violations(page) -> list[str]:
    page.evaluate(AXE.read_text(encoding="utf-8"))  # evaluate() is not subject to the page's CSP
    found = page.evaluate("tags => axe.run(document, { runOnly: { type: 'tag', values: tags } }).then(r => r.violations)", TAGS)
    return [f"{v['id']}: {v['help']} ({len(v['nodes'])}) e.g. {v['nodes'][0]['target']}" for v in found]


@pytest.mark.parametrize("name", PAGES)
def test_page_has_no_axe_violations(site, page, name):
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    assert violations(page) == []


@pytest.mark.parametrize("name", PAGES)
def test_skip_link_is_first_tab_stop_and_reaches_main(site, page, name):
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    page.keyboard.press("Tab")
    link = page.locator(":focus")
    assert link.get_attribute("href") == "#main"
    assert link.is_visible()
    page.keyboard.press("Enter")
    assert page.evaluate("document.activeElement.id") == "main" or page.evaluate("location.hash") == "#main"


@pytest.mark.parametrize("name", PAGES)
def test_no_horizontal_scroll_at_320px(site, page, name):
    page.set_viewport_size({"width": 320, "height": 640})
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
