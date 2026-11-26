// Budget and shopping list for one saved project (?project=<id>). Estimates only; everything shown comes from the API.
import { api, requireSession, signOut } from "../api.js";
import * as B from "../budget-logic.js";
import { $, h, run, showStudio } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null;
const base = `/v1/projects/${encodeURIComponent(projectId)}`;
const KIND_LABEL = { furniture: "Furniture", finish: "Finishes", custom: "Other" };
const UNIT_LABEL = { item: "item", m2: "m²" };

// rows: lines as edited (qty and unit_price stay strings as typed); budget: the last saved summary.
const state = { rows: [], currency: "USD", min: null, max: null, saved: null };

function setStatus(node, message, kind = "ok") {
  node.textContent = message;
  node.classList.toggle("error", kind === "error");
}

const toRow = (line) => ({ ...line, qty: String(line.qty), unit_price: String(line.unit_price) });

// Numbers typed but not yet valid count as 0 in the live total; saving reports the problem.
function liveLines() {
  return state.rows.map((row) => {
    const qty = Number(row.qty);
    const price = Number(row.unit_price);
    return { kind: row.kind, qty: Number.isFinite(qty) ? qty : 0, unit_price: Number.isFinite(price) ? price : 0 };
  });
}

function renderSummary() {
  const { subtotals, total } = B.summarize(liveLines());
  const money = (amount) => B.formatMoney(amount, state.currency);
  const target = state.min == null && state.max == null ? "Not set in the brief" : `${state.min == null ? "…" : money(state.min)} – ${state.max == null ? "…" : money(state.max)}`;
  const rows = [
    ["Estimated total", money(total)],
    ...B.KINDS.map((kind) => [KIND_LABEL[kind], money(subtotals[kind])]),
    ["Target budget", target],
  ];
  $("#summary").replaceChildren(...rows.map(([term, value], index) => h("div", { class: index === 0 ? "total" : "" }, h("dt", {}, term), h("dd", { class: "mono" }, value))));
  const status = B.targetStatus(total, state.min, state.max);
  const text = { none: "", under: "Below your target range.", within: "Within your target range.", over: "Above your target range." }[status];
  setStatus($("#target-status"), text, status === "over" ? "error" : "ok");
}

// The rows as they were last saved or loaded; the page is "dirty" when they differ from what is on screen.
let baseline = "[]";
const snapshot = () => JSON.stringify(state.rows.map(({ kind, ref, label, qty, unit, unit_price, note }) => ({ kind, ref, label, qty, unit, unit_price, note })));
const isDirty = () => snapshot() !== baseline;

function showDirty() {
  const status = $("#save-status");
  if (isDirty()) setStatus(status, "Unsaved changes.");
  else if (status.textContent === "Unsaved changes.") setStatus(status, "");
}

window.addEventListener("beforeunload", (event) => {
  if (isDirty()) event.preventDefault();
});

function field(row, key, label, attrs = {}) {
  const input = h("input", { type: "text", value: row[key], "aria-label": label, ...attrs });
  const check = () => {
    const problem = B.fieldError(key, input.value);
    input.setAttribute("aria-invalid", problem ? "true" : "false");
    input.title = problem ?? "";
  };
  check();
  input.addEventListener("input", () => {
    row[key] = input.value;
    check();
    showDirty();
    renderSummary();
    if (key === "qty" || key === "unit_price") subtotalCell(row).textContent = subtotalText(row);
  });
  return input;
}

const subtotalText = (row) => {
  const qty = Number(row.qty);
  const price = Number(row.unit_price);
  return B.formatMoney(Number.isFinite(qty) && Number.isFinite(price) ? B.lineSubtotal({ qty, unit_price: price }) : 0, state.currency);
};
const cells = new WeakMap();
const subtotalCell = (row) => cells.get(row);

