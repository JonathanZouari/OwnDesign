// Pure helpers for the budget page. No DOM, no network. Limits mirror backend/app/schemas.py (BudgetItem).
// Every amount is an estimate, never a supplier price (PRD FR-10, MVP-06).

export const MAX_LINES = 300;
export const MAX_QTY = 100_000;
export const MAX_PRICE = 100_000_000;
export const MAX_LABEL = 80;
export const MAX_NOTE = 200;
export const KINDS = ["furniture", "finish", "custom"];

const NUMBER = /^\d+(\.\d{1,2})?$/;

export function parseQty(raw) {
  const text = String(raw ?? "").trim();
  if (!NUMBER.test(text) || Number(text) > MAX_QTY) throw new Error(`Quantity must be a number from 0 to ${MAX_QTY.toLocaleString("en-US")} with at most 2 decimals.`);
  return Number(text);
}

export function parsePrice(raw) {
  const text = String(raw ?? "").trim();
  const value = Number(text);
  if (text === "" || !/^\d+$/.test(text) || value > MAX_PRICE) throw new Error(`Price must be a whole number from 0 to ${MAX_PRICE.toLocaleString("en-US")}.`);
  return value;
}

export const lineSubtotal = (line) => Math.round(line.qty * line.unit_price);

export function summarize(lines) {
  const subtotals = { furniture: 0, finish: 0, custom: 0 };
  for (const line of lines) subtotals[line.kind] += lineSubtotal(line);
  return { subtotals, total: subtotals.furniture + subtotals.finish + subtotals.custom };
}

// How the total compares with the brief's target range: "none" (no target), "under", "within" or "over".
export function targetStatus(total, min, max) {
  if (min == null && max == null) return "none";
  if (max != null && total > max) return "over";
  if (min != null && total < min) return "under";
  return "within";
}

export const formatMoney = (amount, currency) => `${Number(amount).toLocaleString("en-US")} ${currency}`;

export const lineKey = (line) => (line.ref == null ? null : `${line.kind}:${line.ref}`);

// Suggestions the budget does not already have, so applying them twice never duplicates a line.
export function newSuggestions(lines, suggestions) {
  const have = new Set(lines.map(lineKey).filter(Boolean));
  return suggestions.filter((suggestion) => !have.has(lineKey(suggestion)));
}

// Rows as edited on the page (strings) -> { payload } for PUT /budget, or { error } naming the line.
export function buildPayload(rows) {
  if (rows.length > MAX_LINES) return { error: `A budget can have at most ${MAX_LINES} lines.` };
  const items = [];
  for (const [index, row] of rows.entries()) {
    const where = `Line ${index + 1}`;
    const label = String(row.label ?? "").trim();
    if (label === "" || label.length > MAX_LABEL) return { error: `${where}: the name must be 1 to ${MAX_LABEL} characters.` };
    const note = String(row.note ?? "").trim();
    if (note.length > MAX_NOTE) return { error: `${where}: the note is limited to ${MAX_NOTE} characters.` };
    try {
      items.push({
        kind: row.kind,
        ref: row.ref ?? null,
        label,
        qty: parseQty(row.qty),
        unit: row.unit,
        unit_price: parsePrice(row.unit_price),
        note,
      });
    } catch (error) {
      return { error: `${where}: ${error.message}` };
    }
  }
  return { payload: { items } };
}

// The message for a number field that cannot be saved as typed, or null. Shown beside the field while typing.
export function fieldError(key, raw) {
  try {
    if (key === "qty") parseQty(raw);
    if (key === "unit_price") parsePrice(raw);
    return null;
  } catch (error) {
    return error.message;
  }
}

// A cell that a spreadsheet could read as a formula gets a leading apostrophe, so typed text never runs as one.
const csvCell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// The shopping list as CSV text. The BOM makes Excel read non-Latin names correctly.
export function shoppingListCsv(lines, currency, notice) {
  const rows = [
    [notice],
    ["Type", "Item", "Quantity", "Unit", `Price per unit (${currency})`, `Subtotal (${currency})`, "Note"],
    ...lines.map((line) => [line.kind, line.label, line.qty, line.unit, line.unit_price, lineSubtotal(line), line.note]),
    ["", "", "", "", "Estimated total", summarize(lines).total, ""],
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
