// Budget and shopping list for one saved project (?project=<id>). Totals update live while editing; saving is explicit.
import { api, requireSession, signOut } from "../api.js";
import * as B from "../budget-logic.js";
import { BUDGET, ltr } from "../strings.js";
import { $, action, formatDate, h, run, showStudio, toast, userMessage } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else is never used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}`;

const state = {
  project: null,
  currency: null, // the list's currency (null until chosen)
  budget: null, // {min, max, currency} from the brief, as last returned by the server
  rows: [], // editable rows; quantity and unit_price are the typed text
  saved: "", // snapshot of the last saved state, to detect unsaved changes
  nextKey: 1,
  showErrors: false, // inline errors appear once the user has typed in a field or tried to save
};

const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, name);

// ---- formatting -------------------------------------------------------------------------------------

function money(amount, currency = state.currency) {
  if (!currency) return new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 }).format(amount);
  return new Intl.NumberFormat("he-IL", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

// ---- rows -------------------------------------------------------------------------------------------

const rowFromItem = (item) => ({
  key: state.nextKey++,
  name: item.name ?? "",
  category: item.category,
  room: item.room ?? "",
  quantity: String(item.quantity),
  unit: item.unit,
  unit_price: String(item.unit_price),
  source: item.source === "synthetic" ? "synthetic" : "user",
  note: item.note ?? "",
});

const blankRow = () => rowFromItem({ name: "", category: "furniture", room: "", quantity: 1, unit: "unit", unit_price: 0, source: "user", note: "" });

const snapshot = () => JSON.stringify([state.currency, state.rows.map(({ key, ...row }) => row)]);
const isDirty = () => snapshot() !== state.saved;

// Rows whose quantity and price both parse count toward the live totals; the rest count as zero.
function liveItems() {
  return state.rows.map((row) => {
    const quantity = B.parseQuantity(row.quantity);
    const price = B.parsePrice(row.unit_price);
    return { category: row.category, quantity: quantity.value ?? 0, unit_price: price.value ?? 0 };
  });
}

// ---- summary (compare card, subtotals, grand total) -------------------------------------------------

function renderSummary() {
  const { total, byCategory } = B.totals(liveItems());
  const status = B.compareToBudget(total, state.currency, state.budget, state.rows.length);
  const budget = state.budget;
  const gap = (value) => ltr(money(value));

  const text = {
    no_items: BUDGET.status.no_items,
    no_budget: BUDGET.status.no_budget,
    currency_mismatch: () => BUDGET.status.currency_mismatch(budget.currency, state.currency ?? "—"),
    under: () => BUDGET.status.under(gap(budget.min - total)),
    within: BUDGET.status.within,
    over: () => BUDGET.status.over(gap(total - budget.max)),
  }[status];
  $("#compare-text").textContent = typeof text === "function" ? text() : text;
  const tag = $("#compare-tag");
  tag.textContent = BUDGET.statusTag[status];
  tag.className = `chip ${{ within: "ok", under: "caution", over: "accent", currency_mismatch: "caution" }[status] ?? ""}`;

  const hasRange = budget && (budget.min != null || budget.max != null);
  $("#compare-range").textContent = hasRange
    ? `${BUDGET.budgetRange(budget.min != null ? ltr(money(budget.min, budget.currency)) : null, budget.max != null ? ltr(money(budget.max, budget.currency)) : null)}`
    : "";
  $("#brief-link").hidden = !(status === "no_budget" || status === "currency_mismatch");

  const cards = B.CATEGORIES.filter((key) => byCategory[key] != null).map((key) =>
    h("div", { class: "card" }, h("span", { class: "label" }, BUDGET.categories[key]), h("div", { class: "amount num" }, money(byCategory[key]))),
  );
  cards.push(h("div", { class: "card total" }, h("span", { class: "label" }, BUDGET.total), h("div", { class: "amount num" }, money(total))));
  $("#subtotals").replaceChildren(...cards);
  $("#grand-total").textContent = money(total);

  $("#empty").hidden = state.rows.length > 0;
  $("#table-wrap").hidden = state.rows.length === 0;
  $("#add-row").disabled = state.rows.length >= B.MAX_ITEMS;
  $("#export").disabled = state.rows.length === 0;
  $("#print").disabled = state.rows.length === 0;
  renderDirty();
}

function renderDirty() {
  const status = $("#save-status");
  status.textContent = isDirty() ? BUDGET.unsaved : state.saved ? BUDGET.allSaved : "";
}

// ---- table ------------------------------------------------------------------------------------------

function rowErrors(row) {
  return B.validateItem(row);
}

function setError(input, holder, key) {
  const message = key && state.showErrors ? BUDGET.errors[key] : "";
  input.setAttribute("aria-invalid", String(Boolean(message)));
  holder.textContent = message;
  holder.hidden = !message;
}

function buildRow(row, index) {
  const position = index + 1;
  const label = (field) => BUDGET.rowLabel(BUDGET.fields[field], row.name.trim(), position);
  const refs = {};

  // One cell: control + its inline error message, linked with aria-describedby.
  const cell = (field, control, extra = {}) => {
    const error = h("p", { class: "field-error", id: `err-${row.key}-${field}`, hidden: true });
    control.setAttribute("aria-describedby", error.id);
    control.setAttribute("aria-label", label(field));
    refs[field] = { control, error };
    return h("td", extra, control, error);
  };

  const text = (field, props = {}) =>
    h("input", {
      type: "text",
      value: row[field],
      ...props,
      oninput: (event) => {
        row[field] = event.target.value;
        state.showErrors = true;
        refresh();
      },
    });
  const select = (field, keys, labels) => {
    const node = h("select", {
      onchange: (event) => {
        row[field] = event.target.value;
        refresh();
      },
    }, ...keys.map((key) => h("option", { value: key }, labels[key])));
    node.value = row[field];
    return node;
  };

  const amount = h("td", { class: "num" });
  const remove = h("button", { type: "button", class: "danger", onclick: () => removeRow(row) }, icon("delete"));
  const tr = h(
    "tr",
    { "data-key": row.key },
    cell("name", text("name", { maxLength: 200, autocomplete: "off" })),
    cell("category", select("category", B.CATEGORIES, BUDGET.categories)),
    cell("room", text("room", { autocomplete: "off" })),
    cell("quantity", text("quantity", { inputmode: "decimal", dir: "ltr" })),
    cell("unit", select("unit", B.UNIT_KEYS, BUDGET.units)),
    cell("unit_price", text("unit_price", { inputmode: "numeric", dir: "ltr" })),
    amount,
    h("td", { class: "no-print" }, remove),
  );

  // Updates the parts of this row that depend on what was typed, without rebuilding the inputs (focus is kept).
  const update = () => {
    const errors = rowErrors(row);
    for (const field of Object.keys(refs)) {
      const { control, error } = refs[field];
      control.setAttribute("aria-label", label(field));
      setError(control, error, errors[field]);
    }
    const quantity = B.parseQuantity(row.quantity);
    const price = B.parsePrice(row.unit_price);
    amount.textContent = quantity.error || price.error ? "—" : money(B.lineAmount(quantity.value, price.value));
    remove.setAttribute("aria-label", BUDGET.removeRow(row.name.trim(), position));
    return errors;
  };
  tr.update = update;
  update();
  return tr;
}

function renderRows(focusKey = null) {
  $("#rows").replaceChildren(...state.rows.map(buildRow));
  renderSummary();
  if (focusKey != null) $(`tr[data-key="${focusKey}"] input`)?.focus();
}

// After typing: refresh the changed row labels/errors and the live totals.
function refresh() {
  for (const tr of $("#rows").children) tr.update();
  renderSummary();
}

function removeRow(row) {
  const index = state.rows.indexOf(row);
  state.rows.splice(index, 1);
  const next = state.rows[Math.min(index, state.rows.length - 1)];
  renderRows(next?.key ?? null);
  if (!next) $("#add-row").focus();
}

function addRow() {
  if (state.rows.length >= B.MAX_ITEMS) return toast(BUDGET.tooMany, "error");
  if (!state.currency && state.budget?.currency) {
    state.currency = state.budget.currency;
    $("#currency").value = state.currency;
  }
  const row = blankRow();
  state.rows.push(row);
  renderRows(row.key);
  $(`tr[data-key="${row.key}"]`).scrollIntoView({ block: "nearest" });
}

// ---- server data ------------------------------------------------------------------------------------

function load(estimate) {
  state.currency = estimate.currency ?? null;
  state.budget = estimate.budget ?? null;
  state.rows = estimate.items.map(rowFromItem);
  state.showErrors = false;
  state.saved = snapshot();
  $("#currency").value = state.currency ?? "";
  $("#save-status").textContent = "";
  renderRows();
  $("#updated").textContent = estimate.updated_at ? BUDGET.updatedAt(formatDate(estimate.updated_at)) : "";
  renderDirty();
}

// Parses every row; returns the API items, or null after marking the invalid fields.
function collect() {
  state.showErrors = true;
  refresh();
  const items = [];
  for (const row of state.rows) {
    const { item } = B.parseItem(row);
    if (!item) {
      $(`#err-${row.key}-${Object.keys(rowErrors(row))[0]}`)?.previousElementSibling?.focus();
      toast(BUDGET.fixErrors, "error");
      return null;
    }
    items.push(item);
  }
  return items;
}

