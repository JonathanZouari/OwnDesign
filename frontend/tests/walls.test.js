import assert from "node:assert/strict";
import { test } from "node:test";

import * as P from "../js/plan.js";
import { detectScale, detectWalls, rescale, wallLength } from "../js/import/walls.js";

const PT_CM = 2.54 / 72; // one PDF unit in cm at 1:1
const cmPerUnit = (n) => PT_CM * n;

// ---- synthetic page builders. All geometry is authored in cm and converted to PDF units for scale 1:n. ----
const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const poly = (pts, extra = {}) => ({
  ops: [
    ...pts.map(([x, y], i) => ({ op: i === 0 ? "M" : "L", pts: [x, y] })),
    { op: "Z", pts: [] },
  ],
  fill: true,
  stroke: false,
  fillColor: [0, 0, 0],
  lineWidth: 0,
  ...extra,
});
const line = (x1, y1, x2, y2, lineWidth = 0.1) => ({
  ops: [{ op: "M", pts: [x1, y1] }, { op: "L", pts: [x2, y2] }],
  fill: false,
  stroke: true,
  fillColor: null,
  lineWidth,
});
const strokedRect = (x, y, w, h, extra = {}) => poly(rectPts(x, y, w, h), { fill: false, stroke: true, fillColor: null, lineWidth: 0.1, ...extra });

// Scales every coordinate of a cm-authored path into PDF units.
function toUnits(path, n) {
  const k = 1 / cmPerUnit(n);
  return { ...path, lineWidth: path.lineWidth * k, ops: path.ops.map((o) => ({ op: o.op, pts: o.pts.map((v) => v * k) })) };
}
const pageOf = (paths, n, wCm = 1500, hCm = 1000) => ({
  width: wCm / cmPerUnit(n),
  height: hCm / cmPerUnit(n),
  paths: paths.map((p) => toUnits(p, n)),
});

// Two-room apartment, 7 walls. Centre lines in cm (page space), shifted so it does not start at 0.
const OX = 300;
const OY = 200;
const EXPECTED = [
  [0, 0, 800, 0, 20, "exterior"],
  [0, 500, 800, 500, 20, "exterior"],
  [0, 0, 0, 500, 20, "exterior"],
  [800, 0, 800, 500, 20, "exterior"],
  [400, 0, 400, 500, 10, "partition"],
  [400, 250, 800, 250, 10, "partition"],
  [0, 300, 150, 300, 10, "partition"],
].map(([x1, y1, x2, y2, thickness, kind]) => ({ x1: x1 + OX, y1: y1 + OY, x2: x2 + OX, y2: y2 + OY, thickness, kind }));

// Each wall as a dark filled rectangle (outer ones overlap at the corners, partitions stop at the faces).
function apartmentFilled() {
  const r = (x, y, w, h) => poly(rectPts(x + OX, y + OY, w, h));
  return [
    r(-10, -10, 820, 20),
    r(-10, 490, 820, 20),
    r(-10, 10, 20, 480),
    r(790, 10, 20, 480),
    r(395, 10, 10, 480),
    r(405, 245, 385, 10),
    r(10, 295, 140, 10),
  ];
}

// The same walls as an outline pair (outer + inner loop) plus parallel line pairs for the partitions.
function apartmentStroked() {
  const s = (x1, y1, x2, y2) => line(x1 + OX, y1 + OY, x2 + OX, y2 + OY);
  return [
    strokedRect(-10 + OX, -10 + OY, 820, 520),
    strokedRect(10 + OX, 10 + OY, 780, 480),
    s(395, 10, 395, 490), s(405, 10, 405, 490),
    s(405, 245, 790, 245), s(405, 255, 790, 255),
    s(10, 295, 150, 295), s(10, 305, 150, 305),
  ];
}

const key = (w) => [w.x1, w.y1, w.x2, w.y2];
// Compares to the expected list ignoring order and direction; offset adds originCm back to page space.
function assertWalls(result, expected, tol = 2) {
  const { originCm } = result;
  const got = result.walls.map((w) => ({ ...w, x1: w.x1 + originCm.x, y1: w.y1 + originCm.y, x2: w.x2 + originCm.x, y2: w.y2 + originCm.y }));
  assert.equal(got.length, expected.length, `wall count: ${JSON.stringify(got.map(key))}`);
  const left = [...got];
  for (const e of expected) {
    const idx = left.findIndex((g) => {
      const same = [0, 1, 2, 3].every((i) => Math.abs(key(g)[i] - key(e)[i]) <= tol);
      const flipped = Math.abs(g.x1 - e.x2) <= tol && Math.abs(g.y1 - e.y2) <= tol && Math.abs(g.x2 - e.x1) <= tol && Math.abs(g.y2 - e.y1) <= tol;
      return (same || flipped) && Math.abs(g.thickness - e.thickness) <= tol;
    });
    assert.ok(idx >= 0, `missing ${JSON.stringify(e)} in ${JSON.stringify(left.map((w) => ({ ...key(w), t: w.thickness })))}`);
    assert.equal(left[idx].kind, e.kind);
    left.splice(idx, 1);
  }
}

