import assert from "node:assert/strict";
import { test } from "node:test";
import * as B from "../js/budget-logic.js";

const item = (over = {}) => ({ category: "furniture", name: "ספה", room: "סלון", quantity: 1, unit: "unit", unit_price: 1000, source: "user", note: null, ...over });
const raw = (over = {}) => ({ name: "ספה", category: "furniture", room: "", quantity: "1", unit: "unit", unit_price: "1000", source: "user", note: "", ...over });
const LABELS = {
  columns: ["פריט", "קטגוריה", "חדר", "כמות", "יחידה", "מחיר ליחידה", "סכום", "הערה"],
  total: "סה״כ",
  categories: { furniture: "רהיטים" },
  units: { unit: "יחידה" },
};

test("lineAmount is exact for float-unfriendly quantities", () => {
  assert.equal(B.lineAmount(0.1 * 3, 100), 30);
  assert.equal(B.lineAmount(2.35, 100), 235);
  assert.equal(B.lineAmount(1.1, 3), 3); // 3.3 -> 3
  assert.equal(B.lineAmount(1.15, 10), 12); // 11.5 -> half up
  assert.equal(B.lineAmount(0.5, 1), 1); // 0.5 -> half up
  assert.equal(B.lineAmount(0.01, 49), 0);
  assert.equal(B.lineAmount(0.01, 50), 1);
});

test("lineAmount stays exact at the maximum values", () => {
  assert.equal(B.lineAmount(10000, 100_000_000), 1_000_000_000_000);
  assert.equal(B.lineAmount(9999.99, 99_999_999), Math.round((999999 * 99_999_999) / 100));
  assert.equal(B.lineAmount(10000, 0), 0);
});

test("lineAmount returns 0 for unusable input", () => {
  assert.equal(B.lineAmount(0, 100), 0);
  assert.equal(B.lineAmount(-1, 100), 0);
  assert.equal(B.lineAmount("x", 100), 0);
  assert.equal(B.lineAmount(1, -5), 0);
  assert.equal(B.lineAmount(1, undefined), 0);
});

test("totals: empty list, grouping, and 200 maximal rows", () => {
  assert.deepEqual(B.totals([]), { total: 0, byCategory: {} });
  const t = B.totals([item(), item({ category: "lighting", quantity: 2, unit_price: 250 }), item({ quantity: 0.5, unit_price: 101 })]);
  assert.equal(t.total, 1000 + 500 + 51);
  assert.deepEqual(t.byCategory, { furniture: 1051, lighting: 500 });
  const big = B.totals(Array.from({ length: 200 }, () => item({ quantity: 10000, unit_price: 100_000_000 })));
  assert.equal(big.total, 200 * 1_000_000_000_000);
  assert.ok(Number.isSafeInteger(big.total));
});

test("compareToBudget covers every status", () => {
  const budget = { min: 1000, max: 2000, currency: "ILS" };
  assert.equal(B.compareToBudget(0, "ILS", budget, 0), "no_items");
  assert.equal(B.compareToBudget(500, "ILS", null), "no_budget");
  assert.equal(B.compareToBudget(500, "ILS", { min: null, max: null, currency: "ILS" }), "no_budget");
  assert.equal(B.compareToBudget(500, "ILS", { ...budget, currency: "USD" }), "currency_mismatch");
  assert.equal(B.compareToBudget(999, "ILS", budget), "under");
  assert.equal(B.compareToBudget(1000, "ILS", budget), "within");
  assert.equal(B.compareToBudget(2000, "ILS", budget), "within");
  assert.equal(B.compareToBudget(2001, "ILS", budget), "over");
  assert.equal(B.compareToBudget(5, "ILS", { min: null, max: 10, currency: "ILS" }), "within");
  assert.equal(B.compareToBudget(11, "ILS", { min: null, max: 10, currency: "ILS" }), "over");
  assert.equal(B.compareToBudget(10 ** 9, "ILS", { min: 10, max: null, currency: "ILS" }), "within");
  assert.equal(B.compareToBudget(5, "ILS", { min: 10, max: null, currency: "ILS" }), "under");
  assert.equal(B.compareToBudget(0, "ILS", { min: 0, max: 0, currency: "ILS" }), "within");
});

test("parseItem accepts a valid row and normalises it", () => {
  const { item: parsed, errors } = B.parseItem(raw({ room: " סלון ", quantity: "2.5", note: " x ", source: "synthetic" }));
  assert.deepEqual(errors, {});
  assert.deepEqual(parsed, item({ quantity: 2.5, source: "synthetic", note: "x" }));
  assert.equal(B.parseItem(raw({ source: "bogus" })).item.source, "user");
  assert.equal(B.parseItem(raw({ quantity: "1,5" })).item.quantity, 1.5);
});

