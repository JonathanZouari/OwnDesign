// Budget and shopping list for one saved project (?project=<id>). Totals update live while editing; saving is explicit.
import { api, requireSession, signOut } from "../api.js";
import * as B from "../budget-logic.js";
import { BUDGET, ltr } from "../strings.js";
import { $, formatDate, h, run, showStudio, toast, userMessage } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else is never used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}`;
const SAVE_TIMEOUT_MS = 30_000;

const state = {
  project: null,
  currency: null, // the list's currency (null until chosen)
  budget: null, // {min, max, currency} from the brief, as last returned by the server
  rows: [], // editable rows; quantity and unit_price are the typed text
  updatedAt: null, // the server's version of the saved list, an opaque string sent back unchanged (null: no list yet)
  saving: false,
  touched: new Set(), // "<row key>:<field>" of the fields whose errors are shown
  saved: "", // snapshot of the last saved state, to detect unsaved changes
  nextKey: 1,
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

// A live region is written only when its text changes, so typing does not repeat the announcement.
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function renderDirty() {
  setText($("#save-status"), isDirty() ? BUDGET.unsaved : state.saved ? BUDGET.allSaved : "");
}

// ---- errors -----------------------------------------------------------------------------------------

const fieldId = (row, field) => `${row.key}:${field}`;

// The announced summary of the errors on screen. It waits for a pause in typing; after a save or export attempt it
// is cleared first, so the same text is announced again.
let summaryTimer;
function summarise({ attempt = false } = {}) {
  const box = $("#error-summary");
  clearTimeout(summaryTimer);
  if (attempt) box.textContent = "";
  summaryTimer = setTimeout(() => {
    const count = $("#rows").querySelectorAll('[aria-invalid="true"], .row-error:not([hidden])').length;
    setText(box, count ? BUDGET.errorSummary(count) : "");
  }, attempt ? 50 : 800);
}

// A save or export attempt shows every error and moves to the first one. -> the API items, or null.
function collect() {
  for (const row of state.rows) for (const field of Object.keys(BUDGET.fields)) state.touched.add(fieldId(row, field));
  refresh();
  const parsed = state.rows.map(B.parseItem);
  const bad = parsed.findIndex(({ item }) => !item);
  if (bad < 0) return parsed.map(({ item }) => item);
  summarise({ attempt: true });
  const { key } = state.rows[bad];
  const inCell = Object.keys(parsed[bad].errors).map((field) => $(`#err-${key}-${field}`)).find(Boolean);
  (inCell?.previousElementSibling ?? $(`tr[data-key="${key}"] input`)).focus(); // no cell: the row's first field
  return null;
}

// Showing an error moves what is below it. Done during a click, that would move the button from under the pointer, so
// the update waits until the click is over (a tap sends its mouse events after pointerup, within one task).
let pointerHeld = false;
function afterClick(task) {
  if (!pointerHeld) return setTimeout(task);
  window.addEventListener("pointerup", () => setTimeout(task), { once: true });
}

// ---- table ------------------------------------------------------------------------------------------

function setError(input, holder, key) {
  const message = key ? BUDGET.errors[key] : "";
  input.setAttribute("aria-invalid", String(Boolean(message)));
  holder.textContent = message;
  holder.hidden = !message;
}