// ---- detectScale ----
test("detectScale reads 1:50 and the Hebrew label", () => {
  assert.deepEqual(detectScale([{ str: "1:50", x: 0, y: 0 }]).ratio, 50);
  const r = detectScale([{ str: 'קנ"מ 1:50', x: 0, y: 0 }]);
  assert.equal(r.ratio, 50);
  assert.ok(Math.abs(r.cmPerUnit - cmPerUnit(50)) < 1e-9);
  assert.equal(detectScale([{ str: "קנ״מ 1:50", x: 0, y: 0 }]).ratio, 50);
});

test("detectScale handles spaces, 1:100 and 1:20", () => {
  assert.equal(detectScale([{ str: "1 : 100", x: 0, y: 0 }]).ratio, 100);
  assert.equal(detectScale([{ str: "1:20", x: 0, y: 0 }]).ratio, 20);
  assert.equal(detectScale([{ str: 'קנ"מ 1:20', x: 0, y: 0 }]).ratio, 20);
});

test("detectScale returns null without a scale or with an out-of-range decoy", () => {
  assert.deepEqual(detectScale([]), { ratio: null, cmPerUnit: null, candidates: [] });
  assert.equal(detectScale([{ str: "חדר שינה", x: 0, y: 0 }]).ratio, null);
  assert.equal(detectScale([{ str: "1:5000", x: 0, y: 0 }]).ratio, null);
  assert.equal(detectScale([{ str: "1:5", x: 0, y: 0 }]).ratio, null);
  assert.equal(detectScale([{ str: "21:50", x: 0, y: 0 }]).ratio, null);
  assert.equal(detectScale([{ str: "12.1:50", x: 0, y: 0 }]).ratio, null);
});

test("detectScale prefers the value near the scale label, else the most frequent, and lists all", () => {
  const near = detectScale([
    { str: "1:20", x: 500, y: 500 },
    { str: "1:20", x: 600, y: 500 },
    { str: "קנ\"מ", x: 10, y: 10 },
    { str: "1:50", x: 40, y: 10 },
  ]);
  assert.equal(near.ratio, 50);
  assert.deepEqual(near.candidates, [50, 20]);
  const frequent = detectScale([
    { str: "1:50", x: 0, y: 0 },
    { str: "1:20", x: 300, y: 0 },
    { str: "1:20", x: 600, y: 0 },
  ]);
  assert.equal(frequent.ratio, 20);
  assert.deepEqual(frequent.candidates, [20, 50]);
  const tie = detectScale([{ str: "1:50", x: 0, y: 0 }, { str: "1:20", x: 300, y: 0 }]);
  assert.deepEqual(tie.candidates, [50, 20]);
});

// ---- detectWalls ----
for (const n of [20, 50, 100]) {
  test(`two-room apartment drawn as filled rectangles at 1:${n} gives 7 walls`, () => {
    const res = detectWalls(pageOf(apartmentFilled(), n), { cmPerUnit: cmPerUnit(n) });
    assertWalls(res, EXPECTED);
    assert.ok(!res.warnings.includes("no_scale"));
    assert.ok(res.confidence > 0.8, `confidence ${res.confidence}`);
  });
}

test("the same apartment drawn with parallel stroked lines gives 7 walls", () => {
  const res = detectWalls(pageOf(apartmentStroked(), 50), { cmPerUnit: cmPerUnit(50) });
  assertWalls(res, EXPECTED, 3);
});

test("origin is returned and the walls start near (0,0)", () => {
  const res = detectWalls(pageOf(apartmentFilled(), 50), { cmPerUnit: cmPerUnit(50) });
  assert.ok(Math.abs(res.originCm.x - (OX - 10)) <= 2 && Math.abs(res.originCm.y - (OY - 10)) <= 2, JSON.stringify(res.originCm));
  const minX = Math.min(...res.walls.flatMap((w) => [w.x1 - w.thickness / 2, w.x2 - w.thickness / 2]));
  assert.ok(minX >= -2 && minX <= 2);
});

