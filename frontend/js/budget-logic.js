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

export function parseQuantity(text) {
  const raw = String(text ?? "").trim().replace(",", ".");
  if (raw === "") return { error: "quantityInvalid" };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: "quantityInvalid" };
  if (/\.\d{3,}/.test(raw)) return { error: "quantityDecimals" };
  const value = Number(raw);
  if (value <= 0) return { error: "quantityInvalid" };
  if (value > MAX_QUANTITY) return { error: "quantityRange" };
  return { value };
}

export function parsePrice(text) {
  const raw = String(text ?? "").trim();
  if (raw === "" || !/^\d+$/.test(raw)) return { error: "priceInvalid" };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_PRICE) return { error: "priceRange" };
  return { value };
}

// raw: {name, category, room, quantity, unit, unit_price, source, note} where quantity and unit_price are the typed text.
// Returns {item, errors}: `item` is the API shape when errors is empty, else null.
export function parseItem(raw) {
  const errors = {};
  const name = String(raw.name ?? "").trim();
  if (!name) errors.name = "nameRequired";
  else if (name.length > MAX_NAME) errors.name = "nameTooLong";
  const room = String(raw.room ?? "").trim();
  if (room.length > MAX_ROOM) errors.room = "roomTooLong";
  const note = String(raw.note ?? "").trim();
  if (note.length > MAX_NOTE) errors.note = "noteTooLong";
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

// A cell that starts with = + - @ tab or CR can run as a formula in a spreadsheet; a leading ' defuses it.
export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