async function save() {
  const items = collect();
  if (!items) return;
  if (!state.currency) {
    toast(BUDGET.needCurrency, "error");
    return $("#currency").focus();
  }
  const estimate = await api(`${base}/estimate`, { method: "PUT", body: { currency: state.currency, items } });
  load(estimate);
  report();
  toast(BUDGET.saved);
}

// ---- replacing the whole list (sample or CSV file) ---------------------------------------------------

// What the last import did, or why it failed. The container is a live region that is always in the page.
function report(lines = [], { error = false } = {}) {
  if (!lines.length) return $("#import-report").replaceChildren();
  const [first, ...rest] = lines;
  $("#import-report").replaceChildren(
    h("div", { class: error ? "error" : "" }, h("p", { class: "strong" }, first), rest.length ? h("ul", {}, ...rest.map((line) => h("li", {}, line))) : null),
  );
}

// One replacement at a time: both buttons share the confirmation box.
async function exclusive(trigger, task) {
  const buttons = [$("#load-sample"), $("#import")];
  for (const button of buttons) button.disabled = true;
  try {
    await task();
  } catch (error) {
    toast(userMessage(error), "error");
  } finally {
    for (const button of buttons) button.disabled = false;
    trigger.focus();
  }
}

// True when the list is empty or the user agrees to lose it.
async function mayReplace(body) {
  if (!state.rows.length) return true;
  return askConfirm({ title: BUDGET.replaceTitle, body, yes: BUDGET.replaceConfirm, no: BUDGET.cancel });
}

