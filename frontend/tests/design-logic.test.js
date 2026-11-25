import assert from "node:assert/strict";
import { test } from "node:test";
import * as L from "../js/design-logic.js";

const MATERIALS = [
  { id: "oak-floor", label: "Natural oak", surfaces: ["floor", "cabinets"], color: "#c9a46b" },
  { id: "white-paint", label: "Warm white paint", surfaces: ["walls", "ceiling", "cabinets"], color: "#f3efe6" },
  { id: "lime-plaster", label: "Lime plaster", surfaces: ["walls"], color: "#e4dccb" },
];
const SURFACES = ["floor", "walls", "ceiling", "cabinets"];
const BRIEF = { styles: [], colors: [], budget_min: "", budget_max: "", currency: "USD", adults: "2", children: "0", pets: false };

test("materialsForSurface keeps only materials allowed on that surface", () => {
  assert.deepEqual(L.materialsForSurface(MATERIALS, "walls").map((m) => m.id), ["white-paint", "lime-plaster"]);
  assert.deepEqual(L.materialsForSurface(MATERIALS, "ceiling").map((m) => m.id), ["white-paint"]);
  assert.deepEqual(L.materialsForSurface(MATERIALS, "roof"), []);
  assert.deepEqual(L.materialsForSurface([], "floor"), []);
});

test("swatchColor accepts hex colours only", () => {
  assert.equal(L.swatchColor("#C9A46B"), "#C9A46B");
  assert.equal(L.swatchColor("red; background: url(x)"), "transparent");
  assert.equal(L.swatchColor(undefined), "transparent");
});

test("toggleStyle adds, removes and stops at five", () => {
  assert.deepEqual(L.toggleStyle([], "modern"), ["modern"]);
  assert.deepEqual(L.toggleStyle(["modern", "classic"], "modern"), ["classic"]);
  const five = ["a", "b", "c", "d", "e"];
  assert.equal(L.toggleStyle(five, "f"), five);
  assert.deepEqual(L.toggleStyle(five, "e"), ["a", "b", "c", "d"]);
});

test("addColor normalises case, refuses duplicates, invalid values and a ninth colour", () => {
  assert.deepEqual(L.addColor([], "#AABBCC"), ["#aabbcc"]);
  const one = ["#aabbcc"];
  assert.equal(L.addColor(one, "#AABBCC"), one);
  assert.equal(L.addColor(one, "#abc"), one);
  assert.equal(L.addColor(one, "javascript:1"), one);
  const eight = Array.from({ length: 8 }, (_, i) => `#00000${i}`);
  assert.equal(L.addColor(eight, "#ffffff"), eight);
});

test("buildBriefPayload turns form strings into the API shape", () => {
  const { payload, error } = L.buildBriefPayload({
    styles: ["modern", "japandi", "modern"],
    colors: ["#9F3C16", "#9f3c16", "#47654f"],
    budget_min: " 10000 ",
    budget_max: "25000",
    currency: "EUR",
    adults: "2",
    children: "",
    pets: true,
    lifestyle: "  Work from home  ",
    needs: "Storage",
    constraints: "",
    existing_items: undefined,
  });
  assert.equal(error, undefined);
  assert.deepEqual(payload, {
    styles: ["modern", "japandi"],
    colors: ["#9f3c16", "#47654f"],
    budget_min: 10000,
    budget_max: 25000,
    currency: "EUR",
    adults: 2,
    children: 0,
    pets: true,
    lifestyle: "Work from home",
    needs: "Storage",
    constraints: "",
    existing_items: "",
  });
});

test("buildBriefPayload: empty form gives the schema defaults", () => {
  const { payload } = L.buildBriefPayload({ currency: "USD" });
  assert.deepEqual(payload, {
    styles: [], colors: [], budget_min: null, budget_max: null, currency: "USD", adults: 1, children: 0, pets: false,
    lifestyle: "", needs: "", constraints: "", existing_items: "",
  });
});

