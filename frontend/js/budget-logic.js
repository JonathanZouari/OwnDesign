// Pure budget / shopping-list logic (no DOM). Money is whole currency units; quantities are handled in hundredths
// so the arithmetic stays in exact integers (no 0.1 * 3 float drift).

export const CATEGORIES = ["furniture", "finish", "lighting", "textile", "appliance", "other"];
export const UNIT_KEYS = ["unit", "m2", "m", "set"];
export const CURRENCIES = ["ILS", "USD", "EUR", "GBP"];
export const MAX_ITEMS = 200;
export const MAX_NAME = 120;
export const MAX_ROOM = 60;
export const MAX_NOTE = 200;
export const MAX_QUANTITY = 10000;
export const MAX_PRICE = 100_000_000;

// Quantity as an integer count of hundredths. Works for any number with at most two decimals.
const hundredths = (quantity) => Math.round(Number(quantity) * 100);

// quantity x unit price, rounded half up to whole currency units, in exact integer arithmetic.
export function lineAmount(quantity, unitPrice) {
  const q = hundredths(quantity);
  const price = Math.round(Number(unitPrice));
  if (!Number.isFinite(q) || !Number.isFinite(price) || q <= 0 || price < 0) return 0;
  const cents = q * price + 50; // exact: at most 1e6 * 1e8 + 50
  return (cents - (cents % 100)) / 100;
}

export function totals(items) {
  const byCategory = {};
  let total = 0;
  for (const item of items) {
    const amount = lineAmount(item.quantity, item.unit_price);
    total += amount;
    byCategory[item.category] = (byCategory[item.category] ?? 0) + amount;
  }
  return { total, byCategory };
}

// Same statuses as the backend. `itemCount` is optional; 0 gives "no_items".
export function compareToBudget(total, currency, budget, itemCount = null) {
  if (itemCount === 0) return "no_items";
  const min = budget?.min ?? null;
  const max = budget?.max ?? null;
  if (!budget || (min === null && max === null)) return "no_budget";
  if (budget.currency !== currency) return "currency_mismatch";
  if (min !== null && total < min) return "under";
  if (max !== null && total > max) return "over";
  return "within";
}

// ---- parsing and validation of what the user typed ---------------------------------------------------
// Errors are keys; strings.js (BUDGET.errors) maps each to Hebrew.

// The one number rule, for the page and for CSV files: "1,200" is 1200. A comma that is not clearly a thousands
// separator ("2,5", "0,500", "1,00") gives null, because guessing would change the number by a factor.
function plainNumber(text) {
  const value = String(text ?? "").trim();
  if (!value.includes(",")) return value;
  return /^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(value) ? value.replaceAll(",", "") : null;
}

export function parseQuantity(text) {
  const raw = plainNumber(text);
  if (raw === null) return { error: "quantityComma" };
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(raw)) return { error: "quantityInvalid" };
  if (/\.\d\d\d*[1-9]/.test(raw)) return { error: "quantityDecimals" }; // trailing zeros are not decimals
  const value = Number(raw);
  if (value <= 0) return { error: "quantityInvalid" };
  if (value > MAX_QUANTITY) return { error: "quantityRange" };
  return { value };
}

export function parsePrice(text) {
  const raw = plainNumber(text);
  if (raw === null) return { error: "priceComma" };
  if (!/^\d+$/.test(raw)) return { error: "priceInvalid" };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_PRICE) return { error: "priceRange" };
  return { value };
}

// Characters as the server and the database count them: code points, so an emoji is one, not two.
const length = (text) => [...text].length;

// raw: {name, category, room, quantity, unit, unit_price, source, note} where quantity and unit_price are the typed text.
// Returns {item, errors}: `item` is the API shape when errors is empty, else null.
export function parseItem(raw) {
  const errors = {};
  const name = String(raw.name ?? "").trim();
  if (!name) errors.name = "nameRequired";
  else if (length(name) > MAX_NAME) errors.name = "nameTooLong";
  const room = String(raw.room ?? "").trim();
  if (length(room) > MAX_ROOM) errors.room = "roomTooLong";
  const note = String(raw.note ?? "").trim();
  if (length(note) > MAX_NOTE) errors.note = "noteTooLong";
  const quantity = parseQuantity(raw.quantity);
  if (quantity.error) errors.quantity = quantity.error;
  const price = parsePrice(raw.unit_price);
  if (price.error) errors.unit_price = price.error;
  if (!CATEGORIES.includes(raw.category)) errors.category = "categoryInvalid";
  if (!UNIT_KEYS.includes(raw.unit)) errors.unit = "unitInvalid";
  if (Object.keys(errors).length) return { item: null, errors };
  return {
    item: {
      category: raw.category,
      name,
      room: room || null,
      quantity: quantity.value,
      unit: raw.unit,
      unit_price: price.value,
      source: raw.source === "synthetic" ? "synthetic" : "user",
      note: note || null,
    },
    errors,
  };
}