function replaceRows(items, currency) {
  state.currency = currency;
  $("#currency").value = currency;
  state.rows = items.map(rowFromItem);
  state.showErrors = false;
  renderRows();
}

// ---- sample list ------------------------------------------------------------------------------------

async function applySample() {
  const sample = await api("/v1/estimate/sample");
  replaceRows(sample.items, sample.currency);
  report();
  toast(BUDGET.loadedSample);
}

function askConfirm({ title, body, yes, no }) {
  const box = $("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  $("#confirm-yes").textContent = yes;
  $("#confirm-no").textContent = no;
  box.hidden = false;
  $("#confirm-no").focus();
  return new Promise((resolve) => {
    const finish = (answer) => {
      box.hidden = true;
      box.onkeydown = null;
      resolve(answer);
    };
    $("#confirm-yes").onclick = () => finish(true);
    $("#confirm-no").onclick = () => finish(false);
    box.onkeydown = (event) => {
      if (event.key === "Escape") finish(false);
    };
  });
}

async function loadSample() {
  if (await mayReplace(BUDGET.replaceBody)) await applySample();
}

// ---- import -----------------------------------------------------------------------------------------

const csvLabels = { columns: BUDGET.columns, total: BUDGET.csvTotal, categories: BUDGET.categories, units: BUDGET.units };
const MAX_SHOWN_ERRORS = 10;

// -> {items, currency} or {errors}
async function readImport(file) {
  const fail = (key) => ({ errors: [{ key }] });
  if (file.size > B.MAX_CSV_BYTES) return fail("tooLarge"); // checked before reading it into memory
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return fail("unreadable");
  }
  const { text, error } = B.decodeCsv(bytes);
  return error ? fail(error) : B.importItems(B.parseCsv(text), csvLabels);
}