function buildRow(row, index) {
  const position = index + 1;
  const label = (field) => BUDGET.rowLabel(BUDGET.fields[field], row.name.trim(), position);
  const refs = {};

  // One cell: control, its inline error message (linked with aria-describedby), and the text printed instead of
  // the control, which can wrap.
  const cell = (field, control) => {
    const error = h("p", { class: "field-error", id: `err-${row.key}-${field}`, hidden: true });
    const printed = h("span", { class: "print-only", dir: control.dir || "auto" });
    control.setAttribute("aria-describedby", error.id);
    control.setAttribute("aria-label", label(field));
    control.addEventListener("blur", () => {
      state.touched.add(fieldId(row, field));
      afterClick(() => {
        tr.update();
        summarise();
      });
    });
    refs[field] = { control, error, printed };
    return h("td", {}, control, error, printed);
  };

  const text = (field, props = {}) =>
    h("input", {
      type: "text",
      value: row[field],
      ...props,
      oninput: (event) => {
        row[field] = event.target.value;
        state.touched.add(fieldId(row, field));
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

  // Errors of fields without a cell are shown under the name, and name the row.
  const rowError = h("p", { class: "field-error row-error", id: `err-${row.key}-row`, hidden: true });
  const amount = h("td", { class: "num" });
  const remove = h("button", { type: "button", class: "danger", onclick: () => removeRow(row) }, icon("delete"));
  const tr = h(
    "tr",
    { "data-key": row.key },
    // maxLength counts UTF-16 units: room for more than MAX_NAME emoji, so a name that is too long shows an error.
    cell("name", text("name", { maxLength: 4 * B.MAX_NAME, autocomplete: "off" })),
    cell("category", select("category", B.CATEGORIES, BUDGET.categories)),
    cell("room", text("room", { autocomplete: "off" })),
    cell("quantity", text("quantity", { inputmode: "decimal", dir: "ltr" })),
    cell("unit", select("unit", B.UNIT_KEYS, BUDGET.units)),
    cell("unit_price", text("unit_price", { inputmode: "numeric", dir: "ltr" })),
    amount,
    h("td", { class: "no-print" }, remove),
  );
  refs.name.error.after(rowError);
  refs.name.control.setAttribute("aria-describedby", `${refs.name.error.id} ${rowError.id}`);

  // Updates the parts of this row that depend on what was typed, without rebuilding the inputs (focus is kept).
  const update = () => {
    const errors = B.validateItem(row);
    for (const field of Object.keys(refs)) {
      const { control, error, printed } = refs[field];
      control.setAttribute("aria-label", label(field));
      setError(control, error, state.touched.has(fieldId(row, field)) ? errors[field] : null);
      printed.textContent = control.tagName === "SELECT" ? (control.selectedOptions[0]?.textContent ?? "") : row[field];
    }
    const unseen = Object.keys(errors).filter((field) => !refs[field]);
    rowError.textContent = unseen.map((field) => BUDGET.rowError(row.name.trim(), position, BUDGET.errors[errors[field]])).join(" ");
    rowError.hidden = !unseen.length;
    const quantity = B.parseQuantity(row.quantity);
    const price = B.parsePrice(row.unit_price);
    amount.textContent = quantity.error || price.error ? "—" : money(B.lineAmount(quantity.value, price.value));
    remove.setAttribute("aria-label", BUDGET.removeRow(row.name.trim(), position));
  };
  tr.update = update;
  update();
  return tr;
}

function renderRows(focusKey = null) {
  $("#rows").replaceChildren(...state.rows.map(buildRow));
  renderSummary();
  summarise();
  if (focusKey != null) $(`tr[data-key="${focusKey}"] input`)?.focus();
}

// After typing: refresh the changed row labels/errors and the live totals.
function refresh() {
  for (const tr of $("#rows").children) tr.update();
  renderSummary();
  summarise();
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
  state.updatedAt = estimate.updated_at ?? null;
  state.rows = estimate.items.map(rowFromItem);
  state.touched.clear();
  state.saved = snapshot();
  $("#currency").value = state.currency ?? "";
  renderRows();
  $("#updated").textContent = state.updatedAt ? BUDGET.updatedAt(formatDate(state.updatedAt)) : "";
}

// While a save is pending the list cannot be edited: the answer replaces the rows, and would drop what was typed.
function setSaving(saving) {
  state.saving = saving;
  $("#list-card").inert = saving;
  $("#saving").textContent = saving ? BUDGET.saving : "";
}

async function save() {
  if (state.saving) return;
  const items = collect();
  if (!items) return;
  if (!state.currency) {
    toast(BUDGET.needCurrency, "error");
    return $("#currency").focus();
  }
  const body = { currency: state.currency, items, base_updated_at: state.updatedAt };
  let estimate;
  setSaving(true);
  try {
    const signal = AbortSignal.timeout(globalThis.atelierSaveTimeoutMs ?? SAVE_TIMEOUT_MS); // the global is for tests
    estimate = await api(`${base}/estimate`, { method: "PUT", body, signal });
  } catch (error) {
    setSaving(false);
    $("#save").focus(); // inert took the focus away
    if (error.status === 409) return resolveConflict();
    // The list may have been saved: saving again is safe, because the server accepts what it already holds.
    if (error.aborted) throw new Error(BUDGET.saveTimedOut);
    throw error;
  }
  setSaving(false);
  load(estimate);
  report();
  $("#save").focus();
}

// Someone else saved since this page read the list. Nothing is overwritten: the user takes their changes out as a
// file, loads the other version, or goes back to editing (and the next save conflicts again).
function resolveConflict() {
  return showDialog({
    title: BUDGET.conflictTitle,
    body: BUDGET.conflictBody,
    actions: (dialog) => [
      { label: BUDGET.conflictExport, run: () => downloadCsv() && dialog.note(BUDGET.exported) },
      {
        label: BUDGET.conflictLoad,
        kind: "danger",
        run: async () => {
          dialog.busy(true);
          try {
            const latest = await api(`${base}/estimate`);
            if (!dialog.isOpen()) return; // cancelled while loading: the edits stay
            load(latest);
            report();
            dialog.close();
          } catch (error) {
            dialog.note(userMessage(error));
          } finally {
            dialog.busy(false);
          }
        },
      },
      { label: BUDGET.cancel, initial: true, run: () => dialog.close() },
    ],
  });
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

// One replacement at a time, and no save while the rows are about to be replaced.
async function exclusive(trigger, task) {
  const buttons = [$("#load-sample"), $("#import"), $("#save")];
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
  state.touched.clear();
  renderRows();
}

// ---- sample list ------------------------------------------------------------------------------------

async function applySample() {
  const sample = await api("/v1/estimate/sample");
  replaceRows(sample.items, sample.currency);
  report();
  toast(BUDGET.loadedSample);
}

// The modal dialog. `actions(dialog)` returns the buttons: {label, kind?, initial?, run}; the initial one takes the
// focus and stays enabled while busy. Esc closes the dialog. Resolves once it is closed, with the focus back where
// it was.
function showDialog({ title, body, actions }) {
  const box = $("#confirm");
  const opener = document.activeElement;
  let buttons = [];
  // The one <dialog> is reused: a late answer must not act on a dialog opened after this one was closed.
  const isOpen = () => box.open && buttons.some(({ node }) => node.isConnected);
  const dialog = {
    isOpen,
    close: () => isOpen() && box.close(),
    note: (text) => isOpen() && ($("#confirm-note").textContent = text),
    busy: (busy) => {
      for (const { node, initial } of buttons) node.disabled = busy && !initial;
      if (busy) buttons.find(({ initial }) => initial)?.node.focus(); // a disabled button cannot keep the focus
    },
  };
  buttons = actions(dialog).map(({ label, kind = "", initial = false, run: onclick }) => ({
    initial,
    node: h("button", { type: "button", class: kind, onclick }, label),
  }));
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  $("#confirm-note").textContent = "";
  $("#confirm-actions").replaceChildren(...buttons.map(({ node }) => node));
  return new Promise((resolve) => {
    const closed = () => {
      opener?.focus();
      resolve();
    };
    box.addEventListener("close", closed, { once: true });
    box.showModal();
    buttons.find(({ initial }) => initial)?.node.focus();
  });
}

// showModal() makes the page behind inert, but Tab could still leave for the browser's own controls.
function trapTab(event) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
  const at = buttons.indexOf(document.activeElement);
  const next = event.shiftKey ? (at <= 0 ? buttons.length : at) - 1 : (at + 1) % buttons.length;
  buttons[next]?.focus();
}

async function askConfirm({ title, body, yes, no }) {
  let answer = false;
  await showDialog({
    title,
    body,
    actions: (dialog) => [
      {
        label: yes,
        kind: "danger",
        run: () => {
          answer = true;
          dialog.close();
        },
      },
      { label: no, initial: true, run: () => dialog.close() },
    ],
  });
  return answer;
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

// -> false when a row is invalid (its errors are then shown)
function downloadCsv() {
  const items = collect();
  if (!items) return false;
  const csv = B.toCsv(items, state.currency, csvLabels);
  const slug = state.project.name.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = h("a", { href: url, download: `budget-${slug}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function exportCsv() {
  if (downloadCsv()) toast(BUDGET.exported);
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
  $("#save").addEventListener("click", () => save().catch((error) => toast(userMessage(error), "error")));
  $("#confirm").addEventListener("keydown", trapTab);
  for (const [type, held] of [["pointerdown", true], ["pointerup", false], ["pointercancel", false]]) {
    window.addEventListener(type, () => (pointerHeld = held), true);
  }
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