test("quantity boundaries", () => {
  for (const [text, key] of [["0", "quantityInvalid"], ["0.00", "quantityInvalid"], ["-1", "quantityInvalid"], ["", "quantityInvalid"], ["abc", "quantityInvalid"], ["1e3", "quantityInvalid"], ["1.234", "quantityDecimals"], ["10000.01", "quantityRange"], ["10001", "quantityRange"]]) {
    assert.equal(B.validateItem(raw({ quantity: text })).quantity, key, text);
  }
  for (const ok of ["0.01", "1", "9999.99", "10000", "10000.00"]) assert.equal(B.validateItem(raw({ quantity: ok })).quantity, undefined, ok);
});

test("price boundaries", () => {
  for (const [text, key] of [["", "priceInvalid"], ["-1", "priceInvalid"], ["1.5", "priceInvalid"], ["abc", "priceInvalid"], ["1e3", "priceInvalid"], ["100000001", "priceRange"], ["99999999999999999999", "priceRange"]]) {
    assert.equal(B.validateItem(raw({ unit_price: text })).unit_price, key, text);
  }
  for (const ok of ["0", "1", "100000000"]) assert.equal(B.validateItem(raw({ unit_price: ok })).unit_price, undefined, ok);
});

test("name, room, note, category and unit limits", () => {
  assert.equal(B.validateItem(raw({ name: "" })).name, "nameRequired");
  assert.equal(B.validateItem(raw({ name: "   " })).name, "nameRequired");
  assert.equal(B.validateItem(raw({ name: "א".repeat(121) })).name, "nameTooLong");
  assert.equal(B.validateItem(raw({ name: "א".repeat(120) })).name, undefined);
  assert.equal(B.validateItem(raw({ room: "ח".repeat(61) })).room, "roomTooLong");
  assert.equal(B.validateItem(raw({ room: "ח".repeat(60) })).room, undefined);
  assert.equal(B.validateItem(raw({ note: "ה".repeat(201) })).note, "noteTooLong");
  assert.equal(B.validateItem(raw({ category: "toys" })).category, "categoryInvalid");
  assert.equal(B.validateItem(raw({ unit: "kg" })).unit, "unitInvalid");
  assert.equal(B.parseItem(raw({ name: "" })).item, null);
});

test("toCsv: BOM, header, CRLF, total row", () => {
  const csv = B.toCsv([item({ quantity: 2, unit_price: 500 })], "ILS", LABELS);
  assert.ok(csv.startsWith("\uFEFFפריט,קטגוריה,חדר,כמות,יחידה,מחיר ליחידה,סכום (ILS),הערה\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[1], "ספה,רהיטים,סלון,2,יחידה,500,1000,");
  assert.equal(lines[2], "סה״כ,,,,,,1000,");
  assert.equal(lines[3], "");
});

test("toCsv: empty list has header and a zero total", () => {
  const lines = B.toCsv([], "ILS", LABELS).slice(1).split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "סה״כ,,,,,,0,");
});

test("toCsv quotes commas, quotes and newlines", () => {
  const csv = B.toCsv([item({ name: 'שולחן, "גדול"', note: "שורה1\nשורה2" })], "ILS", LABELS);
  assert.ok(csv.includes('"שולחן, ""גדול"""'));
  assert.ok(csv.includes('"שורה1\nשורה2"'));
});

test("toCsv guards against spreadsheet formulas", () => {
  for (const bad of ["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"]) {
    const cell = B.csvCell(bad);
    assert.ok(cell.replace(/^"/, "").startsWith("'"), JSON.stringify(bad));
  }
  assert.equal(B.csvCell("=1,2"), `"'=1,2"`);
  assert.equal(B.csvCell("safe"), "safe");
  assert.equal(B.csvCell(null), "");
  const csv = B.toCsv([item({ name: "=HYPERLINK(1)", room: "@x" })], "ILS", LABELS);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes(",'@x,"));
});

test("toCsv handles 200 maximal rows exactly", () => {
  const items = Array.from({ length: 200 }, () => item({ quantity: 10000, unit_price: 100_000_000 }));
  const csv = B.toCsv(items, "USD", LABELS);
  assert.equal(csv.slice(1).split("\r\n").length, 200 + 3);
  assert.ok(csv.includes(`,${200 * 1_000_000_000_000},`));
});
