// Rooms from a drawing's walls. Pure functions (no DOM), all lengths in plan cm.
// Walls are drawn on a coarse grid, doorways are closed with virtual blocking segments (never added as walls), the
// grid is flood-filled from outside, and every remaining free region becomes a room with a simplified outline.
// Regions are named from the drawing's text, else from the furniture inside, else from their shape.
import { ROOM_GUESS, ROOM_WORDS } from "../strings.js";

const CELL = 5; // cm
const MAX_CELLS = 1_500_000; // bounds time and memory: larger plans get a coarser grid
const MIN_AREA_M2 = 1;
const MIN_WIDTH = 60; // cm: narrower regions are shafts or gaps between walls, not rooms
const RAY_GAP = 125; // cm: a doorway is closed along the wall direction up to this long
const NEAR_GAP = 75; // cm: else to the nearest wall within this distance
const TOUCH = 6; // cm of slack when deciding whether a wall end meets another wall
const SIMPLIFY = 7.5; // cm
const MAX_POINTS = 200;
const CORRIDOR = { aspect: 3, width: 150 };

const uid = () => `r_${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

// ---------------------------------------------------------------- geometry helpers

const segDistance = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / len2, 0), 1);
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return { distance: Math.hypot(px - qx, py - qy), x: qx, y: qy };
};

export function polygonArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

// Ramer-Douglas-Peucker on an open run of points.
function rdp(points, tol) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points.at(-1);
  let far = 0;
  let index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDistance(points[i][0], points[i][1], ax, ay, bx, by).distance;
    if (d > far) {
      far = d;
      index = i;
    }
  }
  if (far <= tol) return [points[0], points.at(-1)];
  return [...rdp(points.slice(0, index + 1), tol).slice(0, -1), ...rdp(points.slice(index), tol)];
}

function dropCollinear(points) {
  let pts = points;
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    const keep = pts.filter((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[(i + 1) % pts.length];
      return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
    });
    if (keep.length !== pts.length && keep.length >= 3) {
      pts = keep;
      changed = true;
    }
  }
  return pts;
}

// Simplifies a closed ring: split at the two points farthest apart so the result does not depend on where it starts.
function simplifyRing(ring, tol) {
  let ring0 = dropCollinear(ring);
  if (ring0.length <= 4) return ring0;
  let a = 0;
  let b = 0;
  let best = -1;
  const step = Math.max(1, Math.floor(ring0.length / 64));
  for (let i = 0; i < ring0.length; i += step) {
    for (let j = i + 1; j < ring0.length; j += step) {
      const d = Math.hypot(ring0[i][0] - ring0[j][0], ring0[i][1] - ring0[j][1]);
      if (d > best) {
        best = d;
        a = i;
        b = j;
      }
    }
  }
  const first = ring0.slice(a, b + 1);
  const second = [...ring0.slice(b), ...ring0.slice(0, a + 1)];
  const out = [...rdp(first, tol).slice(0, -1), ...rdp(second, tol).slice(0, -1)];
  return dropCollinear(out.length >= 3 ? out : ring0);
}

// ---------------------------------------------------------------- grid

function makeGrid(walls) {
  const xs = walls.flatMap((w) => [w.x1, w.x2]);
  const ys = walls.flatMap((w) => [w.y1, w.y2]);
  const margin = Math.max(...walls.map((w) => w.thickness)) / 2 + 5 * CELL; // free ring that holds the outside
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  const x1 = Math.max(...xs) + margin;
  const y1 = Math.max(...ys) + margin;
  const c = Math.max(CELL, Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_CELLS));
  const nx = Math.ceil((x1 - x0) / c);
  const ny = Math.ceil((y1 - y0) / c);
  return { x0, y0, c, nx, ny, cells: new Uint8Array(nx * ny) };
}

// Marks every cell whose centre lies within `half` of the segment (and within `ext` beyond its ends).
function stamp(grid, x1, y1, x2, y2, half, ext) {
  const { x0, y0, c, nx, ny, cells } = grid;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const r = half + ext + c;
  const ix0 = Math.max(0, Math.floor((Math.min(x1, x2) - r - x0) / c));
  const ix1 = Math.min(nx - 1, Math.ceil((Math.max(x1, x2) + r - x0) / c));
  const iy0 = Math.max(0, Math.floor((Math.min(y1, y2) - r - y0) / c));
  const iy1 = Math.min(ny - 1, Math.ceil((Math.max(y1, y2) + r - y0) / c));
  const eps = 1e-6;
  for (let iy = iy0; iy <= iy1; iy++) {
    const py = y0 + (iy + 0.5) * c - y1;
    for (let ix = ix0; ix <= ix1; ix++) {
      const px = x0 + (ix + 0.5) * c - x1;
      const along = px * ux + py * uy;
      if (along < -ext - eps || along > len + ext + eps) continue;
      if (Math.abs(-px * uy + py * ux) <= half + eps) cells[iy * nx + ix] = 1;
    }
  }
}

// The segment a doorway is closed with, from the free end `end` of wall `w`, or null when nothing is close enough.
function bridge(w, end, others) {
  const [px, py, qx, qy] = end === 1 ? [w.x1, w.y1, w.x2, w.y2] : [w.x2, w.y2, w.x1, w.y1];
  const len = Math.hypot(px - qx, py - qy);
  if (len === 0) return null;
  const dx = (px - qx) / len;
  const dy = (py - qy) / len;
  let hit = Infinity;
  for (const o of others) {
    const ex = o.x2 - o.x1;
    const ey = o.y2 - o.y1;
    const elen = Math.hypot(ex, ey);
    if (elen === 0) continue;
    const ax = o.x1 - px;
    const ay = o.y1 - py;
    const cross = dx * ey - dy * ex;
    const sin = Math.abs(cross) / elen;
    if (sin > 0.05) {
      const s = (ax * ey - ay * ex) / cross;
      const u = (ax * dy - ay * dx) / cross;
      const slack = 10 / elen;
      if (s > 0 && u >= -slack && u <= 1 + slack) hit = Math.min(hit, s - o.thickness / 2 / sin);
    } else {
      for (const [bx, by] of [[o.x1, o.y1], [o.x2, o.y2]]) {
        const lateral = Math.abs((bx - px) * dy - (by - py) * dx);
        const along = (bx - px) * dx + (by - py) * dy;
        if (lateral <= 15 && along > 0) hit = Math.min(hit, along);
      }
    }
  }
  if (hit > 0 && hit <= RAY_GAP) return [px, py, px + dx * (hit + CELL), py + dy * (hit + CELL)];
  let best = null;
  for (const o of others) {
    const near = segDistance(px, py, o.x1, o.y1, o.x2, o.y2);
    if (near.distance - o.thickness / 2 <= NEAR_GAP && (!best || near.distance < best.distance)) best = near;
  }
  return best ? [px, py, best.x, best.y] : null;
}

const touches = (x, y, w, others) => others.some((o) => o !== w && segDistance(x, y, o.x1, o.y1, o.x2, o.y2).distance <= o.thickness / 2 + w.thickness / 2 + TOUCH);

// Labels connected free regions (4-neighbour). Wall cells stay 0; label 1 is the outside, rooms are 2, 3, ...
function labelRegions(grid) {
  const { nx, ny, cells } = grid;
  const label = new Int32Array(nx * ny);
  const stack = new Int32Array(nx * ny);
  let next = 1;
  const fill = (start) => {
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top > 0) {
      const i = stack[--top];
      const ix = i % nx;
      const iy = (i - ix) / nx;
      if (ix > 0 && !cells[i - 1] && !label[i - 1]) (label[i - 1] = next), (stack[top++] = i - 1);
      if (ix < nx - 1 && !cells[i + 1] && !label[i + 1]) (label[i + 1] = next), (stack[top++] = i + 1);
      if (iy > 0 && !cells[i - nx] && !label[i - nx]) (label[i - nx] = next), (stack[top++] = i - nx);
      if (iy < ny - 1 && !cells[i + nx] && !label[i + nx]) (label[i + nx] = next), (stack[top++] = i + nx);
    }
    next++;
  };
  fill(0); // the margin all around the walls is free and connected
  for (let i = 0; i < label.length; i++) if (!cells[i] && !label[i]) fill(i);
  return { label, count: next };
}

// Chamfer (3-4) distance of every room cell to the nearest wall or outside cell, in thirds of a cell.
function clearance(grid, label) {
  const { nx, ny } = grid;
  const d = new Int32Array(nx * ny);
  const INF = 1 << 28;
  for (let i = 0; i < d.length; i++) d[i] = label[i] > 1 ? INF : 0;
  const at = (ix, iy) => (ix < 0 || iy < 0 || ix >= nx || iy >= ny ? 0 : d[iy * nx + ix]);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iy * nx + ix;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(ix - 1, iy) + 3, at(ix, iy - 1) + 3, at(ix - 1, iy - 1) + 4, at(ix + 1, iy - 1) + 4);
    }
  }
  for (let iy = ny - 1; iy >= 0; iy--) {
    for (let ix = nx - 1; ix >= 0; ix--) {
      const i = iy * nx + ix;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(ix + 1, iy) + 3, at(ix, iy + 1) + 3, at(ix + 1, iy + 1) + 4, at(ix - 1, iy + 1) + 4);
    }
  }
  return d;
}

// Outer boundary of a set of cells as a ring of lattice points (clockwise on screen).
function traceOuter(grid, label, id, cellIndexes) {
  const { nx } = grid;
  const w = nx + 1;
  const outs = new Map(); // start vertex -> end vertices still unused
  const add = (ax, ay, bx, by) => {
    const key = ay * w + ax;
    const list = outs.get(key);
    if (list) list.push(by * w + bx);
    else outs.set(key, [by * w + bx]);
  };
  const free = (ix, iy) => ix >= 0 && iy >= 0 && ix < nx && iy * nx + ix < label.length && label[iy * nx + ix] === id;
  for (const i of cellIndexes) {
    const ix = i % nx;
    const iy = (i - ix) / nx;
    if (!free(ix, iy - 1)) add(ix, iy, ix + 1, iy);
    if (!free(ix + 1, iy)) add(ix + 1, iy, ix + 1, iy + 1);
    if (!free(ix, iy + 1)) add(ix + 1, iy + 1, ix, iy + 1);
    if (!free(ix - 1, iy)) add(ix, iy + 1, ix, iy);
  }
  let best = null;
  let bestArea = -1;
  for (const [startKey] of outs) {
    while (outs.get(startKey)?.length) {
      const ring = [];
      let key = startKey;
      do {
        const list = outs.get(key);
        const nextKey = list.pop();
        ring.push([key % w, Math.floor(key / w)]);
        key = nextKey;
      } while (key !== startKey && outs.get(key)?.length);
      const area = polygonArea(ring);
      if (area > bestArea) {
        bestArea = area;
        best = ring;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- naming

const strip = (s) => String(s).replace(/[\s"'`׳״”“„.,:;()\-_/\\]+/g, "");
const reverse = (s) => Array.from(s).reverse().join("");

