import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as B from "../js/budget-logic.js";

const item = (over = {}) => ({ category: "furniture", name: "Sofa", room: "Salon", quantity: 1, unit: "unit", unit_price: 1000, source: "user", note: null, ...over });
const raw = (over = {}) => ({ name: "Sofa", category: "furniture", room: "", quantity: "1", unit: "unit", unit_price: "1000", source: "user", note: "", ...over });

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
  const { item: parsed, errors } = B.parseItem(raw({ room: " Salon ", quantity: "2.5", note: " x ", source: "synthetic" }));
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
  assert.equal(B.validateItem(raw({ name: "a".repeat(121) })).name, "nameTooLong");
  assert.equal(B.validateItem(raw({ name: "a".repeat(120) })).name, undefined);
  assert.equal(B.validateItem(raw({ room: "r".repeat(61) })).room, "roomTooLong");
  assert.equal(B.validateItem(raw({ room: "r".repeat(60) })).room, undefined);
  assert.equal(B.validateItem(raw({ note: "n".repeat(201) })).note, "noteTooLong");
  assert.equal(B.validateItem(raw({ category: "toys" })).category, "categoryInvalid");
  assert.equal(B.validateItem(raw({ unit: "kg" })).unit, "unitInvalid");
  assert.equal(B.parseItem(raw({ name: "" })).item, null);
});

test("every item error key has a message", () => {
  const { errors } = B.parseItem({ name: "", category: "x", quantity: "", unit: "x", unit_price: "" });
  for (const key of Object.values(errors)) assert.ok(B.ERRORS[key], key);
  for (const key of ["nameTooLong", "roomTooLong", "noteTooLong", "quantityDecimals", "quantityRange", "priceRange"]) assert.ok(B.ERRORS[key], key);
});

test("every category and unit has a label", () => {
  assert.deepEqual(Object.keys(B.CATEGORY_LABELS), B.CATEGORIES);
  assert.deepEqual(Object.keys(B.UNIT_LABELS), B.UNIT_KEYS);
});

