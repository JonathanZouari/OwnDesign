import test from "node:test";
import assert from "node:assert/strict";
import { pinchView } from "../js/editor/pointer.js";

const view = { x: 0, y: 0, w: 1000, h: 800 };
const centre = { x: 500, y: 400 };
// Where a plan point sits on screen, as a fraction of the view.
const at = (v, p) => ({ x: (p.x - v.x) / v.w, y: (p.y - v.y) / v.h });

test("two fingers moving together pan without zooming", () => {
  assert.deepEqual(pinchView(view, centre, 1, { x: 100, y: -50 }), { x: -100, y: 50, w: 1000, h: 800 });
});

test("a still midpoint zooms around the centre", () => {
  assert.deepEqual(at(pinchView(view, centre, 0.5, { x: 0, y: 0 }), centre), at(view, centre));
});

test("the point under the fingers follows the midpoint while zooming", () => {
  const next = pinchView(view, centre, 0.5, { x: 100, y: 80 });
  assert.deepEqual(at(next, centre), at(view, { x: 600, y: 480 }));
});

test("at the zoom limit the plan still pans", () => {
  const next = pinchView(view, centre, 0.001, { x: 100, y: 0 });
  assert.equal(next.w, 150);
  assert.ok(Math.abs(at(next, centre).x - 0.6) < 1e-9);
});