test("noise is ignored: hatching, furniture, dimension lines, door arcs, text-size marks", () => {
  const noise = [];
  for (let i = 0; i < 40; i++) noise.push(line(OX + 20 + i * 18, OY + 20, OX + 20 + i * 18 + 15, OY + 35, 0.05)); // hatching
  noise.push(strokedRect(OX + 420, OY + 20, 90, 200), poly(rectPts(OX + 100, OY + 330, 200, 90), { fillColor: [235, 235, 235], stroke: true, lineWidth: 0.1 })); // furniture
  noise.push(strokedRect(OX + 120, OY + 340, 45, 45), poly(rectPts(OX + 600, OY + 300, 40, 40), { fillColor: [250, 250, 250] }));
  noise.push(line(OX, OY - 80, OX + 800, OY - 80), line(OX, OY - 90, OX, OY - 70), line(OX + 800, OY - 90, OX + 800, OY - 70)); // dimension line + ticks
  noise.push({
    ops: [{ op: "M", pts: [OX + 150, OY + 300] }, { op: "C", pts: [OX + 150, OY + 380, OX + 230, OY + 380, OX + 230, OY + 300] }, { op: "L", pts: [OX + 150, OY + 300] }, { op: "Z", pts: [] }],
    fill: true, stroke: true, fillColor: [0, 0, 0], lineWidth: 0.1,
  }); // door arc (curve): never a wall
  const res = detectWalls(pageOf([...apartmentFilled(), ...noise], 50), { cmPerUnit: cmPerUnit(50) });
  assertWalls(res, EXPECTED);
});

test("noise is ignored on the stroked drawing too", () => {
  const noise = [strokedRect(OX + 420, OY + 20, 90, 200), strokedRect(OX + 120, OY + 340, 45, 45), line(OX, OY - 80, OX + 800, OY - 80)];
  const res = detectWalls(pageOf([...apartmentStroked(), ...noise], 50), { cmPerUnit: cmPerUnit(50) });
  assertWalls(res, EXPECTED, 3);
});

