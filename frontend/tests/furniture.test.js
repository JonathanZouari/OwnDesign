import assert from "node:assert/strict";
import { test } from "node:test";

import * as P from "../js/plan.js";
import { FURNITURE, FURNITURE_BY_TYPE } from "../js/catalog.js";
import { carryOverChoices, detectFurniture, fitToType, toPlanFurniture } from "../js/import/furniture.js";

// All geometry is authored in plan/page cm and converted to PDF units for a 1:50 sheet.
const PT_CM = 2.54 / 72;
const K = PT_CM * 50;
const U = 1 / K;
const SHEET = 2000; // cm

const rad = (deg) => (deg * Math.PI) / 180;
const rotate = (pts, cx, cy, deg) => pts.map(([x, y]) => [cx + (x - cx) * Math.cos(rad(deg)) - (y - cy) * Math.sin(rad(deg)), cy + (x - cx) * Math.sin(rad(deg)) + (y - cy) * Math.cos(rad(deg))]);
const rectPts = (cx, cy, w, d) => [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]];

const stroke = (extra = {}) => ({ fill: false, stroke: true, fillColor: null, lineWidth: 0.1, ...extra });
const polygon = (pts, extra = {}) => ({ ops: [...pts.map(([x, y], i) => ({ op: i === 0 ? "M" : "L", pts: [x, y] })), { op: "Z", pts: [] }], ...stroke(extra) });
const line = (x1, y1, x2, y2) => ({ ops: [{ op: "M", pts: [x1, y1] }, { op: "L", pts: [x2, y2] }], ...stroke() });
// An ellipse as four cubic curves (closed).
function ellipse(cx, cy, rx, ry, extra = {}) {
  const c = 0.5523;
  const ops = [
    { op: "M", pts: [cx + rx, cy] },
    { op: "C", pts: [cx + rx, cy + c * ry, cx + c * rx, cy + ry, cx, cy + ry] },
    { op: "C", pts: [cx - c * rx, cy + ry, cx - rx, cy + c * ry, cx - rx, cy] },
    { op: "C", pts: [cx - rx, cy - c * ry, cx - c * rx, cy - ry, cx, cy - ry] },
    { op: "C", pts: [cx + c * rx, cy - ry, cx + rx, cy - c * ry, cx + rx, cy] },
    { op: "Z", pts: [] },
  ];
  return { ops, ...stroke(extra) };
}
// A quarter circle drawn as one open cubic (a door swing).
const quarterArc = (cx, cy, r) => ({
  ops: [{ op: "M", pts: [cx + r, cy] }, { op: "C", pts: [cx + r, cy + 0.5523 * r, cx + 0.5523 * r, cy + r, cx, cy + r] }],
  ...stroke(),
});

const toUnits = (path) => ({ ...path, lineWidth: path.lineWidth * U, ops: path.ops.map((o) => ({ op: o.op, pts: o.pts.map((v) => v * U) })) });
const pageOf = (paths, texts = []) => ({
  width: SHEET * U,
  height: SHEET * U,
  paths: paths.map(toUnits),
  texts: texts.map((t) => ({ str: t.str, x: t.x * U, y: t.y * U })),
  hasVector: true,
});
const AREA = { x0: 0, y0: 0, x1: 1500 * U, y1: 1500 * U };
const wallsResult = (list = []) => ({
  walls: list.map((w, i) => ({ id: w.id ?? `w${i}`, x1: w[0], y1: w[1], x2: w[2], y2: w[3], thickness: w[4], kind: "partition" })),
  outside: [],
  originCm: { x: 0, y: 0 },
  areaCm: { x: 0, y: 0, w: 1500, h: 1500 },
  cmPerUnit: K,
});
const run = (paths, { texts, walls } = {}) => detectFurniture(pageOf(paths, texts), { cmPerUnit: K, areaPage: AREA, walls: walls ?? wallsResult() });

