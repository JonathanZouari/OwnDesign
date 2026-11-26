import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../js/budget-logic.js";

const sofa = { kind: "furniture", ref: "sofa", label: "Sofa", qty: 2, unit: "item", unit_price: 900, note: "" };
const floor = { kind: "finish", ref: "r1|floor", label: "Floor", qty: 12.5, unit: "m2", unit_price: 70, note: "" };
const custom = { kind: "custom", ref: null, label: "Curtains", qty: 1, unit: "item", unit_price: 150, note: "" };
const row = (line) => ({ ...line, qty: String(line.qty), unit_price: String(line.unit_price) });

test("parseQty accepts up to two decimals and rejects everything else", () => {
  assert.equal(B.parseQty("0"), 0);
  assert.equal(B.parseQty(" 12.5 "), 12.5);
  assert.equal(B.parseQty("100000"), 100000);
  for (const bad of ["", "-1", "1.234", "abc", "1e3", "100000.01", "1,5"]) assert.throws(() => B.parseQty(bad), undefined, bad);
});

test("parsePrice accepts whole numbers only, within the limit", () => {
  assert.equal(B.parsePrice("0"), 0);
  assert.equal(B.parsePrice("100000000"), 100_000_000);
  for (const bad of ["", "-5", "1.5", "x", "100000001"]) assert.throws(() => B.parsePrice(bad), undefined, bad);
});

test("summarize totals by kind; empty budget is zero", () => {
  assert.deepEqual(B.summarize([]), { subtotals: { furniture: 0, finish: 0, custom: 0 }, total: 0 });
  const result = B.summarize([sofa, floor, custom]);
  assert.deepEqual(result.subtotals, { furniture: 1800, finish: 875, custom: 150 });
  assert.equal(result.total, 2825);
});

test("lineSubtotal rounds to a whole amount", () => {
  assert.equal(B.lineSubtotal({ qty: 0.33, unit_price: 10 }), 3);
  assert.equal(B.lineSubtotal({ qty: 0, unit_price: 999 }), 0);
});

test("targetStatus compares with the brief's range", () => {
  assert.equal(B.targetStatus(500, null, null), "none");
  assert.equal(B.targetStatus(500, 1000, 2000), "under");
  assert.equal(B.targetStatus(1000, 1000, 2000), "within");
  assert.equal(B.targetStatus(2000, 1000, 2000), "within");
  assert.equal(B.targetStatus(2001, 1000, 2000), "over");
  assert.equal(B.targetStatus(5000, 1000, null), "within");
  assert.equal(B.targetStatus(5000, null, 2000), "over");
});

test("newSuggestions skips lines the budget already has; custom lines never block", () => {
  const suggestions = [sofa, floor, { ...floor, ref: "r2|floor" }];
  assert.deepEqual(B.newSuggestions([sofa, custom], suggestions).map((s) => s.ref), ["r1|floor", "r2|floor"]);
  assert.deepEqual(B.newSuggestions([], []), []);
});

test("buildPayload converts rows and trims text", () => {
  const { payload } = B.buildPayload([{ ...row(sofa), label: "  Sofa  ", note: " grey " }]);
  assert.deepEqual(payload.items[0], { ...sofa, note: "grey" });
  assert.deepEqual(B.buildPayload([]).payload, { items: [] });
});

test("buildPayload names the failing line", () => {
  assert.match(B.buildPayload([row(sofa), { ...row(sofa), qty: "-1" }]).error, /^Line 2: Quantity/);
  assert.match(B.buildPayload([{ ...row(sofa), unit_price: "1.5" }]).error, /^Line 1: Price/);
  assert.match(B.buildPayload([{ ...row(sofa), label: "   " }]).error, /name/);
  assert.match(B.buildPayload([{ ...row(sofa), label: "x".repeat(81) }]).error, /name/);
  assert.match(B.buildPayload([{ ...row(sofa), note: "x".repeat(201) }]).error, /note/);
});

test("buildPayload caps the number of lines", () => {
  assert.ok(B.buildPayload(Array(300).fill(row(custom))).payload);
  assert.match(B.buildPayload(Array(301).fill(row(custom))).error, /at most 300/);
});

test("formatMoney groups thousands and names the currency", () => {
  assert.equal(B.formatMoney(1234567, "EUR"), "1,234,567 EUR");
});
