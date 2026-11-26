import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MODELS, POOL, ROOMS, START, UPPER, walk } from "../villa/js/world.js";

// Every place a walker can get to from the front gate, found by walking in small steps.
function explore() {
  const seen = new Map();
  const key = (p) => `${Math.round(p.x / 0.2)},${Math.round(p.y / 0.1)},${Math.round(p.z / 0.2)}`;
  const queue = [{ x: START.x, y: START.y, z: START.z }];
  seen.set(key(queue[0]), queue[0]);
  while (queue.length) {
    const from = queue.pop();
    for (const [dx, dz] of [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) {
      const to = walk(from, dx, dz);
      if (!seen.has(key(to))) {
        seen.set(key(to), to);
        queue.push(to);
      }
    }
  }
  return [...seen.values()];
}
const places = explore();
const reached = (x, y, z, within = 0.6) => places.some((p) => Math.abs(p.y - y) < 0.2 && Math.hypot(p.x - x, p.z - z) < within);

test("there are six living rooms and bedrooms on two floors", () => {
  const six = ROOMS.filter((r) => !/hall|landing|bathroom/i.test(r.name));
  assert.equal(six.length, 6);
  assert.deepEqual([...new Set(six.map((r) => r.y))], [0, UPPER]);
});

for (const room of ROOMS) {
  test(`${room.name} can be reached on foot from the gate`, () => assert.ok(reached(room.spawn.x, room.spawn.y, room.spawn.z)));
  test(`${room.name}: the jump-to point is free`, () => {
    const at = walk(room.spawn, 0, 0);
    assert.ok(Math.hypot(at.x - room.spawn.x, at.z - room.spawn.z) < 0.01 && Math.abs(at.y - room.y) < 0.05, JSON.stringify(at));
  });
}

test("the pool deck and the back of the yard are reachable", () => {
  assert.ok(reached(8, 0, 14));
  assert.ok(reached(8, 0, 22));
});

test("nobody ends up in the pool, outside the fence or between floors in mid air", () => {
  for (const p of places) {
    assert.ok(!(p.x > POOL.x0 && p.x < POOL.x1 && p.z > POOL.z0 && p.z < POOL.z1), `in the pool at ${p.x}, ${p.z}`);
    assert.ok(p.x > -9 && p.x < 25 && p.z > -8 && p.z < 25, `outside at ${p.x}, ${p.z}`);
    if (p.y > 3.05) assert.fail(`climbed onto something: ${JSON.stringify(p)}`);
    const onStairs = p.x > 9.3 && p.x < 11 && p.z > 0.9 && p.z < 5.1;
    if (p.y > 0.45 && p.y < 2.95) assert.ok(onStairs, `floating at ${JSON.stringify(p)}`);
  }
});

test("walking the stairs goes up one floor and back down", () => {
  let at = { x: 10.3, y: 0.02, z: 0.8 };
  at = walk(at, 0, 4.6);
  assert.ok(Math.abs(at.y - UPPER) < 0.01, JSON.stringify(at));
  at = walk(at, 0, -4.6);
  assert.ok(at.y < 0.05, JSON.stringify(at));
});

test("one huge step does not cross a wall", () => {
  const at = walk({ x: 2.5, y: 0.02, z: 3 }, -500, 0);
  assert.ok(at.x > 0.1, JSON.stringify(at));
});

const asset = (path) => fileURLToPath(new URL(`../villa/assets/${path}`, import.meta.url));
const skip = !existsSync(asset("sky.hdr")) && "assets not downloaded (npm run villa:assets)";

test("every model that is placed was downloaded", { skip }, () => {
  for (const { id } of MODELS) assert.ok(existsSync(asset(`models/${id}/model.gltf`)), id);
});

test("the download script fetches every model that is placed", () => {
  const script = readFileSync(new URL("../scripts/download-villa-assets.mjs", import.meta.url), "utf8");
  for (const { id } of MODELS) assert.ok(script.includes(`"${id}"`), id);
});

test("the content security policy allows exactly the import map", () => {
  const page = readFileSync(new URL("../villa/index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const [, map] = page.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(page.includes(`script-src 'self' 'sha256-${createHash("sha256").update(map).digest("base64")}'`));
});