// ---- one drawing per catalog type: paths for an item centred on (cx, cy), w along x, d along y (rotation 0)
const CX = 600;
const CY = 600;
const drawings = {
  toilet: (cx, cy, w, d) => [ellipse(cx, cy, w / 2, d / 2)],
  bathtub: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), ellipse(cx, cy, w / 2 - 12, d / 2 - 10)],
  shower: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), line(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)],
  stove: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), ...[[-14, -14], [14, -14], [-14, 14], [14, 14]].map(([dx, dy]) => ellipse(cx + dx, cy + dy, 7, 7))],
  armchair: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), polygon(rectPts(cx, cy, w - 25, d - 25))],
  sofa: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), polygon(rectPts(cx - w / 4, cy + 8, w / 2 - 20, d - 30)), polygon(rectPts(cx + w / 4, cy + 8, w / 2 - 20, d - 30))],
  "double-bed": (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), polygon(rectPts(cx - w / 4, cy - d / 2 + 30, 50, 35)), polygon(rectPts(cx + w / 4, cy - d / 2 + 30, 50, 35))],
  "single-bed": (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), polygon(rectPts(cx, cy - d / 2 + 30, 50, 35))],
  sink: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), ellipse(cx, cy, w / 2 - 15, d / 2 - 12)],
  vanity: (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d)), ellipse(cx, cy, w / 2 - 15, d / 2 - 10)],
};
const plain = (cx, cy, w, d) => [polygon(rectPts(cx, cy, w, d))];
for (const t of ["chair", "coffee-table", "tv-unit", "dining-table", "wardrobe", "desk", "kitchen-counter", "kitchen-island", "fridge"]) drawings[t] = plain;

// Context each type needs to be told apart from its look-alikes: a wall next to it and/or a room label.
const context = (type, cx, cy, w, d) => {
  const wallUnder = (x, y, len, side) => (side === "top" ? [x - len / 2, y - d / 2 - 5, x + len / 2, y - d / 2 - 5, 10] : [x - len / 2, y + d / 2 + 5, x + len / 2, y + d / 2 + 5, 10]);
  const label = (str) => [{ str, x: cx, y: cy + 150 }];
  switch (type) {
    case "tv-unit":
      return { walls: wallsResult([wallUnder(cx, cy, w + 100, "top")]) };
    case "wardrobe":
      return { walls: wallsResult([wallUnder(cx, cy, w + 100, "top")]), texts: label("חדר שינה") };
    case "desk":
      return { walls: wallsResult([wallUnder(cx, cy, w + 100, "top")]), texts: label("פינת עבודה") };
    case "kitchen-counter":
      return { walls: wallsResult([wallUnder(cx, cy, w + 100, "top")]), texts: label("מטבח") };
    case "kitchen-island":
      return { texts: label("מטבח") };
    case "fridge":
      return { texts: label("מטבח") };
    case "stove":
      return { texts: label("מטבח") };
    case "sink":
      return { texts: label("מטבח") };
    case "vanity":
      return { texts: label("שירותים") };
    case "shower":
    case "bathtub":
    case "toilet":
      return { texts: label("אמבטיה") };
    default:
      return {};
  }
};

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

// Neighbours that tell a type from its look-alikes, authored at rotation 0 and turned with the item.
const neighbours = {
  "coffee-table": { paths: (cx, cy) => drawings.sofa(cx, cy + 105, 200, 90), allow: ["sofa"] },
  "dining-table": {
    paths: (cx, cy, w, d) => [-45, 45].flatMap((dx) => [plain(cx + dx, cy - d / 2 - 32, 45, 45)[0], plain(cx + dx, cy + d / 2 + 32, 45, 45)[0]]),
    allow: ["chair"],
  },
};

for (const spec of FURNITURE) {
  for (const turn of [0, 90]) {
    test(`${spec.type} drawn at ${turn} degrees is identified with its measured size`, () => {
      const { w, d } = spec;
      const extra = neighbours[spec.type];
      const flat = [...drawings[spec.type](CX, CY, w, d), ...(extra ? extra.paths(CX, CY, w, d) : [])];
      const paths = flat.map((p) => ({ ...p, ops: p.ops.map((o) => ({ op: o.op, pts: turn ? rotate90(o.pts, CX, CY) : o.pts })) }));
      const r = run(paths, context(spec.type, CX, CY, turn ? d : w, turn ? w : d));
      const why = JSON.stringify(r.items.map((i) => [i.type, i.w, i.d]));
      const found = r.items.filter((i) => i.type === spec.type);
      assert.equal(found.length, 1, why);
      const item = found[0];
      assert.ok(near(item.x, CX) && near(item.y, CY), `centre ${item.x},${item.y}`);
      assert.ok(near(item.w, w) && near(item.d, d), `size ${item.w}x${item.d} expected ${w}x${d}`);
      if (Math.abs(w - d) > 4) assert.equal(item.rotation % 180, turn, `rotation ${item.rotation}`);
      const others = r.items.filter((i) => i !== item && i.type && !(extra?.allow ?? []).includes(i.type));
      assert.equal(others.length, 0, `extra typed items: ${JSON.stringify(others)}`);
    });
  }
}