test("buildBriefPayload: boundaries of budget and household", () => {
  assert.equal(L.buildBriefPayload({ ...BRIEF, budget_min: "0", budget_max: "100000000", adults: "20", children: "20" }).error, undefined);
  assert.equal(L.buildBriefPayload({ ...BRIEF, budget_min: "500", budget_max: "500" }).payload.budget_max, 500);
  assert.match(L.buildBriefPayload({ ...BRIEF, budget_max: "100000001" }).error, /Maximum budget/);
  assert.match(L.buildBriefPayload({ ...BRIEF, budget_min: "-1" }).error, /Minimum budget/);
  assert.match(L.buildBriefPayload({ ...BRIEF, budget_min: "12.5" }).error, /whole number/);
  assert.match(L.buildBriefPayload({ ...BRIEF, budget_min: "abc" }).error, /whole number/);
  assert.match(L.buildBriefPayload({ ...BRIEF, budget_min: "900", budget_max: "100" }).error, /must not exceed/);
  assert.match(L.buildBriefPayload({ ...BRIEF, adults: "21" }).error, /Adults/);
  assert.match(L.buildBriefPayload({ ...BRIEF, children: "-2" }).error, /Children/);
});

test("buildBriefPayload: too many styles or colours, bad colour, bad currency, long text", () => {
  assert.match(L.buildBriefPayload({ ...BRIEF, styles: ["a", "b", "c", "d", "e", "f"] }).error, /at most 5 styles/);
  assert.match(L.buildBriefPayload({ ...BRIEF, colors: Array.from({ length: 9 }, (_, i) => `#00000${i}`) }).error, /at most 8 colours/);
  assert.match(L.buildBriefPayload({ ...BRIEF, colors: ["red"] }).error, /hex/);
  assert.match(L.buildBriefPayload({ ...BRIEF, currency: "JPY" }).error, /currency/);
  assert.equal(L.buildBriefPayload({ ...BRIEF, needs: "x".repeat(1000) }).error, undefined);
  assert.match(L.buildBriefPayload({ ...BRIEF, needs: "x".repeat(1001) }).error, /Needs/);
  assert.equal(L.buildBriefPayload({ ...BRIEF, needs: ` ${"x".repeat(1000)} ` }).payload.needs.length, 1000);
});

test("finishSelections keeps rooms of the plan and materials that fit the surface", () => {
  const rooms = [{ id: "r1" }, { id: "r2" }];
  const chosen = L.finishesToMap([
    { room_id: "r1", surface: "floor", material_id: "oak-floor" },
    { room_id: "r1", surface: "walls", material_id: "oak-floor" }, // does not fit walls
    { room_id: "r2", surface: "ceiling", material_id: "white-paint" },
    { room_id: "gone", surface: "floor", material_id: "oak-floor" }, // room removed from the plan
    { room_id: "r2", surface: "walls", material_id: "unknown" },
  ]);
  chosen[L.finishKey("r2", "floor")] = ""; // "None" picked
  assert.deepEqual(L.finishSelections(rooms, SURFACES, MATERIALS, chosen), [
    { room_id: "r1", surface: "floor", material_id: "oak-floor" },
    { room_id: "r2", surface: "ceiling", material_id: "white-paint" },
  ]);
  assert.deepEqual(L.finishSelections([], SURFACES, MATERIALS, chosen), []);
  assert.deepEqual(L.finishSelections(rooms, SURFACES, MATERIALS, {}), []);
});

test("moveItem moves up and down without mutating, and ignores impossible moves", () => {
  const items = ["a", "b", "c"];
  assert.deepEqual(L.moveItem(items, 1, -1), ["b", "a", "c"]);
  assert.deepEqual(L.moveItem(items, 1, 1), ["a", "c", "b"]);
  assert.deepEqual(items, ["a", "b", "c"]);
  assert.equal(L.moveItem(items, 0, -1), items);
  assert.equal(L.moveItem(items, 2, 1), items);
  assert.equal(L.moveItem(items, 5, -1), items);
  assert.equal(L.moveItem(items, -1, 1), items);
  assert.equal(L.moveItem(items, 1, 0), items);
  assert.deepEqual(L.moveItem([], 0, 1), []);
  assert.deepEqual(L.moveItem(["only"], 0, 1), ["only"]);
});

