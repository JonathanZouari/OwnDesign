import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPath, footPoint, personScore, polylinePoints, thin } from "../js/walk-logic.js";

const person = (x, y, score = 0.9) => ({ class: "person", score, bbox: [x - 10, y - 100, 20, 100] }); // feet at (x, y)

test("foot point is the bottom middle of the box, clamped to the frame", () => {
  assert.deepEqual(footPoint([90, 0, 20, 50], 200, 100), [0.5, 0.5]);
  assert.deepEqual(footPoint([190, 50, 40, 80], 200, 100), [1, 1]);
});

test("follows one person across frames, in order", () => {
  const frames = [[person(20, 90)], [], [person(60, 80)], [person(100, 70)]];
  assert.deepEqual(buildPath(frames, 200, 100), [[0.1, 0.9], [0.3, 0.8], [0.5, 0.7]]);
});

test("no frames or nobody seen gives an empty path", () => {
  assert.deepEqual(buildPath([], 200, 100), []);
  assert.deepEqual(buildPath([[], [{ class: "chair", score: 0.99, bbox: [0, 0, 10, 10] }]], 200, 100), []);
});

test("weak detections are ignored", () => {
  assert.deepEqual(buildPath([[person(20, 90, 0.3)], [person(40, 90, 0.49)]], 200, 100), []);
});

test("starts from the most confident person, then stays with the nearest one", () => {
  const frames = [
    [person(20, 90, 0.6), person(180, 90, 0.95)],
    [person(30, 90), person(170, 90)],
  ];
  assert.deepEqual(buildPath(frames, 200, 100), [[0.9, 0.9], [0.85, 0.9]]);
});

test("a sudden jump across the room is dropped", () => {
  const frames = [[person(20, 90)], [person(190, 10)], [person(30, 90)]];
  assert.deepEqual(buildPath(frames, 200, 100), [[0.1, 0.9], [0.15, 0.9]]);
});

test("standing still adds one point, not many", () => {
  const frames = Array.from({ length: 20 }, () => [person(100, 50)]);
  assert.equal(buildPath(frames, 200, 100).length, 1);
});

test("long walks are thinned to the API limit, keeping both ends", () => {
  // Zig-zag so every sample is a real step and none is merged away.
  const frames = Array.from({ length: 1500 }, (_, i) => [person(i * 0.1 + 10, i % 2 ? 60 : 40)]);
  const path = buildPath(frames, 200, 100);
  assert.equal(path.length, 600);
  assert.deepEqual(path[0], [0.05, 0.4]);
  assert.deepEqual(path.at(-1), [0.7995, 0.6]);
  assert.deepEqual(thin([[0, 0], [1, 1]], 600), [[0, 0], [1, 1]]);
});

test("background frame score and polyline text", () => {
  assert.equal(personScore([]), 0);
  assert.equal(personScore([person(1, 1, 0.7), { class: "dog", score: 0.99, bbox: [0, 0, 1, 1] }]), 0.7);
  assert.equal(polylinePoints([[0.5, 0.25], [1, 1]], 640, 360), "320,90 640,360");
});

// ---- YOLOv8 decoding ---------------------------------------------------------------------------------
import { decodeYolo, letterbox, toTensorData } from "../js/walk-logic.js";

// A fake [1, 84, n] output: each box is [cx, cy, w, h, personScore, otherClassScore].
function fakeOutput(boxes) {
  const n = boxes.length;
  const out = new Float32Array(84 * n);
  boxes.forEach(([cx, cy, w, h, person, other = 0], i) => {
    [cx, cy, w, h, person].forEach((v, row) => (out[row * n + i] = v));
    out[5 * n + i] = other;
  });
  return { out, n };
}

test("letterbox fits a landscape frame and centres it", () => {
  assert.deepEqual(letterbox(1280, 720), { scale: 0.5, w: 640, h: 360, padX: 0, padY: 140 });
  assert.deepEqual(letterbox(720, 1280), { scale: 0.5, w: 360, h: 640, padX: 140, padY: 0 });
});

test("decoding maps boxes back to frame pixels and keeps only people", () => {
  const box = letterbox(1280, 720);
  const { out, n } = fakeOutput([[320, 320, 40, 200, 0.9], [100, 300, 50, 50, 0.1, 0.95]]);
  const found = decodeYolo(out, n, box);
  assert.equal(found.length, 1);
  assert.equal(found[0].class, "person");
  assert.ok(Math.abs(found[0].score - 0.9) < 1e-6);
  assert.deepEqual(found[0].bbox, [600, 160, 80, 400]); // feet at (640, 560) in the 1280x720 frame
});

test("overlapping boxes of one person collapse to the most confident", () => {
  const box = letterbox(640, 640);
  const { out, n } = fakeOutput([[100, 100, 40, 100, 0.7], [102, 101, 40, 100, 0.9], [400, 100, 40, 100, 0.8]]);
  const found = decodeYolo(out, n, box);
  assert.deepEqual(found.map((d) => Math.round(d.score * 10)), [9, 8]);
});

test("no confident person, or no boxes at all, decodes to nothing", () => {
  assert.deepEqual(decodeYolo(new Float32Array(0), 0, letterbox(640, 640)), []);
  const { out, n } = fakeOutput([[100, 100, 40, 100, 0.49]]);
  assert.deepEqual(decodeYolo(out, n, letterbox(640, 640)), []);
});

test("tensor data is planar RGB scaled to 0..1", () => {
  const rgba = new Uint8ClampedArray([255, 0, 51, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const data = toTensorData(rgba, 2);
  assert.deepEqual(Array.from(data, (v) => Math.round(v * 10) / 10), [1, 0, 0, 1, 0, 1, 0, 1, 0.2, 0, 1, 1]);
});
