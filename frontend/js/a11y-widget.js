// Accessibility options: a floating button with a panel of display adjustments, remembered in this browser.
// Each option is a class on <html>; the rules live at the end of css/app.css.
import { h } from "./ui.js";

const KEY = "atelier-a11y";
const MAX_TEXT = 3;
const TOGGLES = ["contrast", "links", "font", "spacing", "still", "focus"];

const TEXT = {
  en: {
    open: "Accessibility options", close: "Close", title: "Accessibility options", larger: "Larger text", smaller: "Smaller text",
    size: "Text size", reset: "Reset", statement: "Accessibility statement (Hebrew)",
    contrast: "High contrast", links: "Highlight links", font: "Readable font", spacing: "Wider spacing", still: "Stop animations", focus: "Bold focus outline",
  },
  he: {
    open: "אפשרויות נגישות", close: "סגירה", title: "אפשרויות נגישות", larger: "הגדלת טקסט", smaller: "הקטנת טקסט",
    size: "גודל טקסט", reset: "איפוס", statement: "הצהרת נגישות",
    contrast: "ניגודיות גבוהה", links: "הדגשת קישורים", font: "גופן קריא", spacing: "ריווח מוגדל", still: "עצירת אנימציות", focus: "מסגרת פוקוס מודגשת",
  },
};

// Stored data is untrusted: anything unexpected falls back to the default.
function load() {
  const prefs = { text: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    if (Number.isInteger(stored?.text) && stored.text >= 0 && stored.text <= MAX_TEXT) prefs.text = stored.text;
    for (const name of TOGGLES) if (stored?.[name] === true) prefs[name] = true;
  } catch {
    // no storage or invalid JSON: use defaults
  }
  return prefs;
}

const prefs = load();

function apply() {
  const root = document.documentElement;
  [...root.classList].forEach((name) => name.startsWith("a11y-") && root.classList.remove(name)); // copy: the live list shrinks while removing
  if (prefs.text) root.classList.add(`a11y-text-${prefs.text}`);
  for (const name of TOGGLES) if (prefs[name]) root.classList.add(`a11y-${name}`);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked: the options still work for this page view
  }
}

function icon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.innerHTML = '<circle cx="12" cy="4.5" r="2" fill="currentColor"/><path d="M5 8.5h14M12 8.5v6m0 0-3.5 6m3.5-6 3.5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>';
  return svg;
}

function build() {
  const t = TEXT[document.documentElement.lang === "he" ? "he" : "en"];
  const readout = h("span", { class: "a11y-readout", "aria-live": "polite" });
  const smaller = h("button", { type: "button", onclick: () => change(-1) }, t.smaller);
  const larger = h("button", { type: "button", onclick: () => change(1) }, t.larger);
  const buttons = Object.fromEntries(TOGGLES.map((name) => [name, h("button", { type: "button", "aria-pressed": "false", onclick: () => flip(name) }, t[name])]));

  const sync = () => {
    readout.textContent = `${t.size}: ${100 + prefs.text * 15}%`;
    smaller.disabled = prefs.text === 0;
    larger.disabled = prefs.text === MAX_TEXT;
    for (const name of TOGGLES) buttons[name].setAttribute("aria-pressed", String(!!prefs[name]));
  };
  const change = (step) => {
    const next = prefs.text + step;
    if (next < 0 || next > MAX_TEXT) return;
    prefs.text = next;
    apply();
    sync();
  };
  const flip = (name) => {
    prefs[name] = !prefs[name];
    apply();
    sync();
  };
  const reset = () => {
    prefs.text = 0;
    for (const name of TOGGLES) delete prefs[name];
    apply();
    sync();
  };

  const panel = h("section", { id: "a11y-panel", class: "a11y-panel", "aria-labelledby": "a11y-title", hidden: true },
    h("h2", { id: "a11y-title" }, t.title),
    h("div", { class: "a11y-size" }, smaller, larger, readout),
    h("div", { class: "a11y-grid" }, TOGGLES.map((name) => buttons[name])),
    h("div", { class: "a11y-foot" },
      h("button", { type: "button", onclick: reset }, t.reset),
      h("a", { lang: "he", href: "accessibility.html" }, t.statement)));

  const toggle = h("button", { type: "button", class: "a11y-toggle", "aria-expanded": "false", "aria-controls": "a11y-panel", "aria-label": t.open }, icon());
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  const root = h("div", { class: "a11y", onkeydown: (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  } }, toggle, panel);

  sync();
  document.body.append(root);
}

apply();
build();
