import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { CATEGORIES, PRODUCTS, PRODUCT_BY_ID } from "../js/products.js";
import * as S from "../js/shop-logic.js";

const add = (state, extra = {}) => S.addItem(state, { productId: "FUR-001", color: "Beige", sizeId: "3-seater", quantity: 1, ...extra });
const ids = (list) => list.map((p) => p.id);

test("mock data meets the minimums", () => {
  assert.equal(CATEGORIES.length, 4);
  assert.ok(PRODUCTS.length >= 20);
  assert.equal(PRODUCT_BY_ID.size, PRODUCTS.length);
  for (const category of CATEGORIES) assert.ok(PRODUCTS.filter((p) => p.category === category.id).length >= 5);
  for (const p of PRODUCTS) {
    assert.ok(p.name && p.description && p.sizes.length, p.id);
    assert.ok(existsSync(new URL(`../${p.image}`, import.meta.url)), p.image);
    for (const size of p.sizes) assert.ok(Number.isInteger(size.price) && size.price > 0 && Object.keys(size.dimensions).length, p.id);
  }
});

test("filters combine, clear, and can match nothing", () => {
  const found = S.filterProducts(PRODUCTS, { category: "lighting", color: "Black", min: 0, max: 1000 });
  assert.ok(found.length > 0);
  for (const p of found) assert.ok(p.category === "lighting" && p.colors.includes("Black") && S.minPrice(p) <= 1000);
  assert.equal(S.filterProducts(PRODUCTS, {}).length, PRODUCTS.length);
  assert.deepEqual(S.filterProducts(PRODUCTS, { min: 999999 }), []);
  const price = S.minPrice(PRODUCTS[0]);
  assert.ok(ids(S.filterProducts(PRODUCTS, { min: price, max: price })).includes(PRODUCTS[0].id));
  assert.deepEqual(S.priceBounds([]), { min: 0, max: 0 });
});

test("sorting works in both directions without changing the input", () => {
  const before = ids(PRODUCTS);
  const up = S.sortProducts(PRODUCTS, "price-asc").map(S.minPrice);
  assert.deepEqual(up, [...up].sort((a, b) => a - b));
  const down = S.sortProducts(PRODUCTS, "price-desc").map(S.minPrice);
  assert.deepEqual(down, [...down].sort((a, b) => b - a));
  assert.deepEqual(ids(PRODUCTS), before);
  assert.deepEqual(ids(S.sortProducts(PRODUCTS, "")), before);
});

test("same options merge, different options make a new line, totals follow the size price", () => {
  let state = add(add(S.emptyState()));
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].quantity, 2);
  state = add(add(state, { color: "Black" }), { sizeId: "2-seater" });
  assert.equal(state.items.length, 3);
  assert.equal(S.lineTotal(state.items[0]), 9000);
  assert.equal(S.estimatedTotal(state), 9000 + 4500 + 4000);
  assert.equal(S.estimatedTotal(S.removeItem(state, 0)), 8500);
});

test("quantity stays between 1 and 99", () => {
  const state = add(S.emptyState());
  assert.equal(S.setQuantity(state, 0, 0).items[0].quantity, 1);
  assert.equal(S.setQuantity(state, 0, -5).items[0].quantity, 1);
  assert.equal(S.setQuantity(state, 0, 500).items[0].quantity, 99);
  assert.equal(S.setQuantity(state, 0, NaN), state);
  assert.equal(S.setQuantity(state, 7, 2), state);
  assert.equal(add(add(state, { quantity: 99 })).items[0].quantity, 99);
});

test("invalid additions are refused", () => {
  for (const bad of [{ productId: "NOPE" }, { color: "Pink" }, { color: null }, { sizeId: "9-seater" }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 100 }])
    assert.throws(() => add(S.emptyState(), bad), Error, JSON.stringify(bad));
  const plain = PRODUCTS.find((p) => !p.colors.length);
  const state = S.addItem(S.emptyState(), { productId: plain.id, color: null, sizeId: plain.sizes[0].id });
  assert.equal(state.items[0].quantity, 1);
});

test("favorites are separate from the list", () => {
  const state = S.toggleFavorite(S.emptyState(), "FUR-001");
  assert.deepEqual([state.favorites, state.items], [["FUR-001"], []]);
  assert.deepEqual(S.toggleFavorite(state, "FUR-001").favorites, []);
});

test("any list edit after approval returns it to draft", () => {
  assert.throws(() => S.approve(S.emptyState()));
  const approved = S.approve(add(S.emptyState()));
  assert.equal(approved.status, "approved");
  for (const next of [add(approved), S.setQuantity(approved, 0, 3), S.removeItem(approved, 0)]) assert.equal(next.status, "draft");
  assert.equal(S.toggleFavorite(approved, "FUR-001").status, "approved");
  assert.equal(S.setQuantity(approved, 0, 1).status, "approved");
});

test("stored state is validated on the way back in", () => {
  for (const raw of [null, 5, "x", [], { items: "no", favorites: {} }]) assert.deepEqual(S.restore(raw), S.emptyState());
  const line = { productId: "FUR-001", color: "Beige", sizeId: "3-seater" };
  const state = S.restore({
    favorites: ["FUR-001", "FUR-001", "NOPE", 4],
    items: [
      null,
      { ...line, quantity: 1e9 },
      { ...line, quantity: 2 },
      { ...line, color: "Pink", quantity: 1 },
      { ...line, sizeId: "x", quantity: 1 },
      { ...line, color: "Black", quantity: -3 },
      { ...line, color: "Brown", quantity: "abc" },
    ],
    status: "shipped",
  });
  assert.deepEqual(state.favorites, ["FUR-001"]);
  assert.deepEqual(state.items.map((i) => [i.color, i.quantity]), [["Beige", 99], ["Black", 1]]);
  assert.equal(state.status, "draft");
  assert.equal(S.restore({ items: [], status: "approved" }).status, "draft");
});

test("CSV has the columns, one row per line and a total", () => {
  const state = add(add(S.emptyState(), { quantity: 2 }), { color: "Black" });
  assert.deepEqual(S.toCsv(state).split("\r\n"), [
    "Product ID,Product Name,Category,Color,Size,Quantity,Unit Price,Line Total",
    "FUR-001,Modern Sofa,Furniture,Beige,3-seater,2,4500,9000",
    "FUR-001,Modern Sofa,Furniture,Black,3-seater,1,4500,4500",
    "TOTAL,,,,,,,13500",
  ]);
  assert.equal(S.csvCell("=1+1"), "'=1+1");
  assert.equal(S.csvCell('a,"b"'), '"a,""b"""');
});

test("money uses the project currency and falls back to USD", () => {
  assert.equal(S.formatMoney(4500, "USD"), "$4,500");
  assert.ok(S.formatMoney(4500, "ILS").includes("4,500"));
  assert.equal(S.formatMoney(1, "not a code"), "$1");
});
