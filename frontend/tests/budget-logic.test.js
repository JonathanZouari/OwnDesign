import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as B from "../js/budget-logic.js";
import { BUDGET } from "../js/strings.js";

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

test("numbers: commas are thousands separators only", () => {
  assert.equal(B.parseQuantity("1,000").value, 1000);
  assert.equal(B.parseQuantity(" 1,000.5 ").value, 1000.5);
  assert.equal(B.parseQuantity("10,000.00").value, 10000);
  assert.equal(B.parsePrice("1,200").value, 1200);
  assert.equal(B.parsePrice("100,000,000").value, 100_000_000);
  for (const bad of ["1,5", "1,00", "0,500", "12,34", "1,0000", ",100", "100,", ",", "1,,000", "1.000,5", "1,000,00", "-1,000", "1 ,000"]) {
    assert.deepEqual(B.parseQuantity(bad), { error: "quantityComma" }, bad);
    assert.deepEqual(B.parsePrice(bad), { error: "priceComma" }, bad);
  }
  assert.deepEqual(B.parseQuantity("10,001"), { error: "quantityRange" });
  assert.deepEqual(B.parseQuantity("1,000,000"), { error: "quantityRange" });
  assert.deepEqual(B.parsePrice("100,000,001"), { error: "priceRange" });
  assert.deepEqual(B.parsePrice("1,200.5"), { error: "priceInvalid" });
});

test("numbers: trailing zeros are not decimals, and a leading dot is accepted", () => {
  for (const [text, value] of [["1.500", 1.5], ["1.5000000", 1.5], ["2.350", 2.35], ["3.000", 3], [".5", 0.5], [".05", 0.05], [".500", 0.5], ["10000.000", 10000]]) {
    assert.deepEqual(B.parseQuantity(text), { value }, text);
  }
  for (const text of ["1.001", "1.5001", ".005", "0.0100001"]) assert.deepEqual(B.parseQuantity(text), { error: "quantityDecimals" }, text);
  for (const text of [".", "5.", "..5", ".5.", "-.5", ".0", "0.000"]) assert.deepEqual(B.parseQuantity(text), { error: "quantityInvalid" }, text);
  assert.deepEqual(B.parsePrice(".5"), { error: "priceInvalid" });
});

test("numbers: the page and the CSV import follow the same rule", () => {
  for (const text of ["1,000", "1,000.5", "1.500", ".5", "1,5", "1,00", "0,500", "1.001", "5.", "1,200"]) {
    const page = B.parseItem(raw({ room: "", quantity: text, unit_price: text }));
    const file = imp(csvOf(HEADER, `ספה,רהיטים,,"${text}",יחידה,"${text}",,`));
    assert.deepEqual(file.items, page.item ? [page.item] : undefined, text);
    assert.deepEqual(file.errors?.map((e) => e.key), page.item ? undefined : Object.values(page.errors), text);
  }
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

// ---- CSV import --------------------------------------------------------------------------------------

const IMPORT = {
  columns: BUDGET.columns,
  total: BUDGET.csvTotal,
  categories: BUDGET.categories,
  units: BUDGET.units,
};
const HEADER = "פריט,קטגוריה,חדר,כמות,יחידה,מחיר ליחידה,סכום (ILS),הערה";
const GOOD = "ספה,רהיטים,סלון,1,יחידה,1000,1000,";
const imp = (text) => B.importItems(B.parseCsv(text), IMPORT);
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
  assert.deepEqual(B.parseCsv('a,b\rמ"ר,""').map((r) => r.cells), [["a", "b"], ['מ"ר', ""]]);
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
    item({ name: 'שולחן, "גדול"; 1,000', room: "סלון\tראשי", note: "שורה1\nשורה2", quantity: 2.35 }),
    item({ name: "=HYPERLINK(1)", room: "@x", note: "-5", category: "lighting", unit: "m2", quantity: 10000, unit_price: 100_000_000 }),
    item({ name: "+1", room: null, note: null, category: "other", unit: "set", quantity: 0.01, unit_price: 0 }),
    item({ name: "'מצוטט'", category: "textile", unit: "m", room: null }),
    item({ name: BUDGET.csvTotal, category: "appliance" }),
    ...B.CATEGORIES.map((category) => item({ category, name: category })),
  ];
  const result = imp(B.toCsv(items, "USD", IMPORT));
  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(result.items, items);
  assert.equal(result.currency, "USD");
});

