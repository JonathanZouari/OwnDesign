// Step 2b: plan-area guess, tables and title blocks, hatched pairs, stray lines, honest confidence,
// choices kept across recalibration and the scale suggestion. Everything here is synthetic.
import assert from "node:assert/strict";
import { test } from "node:test";

import { areaFromPage, areaToPage, carryOverDisabled, detectWalls, suggestScale, wallLength } from "../js/import/walls.js";

const PT_CM = 2.54 / 72;
const cmPerUnit = (n) => PT_CM * n;
const OX = 300;
const OY = 200;

const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const poly = (pts, extra = {}) => ({
  ops: [...pts.map(([x, y], i) => ({ op: i === 0 ? "M" : "L", pts: [x, y] })), { op: "Z", pts: [] }],
  fill: true,
  stroke: false,
  fillColor: [0, 0, 0],
  lineWidth: 0,
  ...extra,
});
const line = (x1, y1, x2, y2, lineWidth = 0.1) => ({ ops: [{ op: "M", pts: [x1, y1] }, { op: "L", pts: [x2, y2] }], fill: false, stroke: true, fillColor: null, lineWidth });
const strokedRect = (x, y, w, h) => poly(rectPts(x, y, w, h), { fill: false, stroke: true, fillColor: null, lineWidth: 0.1 });
const arc = (cx, cy, r) => ({
  ops: [{ op: "M", pts: [cx + r, cy] }, { op: "C", pts: [cx + r, cy + r, cx, cy + r, cx, cy + r] }, { op: "L", pts: [cx, cy] }, { op: "Z", pts: [] }],
  fill: false,
  stroke: true,
  fillColor: null,
  lineWidth: 0.1,
});

const toUnits = (path, n) => {
  const k = 1 / cmPerUnit(n);
  return { ...path, lineWidth: path.lineWidth * k, ops: path.ops.map((o) => ({ op: o.op, pts: o.pts.map((v) => v * k) })) };
};
const pageOf = (paths, n, wCm = 1500, hCm = 1000, texts = []) => ({
  width: wCm / cmPerUnit(n),
  height: hCm / cmPerUnit(n),
  paths: paths.map((p) => toUnits(p, n)),
  texts: texts.map((t) => ({ str: t.str, x: t.x / cmPerUnit(n), y: t.y / cmPerUnit(n) })),
});

// The two-room apartment as filled rectangles (page cm).
function apartment() {
  const r = (x, y, w, h) => poly(rectPts(x + OX, y + OY, w, h));
  return [r(-10, -10, 820, 20), r(-10, 490, 820, 20), r(-10, 10, 20, 480), r(790, 10, 20, 480), r(395, 10, 10, 480), r(405, 245, 385, 10), r(10, 295, 140, 10)];
}

// A table drawn as lines: `rows` equally spaced horizontal lines and a few columns.
function table(x, y, w, rowH, rows, cols = 4) {
  const out = [];
  for (let i = 0; i <= rows; i++) out.push(line(x, y + i * rowH, x + w, y + i * rowH));
  for (let c = 0; c <= cols; c++) out.push(line(x + (c * w) / cols, y, x + (c * w) / cols, y + rows * rowH));
  return out;
}

const texts = (x, y, w, h, n) => Array.from({ length: n }, (_, i) => ({ str: `t${i}`, x: x + ((i * 37) % w), y: y + ((i * 53) % h) }));
const lengthOf = (list) => list.reduce((s, w) => s + wallLength(w), 0);
const centre = (res, w) => [(w.x1 + w.x2) / 2 + res.originCm.x, (w.y1 + w.y2) / 2 + res.originCm.y];

test("a title block (box on the sheet edge with table rows and text) does not become walls and is outside the area", () => {
  const block = [strokedRect(1180, 20, 300, 960), ...table(1180, 40, 300, 20, 30, 2)];
  const res = detectWalls(pageOf([...apartment(), ...block], 20, 1500, 1000, texts(1190, 50, 280, 900, 120)), { cmPerUnit: cmPerUnit(20) });
  assert.equal(res.walls.length, 7);
  assert.equal(res.outside.length, 0);
  assert.ok(res.areaCm.x + res.areaCm.w <= 1180 - res.originCm.x + 5, JSON.stringify(res.areaCm));
});