// Text of a PDF may come out in visual order (reversed); every candidate is tried both ways.
function wordFor(blobs) {
  for (const blob of blobs) {
    const forms = [strip(blob), strip(reverse(blob))];
    for (const entry of ROOM_WORDS) if (entry.words.some((word) => forms.some((f) => f.includes(word)))) return entry;
  }
  return null;
}

function typeFromFurniture(items) {
  const has = (...types) => items.some((f) => types.includes(f.type));
  if (has("double-bed", "single-bed", "bed")) return { type: "bedroom", name: ROOM_GUESS.bedroom };
  if (has("toilet", "shower", "bathtub")) return { type: "bathroom", name: ROOM_GUESS.bathroom };
  if (has("kitchen-counter", "kitchen-island", "stove", "fridge")) return { type: "kitchen", name: ROOM_GUESS.kitchen };
  if (has("sofa")) return { type: "living", name: ROOM_GUESS.living };
  if (has("sink", "vanity")) return { type: "bathroom", name: ROOM_GUESS.bathroom };
  return null;
}

// ---------------------------------------------------------------- detection

// walls: [{ x1, y1, x2, y2, thickness }] in cm. texts: [{ str, x, y, cx?, cy? }] in plan cm (cx, cy: centre of the
// text when known). furniture: [{ type, x, y }] in plan cm.
// Returns rooms sorted top to bottom, left to right: { id, name, type, source, outline, area, label, width }.
export function detectRooms({ walls = [], texts = [], furniture = [] } = {}) {
  const usable = walls.filter((w) => [w.x1, w.y1, w.x2, w.y2, w.thickness].every(Number.isFinite) && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 0);
  if (usable.length < 3) return [];
  const grid = makeGrid(usable);
  const { c, nx } = grid;
  for (const w of usable) stamp(grid, w.x1, w.y1, w.x2, w.y2, Math.max(w.thickness, c) / 2, w.thickness / 2);
  for (const w of usable) {
    const others = usable.filter((o) => o !== w);
    for (const end of [1, 2]) {
      const [px, py] = end === 1 ? [w.x1, w.y1] : [w.x2, w.y2];
      if (touches(px, py, w, others)) continue;
      const seg = bridge(w, end, others);
      if (seg) stamp(grid, seg[0], seg[1], seg[2], seg[3], c / 2, c);
    }
  }

  const { label, count } = labelRegions(grid);
  const clear = clearance(grid, label);
  const cellsOf = Array.from({ length: count }, () => []);
  const maxClear = new Int32Array(count);
  for (let i = 0; i < label.length; i++) {
    const id = label[i];
    if (id > 1) {
      cellsOf[id].push(i);
      if (clear[i] > maxClear[id]) maxClear[id] = clear[i];
    }
  }

  const cellAt = (x, y) => {
    const ix = Math.floor((x - grid.x0) / c);
    const iy = Math.floor((y - grid.y0) / c);
    for (let r = 0; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const jx = ix + dx;
          const jy = iy + dy;
          if (jx < 0 || jy < 0 || jx >= nx || jy >= grid.ny) continue;
          const id = label[jy * nx + jx];
          if (id > 1) return id;
        }
      }
    }
    return 0;
  };

  const rooms = [];
  for (let id = 2; id < count; id++) {
    const cells = cellsOf[id];
    const areaM2 = (cells.length * c * c) / 10_000;
    const width = (2 * (maxClear[id] / 3) - 1) * c;
    if (areaM2 < MIN_AREA_M2 || width < MIN_WIDTH) continue;
    const lattice = traceOuter(grid, label, id, cells);
    if (!lattice || lattice.length < 4) continue;
    let ring = lattice.map(([vx, vy]) => [grid.x0 + vx * c, grid.y0 + vy * c]);
    for (let tol = SIMPLIFY, guard = 0; ; tol *= 1.5, guard++) {
      const simple = simplifyRing(ring, tol);
      if (simple.length <= MAX_POINTS || guard > 12) {
        ring = simple.slice(0, MAX_POINTS);
        break;
      }
    }
    if (ring.length < 3) continue;
    const outline = ring.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    const area = polygonArea(outline) / 10_000;
    if (area < MIN_AREA_M2) continue;
    rooms.push({ id, outline, area, width, cells: cells.length });
  }

  const byId = new Map(rooms.map((r) => [r.id, { text: [], furniture: [] }]));
  for (const t of texts) {
    const hit = cellAt(Number.isFinite(t.cx) ? t.cx : t.x, Number.isFinite(t.cy) ? t.cy : t.y);
    if (byId.has(hit)) byId.get(hit).text.push(t.str);
  }
  for (const f of furniture) {
    const hit = cellAt(f.x, f.y);
    if (byId.has(hit)) byId.get(hit).furniture.push(f);
  }

  const ordered = rooms
    .map((r) => {
      const xs = r.outline.map((p) => p[0]);
      const ys = r.outline.map((p) => p[1]);
      return { ...r, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
    })
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  let numbered = 0;
  return ordered.map((r) => {
    const found = byId.get(r.id);
    const joined = found.text.join(" ");
    const entry = wordFor([...found.text, joined]);
    let name;
    let type;
    let source;
    if (entry) ({ name, type } = entry), (source = "text");
    else if (typeFromFurniture(found.furniture)) ({ name, type } = typeFromFurniture(found.furniture)), (source = "furniture");
    else if (r.width < CORRIDOR.width && (r.area * 10_000) / Math.max(r.width, 1) > CORRIDOR.aspect * r.width) (name = ROOM_GUESS.corridor), (type = "hallway"), (source = "shape");
    else (name = ROOM_GUESS.numbered(++numbered)), (type = "other"), (source = "default");
    return { id: `room_${r.id}`, name, type, source, outline: r.outline, area: r.area, width: r.width };
  });
}

