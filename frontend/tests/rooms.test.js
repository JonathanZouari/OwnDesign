import assert from "node:assert/strict";
import { test } from "node:test";

import { carryOverRoomChoices, detectRooms, toPlanRooms } from "../js/import/rooms.js";

// Walls as centre lines in cm: a rectangle outline plus extra partitions.
const W = (x1, y1, x2, y2, thickness = 10) => ({ x1, y1, x2, y2, thickness });
const box = (x, y, w, h, t = 20) => [W(x, y, x + w, y, t), W(x + w, y, x + w, y + h, t), W(x + w, y + h, x, y + h, t), W(x, y + h, x, y, t)];
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= expected * tol, `${msg ?? ""} ${actual} vs ${expected}`);
// Net interior of a room whose wall centre lines are w x h with thickness t.
const net = (w, h, t) => ((w - t) * (h - t)) / 10_000;

// Two rooms 400 x 500 side by side sharing a partition with a 90 cm doorway.
const twoRooms = () => [...box(0, 0, 800, 500), W(400, 0, 400, 150), W(400, 240, 400, 500)];

test("two rooms joined by a 90 cm doorway give two rooms", () => {
  const rooms = detectRooms({ walls: twoRooms() });
  assert.equal(rooms.length, 2);
  for (const r of rooms) near(r.area, net(400, 500, 15), 0.06);
});

test("without a doorway the two rooms stay separate too", () => {
  assert.equal(detectRooms({ walls: [...box(0, 0, 800, 500), W(400, 0, 400, 500)] }).length, 2);
});

test("L-shaped room is one room with the right area", () => {
  // L: 600 x 400 minus a 300 x 200 notch, wall thickness 20 -> inner face is 10 cm in from the centre line.
  const pts = [[0, 0], [600, 0], [600, 200], [300, 200], [300, 400], [0, 400]];
  const walls = pts.map(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    return W(x, y, x2, y2, 20);
  });
  const rooms = detectRooms({ walls });
  assert.equal(rooms.length, 1);
  // Inner faces are 10 cm in from the centre lines: 180000 - 2000 * 10 + (5 convex - 1 reflex) * 10 * 10.
  near(rooms[0].area, 160_400 / 10_000, 0.02);
  assert.ok(rooms[0].outline.length >= 6 && rooms[0].outline.length <= 12);
});

test("a 0.6 m2 shaft is dropped", () => {
  const walls = [...box(0, 0, 800, 500), ...box(100, 100, 100, 100, 20)]; // inside the small box: 80 x 80 = 0.64 m2
  const rooms = detectRooms({ walls });
  assert.equal(rooms.length, 1);
  assert.ok(rooms[0].area > 30);
});

test("an open living room and kitchen (wide gap in the partition) are one room", () => {
  const walls = [...box(0, 0, 800, 500), W(400, 0, 400, 100), W(400, 400, 400, 500)]; // 300 cm opening
  assert.equal(detectRooms({ walls }).length, 1);
});

test("a corridor is named as a corridor", () => {
  const walls = [...box(0, 0, 900, 500), W(0, 120, 900, 120, 10)]; // 100 cm wide strip along the top (inner faces 10 and 115)
  const rooms = detectRooms({ walls });
  assert.equal(rooms.length, 2);
  const corridor = rooms.find((r) => r.type === "hallway");
  assert.ok(corridor, JSON.stringify(rooms.map((r) => [r.name, r.type, r.area])));
  assert.equal(corridor.source, "shape");
});

test("rooms are named from Hebrew text inside them", () => {
  const texts = [{ str: "סלון", x: 200, y: 250 }, { str: 'ממ"ד', x: 600, y: 250 }];
  const rooms = detectRooms({ walls: twoRooms(), texts });
  assert.deepEqual(rooms.map((r) => [r.name, r.type, r.source]), [["סלון", "living", "text"], ["ממ״ד", "other", "text"]]);
});