test("a legend table along the bottom is not walls", () => {
  const legend = table(300, 800, 700, 18, 5, 5);
  const res = detectWalls(pageOf([...apartment(), ...legend], 20, 1500, 1000), { cmPerUnit: cmPerUnit(20) });
  assert.equal(res.walls.length, 7);
  assert.ok(res.walls.every((w) => centre(res, w)[1] < 720));
});

test("table rows crossed by columns are rejected even without equal spacing", () => {
  const rows = [0, 17, 41, 60, 85, 99, 130].map((dy) => line(300, 700 + dy, 900, 700 + dy));
  const cols = [0, 100, 200, 450, 600].map((dx) => line(300 + dx, 700, 300 + dx, 830));
  const res = detectWalls(pageOf([...apartment(), ...rows, ...cols], 20), { cmPerUnit: cmPerUnit(20) });
  assert.equal(res.walls.length + res.outside.length, 7);
});

test("the plan is the largest connected cluster: a distant small clutter of lines is outside the area", () => {
  const far = [poly(rectPts(1300, 700, 150, 10)), poly(rectPts(1300, 700, 10, 120)), poly(rectPts(1300, 810, 150, 10))];
  const res = detectWalls(pageOf([...apartment(), ...far], 20, 2400, 1500), { cmPerUnit: cmPerUnit(20) });
  assert.equal(res.walls.length, 7);
  assert.equal(res.outside.length, 3);
});

test("an area given by the user overrides the guess and moves the included walls", () => {
  const page = pageOf(apartment(), 20, 1500, 1000);
  const auto = detectWalls(page, { cmPerUnit: cmPerUnit(20) });
  assert.equal(auto.walls.length, 7);
  const k = cmPerUnit(20);
  const left = detectWalls(page, { cmPerUnit: k, area: { x0: (OX - 50) / k, y0: (OY - 50) / k, x1: (OX + 450) / k, y1: (OY + 600) / k } });
  assert.ok(left.walls.length < 7 && left.walls.length >= 3, `${left.walls.length}`);
  assert.equal(left.walls.length + left.outside.length, 7);
  const nothing = detectWalls(page, { cmPerUnit: k, area: { x0: 0, y0: 0, x1: 10, y1: 10 } });
  assert.equal(nothing.walls.length, 0);
  assert.ok(nothing.areaCm);
});

test("area converts to PDF units and back across a change of scale", () => {
  const page = pageOf(apartment(), 20);
  const res = detectWalls(page, { cmPerUnit: cmPerUnit(20) });
  const units = areaToPage(res.areaCm, res);
  const back = areaFromPage(units, res);
  assert.deepEqual(back, res.areaCm);
  const other = detectWalls(page, { cmPerUnit: cmPerUnit(50) });
  const there = areaFromPage(units, other);
  assert.ok(Math.abs(there.w - (res.areaCm.w * 50) / 20) <= 2);
});

// ---- hatching, thickness, stray lines
test("a hatched pair of thin lines is a strong wall even when short and isolated; the same pair without hatching is not", () => {
  const pair = (hatched) => {
    const out = [line(100, 100, 190, 100), line(100, 120, 190, 120)];
    if (hatched) for (let i = 0; i < 6; i++) out.push(line(105 + i * 14, 100, 119 + i * 14, 120));
    return out;
  };
  const withHatch = detectWalls(pageOf(pair(true), 20), { cmPerUnit: cmPerUnit(20) });
  assert.equal(withHatch.walls.length, 1);
  assert.equal(withHatch.walls[0].thickness, 20);
  assert.equal(detectWalls(pageOf(pair(false), 20), { cmPerUnit: cmPerUnit(20) }).walls.length, 0);
});

test("two lines further apart than 60 cm are not a wall, hatched or not", () => {
  const out = [line(100, 100, 500, 100), line(100, 180, 500, 180)];
  for (let i = 0; i < 12; i++) out.push(line(110 + i * 30, 100, 130 + i * 30, 180));
  assert.equal(detectWalls(pageOf(out, 20), { cmPerUnit: cmPerUnit(20) }).walls.length, 0);
});

test("a long thin line pair crossing the whole plan is dropped, the plan stays", () => {
  const stray = [line(OX - 200, OY + 160, OX + 1000, OY + 160), line(OX - 200, OY + 185, OX + 1000, OY + 185)];
  const res = detectWalls(pageOf([...apartment(), ...stray], 20, 1800, 1000), { cmPerUnit: cmPerUnit(20) });
  assert.equal(res.walls.length, 7);
  assert.ok(Math.max(...res.walls.map(wallLength)) <= 830);
});