test("toCsv: BOM, header, CRLF, total row", () => {
  const csv = B.toCsv([item({ quantity: 2, unit_price: 500 })], "ILS", B.CSV_LABELS);
  assert.ok(csv.startsWith("﻿Item,Category,Room,Quantity,Unit,Unit price,Amount (ILS),Note\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[1], "Sofa,Furniture,Salon,2,unit,500,1000,");
  assert.equal(lines[2], "Total,,,,,,1000,");
  assert.equal(lines[3], "");
});

test("toCsv: empty list has header and a zero total", () => {
  const lines = B.toCsv([], "ILS", B.CSV_LABELS).slice(1).split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "Total,,,,,,0,");
});

test("toCsv quotes commas, quotes and newlines", () => {
  const csv = B.toCsv([item({ name: 'Table, "big"', note: "line1\nline2" })], "ILS", B.CSV_LABELS);
  assert.ok(csv.includes('"Table, ""big"""'));
  assert.ok(csv.includes('"line1\nline2"'));
});

test("toCsv guards against spreadsheet formulas", () => {
  for (const bad of ["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"]) {
    const cell = B.csvCell(bad);
    assert.ok(cell.replace(/^"/, "").startsWith("'"), JSON.stringify(bad));
  }
  assert.equal(B.csvCell("=1,2"), `"'=1,2"`);
  assert.equal(B.csvCell("safe"), "safe");
  assert.equal(B.csvCell(null), "");
  const csv = B.toCsv([item({ name: "=HYPERLINK(1)", room: "@x" })], "ILS", B.CSV_LABELS);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes(",'@x,"));
});

test("toCsv handles 200 maximal rows exactly", () => {
  const items = Array.from({ length: 200 }, () => item({ quantity: 10000, unit_price: 100_000_000 }));
  const csv = B.toCsv(items, "USD", B.CSV_LABELS);
  assert.equal(csv.slice(1).split("\r\n").length, 200 + 3);
  assert.ok(csv.includes(`,${200 * 1_000_000_000_000},`));
});

// ---- CSV import --------------------------------------------------------------------------------------

const HEADER = "Item,Category,Room,Quantity,Unit,Unit price,Amount (ILS),Note";
const GOOD = "Sofa,Furniture,Salon,1,unit,1000,1000,";
const imp = (text) => B.importItems(B.parseCsv(text), B.CSV_LABELS);
const csvOf = (...lines) => lines.join("\r\n");
const errorsOf = (...lines) => imp(csvOf(...lines)).errors;

test("parseCsv: quotes, escaped quotes, newlines in quotes, line numbers", () => {
  const rows = B.parseCsv('﻿a,b,c\r\n"1,2","say ""hi""","l1\r\nl2"\n,x,\n');
  assert.deepEqual(rows.map((r) => r.cells), [["a", "b", "c"], ["1,2", 'say "hi"', "l1\r\nl2"], ["", "x", ""]]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 4]);
});

test("parseCsv: empty text, no trailing newline, CR only, quote inside an unquoted cell", () => {
  assert.deepEqual(B.parseCsv(""), []);
  assert.deepEqual(B.parseCsv("﻿"), []);
  assert.deepEqual(B.parseCsv('a,b\r5" pipe,""').map((r) => r.cells), [["a", "b"], ['5" pipe', ""]]);
});

test("parseCsv: delimiter detected from the header, ignoring quoted text", () => {
  assert.deepEqual(B.parseCsv("a;b;c\n1,5;2;3")[1].cells, ["1,5", "2", "3"]);
  assert.deepEqual(B.parseCsv("a\tb\n1;2\t3")[1].cells, ["1;2", "3"]);
  assert.deepEqual(B.parseCsv('"x;y;z",b\n1;2,3')[1].cells, ["1;2", "3"]);
  assert.deepEqual(B.parseCsv("\r\na;b\n1;2")[2].cells, ["1", "2"]);
});

test("parseCsv flags broken quoting", () => {
  assert.equal(B.parseCsv('a,b\n"open,1\n2,3').at(-1).error, "unterminatedQuote");
  assert.equal(B.parseCsv('a,b\n"x"y,1')[1].error, "badQuote");
});

test("round trip: export then import reproduces the items", () => {
  const items = [
    item({ name: 'Table, "big"; 1,000', room: "Main\troom", note: "line1\nline2", quantity: 2.35 }),
    item({ name: "=HYPERLINK(1)", room: "@x", note: "-5", category: "lighting", unit: "m2", quantity: 10000, unit_price: 100_000_000 }),
    item({ name: "+1", room: null, note: null, category: "other", unit: "set", quantity: 0.01, unit_price: 0 }),
    item({ name: "'quoted'", category: "textile", unit: "m", room: null }),
    item({ name: "Total", category: "appliance" }),
    item({ name: "Sofà 北 — дом", room: "リビング" }), // any language survives the UTF-8 round trip
    ...B.CATEGORIES.map((category) => item({ category, name: category })),
  ];
  const result = imp(B.toCsv(items, "USD", B.CSV_LABELS));
  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(result.items, items);
  assert.equal(result.currency, "USD");
});

test("import strips the formula guard only before a formula character", () => {
  const names = ["'=a", "'+a", "'-a", "'@a", "'a", "''=a", "a'=b"];
  const result = imp(csvOf(HEADER, ...names.map((n) => `${n},Furniture,,1,unit,1,1,`)));
  assert.deepEqual(result.items.map((i) => i.name), ["=a", "+a", "-a", "@a", "'a", "''=a", "a'=b"]);
});

// A spreadsheet whose list separator is ; or tab splits inside our cells: no piece may look like a formula.
const FORMULA_PIECE = /[;\t\r\n][\s"]*[=+\-@]/;

test("csvCell defuses formulas after a separator or line break and quotes ; and tab", () => {
  assert.equal(B.csvCell("x;=1+1;y"), `"x;'=1+1;y"`);
  assert.equal(B.csvCell("a;b"), '"a;b"');
  assert.equal(B.csvCell("a\tb"), '"a\tb"');
  assert.equal(B.csvCell("a; -5"), `"a; '-5"`);
  assert.equal(B.csvCell('x;"=1'), `"x;""'=1"`);
  assert.equal(B.csvCell("\t=1"), `"'\t'=1"`);
  for (const separator of [";", "\t", "\r", "\n", "\r\n", ";;", ";  ", "\t ", ';" "']) {
    for (const start of ["=", "+", "-", "@"]) {
      const cell = B.csvCell(`x${separator}${start}1`);
      assert.doesNotMatch(cell, FORMULA_PIECE, JSON.stringify(cell));
      assert.ok(cell.includes(`'${start}1`), JSON.stringify(cell));
    }
  }
  for (const safe of ["a=b", "a - 5", "x,y=1", "mail@example", "a;b-1"]) assert.ok(!B.csvCell(safe).includes("'"), safe);
});

test("toCsv guards separators in name, room and note", () => {
  const csv = B.toCsv([item({ name: "n;=1+1;y", room: "r\t+2", note: "m\n@SUM(1)" })], "ILS", B.CSV_LABELS);
  assert.doesNotMatch(csv.replaceAll("\r\n", "\r\n#"), FORMULA_PIECE);
  for (const guarded of [`"n;'=1+1;y"`, `"r\t'+2"`, `"m\n'@SUM(1)"`]) assert.ok(csv.includes(guarded), guarded);
});

test("round trip: separators and formula characters inside name, room and note", () => {
  const values = [
    "x;=1+1;y", "a; -5", "a;-5", "x,=1", "x\t+1", "a\n=1", "a\r-1", "a\r\n@x", "a;\n\t=1", "a;;=1", 'x;"=1', 'x;""+1',
    "=a;=b", "-1;-2", "x;'a", "x';=1", "a;b", "a\tb", ";", ";=", "x;= ",
  ].map((value) => value.trim());
  const items = values.map((value) => item({ name: value, room: value, note: value }));
  const result = imp(B.toCsv(items, "USD", B.CSV_LABELS));
  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(result.items, items);
});

test("known limitation: an apostrophe already between a separator and a formula character is dropped on import", () => {
  const result = imp(B.toCsv([item({ name: "x;'=1" })], "USD", B.CSV_LABELS));
  assert.equal(result.items[0].name, "x;=1");
});

test("import handles a huge cell of line breaks and separators", () => {
  const cell = ";\n\t\r ".repeat(50_000);
  assert.deepEqual(errorsOf(HEADER, `"${cell}",Furniture,,1,unit,1,1,`).map((e) => e.key), ["nameTooLong"]);
});

test("import accepts semicolons, tabs, a BOM, LF endings and a trailing blank line", () => {
  for (const sep of [";", "\t", ","]) {
    const text = `﻿${[HEADER, GOOD].map((l) => l.split(",").join(sep)).join("\n")}\n\n`;
    assert.deepEqual(imp(text).items, [item()], JSON.stringify(sep));
  }
});

test("import matches columns by name: reordered, extra, optional missing", () => {
  const result = imp(csvOf("Unit price, Unit ,Supplier,Quantity,Category,Item", "1000,unit,whatever,2,furniture,Sofa"));
  assert.deepEqual(result.items, [item({ quantity: 2, room: null })]);
  assert.equal(result.currency, null);
});

test("import: currency comes from the amount header only when it is a known code", () => {
  assert.equal(imp(csvOf(HEADER, GOOD)).currency, "ILS");
  assert.equal(imp(csvOf(HEADER.replace("ILS", "XYZ"), GOOD)).currency, null);
  assert.equal(imp(csvOf(HEADER.replace(" (ILS)", ""), GOOD)).currency, null);
});

test("import accepts labels and keys in any case", () => {
  const result = imp(csvOf(HEADER.toUpperCase(), "Tile,FINISH,,3,M²,10,,", "Paint,finishes,,1,M2,5,,", "TOTAL,,,,,,35,"));
  assert.deepEqual(result.items, [
    item({ name: "Tile", category: "finish", room: null, quantity: 3, unit: "m2", unit_price: 10 }),
    item({ name: "Paint", category: "finish", room: null, unit: "m2", unit_price: 5 }),
  ]);
});

test("import skips blank lines and the total row", () => {
  const result = imp(csvOf("", HEADER, ",,,,,,,", GOOD, "   ", "Total,,,,,,1000,", ""));
  assert.equal(result.items.length, 1);
});

test("import reports every missing required column and duplicates", () => {
  assert.deepEqual(errorsOf("Room,Note", "a,b"), [0, 1, 3, 4, 5].map((i) => ({ line: 1, key: "missingColumn", column: B.CSV_LABELS.columns[i] })));
  assert.deepEqual(errorsOf(`${HEADER},item`, GOOD), [{ line: 1, key: "duplicateColumn", column: "Item" }]);
});

test("import: bad rows are reported with line numbers and nothing is imported", () => {
  const result = imp(
    csvOf(HEADER, GOOD, ",Furniture,,1,unit,1,,", 'x,Toys,,0,kg,1.5,,"a\nb"', `${"a".repeat(121)},Furniture,,1.234,unit,100000001,,`),
  );
  assert.equal(result.items, undefined);
  assert.deepEqual(
    result.errors.map((e) => `${e.line}:${e.key}`),
    ["3:nameRequired", "4:quantityInvalid", "4:priceInvalid", "4:categoryInvalid", "4:unitInvalid", "6:nameTooLong", "6:quantityDecimals", "6:priceRange"],
  );
});

test("import: room and note limits, short rows, extra cells, prototype names", () => {
  assert.deepEqual(errorsOf(HEADER, `x,Furniture,${"r".repeat(61)},1,unit,1,,${"n".repeat(201)}`).map((e) => e.key), ["roomTooLong", "noteTooLong"]);
  assert.deepEqual(errorsOf(HEADER, "x").map((e) => e.key), ["quantityInvalid", "priceInvalid", "categoryInvalid", "unitInvalid"]);
  assert.deepEqual(errorsOf(HEADER, `${GOOD},200`), [{ line: 2, key: "extraCells" }]);
  assert.equal(imp(csvOf(HEADER, `${GOOD},,`)).items.length, 1); // empty extra cells are harmless
  assert.deepEqual(errorsOf(HEADER, "x,constructor,,1,__proto__,1,,").map((e) => e.key), ["categoryInvalid", "unitInvalid"]);
  assert.deepEqual(errorsOf(HEADER, '"x,Furniture'), [{ line: 2, key: "unterminatedQuote" }]);
});

test("import: empty file, header only, 200 versus 201 rows", () => {
  assert.deepEqual(errorsOf(""), [{ line: 1, key: "emptyFile" }]);
  assert.deepEqual(errorsOf("\r\n,,,\r\n"), [{ line: 1, key: "emptyFile" }]);
  assert.deepEqual(errorsOf(HEADER), [{ line: 1, key: "noItems" }]);
  assert.deepEqual(errorsOf(HEADER, "Total,,,,,,0,"), [{ line: 1, key: "noItems" }]);
  const many = (n) => csvOf(HEADER, ...Array(n).fill(GOOD), "Total,,,,,,0,");
  assert.equal(imp(many(200)).items.length, 200);
  assert.deepEqual(imp(many(201)).errors, [{ line: 202, key: "tooManyRows" }]);
});

test("import: thousands separators only when unambiguous", () => {
  const row = (quantity, price) => csvOf(HEADER.replaceAll(",", ";"), `x;Furniture;;${quantity};unit;${price};;`);
  assert.equal(imp(row("1,000", "1,200")).items[0].quantity, 1000);
  assert.equal(imp(row("1,000", "1,200")).items[0].unit_price, 1200);
  assert.equal(imp(row("2,500.5", "100,000,000")).items[0].quantity, 2500.5);
  assert.equal(imp(row("1", "100,000,000")).items[0].unit_price, 100_000_000);
  assert.equal(imp(csvOf(HEADER, 'x,Furniture,,1,unit,"1,200",,')).items[0].unit_price, 1200);
  for (const bad of ["2,5", "0,500", "1,00", "12,34,567", "1,0000", ",100", "100,"]) {
    assert.deepEqual(imp(row(bad, "1")).errors, [{ line: 2, key: "quantityInvalid" }], bad);
    assert.deepEqual(imp(row("1", bad)).errors, [{ line: 2, key: "priceInvalid" }], bad);
  }
});

test("every import error key has a message", () => {
  for (const key of ["tooLarge", "notText", "unreadable", "emptyFile", "noItems", "missingColumn", "duplicateColumn", "tooManyRows", "unterminatedQuote", "badQuote", "extraCells"]) {
    const message = B.IMPORT_ERRORS[key];
    assert.ok(typeof message === "function" ? message("Item").includes('"Item"') : message, key);
  }
});

test("decodeCsv: UTF-8 with BOM, windows-1252 fallback, binary and size limits", () => {
  assert.deepEqual(B.decodeCsv(new TextEncoder().encode("﻿Item m²")), { text: "Item m²" });
  // "Café m²" in windows-1252
  assert.deepEqual(B.decodeCsv(Uint8Array.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x6d, 0xb2])), { text: "Café m²" });
  assert.deepEqual(B.decodeCsv(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0])), { error: "notText" });
  assert.deepEqual(B.decodeCsv(new Uint8Array(B.MAX_CSV_BYTES + 1).fill(97)), { error: "tooLarge" });
  assert.equal(B.decodeCsv(new Uint8Array(B.MAX_CSV_BYTES).fill(97)).text.length, B.MAX_CSV_BYTES);
  assert.deepEqual(B.decodeCsv(new Uint8Array(0)), { text: "" });
});

test("the sample file for users imports cleanly", () => {
  const bytes = readFileSync(new URL("../samples/shopping-list-example.csv", import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const { text } = B.decodeCsv(bytes);
  const result = imp(text);
  assert.deepEqual(result.errors, undefined);
  assert.equal(result.items.length, 6);
  assert.equal(result.currency, "ILS");
  assert.equal(B.totals(result.items).total, 13026);
  assert.equal(result.items[1].unit, "m2");
});
