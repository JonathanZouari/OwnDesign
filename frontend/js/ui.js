import { COMMON } from "./strings.js";

export const $ = (selector, root = document) => root.querySelector(selector);

// Tiny DOM builder. Text always goes in as text nodes, never as HTML, so user content cannot inject markup.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

export function toast(message, kind = "info") {
  let region = $("#toasts");
  if (!region) {
    region = h("div", { id: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(region);
  }
  const note = h("div", { class: `toast ${kind}` }, message);
  region.append(note);
  setTimeout(() => note.remove(), kind === "error" ? 8000 : 4000);
}

// Only our own (Hebrew) messages are shown; a browser or library exception text is replaced.
export const userMessage = (error) => (/[֐-׿]/.test(error?.message ?? "") ? error.message : COMMON.somethingWentWrong);

// Runs a page's async entry point and surfaces any failure to the user instead of failing silently.
export async function run(main) {
  try {
    await main();
  } catch (error) {
    toast(userMessage(error), "error");
  }
}

// Wraps a form submit / button handler: disables the control while busy and reports errors.
export const action = (handler) => async (event) => {
  event.preventDefault();
  const control = event.submitter ?? event.currentTarget;
  control.disabled = true;
  try {
    await handler(event);
  } catch (error) {
    toast(userMessage(error), "error");
  } finally {
    control.disabled = false;
  }
};

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(COMMON.linkCopied);
  } catch {
    toast(COMMON.copyFailed, "error");
  }
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const pageUrl = (page) => new URL(page, location.href).href;

// Keeps the Hebrew face of a hidden file input showing the chosen file's name.
export function showFileName(input) {
  const label = input.parentElement.querySelector(".file-name");
  const empty = label.textContent;
  input.addEventListener("change", () => (label.textContent = input.files[0]?.name ?? empty));
  input.form?.addEventListener("reset", () => (label.textContent = empty));
}

// The studio a visitor is working with, shown as a chip beside the product name.
export function showStudio(name) {
  const chip = $("#studio-brand");
  chip.textContent = name;
  chip.dir = "auto"; // a Latin name is cut at its end, not its start
  chip.hidden = false;
}