test("reversed text and words split over two text items are matched", () => {
  const texts = [{ str: "הניש", x: 100, y: 100 }, { str: "רדח", x: 150, y: 100 }, { str: "חבטמ", x: 600, y: 200 }];
  const rooms = detectRooms({ walls: twoRooms(), texts });
  assert.deepEqual(rooms.map((r) => [r.name, r.type]), [["חדר שינה", "bedroom"], ["מטבח", "kitchen"]]);
});

test("text outside every room is ignored", () => {
  const rooms = detectRooms({ walls: twoRooms(), texts: [{ str: "סלון", x: -500, y: -500 }] });
  assert.deepEqual(rooms.map((r) => r.source), ["default", "default"]);
});

test("rooms are named from the furniture inside them", () => {
  const furniture = [{ type: "double-bed", x: 200, y: 250 }, { type: "toilet", x: 600, y: 250 }];
  const rooms = detectRooms({ walls: twoRooms(), furniture });
  assert.deepEqual(rooms.map((r) => r.type), ["bedroom", "bathroom"]);
  assert.ok(rooms.every((r) => r.source === "furniture"));
});

test("unnamed rooms are numbered", () => {
  const rooms = detectRooms({ walls: twoRooms() });
  assert.deepEqual(rooms.map((r) => r.name), ["חדר 1", "חדר 2"]);
});

test("the same plan shifted, rotated by 90 degrees or very large gives the same rooms", () => {
  const closed = () => [...box(0, 0, 800, 500), W(400, 0, 400, 500)];
  const base = detectRooms({ walls: closed() });
  const shifted = detectRooms({ walls: closed().map((w) => W(w.x1 + 12345, w.y1 - 777, w.x2 + 12345, w.y2 - 777, w.thickness)) });
  const rotated = detectRooms({ walls: closed().map((w) => W(-w.y1, w.x1, -w.y2, w.x2, w.thickness)) });
  for (const other of [shifted, rotated]) {
    assert.equal(other.length, base.length);
    near(other.reduce((s, r) => s + r.area, 0), base.reduce((s, r) => s + r.area, 0), 0.03);
  }
  const k = 8; // 32 x 40 m: forces a coarser grid
  const big = detectRooms({ walls: closed().map((w) => W(w.x1 * k, w.y1 * k, w.x2 * k, w.y2 * k, w.thickness)) });
  assert.equal(big.length, 2);
  near(big[0].area, net(400 * k, 500 * k, 15), 0.03);
});

test("degenerate input gives no rooms", () => {
  assert.deepEqual(detectRooms({}), []);
  assert.deepEqual(detectRooms({ walls: [W(0, 0, 100, 0)] }), []);
  assert.deepEqual(detectRooms({ walls: [W(0, 0, NaN, 0), W(0, 0, 0, 10), W(5, 5, 6, 6)] }), []);
});

test("outlines stay within 200 points and inside the coordinate limit", () => {
  const rooms = detectRooms({ walls: twoRooms() });
  for (const r of rooms) assert.ok(r.outline.length >= 3 && r.outline.length <= 200 && r.outline.flat().every(Number.isFinite));
});

test("choices carry over to the matching room after a rescale; toPlanRooms keeps only chosen rooms", () => {
  const prevCtx = { cmPerUnit: 1.76, originCm: { x: 0, y: 0 } };
  const nextCtx = { cmPerUnit: 3.52, originCm: { x: 0, y: 0 } };
  const closed = [...box(0, 0, 800, 500), W(400, 0, 400, 500)];
  const prev = detectRooms({ walls: closed });
  const scaled = detectRooms({ walls: closed.map((w) => W(w.x1 * 2, w.y1 * 2, w.x2 * 2, w.y2 * 2, w.thickness)) });
  const choices = new Map([[prev[0].id, { on: false, name: "X" }]]);
  const carried = carryOverRoomChoices(prev, prevCtx, choices, scaled, nextCtx);
  assert.equal(carried.size, 1);
  assert.equal(carried.get(scaled[0].id).name, "X");
  const plan = toPlanRooms(prev, (r) => (r === prev[1] ? { name: " Kid ", type: "bedroom" } : null));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].name, "Kid");
  assert.ok(plan[0].id.startsWith("r_") && plan[0].outline.length >= 4);
});
