import assert from "node:assert/strict";
import { test } from "node:test";

import { calibrationFactor, imagePlacement, parseLength } from "../js/import/placement.js";
import { detectWalls, rescale } from "../js/import/walls.js";

test("image placement is the page rectangle shifted by the walls' origin", () => {
  const p = imagePlacement({ width: 100, height: 50 }, 2, { x: 30, y: 10 });
  assert.deepEqual(p, { x: -30, y: -10, width: 200, height: 100 });
});

test("calibration scales walls and the image the same way", () => {
  const page = { width: 100, height: 100 };
  const origin = { x: 20, y: 40 };
  const f = 1.5;
  const p = imagePlacement(page, 2, origin, f);
  assert.deepEqual(p, { x: -30, y: -60, width: 300, height: 300 });
  // A page point (px, py) in plan cm before calibration, times f, lands where the image says.
  const before = { x: 80 - origin.x, y: 120 - origin.y }; // page cm 80,120
  const after = rescale([{ id: "a", x1: before.x, y1: before.y, x2: before.x + 10, y2: before.y, thickness: 10, kind: "partition" }], f)[0];
  assert.equal(after.x1, p.x + 80 * f);
  assert.equal(after.y1, p.y + 120 * f);
});

test("calibration factor from two clicked points and a real length", () => {
  assert.equal(calibrationFactor(200, 300), 1.5);
  assert.equal(calibrationFactor(0, 300), null);
  assert.equal(calibrationFactor(200, -1), null);
  assert.equal(calibrationFactor(200, Number.NaN), null);
  assert.equal(calibrationFactor(1, 100000), null); // absurd ratio
});

test("typed lengths accept metres, centimetres and decimal commas", () => {
  assert.equal(parseLength("4.5", "m"), 450);
  assert.equal(parseLength("4,5", "m"), 450);
  assert.equal(parseLength(" 450 ", "cm"), 450);
  assert.equal(parseLength("abc", "m"), null);
  assert.equal(parseLength("", "cm"), null);
  assert.equal(parseLength("0", "cm"), null);
});

test("placement works with a detection result", () => {
  const page = { width: 600, height: 400, paths: [] };
  const result = detectWalls(page, { cmPerUnit: 1 });
  const p = imagePlacement(page, result.cmPerUnit, result.originCm);
  assert.equal(p.width, 600);
});