function rotate90(pts, cx, cy) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push(cx - (pts[i + 1] - cy), cy + (pts[i] - cx));
  return out;
}

test("a sofa at 30 degrees keeps its angle and size", () => {
  const sofa = drawings.sofa(CX, CY, 200, 90);
  const turned = sofa.map((p) => {
    const pts = p.ops.filter((o) => o.op !== "Z").map((o) => o.pts);
    const r = rotate(pts, CX, CY, 30);
    return polygon(r);
  });
  const r = run(turned);
  const sofaItem = r.items.find((i) => i.type === "sofa");
  assert.ok(sofaItem, JSON.stringify(r.items));
  assert.ok(near(sofaItem.w, 200, 3) && near(sofaItem.d, 90, 3), `${sofaItem.w}x${sofaItem.d}`);
  assert.ok(near(sofaItem.rotation, 30, 2), `rotation ${sofaItem.rotation}`);
});

test("nested shapes merge: a bed with pillows is one item", () => {
  const r = run(drawings["double-bed"](CX, CY, 160, 200));
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].type, "double-bed");
});

test("a table with four chairs gives one table and four chairs", () => {
  const paths = [
    ...plain(CX, CY, 160, 90),
    ...[-45, 45].flatMap((dx) => [plain(CX + dx, CY - 45 - 32, 45, 45)[0], plain(CX + dx, CY + 45 + 32, 45, 45)[0]]),
  ];
  const r = run(paths);
  const count = (t) => r.items.filter((i) => i.type === t).length;
  assert.equal(count("dining-table"), 1, JSON.stringify(r.items.map((i) => [i.type, i.w, i.d])));
  assert.equal(count("chair"), 4);
  assert.equal(r.items.length, 5);
});

test("a round table with chairs around it is a dining table", () => {
  const paths = [ellipse(CX, CY, 55, 55), ...[[0, -80], [0, 80], [-80, 0], [80, 0]].map(([dx, dy]) => polygon(rectPts(CX + dx, CY + dy, 45, 45)))];
  const r = run(paths);
  assert.equal(r.items.filter((i) => i.type === "dining-table").length, 1, JSON.stringify(r.items.map((i) => [i.type, i.w, i.d])));
  assert.equal(r.items.filter((i) => i.type === "chair").length, 4);
});

// ---- things that must not be taken for furniture

test("a hatched wall, a room outline made of wall faces and a window are not furniture", () => {
  const walls = wallsResult([[100, 100, 400, 100, 20], [100, 300, 400, 300, 20], [100, 100, 100, 300, 20], [400, 100, 400, 300, 20]]);
  const paths = [
    line(90, 90, 410, 90), line(90, 110, 410, 110), // top wall faces
    line(90, 290, 410, 290), line(90, 310, 410, 310),
    line(90, 90, 90, 310), line(110, 90, 110, 310),
    line(390, 90, 390, 310), line(410, 90, 410, 310),
    ...Array.from({ length: 20 }, (_, i) => line(100 + i * 15, 92, 112 + i * 15, 108)), // hatching inside the top wall
    polygon(rectPts(250, 100, 100, 12)), // window frame inside the wall
  ];
  const r = run(paths, { walls });
  assert.deepEqual(r.items, []);
});

test("a door swing (arc and leaf) is not furniture", () => {
  const r = run([quarterArc(500, 500, 90), line(500, 500, 500, 590), line(500, 500, 590, 500)]);
  assert.deepEqual(r.items, []);
});

test("a dimension line with ticks and arrow heads is not furniture", () => {
  const arrow = (x, dir) => polygon([[x, 400], [x + dir * 8, 396], [x + dir * 8, 404]], { fill: true, fillColor: [0, 0, 0] });
  const r = run([line(300, 400, 900, 400), line(300, 390, 300, 410), line(900, 390, 900, 410), arrow(300, 1), arrow(900, -1)]);
  assert.deepEqual(r.items, []);
});