// ---------------------------------------------------------------- review helpers

export function outlineCentre(outline) {
  let x = 0;
  let y = 0;
  for (const p of outline) {
    x += p[0];
    y += p[1];
  }
  return { x: x / outline.length, y: y / outline.length };
}

// What the user chose per room (name, type, off) survives a new detection (other scale, calibration, other
// area): rooms are matched by the page position of their outline centre. `ctx` is { cmPerUnit, originCm }.
export function carryOverRoomChoices(prevRooms, prevCtx, choices, nextRooms, nextCtx, maxUnits = 40) {
  const out = new Map();
  if (!prevRooms?.length || !choices?.size) return out;
  const page = (ctx, r) => {
    const m = outlineCentre(r.outline);
    return { x: (m.x + ctx.originCm.x) / ctx.cmPerUnit, y: (m.y + ctx.originCm.y) / ctx.cmPerUnit };
  };
  const prev = prevRooms.filter((r) => choices.has(r.id)).map((r) => ({ id: r.id, ...page(prevCtx, r) }));
  const taken = new Set();
  for (const r of nextRooms) {
    const p = page(nextCtx, r);
    let best = null;
    for (const q of prev) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!taken.has(q.id) && d <= maxUnits && (!best || d < best.d)) best = { id: q.id, d };
    }
    if (best) {
      taken.add(best.id);
      out.set(r.id, choices.get(best.id));
    }
  }
  return out;
}

// Plan rooms (with outline) for the rooms the user keeps. `chosen(room)` returns { name, type } or null to skip.
export function toPlanRooms(rooms, chosen) {
  return rooms.flatMap((room) => {
    const pick = chosen(room);
    if (!pick) return [];
    return [{ id: uid(), name: String(pick.name).trim().slice(0, 80) || room.name, type: pick.type, outline: room.outline.map(([x, y]) => [x, y]) }];
  });
}