test("board: add once, cap at 40, remove, note, payload", () => {
  let items = L.addBoardItem([], "style", "modern");
  assert.deepEqual(items, [{ kind: "style", ref: "modern", note: "" }]);
  assert.equal(L.addBoardItem(items, "style", "modern"), items);
  items = L.addBoardItem(items, "material", "modern"); // same ref, other kind: a different item
  assert.equal(items.length, 2);
  assert.equal(L.onBoard(items, "material", "modern"), true);
  assert.equal(L.onBoard(items, "asset", "modern"), false);

  const full = Array.from({ length: 40 }, (_, i) => ({ kind: "asset", ref: `a${i}`, note: "" }));
  assert.equal(L.addBoardItem(full, "style", "modern"), full);

  items = L.setBoardNote(items, "style", "modern", "  calm  ");
  assert.equal(items[0].note, "  calm  ");
  assert.equal(items[1].note, "");
  const withUrl = [{ ...items[0], url: "https://x.test/a.png" }, { kind: "asset", ref: "id", note: "n".repeat(250) }];
  assert.deepEqual(L.boardPayload(withUrl), {
    items: [{ kind: "style", ref: "modern", note: "calm" }, { kind: "asset", ref: "id", note: "n".repeat(200) }],
  });
  assert.deepEqual(L.boardPayload([]), { items: [] });
  assert.deepEqual(L.removeBoardItem(items, "style", "modern"), [{ kind: "material", ref: "modern", note: "" }]);
});

test("validateImageFile checks presence, type and the 5 MB limit", () => {
  const MB5 = 5 * 1024 * 1024;
  assert.equal(L.validateImageFile({ type: "image/png", size: 1 }), null);
  assert.equal(L.validateImageFile({ type: "image/jpeg", size: MB5 }), null);
  assert.equal(L.validateImageFile({ type: "image/webp", size: 10 }), null);
  assert.match(L.validateImageFile({ type: "image/png", size: MB5 + 1 }), /5 MB/);
  assert.match(L.validateImageFile({ type: "image/png", size: 0 }), /empty/);
  assert.match(L.validateImageFile({ type: "image/gif", size: 10 }), /JPEG, PNG and WebP/);
  assert.match(L.validateImageFile({ type: "image/svg+xml", size: 10 }), /JPEG, PNG and WebP/);
  assert.match(L.validateImageFile({ type: "", size: 10 }), /JPEG, PNG and WebP/);
  assert.match(L.validateImageFile(undefined), /Choose an image/);
});

test("safeImageUrl loads http(s) links only", () => {
  assert.equal(L.safeImageUrl("https://x.test/a.png?token=1"), "https://x.test/a.png?token=1");
  assert.equal(L.safeImageUrl("javascript:alert(1)"), "");
  assert.equal(L.safeImageUrl("data:image/svg+xml,<svg/>"), "");
  assert.equal(L.safeImageUrl(""), "");
  assert.equal(L.safeImageUrl(undefined), "");
});

test("messageState counts characters and allows 1 to 2000 non-blank characters", () => {
  assert.deepEqual(L.messageState(""), { length: 0, canSend: false, counter: "0 / 2000" });
  assert.equal(L.messageState("   \n ").canSend, false);
  assert.equal(L.messageState("a").canSend, true);
  assert.equal(L.messageState("x".repeat(2000)).canSend, true);
  assert.equal(L.messageState("x".repeat(2001)).canSend, false);
  assert.equal(L.messageState("x".repeat(2001)).counter, "2001 / 2000");
});