test("hatching alone is not furniture", () => {
  const r = run(Array.from({ length: 30 }, (_, i) => line(400 + i * 8, 400, 440 + i * 8, 440)));
  assert.deepEqual(r.items, []);
});

test("light fixture symbols (circle with a cross, hatched disc) are not furniture", () => {
  const small = [ellipse(500, 500, 12, 12), line(488, 500, 512, 500), line(500, 488, 500, 512)];
  const disc = [ellipse(800, 500, 24, 24), ...Array.from({ length: 12 }, (_, i) => line(778, 478 + i * 4, 822, 480 + i * 4))];
  const crossDisc = [ellipse(1100, 500, 22, 22), line(1078, 500, 1122, 500), line(1100, 478, 1100, 522)];
  const r = run([...small, ...disc, ...crossDisc]);
  assert.deepEqual(r.items, []);
});

test("text drawn as outlines is not furniture", () => {
  const glyph = (x) => polygon([[x, 500], [x + 6, 500], [x + 6, 510], [x, 510]]);
  const r = run(Array.from({ length: 12 }, (_, i) => glyph(500 + i * 9)));
  assert.deepEqual(r.items, []);
});

test("items outside the plan area are left out", () => {
  const r = run([...plain(CX, CY, 160, 90), ...plain(1700, 600, 160, 90)]);
  assert.equal(r.items.length, 1);
});

test("an odd shape that looks like furniture is reported without a type", () => {
  const r = run([polygon([[500, 500], [650, 500], [500, 620]])]);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].type, null);
  assert.ok(near(r.items[0].w, 150, 3) && near(r.items[0].d, 120, 3) || near(r.items[0].w, 120, 3));
});

test("a wall that is really a counter is explained by the counter and reported for removal", () => {
  const walls = wallsResult([[480, 600, 720, 600, 60]]);
  walls.walls[0].id = "w_counter";
  const r = run([line(5, 5, 9, 9)], { walls, texts: [{ str: "מטבח", x: 600, y: 700 }] });
  const counter = r.items.find((i) => i.type === "kitchen-counter");
  assert.ok(counter, JSON.stringify(r.items));
  assert.ok(near(counter.w, 240) && near(counter.d, 60));
  assert.deepEqual(r.wallsExplained, ["w_counter"]);
});

test("a thick wall that coincides with a drawn sofa is reported for removal", () => {
  const walls = wallsResult([[500, 600, 700, 600, 60]]);
  walls.walls[0].id = "w_sofa";
  const r = run(drawings.sofa(600, 600, 200, 90), { walls });
  assert.equal(r.items.filter((i) => i.type === "sofa").length, 1, JSON.stringify(r.items.map((i) => [i.type, i.w, i.d])));
  assert.ok(r.wallsExplained.includes("w_sofa"));
});

test("a real wall next to a counter is not removed", () => {
  const walls = wallsResult([[400, 555, 800, 555, 10]]);
  const r = run(plain(600, 600, 240, 60), { walls, texts: [{ str: "מטבח", x: 600, y: 700 }] });
  assert.equal(r.items.filter((i) => i.type === "kitchen-counter").length, 1);
  assert.deepEqual(r.wallsExplained, []);
});

test("coordinates follow the walls' origin", () => {
  const walls = wallsResult();
  walls.originCm = { x: 100, y: 50 };
  walls.areaCm = { x: -100, y: -50, w: 1500, h: 1500 };
  const r = detectFurniture(pageOf(plain(CX, CY, 160, 90)), { cmPerUnit: K, walls });
  assert.ok(near(r.items[0].x, CX - 100) && near(r.items[0].y, CY - 50), `${r.items[0].x},${r.items[0].y}`);
});

test("no scale, no vector paths and no area give an empty result, never an error", () => {
  assert.deepEqual(detectFurniture(pageOf(plain(CX, CY, 160, 90)), { cmPerUnit: undefined }).items, []);
  assert.deepEqual(detectFurniture({ width: 10, height: 10, paths: [] }, { cmPerUnit: K, walls: wallsResult() }).items, []);
  assert.deepEqual(detectFurniture(pageOf(plain(CX, CY, 160, 90)), { cmPerUnit: K }).items, []);
  assert.deepEqual(detectFurniture(null, { cmPerUnit: K }).items, []);
});

