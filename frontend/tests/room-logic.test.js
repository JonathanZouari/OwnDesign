import assert from "node:assert/strict";
import { test } from "node:test";
import * as R from "../js/room-logic.js";

const SOFA = { label: "Sofa", category: "seating", confidence: 0.917, box: [0.1, 0.4, 0.6, 0.3], color_hex: "#c8b8a8", color_name: "beige", position: "centre" };
const CHAIR = { label: "Chair", category: "seating", confidence: 0.5, box: [0.7, 0.5, 0.2, 0.3], color_hex: "#202020", color_name: "black", position: "right" };
const ASSET = "11111111-1111-1111-1111-111111111111";

test("detectionsToDrafts numbers the detections and ticks them all", () => {
  const drafts = R.detectionsToDrafts([SOFA, CHAIR], ASSET, "r1");
  assert.deepEqual(drafts.map((d) => [d.number, d.selected, d.label, d.room_id]), [[1, true, "Sofa", "r1"], [2, true, "Chair", "r1"]]);
  assert.equal(drafts[0].asset_id, ASSET);
  assert.deepEqual(R.detectionsToDrafts([], ASSET, null), []);
  assert.deepEqual(R.detectionsToDrafts(undefined, ASSET, null), []);
});

test("detectionsToDrafts replaces unknown categories and bad colours", () => {
  const [draft] = R.detectionsToDrafts([{ ...SOFA, category: "spaceship", color_hex: "red;x" }], ASSET, null);
  assert.equal(draft.category, "other");
  assert.equal(draft.color_hex, null);
});

test("selectedItems builds the POST body from ticked drafts only", () => {
  const drafts = R.detectionsToDrafts([SOFA, CHAIR], ASSET, null);
  drafts[1].selected = false;
  drafts[0].label = "  Grey sofa  ";
  assert.deepEqual(R.selectedItems(drafts), [
    { label: "Grey sofa", category: "seating", color_hex: "#c8b8a8", room_id: null, note: "", source: "scan", asset_id: ASSET, confidence: 0.917, box: SOFA.box },
  ]);
  drafts[0].selected = false;
  assert.deepEqual(R.selectedItems(drafts), []);
});

test("validateItem mirrors the API limits", () => {
  assert.equal(R.validateItem({ label: "Lamp", category: "decor" }), null);
  assert.match(R.validateItem({ label: "   ", category: "decor" }), /name/i);
  assert.match(R.validateItem({ label: "x".repeat(R.MAX_LABEL + 1), category: "decor" }), /80/);
  assert.equal(R.validateItem({ label: "x".repeat(R.MAX_LABEL), category: "decor" }), null);
  assert.match(R.validateItem({ label: "Lamp", category: "nope" }), /category/i);
  assert.match(R.validateItem({ label: "Lamp", category: "decor", color_hex: "#12345" }), /colour/i);
  assert.match(R.validateItem({ label: "Lamp", category: "decor", note: "x".repeat(201) }), /200/);
});

test("validateItems reports the first bad draft by its number, and an empty selection", () => {
  const drafts = R.detectionsToDrafts([SOFA, CHAIR], ASSET, null);
  drafts[1].label = "";
  assert.match(R.validateItems(R.selectedItems(drafts), drafts.filter((d) => d.selected)), /Item 2/);
  assert.match(R.validateItems([], []), /tick/i);
  assert.match(R.validateItems(Array(51).fill({ label: "a", category: "other" }), []), /50/);
});

test("groupByRoom keeps plan order, then the whole home, and names unknown rooms", () => {
  const rooms = [{ id: "r1", name: "Living" }, { id: "r2", name: "Bedroom" }];
  const items = [
    { id: "a", room_id: null, label: "Rug" },
    { id: "b", room_id: "r2", label: "Bed" },
    { id: "c", room_id: "r1", label: "Sofa" },
    { id: "d", room_id: "gone", label: "Shelf" },
  ];
  const groups = R.groupByRoom(items, rooms);
  assert.deepEqual(groups.map((g) => [g.title, g.items.map((i) => i.id)]), [
    ["Living", ["c"]], ["Bedroom", ["b"]], ["Whole home", ["a", "d"]],
  ]);
  assert.deepEqual(R.groupByRoom([], rooms), []);
});

test("boxToPercent clamps and formats overlay positions", () => {
  assert.deepEqual(R.boxToPercent([0.1, 0.2, 0.3, 0.4]), { left: "10%", top: "20%", width: "30%", height: "40%" });
  assert.deepEqual(R.boxToPercent([-1, 2, 5, -3]), { left: "0%", top: "100%", width: "100%", height: "0%" });
  assert.deepEqual(R.boxToPercent(null), null);
});

test("scanFileProblem refuses empty, large and non-image files", () => {
  assert.equal(R.scanFileProblem(null), "Choose or take a photo first.");
  assert.match(R.scanFileProblem({ size: 0, type: "image/jpeg" }), /empty/);
  assert.match(R.scanFileProblem({ size: 5 * 1024 * 1024 + 1, type: "image/jpeg" }), /5 MB/);
  assert.match(R.scanFileProblem({ size: 10, type: "image/gif" }), /JPEG/);
  assert.equal(R.scanFileProblem({ size: 10, type: "image/webp" }), null);
});

test("itemSummary describes an item in words", () => {
  assert.equal(R.itemSummary({ category: "seating", color_name: "beige", confidence: 0.917, source: "scan" }), "Seating · beige · 92% sure");
  assert.equal(R.itemSummary({ category: "decor", source: "manual" }), "Decor");
});