function renderLines() {
  const body = $("#lines-body");
  $("#lines-table").hidden = state.rows.length === 0;
  $("#lines-empty").hidden = state.rows.length > 0;
  body.replaceChildren(
    ...state.rows.map((row, index) => {
      const subtotal = h("td", { class: "mono" }, subtotalText(row));
      cells.set(row, subtotal);
      const name = field(row, "label", `Item name, line ${index + 1}`, { maxLength: B.MAX_LABEL });
      const remove = h("button", { type: "button", "aria-label": `Remove line ${index + 1}` }, h("span", { class: "icon", "aria-hidden": "true" }, "delete"));
      remove.addEventListener("click", () => {
        const removed = state.rows[index].label;
        state.rows.splice(index, 1);
        renderLines();
        renderSummary();
        showDirty();
        // Keep the keyboard place: the next line's name, or the add button when the list is empty.
        const names = document.querySelectorAll("#lines-body tr td:first-child input");
        (names[Math.min(index, names.length - 1)] ?? $("#add-custom")).focus();
        setStatus($("#save-status"), `Removed "${removed}". Unsaved changes.`);
      });
      return h(
        "tr",
        {},
        h("td", {}, name, row.stale ? h("span", { class: "chip caution" }, "Not in the saved plan any more") : null),
        h("td", {}, field(row, "qty", `Quantity, line ${index + 1}`, { inputMode: "decimal", size: 6 })),
        h("td", {}, UNIT_LABEL[row.unit]),
        h("td", {}, field(row, "unit_price", `Price per unit, line ${index + 1}`, { inputMode: "numeric", size: 9 })),
        subtotal,
        h("td", {}, field(row, "note", `Note, line ${index + 1}`, { maxLength: B.MAX_NOTE })),
        h("td", {}, remove),
      );
    }),
  );
}

// The shopping list shows the last saved budget, grouped by kind.
function renderShopping() {
  const lines = state.saved?.items ?? [];
  const body = $("#shopping-body");
  if (lines.length === 0) return body.replaceChildren(h("p", { class: "muted" }, "Nothing to buy yet."));
  const groups = B.KINDS.filter((kind) => lines.some((line) => line.kind === kind)).map((kind) =>
    h(
      "section",
      { class: "shopping-group" },
      h("h3", {}, KIND_LABEL[kind]),
      h(
        "ul",
        { class: "plain" },
        ...lines
          .filter((line) => line.kind === kind)
          .map((line) =>
            h("li", {}, `${line.qty} ${UNIT_LABEL[line.unit]} · ${line.label} · ${B.formatMoney(line.subtotal, state.currency)}`, line.note ? h("span", { class: "muted" }, ` (${line.note})`) : null),
          ),
      ),
    ),
  );
  body.replaceChildren(...groups, h("p", { class: "mono" }, `Estimated total: ${B.formatMoney(state.saved.total, state.currency)}`), h("p", { class: "muted small" }, state.saved.notice));
}

function useSaved(summary) {
  state.saved = summary;
  state.rows = summary.items.map(toRow);
  state.currency = summary.currency;
  state.min = summary.budget_min;
  state.max = summary.budget_max;
  baseline = snapshot();
  renderLines();
  renderSummary();
  renderShopping();
}

async function busy(button, work, done) {
  const status = $("#save-status");
  button.disabled = true;
  setStatus(status, "Working…");
  try {
    await work();
    setStatus(status, done);
  } catch (error) {
    setStatus(status, error.message || "Something went wrong.", "error");
  } finally {
    button.disabled = false;
  }
}

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const [project, summary] = await Promise.all([api(base), api(`${base}/budget`)]);
  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · Budget`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  for (const page of ["editor", "design", "consultant", "budget"]) $(`#nav-${page}`).href = `${page}.html${query}`;

  $("#add-custom").addEventListener("click", () => {
    if (state.rows.length >= B.MAX_LINES) return setStatus($("#save-status"), `A budget can have at most ${B.MAX_LINES} lines.`, "error");
    state.rows.push({ kind: "custom", ref: null, label: "New item", qty: "1", unit: "item", unit_price: "0", note: "" });
    renderLines();
    renderSummary();
    showDirty();
    document.querySelector("#lines-body tr:last-child td:first-child input").focus();
  });

  $("#add-suggestions").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      const data = await api(`${base}/budget/suggestions`);
      const fresh = B.newSuggestions(state.rows, data.suggestions);
      state.rows.push(...fresh.slice(0, B.MAX_LINES - state.rows.length).map(toRow));
      renderLines();
      renderSummary();
      if (fresh.length === 0) throw new Error("Nothing new to add. Save a plan and choose finishes first.");
    }, "Added. Review the quantities and prices, then save."),
  );

  $("#save-budget").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      const { payload, error } = B.buildPayload(state.rows);
      if (error) throw new Error(error);
      useSaved(await api(`${base}/budget`, { method: "PUT", body: payload }));
    }, "Saved."),
  );

  $("#print-list").addEventListener("click", () => window.print());

  // The CSV and the printout are the last saved budget, not unsaved edits.
  $("#download-csv").addEventListener("click", () => {
    if (!state.saved) return;
    const csv = B.shoppingListCsv(state.saved.items, state.currency, state.saved.notice);
    const link = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "shopping-list.csv" });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  });

  useSaved(summary);
  $("#budget").hidden = false;
});