test("non-finite coordinates in a path do not break detection", () => {
  const bad = { ...polygon(rectPts(CX, CY, 100, 100)), ops: [{ op: "M", pts: [NaN, 1] }, { op: "L", pts: [Infinity, 2] }, { op: "Z", pts: [] }] };
  const r = run([bad, ...plain(900, 900, 160, 90)]);
  assert.ok(r.items.length >= 0);
});

// ---- after a new detection and into the plan

test("choices carry over to the item at the same spot after a rescale", () => {
  const first = detectFurniture(pageOf(plain(CX, CY, 160, 90)), { cmPerUnit: K, areaPage: AREA, walls: wallsResult() });
  const second = detectFurniture(pageOf(plain(CX, CY, 160, 90)), { cmPerUnit: K * 1.5, areaPage: { x0: 0, y0: 0, x1: AREA.x1, y1: AREA.y1 }, walls: { ...wallsResult(), cmPerUnit: K * 1.5 } });
  const choices = new Map([[first.items[0].id, { on: false, type: "desk" }]]);
  const out = carryOverChoices(first.items, { originCm: { x: 0, y: 0 }, cmPerUnit: K }, choices, second.items, { originCm: { x: 0, y: 0 }, cmPerUnit: K * 1.5 });
  assert.deepEqual([...out.values()], [{ on: false, type: "desk" }]);
  assert.deepEqual([...out.keys()], [second.items[0].id]);
  // an item that moved away takes no choice
  const far = carryOverChoices(first.items, { originCm: { x: 0, y: 0 }, cmPerUnit: K }, choices, second.items, { originCm: { x: 500, y: 0 }, cmPerUnit: K * 1.5 });
  assert.equal(far.size, 0);
});

test("fitToType swaps the sides to the catalog orientation", () => {
  assert.deepEqual(fitToType({ w: 200, d: 160, rotation: 0 }, "double-bed"), { w: 160, d: 200, rotation: 90 });
  assert.deepEqual(fitToType({ w: 160, d: 200, rotation: 0 }, "double-bed"), { w: 160, d: 200, rotation: 0 });
  assert.deepEqual(fitToType({ w: 10, d: 20, rotation: 5 }, "nope"), { w: 10, d: 20, rotation: 5 });
});

test("the plan furniture keeps measured sizes and passes the backend rules", () => {
  const r = run([...drawings["double-bed"](CX, CY, 200, 160).map((p) => p), ...plain(1000, 1000, 77, 52)]);
  const items = r.items;
  const chosen = (f) => f.type ?? "desk"; // the user picks a type for the unidentified one
  const furniture = toPlanFurniture(items, chosen);
  assert.equal(furniture.length, items.length);
  let plan = { ...P.emptyPlan(), furniture };
  assert.ok(P.isPlan(plan));
  for (const f of furniture) {
    assert.match(f.id, /^[A-Za-z0-9_-]{1,40}$/);
    assert.match(f.type, /^[a-z0-9_-]{1,40}$/);
    assert.ok(f.w > 0 && f.d > 0 && f.w <= 100_000 && f.d <= 100_000);
    assert.ok(f.rotation >= -360 && f.rotation <= 360);
    assert.ok(Math.abs(f.x) <= 100_000 && Math.abs(f.y) <= 100_000);
    assert.deepEqual(Object.keys(f).sort(), ["d", "id", "rotation", "type", "w", "x", "y"]);
    plan = P.patch(plan, "furniture", f.id, { x: f.x + 10 });
  }
  assert.equal(new Set(furniture.map((f) => f.id)).size, furniture.length);
  const bed = furniture.find((f) => f.type === "double-bed");
  assert.ok(near(bed.w, 160) && near(bed.d, 200) && bed.rotation === 90, JSON.stringify(bed));
  assert.equal(toPlanFurniture(items, () => null).length, 0);
  assert.equal(toPlanFurniture(items, () => "no-such-type").length, 0);
  assert.ok(FURNITURE_BY_TYPE.has("desk"));
});