test("import strips the formula guard only before a formula character", () => {
  const names = ["'=a", "'+a", "'-a", "'@a", "'a", "''=a", "a'=b"];
  const result = imp(csvOf(HEADER, ...names.map((n) => `${n},רהיטים,,1,יחידה,1,1,`)));
  assert.deepEqual(result.items.map((i) => i.name), ["=a", "+a", "-a", "@a", "'a", "'=a", "a'=b"]);
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
  const csv = B.toCsv([item({ name: "n;=1+1;y", room: "r\t+2", note: "m\n@SUM(1)" })], "ILS", IMPORT);
  assert.doesNotMatch(csv.replaceAll("\r\n", "\r\n#"), FORMULA_PIECE);
  for (const guarded of [`"n;'=1+1;y"`, `"r\t'+2"`, `"m\n'@SUM(1)"`]) assert.ok(csv.includes(guarded), guarded);
});

test("round trip: separators and formula characters inside name, room and note", () => {
  const values = [
    "x;=1+1;y", "a; -5", "a;-5", "x,=1", "x\t+1", "a\n=1", "a\r-1", "a\r\n@x", "a;\n\t=1", "a;;=1", 'x;"=1', 'x;""+1',
    "=a;=b", "-1;-2", "x;'a", "x';=1", "a;b", "a\tb", ";", ";=", "x;= ",
  ].map((value) => value.trim());
  const items = values.map((value) => item({ name: value, room: value, note: value }));
  const result = imp(B.toCsv(items, "USD", IMPORT));
  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(result.items, items);
});

test("round trip: apostrophes that were already there survive", () => {
  const values = ["'=1", "''=1", "'''@x", "x;'=1", "x;''=1", 'x; "\'-1', "x\t'+1", "x\n''=1", "'a", "a'", "''", "'", "'=a;'=b", "-1;'-2"];
  const items = values.map((value) => item({ name: value, room: value, note: value }));
  const result = imp(B.toCsv(items, "USD", IMPORT));
  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(result.items, items);
});

test("csvCell adds one apostrophe in front of an apostrophe run that precedes a formula character", () => {
  assert.equal(B.csvCell("'=1"), "''=1");
  assert.equal(B.csvCell("''=1"), "'''=1");
  assert.equal(B.csvCell("x;'=1"), `"x;''=1"`);
  assert.equal(B.csvCell("'\t1"), `"''\t1"`);
  assert.equal(B.csvCell("'a"), "'a");
});

// Every string up to `length` over the characters that matter to the guard, to CSV syntax and to spreadsheets.
function* strings(alphabet, length, prefix = "") {
  yield prefix;
  if (length) for (const char of alphabet) yield* strings(alphabet, length - 1, prefix + char);
}

function assertRoundTrip(value) {
  const rows = B.parseCsv(`${B.csvCell(value)},end\r\n`);
  const [cell, end] = rows[0].cells;
  // Plain checks first: building a message for every one of the passing cases is slow.
  if (rows.length !== 1 || end !== "end" || B.unguard(cell) !== value) assert.fail(`not restored: ${JSON.stringify(value)} -> ${JSON.stringify(cell)}`);
  if (/^[=+\-@\t\r]/.test(cell) || FORMULA_PIECE.test(cell)) assert.fail(`formula left: ${JSON.stringify(value)} -> ${JSON.stringify(cell)}`);
}

test("property: export then import is the identity for every short string", () => {
  let count = 0;
  for (const value of strings(["'", ";", ",", "\t", "\n", "\r", "=", "+", "-", "@", '"', " ", "a"], 5)) {
    assertRoundTrip(value);
    count += 1;
  }
  assert.equal(count, (13 ** 6 - 1) / 12);
});

test("property: export then import is the identity for long random strings", () => {
  const alphabet = ["'", "'", "'", ";", ",", "\t", "\n", "\r", "\r\n", "=", "+", "-", "@", '"', " ", "\u00a0", "א", "1"];
  let seed = 12345; // fixed, so a failure can be repeated
  const next = (n) => (seed = (seed * 48271) % 2147483647) % n;
  for (let run = 0; run < 20_000; run += 1) assertRoundTrip(Array.from({ length: 6 + next(30) }, () => alphabet[next(alphabet.length)]).join(""));
});

test("import handles a huge cell of line breaks and separators", () => {
  const cell = ";\n\t\r ".repeat(50_000);
  assert.deepEqual(errorsOf(HEADER, `"${cell}",רהיטים,,1,יחידה,1,1,`).map((e) => e.key), ["nameTooLong"]);
});