export const validateItem = (raw) => parseItem(raw).errors;

// ---- CSV ---------------------------------------------------------------------------------------------

// Where a spreadsheet may start a cell: the start of the value, or after a ; tab or line break inside it (with a
// ";" list separator Excel splits there, quoted or not), skipping blanks and quotes.
const CELL_START = String.raw`(^|[;\t\r\n](?:[^\S\t\r\n]|")*)`;
// Apostrophes in front count too: each guarded position gets exactly one more, so the import can remove exactly one.
const FORMULA_AHEAD = String.raw`(?='*[=+\-@])`;
const UNGUARDED = new RegExp(`${CELL_START}${FORMULA_AHEAD}`, "g");
const GUARDED = new RegExp(`${CELL_START}'${FORMULA_AHEAD}`, "g");

// = + - @ at a cell start, or a leading tab or CR, can run as a formula in a spreadsheet; a ' in front defuses it.
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  text = text.replace(UNGUARDED, "$1'");
  if (/^'*[\t\r]/.test(text)) text = `'${text}`;
  return /[",;\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// labels: {columns: [name, category, room, quantity, unit, unitPrice, amount, note], total, categories: {key: text}, units: {key: text}}
export function toCsv(items, currency, labels) {
  const header = [...labels.columns];
  header[6] = currency ? `${header[6]} (${currency})` : header[6];
  const rows = items.map((item) => [
    item.name,
    labels.categories?.[item.category] ?? item.category,
    item.room ?? "",
    item.quantity,
    labels.units?.[item.unit] ?? item.unit,
    item.unit_price,
    lineAmount(item.quantity, item.unit_price),
    item.note ?? "",
  ]);
  const totalRow = [labels.total, "", "", "", "", "", totals(items).total, ""];
  const lines = [header, ...rows, totalRow].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ---- CSV import --------------------------------------------------------------------------------------
// Reads back what toCsv writes (and what a spreadsheet makes of it). All or nothing: any error imports nothing.

export const MAX_CSV_BYTES = 1024 * 1024;

// bytes -> {text} or {error}. Hebrew Excel's plain "CSV" is windows-1255; a NUL byte means a binary file (.xlsx).
export function decodeCsv(bytes) {
  if (bytes.length > MAX_CSV_BYTES) return { error: "tooLarge" };
  if (bytes.includes(0)) return { error: "notText" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { text: new TextDecoder("windows-1255").decode(bytes) };
  }
}

// The most frequent of , ; and tab outside quotes in the first line that has any text. Comma when there is none.
function detectDelimiter(text) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  let content = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (content) break;
      for (const key of Object.keys(counts)) counts[key] = 0;
      continue;
    } else if (!quoted && Object.hasOwn(counts, char)) {
      counts[char] += 1;
      continue;
    }
    if (char.trim()) content = true;
  }
  return Object.keys(counts).reduce((best, key) => (counts[key] > counts[best] ? key : best), ",");
}

// RFC 4180. Returns [{line, cells, error?}]: `line` is the 1-based line of the file on which the record starts.
export function parseCsv(input) {
  const text = String(input ?? "").replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows = [];
  let cells = [];
  let cell = "";
  let error = null;
  let quoted = false; // inside an open quoted cell
  let closed = false; // the current cell was quoted and its closing quote was read
  let line = 1;
  let start = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
    closed = false;
  };
  const endRow = () => {
    endCell();
    rows.push(error ? { line: start, cells, error } : { line: start, cells });
    cells = [];
    error = null;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const newline = char === "\n" || (char === "\r" && text[i + 1] !== "\n");
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
        closed = true;
      }
      if (newline) line += 1;
    } else if (char === delimiter) endCell();
    else if (newline) {
      endRow();
      line += 1;
      start = line;
    } else if (char === "\r") continue; // the first half of CRLF
    else if (char === '"' && cell === "" && !closed) quoted = true;
    else {
      if (closed) error = "badQuote";
      cell += char;
    }
  }
  if (quoted) error = "unterminatedQuote";
  if (quoted || closed || cell !== "" || cells.length) endRow();
  return rows;
}

const COLUMN_FIELDS = ["name", "category", "room", "quantity", "unit", "unit_price", "amount", "note"]; // order of labels.columns
const REQUIRED_FIELDS = ["name", "category", "quantity", "unit", "unit_price"];

// Hand-typed ASCII quotes count as the Hebrew gershayim / geresh of the labels.
const normalise = (value) => String(value ?? "").trim().replaceAll("״", '"').replaceAll("׳", "'").toLowerCase();

// The key for a typed label or key; unknown text is returned as is, for parseItem to reject.
const keyOf = (value, keys, labels) => {
  const wanted = normalise(value);
  return keys.find((key) => key === wanted || normalise(labels[key]) === wanted) ?? value;
};

// The exact inverse of the guard in csvCell: removes one apostrophe at each guarded position.
export const unguard = (value) => value.replace(GUARDED, "$1").replace(/^'(?='*[\t\r])/, "");

// The code in a title written as the export writes it, "amount (ILS)": {title, code}, or null. Plain string work, in
// linear time: a pattern that allows any run of spaces before the bracket is quadratic on a hostile header cell.
function splitCurrency(title) {
  const code = title.slice(-4, -1);
  if (title.at(-5) !== "(" || !title.endsWith(")") || !/^[a-z]{3}$/.test(code)) return null;
  return { title: title.slice(0, -5).trimEnd(), code: code.toUpperCase() };
}

// Header record -> {at: {field: index}, currency, errors}.
function readHeader({ line, cells }, labels) {
  const at = {};
  const errors = [];
  let currency = null;
  cells.forEach((cell, index) => {
    let title = normalise(cell);
    const withCode = splitCurrency(title);
    if (withCode && withCode.title === normalise(labels.columns[6])) {
      title = withCode.title;
      if (CURRENCIES.includes(withCode.code)) currency = withCode.code;
    }
    const position = labels.columns.findIndex((label) => normalise(label) === title);
    const field = COLUMN_FIELDS[position];
    if (!field || field === "amount") return; // unknown columns are ignored; the amount is recalculated
    if (Object.hasOwn(at, field)) errors.push({ line, key: "duplicateColumn", column: labels.columns[position] });
    else at[field] = index;
  });
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(at, field)) errors.push({ line, key: "missingColumn", column: labels.columns[COLUMN_FIELDS.indexOf(field)] });
  }
  return { at, currency, errors };
}

const isBlank = ({ cells, error }) => !error && cells.every((cell) => !cell.trim());

// rows: from parseCsv; labels: the same object toCsv takes.
// Returns {items, currency} (currency from the amount header, else null) or {errors: [{line, key, column?}]}.
export function importItems(rows, labels) {
  const [header, ...body] = rows.filter((row) => !isBlank(row));
  if (!header) return { errors: [{ line: 1, key: "emptyFile" }] };
  if (header.error) return { errors: [{ line: header.line, key: header.error }] };
  const { at, currency, errors } = readHeader(header, labels);
  if (errors.length) return { errors };

  const items = [];
  let count = 0;
  for (const { line, cells, error } of body) {
    if (error) {
      errors.push({ line, key: error });
      continue;
    }
    const value = (field) => unguard(cells[at[field]] ?? "");
    const isTotal =
      normalise(value("name")) === normalise(labels.total) && ["category", "quantity", "unit", "unit_price"].every((field) => !value(field).trim());
    if (isTotal) continue;
    count += 1;
    if (count > MAX_ITEMS) {
      errors.push({ line, key: "tooManyRows" });
      break;
    }
    // Text beyond the last column means an unquoted delimiter has shifted the cells.
    if (cells.slice(header.cells.length).some((cell) => cell.trim())) {
      errors.push({ line, key: "extraCells" });
      continue;
    }
    const parsed = parseItem({
      name: value("name"),
      category: keyOf(value("category"), CATEGORIES, labels.categories),
      room: value("room"),
      quantity: value("quantity"),
      unit: keyOf(value("unit"), UNIT_KEYS, labels.units),
      unit_price: value("unit_price"),
      source: "user",
      note: value("note"),
    });
    if (parsed.item) items.push(parsed.item);
    else errors.push(...Object.values(parsed.errors).map((key) => ({ line, key })));
  }
  if (errors.length) return { errors };
  if (!items.length) return { errors: [{ line: header.line, key: "noItems" }] };
  return { items, currency };
}
