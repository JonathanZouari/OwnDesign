"""Automated accessibility checks (axe-core, WCAG 2.2 A/AA) on every static page.

Needs no Supabase: it serves a copy of the frontend with the example config, so each page renders
its signed-out / backend-unreachable state. Signed-in states are covered by test_e2e*.py journeys.
"""

import re
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
    "accessibility.html", "index.html", "auth.html", "entry.html", "wizard.html", "editor.html",
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


@pytest.mark.parametrize("name", [p for p in PAGES if p != "accessibility.html"])
def test_every_page_links_to_the_hebrew_statement(site, page, name):
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    assert page.locator("a[href='accessibility.html'][lang=he]:not(#a11y-panel *)").count() == 1


def test_statement_is_hebrew_rtl_and_lists_required_parts(site, page):
    page.goto(f"{SITE}/accessibility.html")
    assert page.evaluate("[document.documentElement.lang, document.documentElement.dir]") == ["he", "rtl"]
    for heading in ("מה הונגש באתר", "חלקים שלא הונגשו במלואם", "פניות בנושא נגישות"):
        assert page.get_by_role("heading", name=heading).count() == 1


def test_studio_sections_reachable_below_1200px(site, page):
    # The dashboard itself is hidden until sign-in, so check the rule, not visibility.
    display = lambda: page.evaluate("getComputedStyle(document.querySelector('.section-links')).display")
    page.set_viewport_size({"width": 1000, "height": 700})
    page.goto(f"{SITE}/studio.html")
    assert display() == "flex"
    page.set_viewport_size({"width": 1400, "height": 800})
    assert display() == "none"


def test_editor_phone_keeps_workspace_links_and_account_button(site, page):
    page.set_viewport_size({"width": 375, "height": 700})
    page.goto(f"{SITE}/editor.html")
    page.wait_for_load_state("networkidle")
    assert page.locator("#tab-wizard").is_visible()
    assert page.locator("#account").is_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth")


@pytest.mark.parametrize("name", ["index.html", "auth.html", "editor.html", "wizard.html", "studio.html", "accessibility.html"])
def test_no_axe_violations_on_a_phone(site, page, name):
    page.set_viewport_size({"width": 375, "height": 700})
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    assert violations(page) == []


# --- Accessibility options widget ---------------------------------------------------------------

def open_widget(page):
    page.get_by_role("button", name=re.compile("Accessibility options|אפשרויות נגישות")).click()
    return page.locator("#a11y-panel")


@pytest.mark.parametrize("name", PAGES)
def test_widget_on_every_page_opens_and_closes_with_escape(site, page, name):
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    toggle = page.locator(".a11y-toggle")
    assert toggle.get_attribute("aria-expanded") == "false"
    panel = open_widget(page)
    assert panel.is_visible() and toggle.get_attribute("aria-expanded") == "true"
    page.keyboard.press("Escape")
    assert not panel.is_visible()
    assert page.evaluate("document.activeElement.classList.contains('a11y-toggle')")


def test_widget_options_apply_persist_and_reset(site, page):
    page.goto(f"{SITE}/index.html")
    panel = open_widget(page)
    panel.get_by_role("button", name="High contrast").click()
    panel.get_by_role("button", name="Larger text").click()
    root = "document.documentElement.className"
    assert "a11y-contrast" in page.evaluate(root) and "a11y-text-1" in page.evaluate(root)
    assert panel.get_by_role("button", name="High contrast").get_attribute("aria-pressed") == "true"
    page.reload()
    assert "a11y-contrast" in page.evaluate(root) and "a11y-text-1" in page.evaluate(root)  # remembered
    open_widget(page).get_by_role("button", name="Reset").click()
    assert "a11y-" not in page.evaluate(root)


def test_widget_ignores_corrupt_stored_settings(site, page):
    page.goto(f"{SITE}/index.html")
    page.evaluate("localStorage.setItem('atelier-a11y', '{\"text\": 99, \"contrast\": \"yes\", \"x\": 1}')")
    page.reload()
    assert "a11y-" not in page.evaluate("document.documentElement.className")
    page.evaluate("localStorage.setItem('atelier-a11y', 'not json')")
    page.reload()
    assert page.locator(".a11y-toggle").count() == 1


def test_text_size_stops_at_the_largest_level(site, page):
    page.goto(f"{SITE}/index.html")
    panel = open_widget(page)
    for _ in range(3):
        panel.get_by_role("button", name="Larger text").click()
    assert "a11y-text-3" in page.evaluate("document.documentElement.className")
    assert panel.get_by_role("button", name="Larger text").is_disabled()


def test_widget_in_hebrew_on_the_statement_page(site, page):
    page.goto(f"{SITE}/accessibility.html")
    panel = open_widget(page)
    assert panel.get_by_role("button", name="ניגודיות גבוהה").count() == 1


@pytest.mark.parametrize("name", ["index.html", "auth.html", "editor.html", "wizard.html", "accessibility.html"])
@pytest.mark.parametrize("mode", ["High contrast", "Larger text", "Readable font"])
def test_no_axe_violations_with_option_on_and_panel_open(site, page, name, mode):
    page.goto(f"{SITE}/{name}")
    page.wait_for_load_state("networkidle")
    panel = open_widget(page)
    label = {"High contrast": "ניגודיות גבוהה", "Larger text": "הגדלת טקסט", "Readable font": "גופן קריא"}[mode] if name == "accessibility.html" else mode
    panel.get_by_role("button", name=label).click()
    assert violations(page) == []


@pytest.mark.parametrize("name", ["index.html", "auth.html", "entry.html", "accessibility.html"])
def test_no_horizontal_scroll_at_largest_text_on_a_phone(site, page, name):
    page.set_viewport_size({"width": 375, "height": 700})
    page.goto(f"{SITE}/{name}")
    page.evaluate("localStorage.setItem('atelier-a11y', JSON.stringify({text: 3}))")
    page.reload()
    page.wait_for_load_state("networkidle")
    assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