test("import accepts semicolons, tabs, a BOM, LF endings and a trailing blank line", () => {
  for (const sep of [";", "\t", ","]) {
    const text = `﻿${[HEADER, GOOD].map((l) => l.split(",").join(sep)).join("\n")}\n\n`;
    assert.deepEqual(imp(text).items, [item()], JSON.stringify(sep));
  }
});

test("import matches columns by name: reordered, extra, optional missing", () => {
  const result = imp(csvOf("מחיר ליחידה, יחידה ,ספק,כמות,קטגוריה,פריט", "1000,unit,whatever,2,furniture,ספה"));
  assert.deepEqual(result.items, [item({ quantity: 2, room: null })]);
  assert.equal(result.currency, null);
});

test("import: currency comes from the amount header only when it is a known code", () => {
  assert.equal(imp(csvOf(HEADER, GOOD)).currency, "ILS");
  assert.equal(imp(csvOf(HEADER.replace("ILS", "XYZ"), GOOD)).currency, null);
  assert.equal(imp(csvOf(HEADER.replace(" (ILS)", ""), GOOD)).currency, null);
});

test("import accepts hand-typed ASCII quotes in labels and keys in any case", () => {
  const result = imp(csvOf(HEADER, 'אריח,FINISH,,3,"מ""ר",10,,', 'סה"כ,,,,,,30,'));
  assert.deepEqual(result.items, [item({ name: "אריח", category: "finish", room: null, quantity: 3, unit: "m2", unit_price: 10 })]);
});

test("import skips blank lines and the total row", () => {
  const result = imp(csvOf("", HEADER, ",,,,,,,", GOOD, "   ", "סה״כ,,,,,,1000,", ""));
  assert.equal(result.items.length, 1);
});

test("import reports every missing required column and duplicates", () => {
  assert.deepEqual(errorsOf("חדר,הערה", "a,b"), [0, 1, 3, 4, 5].map((i) => ({ line: 1, key: "missingColumn", column: BUDGET.columns[i] })));
  assert.deepEqual(errorsOf(`${HEADER},פריט`, GOOD), [{ line: 1, key: "duplicateColumn", column: "פריט" }]);
});

test("import: bad rows are reported with line numbers and nothing is imported", () => {
  const result = imp(
    csvOf(HEADER, GOOD, ",רהיטים,,1,יחידה,1,,", 'x,צעצועים,,0,ק״ג,1.5,,"a\nb"', `${"א".repeat(121)},רהיטים,,1.234,יחידה,100000001,,`),
  );
  assert.equal(result.items, undefined);
  assert.deepEqual(
    result.errors.map((e) => `${e.line}:${e.key}`),
    ["3:nameRequired", "4:quantityInvalid", "4:priceInvalid", "4:categoryInvalid", "4:unitInvalid", "6:nameTooLong", "6:quantityDecimals", "6:priceRange"],
  );
});

test("import: room and note limits, short rows, extra cells, prototype names", () => {
  assert.deepEqual(errorsOf(HEADER, `x,רהיטים,${"ח".repeat(61)},1,יחידה,1,,${"ה".repeat(201)}`).map((e) => e.key), ["roomTooLong", "noteTooLong"]);
  assert.deepEqual(errorsOf(HEADER, "x").map((e) => e.key), ["quantityInvalid", "priceInvalid", "categoryInvalid", "unitInvalid"]);
  assert.deepEqual(errorsOf(HEADER, `${GOOD},200`), [{ line: 2, key: "extraCells" }]);
  assert.equal(imp(csvOf(HEADER, `${GOOD},,`)).items.length, 1); // empty extra cells are harmless
  assert.deepEqual(errorsOf(HEADER, "x,constructor,,1,__proto__,1,,").map((e) => e.key), ["categoryInvalid", "unitInvalid"]);
  assert.deepEqual(errorsOf(HEADER, '"x,רהיטים'), [{ line: 2, key: "unterminatedQuote" }]);
});

test("import: empty file, header only, 200 versus 201 rows", () => {
  assert.deepEqual(errorsOf(""), [{ line: 1, key: "emptyFile" }]);
  assert.deepEqual(errorsOf("\r\n,,,\r\n"), [{ line: 1, key: "emptyFile" }]);
  assert.deepEqual(errorsOf(HEADER), [{ line: 1, key: "noItems" }]);
  assert.deepEqual(errorsOf(HEADER, "סה״כ,,,,,,0,"), [{ line: 1, key: "noItems" }]);
  const many = (n) => csvOf(HEADER, ...Array(n).fill(GOOD), "סה״כ,,,,,,0,");
  assert.equal(imp(many(200)).items.length, 200);
  assert.deepEqual(imp(many(201)).errors, [{ line: 202, key: "tooManyRows" }]);
});

