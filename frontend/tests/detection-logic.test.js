import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptBody, boxStyle, groupDetections, paletteItems, SURE } from "../js/detection-logic.js";

const sofa = { item_class: "couch", label: "Sofa", catalog_type: "sofa", confidence: 0.93, box: { x: 0.1, y: 0.4, w: 0.5, h: 0.3 } };
const chair = (confidence) => ({ item_class: "chair", label: "Chair", catalog_type: "chair", confidence, box: { x: 0.6, y: 0.5, w: 0.1, h: 0.2 } });
const plant = { item_class: "potted plant", label: "Plant", catalog_type: null, confidence: 0.45, box: { x: 0, y: 0, w: 0.1, h: 0.1 } };

test("detections are grouped by item, counted, and sure ones are ticked in advance", () => {
  const groups = groupDetections([chair(0.92), sofa, plant, chair(0.46), chair(0.7)]);
  assert.deepEqual(
    groups.map((g) => [g.item_class, g.label, g.quantity, g.confidence, g.sure]),
    // Two sure chairs; the unsure third one is not counted.
    [["couch", "Sofa", 1, 0.93, true], ["chair", "Chair", 2, 0.92, true], ["potted plant", "Plant", 1, 0.45, false]],
  );
  // When none is sure, every detection counts.
  assert.equal(groupDetections([plant, { ...plant, confidence: 0.5 }])[0].quantity, 2);
  assert.equal(SURE, 0.6);
  assert.equal(groupDetections([chair(0.59)])[0].sure, false);
  assert.equal(groupDetections([chair(0.6)])[0].sure, true);
  assert.deepEqual(groupDetections([]), []);
});

test("a box is placed in percent of the photo, clamped to it", () => {
  assert.deepEqual(boxStyle({ x: 0.1, y: 0.4, w: 0.5, h: 0.3 }), { left: "10%", top: "40%", width: "50%", height: "30%" });
  assert.deepEqual(boxStyle({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 }), { left: "0%", top: "90%", width: "30%", height: "10%" });
});

test("the request names the chosen items, their quantities and the photo", () => {
  const groups = groupDetections([sofa, chair(0.9), chair(0.8), plant]);
  const chosen = new Map([["couch", 1], ["chair", 3]]);
  assert.deepEqual(acceptBody(groups, chosen, "asset-1"), {
    source_asset_id: "asset-1",
    items: [{ item_class: "couch", quantity: 1 }, { item_class: "chair", quantity: 3 }],
  });
  assert.deepEqual(acceptBody(groups, new Map([["chair", 99]]), "a").items, [{ item_class: "chair", quantity: 20 }]);
  assert.deepEqual(acceptBody(groups, new Map([["chair", 0]]), "a").items, [{ item_class: "chair", quantity: 1 }]);
  assert.deepEqual(acceptBody(groups, new Map(), "a").items, []);
});

test("the editor palette shows each catalog type once, with the total quantity", () => {
  const owned = [
    { item_class: "chair", label: "Chair", catalog_type: "chair", quantity: 2 },
    { item_class: "couch", label: "Sofa", catalog_type: "sofa", quantity: 1 },
    { item_class: "chair", label: "Chair", catalog_type: "chair", quantity: 4 },
    { item_class: "potted plant", label: "Plant", catalog_type: null, quantity: 1 },
  ];
  assert.deepEqual(paletteItems(owned), [
    { type: "chair", label: "Chair", quantity: 6 },
    { type: "sofa", label: "Sofa", quantity: 1 },
  ]);
  assert.deepEqual(paletteItems([]), []);
});
