// Language toggle (EN / HE) and on-the-fly translation of the whole page.
//
// Pages and scripts keep writing plain English. This module swaps text nodes and a few attributes for
// their Hebrew entry (js/locales/he.js) and switches the page to right-to-left. A MutationObserver
// translates text the page scripts add or change later, so dynamic screens are covered without
// touching each script. Whatever has no entry (names, numbers, new copy) stays as written.
import * as he from "./locales/he.js";
import { translate } from "./i18n-core.js";

const STORAGE_KEY = "atelier.lang";
const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];
const SKIP = ".icon, script, style, [translate='no']"; // icon names are ligature text, never words
const HAS_LETTERS = /\p{L}/u;

let lang = document.documentElement.lang === "he" ? "he" : "en";
const cache = new Map();
const textRecord = new WeakMap(); // text node -> { src: English as written by the page, out: what is shown }
const attributeRecord = new WeakMap(); // element -> Map(attribute -> { src, out })

const toLang = (src) => {
  if (lang !== "he" || !HAS_LETTERS.test(src)) return src;
  if (!cache.has(src)) cache.set(src, translate(src, he));
  return cache.get(src);
};

// Translate a string from code (confirm dialogs and the like) in the current language.
export const t = (text) => toLang(text);

function applyText(node) {
  if (node.parentElement?.closest(SKIP)) return;
  const record = textRecord.get(node);
  // Unchanged since we last set it: reuse the English we remembered. Otherwise the page just wrote new text.
  const src = record && node.data === record.out ? record.src : node.data;
  const out = toLang(src);
  textRecord.set(node, { src, out });
  if (node.data !== out) node.data = out;
}

function applyAttribute(element, name) {
  const value = element.getAttribute(name);
  if (value == null || element.closest(SKIP)) return;
  const records = attributeRecord.get(element) ?? new Map();
  attributeRecord.set(element, records);
  const record = records.get(name);
  const src = record && value === record.out ? record.src : value;
  const out = toLang(src);
  records.set(name, { src, out });
  if (value !== out) element.setAttribute(name, out);
}

function applyTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return applyText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) applyText(node);
  const selector = ATTRIBUTES.map((name) => `[${name}]`).join(",");
  for (const element of [root, ...root.querySelectorAll(selector)]) {
    for (const name of ATTRIBUTES) if (element.hasAttribute(name)) applyAttribute(element, name);
  }
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") applyText(mutation.target);
    else if (mutation.type === "attributes") applyAttribute(mutation.target, mutation.attributeName);
    else mutation.addedNodes.forEach(applyTree);
  }
});

function observe() {
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTES,
  });
}

// Flags are drawn as inline SVG: Windows has no flag emoji, so they would show up as the letters "US" / "IL".
const SVG_NS = "http://www.w3.org/2000/svg";
const shape = (tag, attributes) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};
const FLAGS = {
  en: () => [
    shape("rect", { width: 22, height: 16, fill: "#fff" }),
    ...[0, 2, 4, 6, 8, 10, 12].map((i) => shape("rect", { y: (i * 16) / 13, width: 22, height: 16 / 13, fill: "#b22234" })),
    shape("rect", { width: 9.5, height: 8.6, fill: "#3c3b6e" }),
    ...[[2, 2], [4.75, 2], [7.5, 2], [3.4, 4.3], [6.1, 4.3], [2, 6.6], [4.75, 6.6], [7.5, 6.6]].map(([cx, cy]) => shape("circle", { cx, cy, r: 0.55, fill: "#fff" })),
  ],
  he: () => [
    shape("rect", { width: 22, height: 16, fill: "#fff" }),
    shape("rect", { y: 1.6, width: 22, height: 2.2, fill: "#0038b8" }),
    shape("rect", { y: 12.2, width: 22, height: 2.2, fill: "#0038b8" }),
    shape("path", { d: "M11 4.9 14.2 10.4H7.8ZM11 11.1 7.8 5.6H14.2Z", fill: "none", stroke: "#0038b8", "stroke-width": 0.8 }),
  ],
};

function buttonFor(code, name) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.lang = code;
  button.setAttribute("aria-label", name);
  button.title = name;
  const flag = shape("svg", { viewBox: "0 0 22 16", width: 22, height: 16, "aria-hidden": "true", class: "flag" });
  flag.append(...FLAGS[code]());
  button.append(flag);
  button.addEventListener("click", () => setLang(code));
  return button;
}

function buildToggle() {
  const toggle = document.createElement("div");
  toggle.className = "lang-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Language");
  toggle.dir = "ltr"; // US | IL keeps its order in both directions
  toggle.append(buttonFor("en", "English"), buttonFor("he", "עברית"));
  // Sits in the top bar right after the last control (Sign in, Sign out, Save...), so it is always beside it.
  const bar = document.querySelector(".appbar");
  const host = bar?.lastElementChild?.matches("nav, .group") ? bar.lastElementChild : bar;
  (host ?? document.body).append(toggle);
  return toggle;
}

function markActive(toggle) {
  for (const button of toggle.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
}

export function setLang(next) {
  lang = next === "he" ? "he" : "en";
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  observer.disconnect(); // our own rewrites need no second pass
  applyTree(document.documentElement);
  observe();
  markActive(document.querySelector(".lang-toggle"));
}

function start() {
  const toggle = buildToggle();
  markActive(toggle);
  applyTree(document.documentElement);
  observe();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
