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