test("a stray line that is longer than its whole cluster is dropped", () => {
  // joined to the plan by a T junction and sticking out far beyond it
  const stray = [poly(rectPts(OX + 810, OY + 90, 1500, 20))];
  const res = detectWalls(pageOf([...apartment(), ...stray], 20, 3000, 1000), { cmPerUnit: cmPerUnit(20) });
  assert.equal(res.walls.length + res.outside.length, 7);
});

// ---- confidence
test("a clean, closed apartment scores high; scattered noise scores low", () => {
  const good = detectWalls(pageOf(apartment(), 20), { cmPerUnit: cmPerUnit(20) });
  assert.ok(good.confidence >= 0.75, `${good.confidence}`);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = [];
  for (let i = 0; i < 70; i++) {
    const horizontal = rnd() < 0.5;
    const len = 100 + rnd() * 300;
    noise.push(poly(horizontal ? rectPts(rnd() * 2500, rnd() * 1700, len, 12) : rectPts(rnd() * 2500, rnd() * 1700, 12, len)));
  }
  const bad = detectWalls(pageOf(noise, 20, 3000, 2000), { cmPerUnit: cmPerUnit(20) });
  assert.ok(bad.confidence < 0.4, `${bad.confidence}`);
});

test("an open plan with doors still counts as closed, but a plan with half its walls missing scores lower", () => {
  const r = (x, y, w, h) => poly(rectPts(x + OX, y + OY, w, h));
  const withDoors = [r(-10, -10, 820, 20), r(-10, 490, 820, 20), r(-10, 10, 20, 180), r(-10, 280, 20, 210), r(790, 10, 20, 480), r(395, 10, 10, 190), r(395, 290, 10, 200)];
  const full = detectWalls(pageOf(withDoors, 20), { cmPerUnit: cmPerUnit(20) });
  assert.ok(full.confidence >= 0.6, `${full.confidence}`);
  const half = detectWalls(pageOf([r(-10, -10, 820, 20), r(-10, 10, 20, 480)], 20), { cmPerUnit: cmPerUnit(20) });
  assert.ok(half.confidence < full.confidence, `${half.confidence} vs ${full.confidence}`);
});

test("junk outside the chosen area lowers the confidence", () => {
  const k = cmPerUnit(20);
  const page = pageOf(apartment(), 20);
  const all = detectWalls(page, { cmPerUnit: k });
  const part = detectWalls(page, { cmPerUnit: k, area: { x0: (OX - 50) / k, y0: (OY - 50) / k, x1: (OX + 450) / k, y1: (OY + 600) / k } });
  assert.ok(part.confidenceParts.inside < all.confidenceParts.inside);
});

// ---- calibration keeps choices
test("walls switched off stay off after re-detection at another scale", () => {
  const page = pageOf(apartment(), 50);
  const prev = detectWalls(page, { cmPerUnit: cmPerUnit(50) });
  const off = new Set([prev.walls[1].id, prev.walls[4].id]);
  const next = detectWalls(page, { cmPerUnit: cmPerUnit(50) * 1.7 });
  const kept = carryOverDisabled(prev, off, next);
  assert.equal(kept.size, 2);
  const ids = [...kept].map((id) => next.walls.findIndex((w) => w.id === id));
  assert.deepEqual(ids.sort(), [1, 4]);
  assert.equal(carryOverDisabled(prev, new Set(), next).size, 0);
});

// ---- scale suggestion
const doorsAt = (n) => [arc(OX + 150, OY + 300, 90), arc(OX + 405, OY + 100, 80)];
for (const n of [20, 50, 100]) {
  test(`scale suggestion picks 1:${n} for an apartment drawn at 1:${n} without any scale text`, () => {
    const big = n === 100 ? [1500, 1000] : [1500, 1000];
    const res = suggestScale(pageOf([...apartment(), ...doorsAt(n)], n, ...big), [20, 50, 100]);
    assert.equal(res.ratio, n, JSON.stringify(res.scores));
  });
}

test("scale suggestion gives nothing for a page without plausible walls", () => {
  assert.equal(suggestScale({ width: 600, height: 400, paths: [], texts: [] }).ratio, null);
  assert.equal(lengthOf([]), 0);
});
