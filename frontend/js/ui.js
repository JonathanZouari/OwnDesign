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

// Runs a page's async entry point and surfaces any failure to the user instead of failing silently.
export async function run(main) {
  try {
    await main();
  } catch (error) {
    toast(error.message || "Something went wrong.", "error");
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
    toast(error.message || "Something went wrong.", "error");
  } finally {
    control.disabled = false;
  }
};

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied");
  } catch {
    toast("Copy failed. Select the link and copy it manually.", "error");
  }
}

// dd/mm/YYYY hh:mi:ss AM/PM in local time, the same in English and Hebrew.
export function formatDate(iso) {
  const date = new Date(iso);
  const two = (n) => String(n).padStart(2, "0");
  const hours = date.getHours() % 12 || 12;
  const meridiem = date.getHours() < 12 ? "AM" : "PM";
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(hours)}:${two(date.getMinutes())}:${two(date.getSeconds())} ${meridiem}`;
}

export const pageUrl = (page) => new URL(page, location.href).href;

// The studio a visitor is working with, shown as a chip beside the product name.
export function showStudio(name) {
  const chip = $("#studio-brand");
  chip.textContent = name;
  chip.hidden = false;
}