test("fills: no explicit colour counts as black, mid grey counts, light grey does not", () => {
  const f = (color, y) => poly(rectPts(0, y, 400, 20), { fillColor: color });
  const res = detectWalls(pageOf([f(null, 0), f([100, 100, 100], 200), f([220, 220, 220], 400)], 50), { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 2);
});

test("a wall rotated by 1.5 degrees is snapped to horizontal", () => {
  const a = (1.5 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const base = [[0, -10], [400, -10], [400, 10], [0, 10]];
  const pts = base.map(([x, y]) => [x * c - y * s + 100, x * s + y * c + 100]);
  const res = detectWalls(pageOf([poly(pts)], 50), { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 1);
  assert.equal(res.walls[0].y1, res.walls[0].y2);
  assert.ok(Math.abs(wallLength(res.walls[0]) - 400) <= 3);
  assert.equal(res.walls[0].thickness, 20);
});

test("collinear and overlapping pieces are merged", () => {
  const res = detectWalls(pageOf([poly(rectPts(0, 0, 210, 20)), poly(rectPts(200, 0, 100, 20)), poly(rectPts(300, 0, 100, 20))], 50), { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 1);
  assert.ok(Math.abs(wallLength(res.walls[0]) - 400) <= 2);
});

test("a T junction ends the stem on the through wall's centre line", () => {
  const res = detectWalls(pageOf([poly(rectPts(0, 0, 600, 20)), poly(rectPts(295, 20, 10, 280))], 50), { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 2);
  const through = res.walls.find((w) => w.y1 === w.y2);
  const stem = res.walls.find((w) => w.x1 === w.x2);
  const top = Math.min(stem.y1, stem.y2);
  assert.ok(Math.abs(top - through.y1) <= 1, `${top} vs ${through.y1}`);
});

test("an L shaped polygon becomes two connected walls", () => {
  const pts = [[0, 0], [400, 0], [400, 20], [20, 20], [20, 300], [0, 300]];
  const res = detectWalls(pageOf([poly(pts)], 50), { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 2);
  assert.ok(res.walls.every((w) => w.thickness === 20 && w.kind === "exterior"));
});

test("tiny and isolated fragments are dropped, short connected ones kept", () => {
  const res = detectWalls(
    pageOf([
      poly(rectPts(0, 0, 500, 20)), // kept
      poly(rectPts(1000, 0, 20, 20)), // tiny
      poly(rectPts(1000, 500, 80, 10)), // isolated and < 100 cm
      poly(rectPts(0, 20, 10, 80)), // 80 cm but attached to the long wall
    ], 50, 2000, 1000),
    { cmPerUnit: cmPerUnit(50) },
  );
  assert.equal(res.walls.length, 2);
});

test("thickness decides the kind and is clamped", () => {
  const res = detectWalls(pageOf([poly(rectPts(0, 0, 500, 16)), poly(rectPts(0, 400, 500, 17)), poly(rectPts(0, 800, 500, 70))], 50, 1500, 1500), { cmPerUnit: cmPerUnit(50) });
  const byT = Object.fromEntries(res.walls.map((w) => [w.thickness, w.kind]));
  assert.equal(byT[16], "partition");
  assert.equal(byT[17], "exterior");
  assert.equal(res.walls.length, 2, "70 cm slab is not a wall");
});

test("without a scale it still detects, with the no_scale warning", () => {
  const res = detectWalls(pageOf(apartmentFilled(), 50), { cmPerUnit: null });
  assert.ok(res.warnings.includes("no_scale"));
  assert.equal(res.walls.length, 7);
});

test("a page without paths reports no_vector", () => {
  const res = detectWalls({ width: 600, height: 400, paths: [] }, { cmPerUnit: cmPerUnit(50) });
  assert.deepEqual(res.walls, []);
  assert.ok(res.warnings.includes("no_vector"));
  assert.equal(res.confidence, 0);
});

test("more than 1000 walls are capped with a warning", () => {
  const paths = [];
  for (let r = 0; r < 27; r++) for (let c = 0; c < 40; c++) paths.push(poly(rectPts(c * 400, r * 100, 200, 20)));
  assert.equal(paths.length, 1080);
  const res = detectWalls(pageOf(paths, 50, 20000, 3000), { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 1000);
  assert.ok(res.warnings.includes("capped"));
});

test("non-finite and absurd input never produces invalid walls", () => {
  const bad = [poly([[NaN, 0], [10, 0], [10, 5], [0, 5]]), poly(rectPts(1e12, 0, 5e11, 20)), poly(rectPts(0, 0, 400, 20))];
  const res = detectWalls({ width: 600, height: 400, paths: bad.map((p) => toUnits(p, 50)) }, { cmPerUnit: cmPerUnit(50) });
  assert.equal(res.walls.length, 1);
});

// ---- rescale / output contract ----
test("rescale doubles lengths and thickness and re-classifies", () => {
  const res = detectWalls(pageOf(apartmentFilled(), 50), { cmPerUnit: cmPerUnit(50) });
  const doubled = rescale(res.walls, 2);
  assert.equal(doubled.length, res.walls.length);
  res.walls.forEach((w, i) => {
    assert.ok(Math.abs(wallLength(doubled[i]) - 2 * wallLength(w)) < 0.2);
    assert.equal(doubled[i].id, w.id);
  });
  const partition = res.walls.find((w) => w.kind === "partition");
  const grown = rescale([partition], 2)[0];
  assert.equal(grown.thickness, 20);
  assert.equal(grown.kind, "exterior");
});

test("output passes plan.js and the backend Geometry rules", () => {
  const res = detectWalls(pageOf(apartmentFilled(), 50), { cmPerUnit: cmPerUnit(50) });
  const plan = { ...P.emptyPlan(), walls: res.walls };
  assert.ok(P.isPlan(plan));
  const ids = new Set();
  for (const w of res.walls) {
    assert.match(w.id, /^[A-Za-z0-9_-]{1,40}$/);
    assert.ok(!ids.has(w.id));
    ids.add(w.id);
    assert.ok(w.thickness > 0 && w.thickness <= 100);
    assert.ok(wallLength(w) >= 1);
    assert.ok([w.x1, w.y1, w.x2, w.y2].every((v) => Number.isFinite(v) && Math.abs(v) <= 100000));
    assert.ok(["exterior", "partition"].includes(w.kind));
    assert.deepEqual(Object.keys(w).sort(), ["id", "kind", "thickness", "x1", "x2", "y1", "y2"]);
  }
  // normalize() runs inside patch; a no-op patch must leave the walls intact.
  const again = P.patch(plan, "walls", res.walls[0].id, {});
  assert.deepEqual(again.walls, res.walls);
});