test("import: thousands separators only when unambiguous", () => {
  const row = (quantity, price) => csvOf(HEADER.replaceAll(",", ";"), `x;רהיטים;;${quantity};יחידה;${price};;`);
  assert.equal(imp(row("1,000", "1,200")).items[0].quantity, 1000);
  assert.equal(imp(row("1,000", "1,200")).items[0].unit_price, 1200);
  assert.equal(imp(row("2,500.5", "100,000,000")).items[0].quantity, 2500.5);
  assert.equal(imp(row("1", "100,000,000")).items[0].unit_price, 100_000_000);
  assert.equal(imp(csvOf(HEADER, 'x,רהיטים,,1,יחידה,"1,200",,')).items[0].unit_price, 1200);
  for (const bad of ["2,5", "0,500", "1,00", "12,34,567", "1,0000", ",100", "100,"]) {
    assert.deepEqual(imp(row(bad, "1")).errors, [{ line: 2, key: "quantityComma" }], bad);
    assert.deepEqual(imp(row("1", bad)).errors, [{ line: 2, key: "priceComma" }], bad);
  }
});

test("every field error key has a Hebrew message", () => {
  for (const key of ["nameRequired", "nameTooLong", "roomTooLong", "noteTooLong", "quantityInvalid", "quantityComma", "quantityDecimals", "quantityRange", "priceInvalid", "priceComma", "priceRange", "categoryInvalid", "unitInvalid"]) {
    assert.match(BUDGET.errors[key] ?? "", /[֐-׿]/, key);
  }
});

test("every import error key has a Hebrew message", () => {
  for (const key of ["tooLarge", "notText", "unreadable", "emptyFile", "noItems", "missingColumn", "duplicateColumn", "tooManyRows", "unterminatedQuote", "badQuote", "extraCells"]) {
    const message = BUDGET.importErrors[key];
    assert.match(typeof message === "function" ? message("x") : message, /[֐-׿]/, key);
  }
});

test("decodeCsv: UTF-8 with BOM, windows-1255 fallback, binary and size limits", () => {
  assert.deepEqual(B.decodeCsv(new TextEncoder().encode("﻿פריט")), { text: "פריט" });
  // "פריט ״" in windows-1255
  assert.deepEqual(B.decodeCsv(Uint8Array.from([0xf4, 0xf8, 0xe9, 0xe8, 0x20, 0xd8])), { text: "פריט ״" });
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
  for (const entry of result.items) assert.match(entry.name, /[א-ת]/);
  assert.doesNotMatch(text, /פנטהאוז|מגדל העמק/);
});

// The server and the database count characters (code points), not UTF-16 units: an emoji is one.
test("name, room and note limits count code points", () => {
  for (const [field, max, key] of [["name", 120, "nameTooLong"], ["room", 60, "roomTooLong"], ["note", 200, "noteTooLong"]]) {
    for (const char of ["\u{1F6CB}", "א", "a"]) {
      assert.deepEqual(B.validateItem(raw({ [field]: char.repeat(max) })), {}, `${field} ${char}`);
      assert.deepEqual(B.validateItem(raw({ [field]: ` ${char.repeat(max)} ` })), {}, `${field} ${char} padded`);
      assert.deepEqual(B.validateItem(raw({ [field]: char.repeat(max + 1) })), { [field]: key }, `${field} ${char} over`);
    }
  }
  const emoji = "\u{1F4A1}".repeat(120);
  assert.deepEqual(imp(csvOf(HEADER, `${emoji},רהיטים,,1,יחידה,1,1,`)).items.map((i) => i.name), [emoji]);
});

test("the row message names the row by position and name, and is Hebrew", () => {
  const message = BUDGET.rowError("Table", 3, BUDGET.errors.noteTooLong);
  for (const part of ["שורה 3", "Table", BUDGET.errors.noteTooLong]) assert.ok(message.includes(part), part);
  const unnamed = BUDGET.rowError("", 1, BUDGET.errors.noteTooLong);
  assert.ok(unnamed.startsWith("שורה 1:") && !unnamed.includes("()"));
});