function showImportErrors(errors) {
  const describe = ({ line, key, column }) => {
    const entry = BUDGET.importErrors[key] ?? BUDGET.errors[key];
    const message = typeof entry === "function" ? entry(column) : entry;
    return line ? BUDGET.importLine(line, message) : message;
  };
  const lines = errors.slice(0, MAX_SHOWN_ERRORS).map(describe);
  if (errors.length > MAX_SHOWN_ERRORS) lines.push(BUDGET.importMore(errors.length - MAX_SHOWN_ERRORS));
  report([BUDGET.importFailed, ...lines], { error: true });
}

// The selected currency wins; without one it comes from the file, then the brief, then shekels.
function importCurrency(fileCurrency) {
  if (state.currency) {
    const differs = fileCurrency && fileCurrency !== state.currency;
    return { currency: state.currency, note: differs ? BUDGET.importCurrency.kept(fileCurrency, state.currency) : null };
  }
  const [source, currency] = fileCurrency
    ? ["file", fileCurrency]
    : B.CURRENCIES.includes(state.budget?.currency)
      ? ["brief", state.budget.currency]
      : ["fallback", "ILS"];
  return { currency, note: BUDGET.importCurrency[source](currency) };
}

// Nothing is saved here: the imported list replaces the rows on screen until the user saves.
async function importFile(file) {
  report();
  const result = await readImport(file);
  if (result.errors) return showImportErrors(result.errors);
  if (!(await mayReplace(BUDGET.importReplaceBody(result.items.length)))) return;
  const { currency, note } = importCurrency(result.currency);
  replaceRows(result.items, currency);
  report([BUDGET.imported(result.items.length), ...(note ? [note] : []), BUDGET.importUnsaved]);
}

// ---- export -----------------------------------------------------------------------------------------

function exportCsv() {
  const items = [];
  for (const row of state.rows) {
    const { item } = B.parseItem(row);
    if (!item) {
      state.showErrors = true;
      refresh();
      return toast(BUDGET.fixErrors, "error");
    }
    items.push(item);
  }
  const csv = B.toCsv(items, state.currency, csvLabels);
  const slug = state.project.name.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = h("a", { href: url, download: `budget-${slug}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(BUDGET.exported);
}

// ---- start ------------------------------------------------------------------------------------------

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const [project, estimate] = await Promise.all([api(base), api(`${base}/estimate`)]);
  state.project = project;
  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · ${BUDGET.pageTitle}`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  if (project.studio) showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  for (const [id, page] of [["editor", "editor"], ["design", "design"], ["consultant", "consultant"], ["budget", "budget"]]) $(`#nav-${id}`).href = `${page}.html${query}`;
  $("#brief-link").href = `design.html${query}`;

  $("#currency").replaceChildren(
    h("option", { value: "" }, BUDGET.noCurrency),
    ...B.CURRENCIES.map((code) => h("option", { value: code }, BUDGET.currencies[code])),
  );
  $("#currency").addEventListener("change", (event) => {
    state.currency = event.target.value || null;
    refresh();
  });
  $("#add-row").addEventListener("click", addRow);
  $("#load-sample").addEventListener("click", (event) => exclusive(event.currentTarget, loadSample));
  $("#import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    event.target.value = ""; // choosing the same file again must fire "change" again
    if (file) exclusive($("#import"), () => importFile(file));
  });
  $("#save").addEventListener("click", action(save));
  $("#export").addEventListener("click", exportCsv);
  $("#print").addEventListener("click", () => window.print());
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = ""; // the browser shows its own generic prompt
  });

  load(estimate);
  $("#budget").hidden = false;
});
