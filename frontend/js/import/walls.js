// Pure wall detection for an imported vector floor plan. No DOM, no pdf.js: it works on the page
// object produced by pdf.js's readPage() ({ width, height, paths }, y down, PDF units) and returns
// walls in centimetres in the plan.js shape. Every threshold below is in cm AFTER scaling, never in
// PDF units, so 1:20, 1:50 and 1:100 drawings behave the same.

const PT_CM = 2.54 / 72; // one PDF unit at scale 1:1, in cm
const PROVISIONAL_RATIO = 50; // used for detection only when no scale was found
const MAX_WALLS = 1000;
const MAX_COORD = 100_000;
const MIN_THICKNESS = 5;
const MIN_PLAIN_PAIR = 100; // a pair of plain thin lines (no hatching) must run at least this long
const MAX_PLAIN_PAIR = 45; // plain (unhatched) line pairs thicker than this are furniture, not walls
const MIN_HATCHED = 3; // a hatched pair can be a thin wall (finish layers on carpentry plans)
const MAX_THICKNESS = 60;
const EXTERIOR_FROM = 17;
const MIN_LENGTH = 30;
const ISOLATED_BELOW = 100;
const SNAP_DEG = 2;
const DARK = 0.55;
const MAX_POLY_POINTS = 64;
const FAR = 1e6; // subpaths reaching further than this (cm) are garbage
const HATCH_MIN = 3; // short strokes between a parallel pair that make it a "strong" (hatched) wall
const HATCH_MAX_LEN = 120; // longest stroke (cm) counted as hatching
const TABLE_MIN_LINES = 4; // equally spaced parallel lines of one extent: a table, not walls
const TABLE_CROSS = 5; // thin perpendicular lines spanning a candidate pair: table rows
const CROSSING_MAX = 3; // a wall that passes through this many other walls is a stray line
const DENSE_TEXTS = 12; // text items per 100 PDF units square that mark a title block or legend
const DENSE_CELL = 100; // PDF units
const MARGIN_SHARE = 0.02; // walls this close to the sheet edge do not choose the plan area

// getRandomValues also works on plain HTTP (same approach as plan.js).
const uid = (prefix) =>
  `${prefix}_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

export const wallLength = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const kindOf = (thickness) => (thickness >= EXTERIOR_FROM ? "exterior" : "partition");

// ---------------------------------------------------------------- scale

const LABEL = "קנ";
const FORWARD = /(?<![\d.:])1\s*:\s*(\d{1,4})(?![\d]|[.,]\d)/g; // 1:50, 1 : 100
const REVERSED = /(?<![\d.:])(\d{1,4})\s*:\s*1(?![\d]|[.,]\d)/g; // RTL extraction can print 50:1
const LABEL_DISTANCE = 150; // PDF units between the label and the ratio text

export function detectScale(texts) {
  const items = (texts ?? []).filter((t) => t && typeof t.str === "string");
  const labels = items.filter((t) => t.str.includes(LABEL));
  const nearLabel = (t) =>
    t.str.includes(LABEL) || labels.some((l) => Math.hypot((l.x ?? 0) - (t.x ?? 0), (l.y ?? 0) - (t.y ?? 0)) <= LABEL_DISTANCE);
  const found = new Map(); // ratio -> { count, near, order }
  const add = (n, near) => {
    if (!(n >= 10 && n <= 500)) return;
    const f = found.get(n) ?? { count: 0, near: false, order: found.size };
    f.count += 1;
    f.near ||= near;
    found.set(n, f);
  };
  for (const t of items) {
    const near = nearLabel(t);
    for (const m of t.str.matchAll(FORWARD)) add(Number(m[1]), near);
    if (near) for (const m of t.str.matchAll(REVERSED)) add(Number(m[1]), true);
  }
  const rank = (a, b) => b[1].count - a[1].count || a[1].order - b[1].order;
  const entries = [...found.entries()];
  const candidates = [...entries.filter(([, f]) => f.near).sort(rank), ...entries.filter(([, f]) => !f.near).sort(rank)].map(([n]) => n);
  const ratio = candidates[0] ?? null;
  return { ratio, cmPerUnit: ratio === null ? null : PT_CM * ratio, candidates };
}

// ---------------------------------------------------------------- geometry helpers

const luminance = (rgb) => (rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 0);

// Splits a path into straight subpaths of cm points. Subpaths that contain a curve are dropped.
function subpaths(path, k) {
  const out = [];
  let cur = null;
  const finish = () => {
    if (cur && !cur.curved && cur.pts.length >= 2) out.push(cur);
    cur = null;
  };
  for (const { op, pts } of path.ops ?? []) {
    if (op === "M") {
      finish();
      cur = { pts: [[pts[0] * k, pts[1] * k]], closed: false, curved: false };
    } else if (!cur) {
      continue;
    } else if (op === "L") {
      cur.pts.push([pts[0] * k, pts[1] * k]);
    } else if (op === "C") {
      cur.curved = true;
    } else if (op === "Z") {
      cur.closed = true;
    }
  }
  finish();
  return out.filter((s) => s.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < FAR && Math.abs(y) < FAR));
}

// Bounding boxes (cm) of subpaths that contain a curve: door swings, round furniture.
function curveExtents(path, k) {
  const out = [];
  let pts = [];
  let curved = false;
  const finish = () => {
    if (curved && pts.length) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (Number.isFinite(w) && Number.isFinite(h) && w < FAR && h < FAR) out.push({ w, h });
    }
    pts = [];
    curved = false;
  };
  for (const { op, pts: p } of path.ops ?? []) {
    if (op === "M") {
      finish();
      pts.push([p[0] * k, p[1] * k]);
    } else if (op === "L") pts.push([p[0] * k, p[1] * k]);
    else if (op === "C") {
      curved = true;
      for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i] * k, p[i + 1] * k]);
    }
  }
  finish();
  return out;
}

function cleanPoly(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.01) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= 0.01) out.pop();
  return out;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

const edgeDeg = (dx, dy) => (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0 = horizontal, 90 = vertical
const isAxis = (dx, dy) => edgeDeg(dx, dy) < SNAP_DEG || edgeDeg(dx, dy) > 90 - SNAP_DEG;

// A parallelogram with a right angle, as { centre, a (along e0), b (along e1), e0, e1 } or null.
function orientedRect(p) {
  if (p.length !== 4) return null;
  const e = [0, 1, 2, 3].map((i) => [p[(i + 1) % 4][0] - p[i][0], p[(i + 1) % 4][1] - p[i][1]]);
  const a = Math.hypot(...e[0]);
  const b = Math.hypot(...e[1]);
  if (a < 0.5 || b < 0.5) return null;
  const closeTo = Math.max(0.5, 0.01 * Math.max(a, b));
  if (Math.hypot(e[0][0] + e[2][0], e[0][1] + e[2][1]) > closeTo || Math.hypot(e[1][0] + e[3][0], e[1][1] + e[3][1]) > closeTo) return null;
  if (Math.abs(e[0][0] * e[1][0] + e[0][1] * e[1][1]) / (a * b) > Math.sin((3 * Math.PI) / 180)) return null;
  return { centre: [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2], a, b, e0: e[0], e1: e[1] };
}

// A rectangle as a wall piece: centre line along its long side, thickness = its short side.
function pieceFromRect({ centre, a, b, e0, e1 }) {
  const [along, length, thickness] = a >= b ? [e0, a, b] : [e1, b, a];
  if (thickness < 4 || thickness > MAX_THICKNESS) return null;
  const ux = (along[0] / length) * (length / 2);
  const uy = (along[1] / length) * (length / 2);
  return { x1: centre[0] - ux, y1: centre[1] - uy, x2: centre[0] + ux, y2: centre[1] + uy, t: thickness };
}

const axisRect = (x0, y0, x1, y1) =>
  pieceFromRect({ centre: [(x0 + x1) / 2, (y0 + y1) / 2], a: x1 - x0, b: y1 - y0, e0: [x1 - x0, 0], e1: [0, y1 - y0] });

function cluster(values, tol = 0.5) {
  const sorted = [...values].sort((p, q) => p - q);
  const out = [];
  for (const v of sorted) {
    if (out.length && v - out.at(-1).last <= tol) {
      const c = out.at(-1);
      c.sum += v;
      c.n += 1;
      c.last = v;
    } else out.push({ sum: v, n: 1, last: v });
  }
  return out.map((c) => c.sum / c.n);
}

// Orthogonal polygon -> list of axis-aligned rectangles (grid compression + greedy merge).
function decompose(pts) {
  if (pts.length > MAX_POLY_POINTS) return [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    if (!isAxis(q[0] - pts[i][0], q[1] - pts[i][1])) return [];
  }
  const xs = cluster(pts.map((p) => p[0]));
  const ys = cluster(pts.map((p) => p[1]));
  const inside = (px, py) => {
    let hit = false;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 > py !== y2 > py && px < x1 + ((py - y1) / (y2 - y1)) * (x2 - x1)) hit = !hit;
    }
    return hit;
  };
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const cell = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)));
  const rects = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!cell[j][i]) continue;
      let i1 = i;
      while (i1 + 1 < nx && cell[j][i1 + 1]) i1++;
      let j1 = j;
      const rowFull = (row) => {
        for (let c = i; c <= i1; c++) if (!cell[row][c]) return false;
        return true;
      };
      while (j1 + 1 < ny && rowFull(j1 + 1)) j1++;
      for (let r = j; r <= j1; r++) for (let c = i; c <= i1; c++) cell[r][c] = false;
      rects.push([xs[i], ys[j], xs[i1 + 1], ys[j1 + 1]]);
    }
  }
  return rects;
}

// ---------------------------------------------------------------- candidate extraction

// Walls from a dark filled polygon.
function fillPieces(pts) {
  const p = cleanPoly(pts);
  if (p.length < 3) return [];
  const rect = orientedRect(p);
  if (rect) return [pieceFromRect(rect)].filter(Boolean);
  return decompose(p).map((r) => axisRect(...r)).filter(Boolean);
}

// Axis-aligned edges of a stroked path, kept for the parallel-pair search.
function pushEdges(pts, closed, segs, pageW, pageH) {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < MIN_LENGTH || !isAxis(dx, dy)) continue;
    if (edgeDeg(dx, dy) < SNAP_DEG) {
      if (len >= 0.9 * pageW) continue; // sheet frames and title block borders
      segs.push({ o: "h", c: (y1 + y2) / 2, a: Math.min(x1, x2), b: Math.max(x1, x2) });
    } else {
      if (len >= 0.9 * pageH) continue;
      segs.push({ o: "v", c: (x1 + x2) / 2, a: Math.min(y1, y2), b: Math.max(y1, y2) });
    }
  }
}

// Hatching strokes (any angle, short) indexed by their midpoint, so a candidate pair can ask "how many strokes
// run across the band between us?".
function hatchIndex(strokes) {
  const cells = new Map();
  for (const s of strokes) {
    const key = `${Math.floor(s.mx / 60)},${Math.floor(s.my / 60)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)).push(s);
  }
  return (o, c1, c2, lo, hi) => {
    const [x0, x1, y0, y1] = o === "h" ? [lo, hi, c1, c2] : [c1, c2, lo, hi];
    let n = 0;
    for (let cx = Math.floor(x0 / 60); cx <= Math.floor(x1 / 60); cx++) {
      for (let cy = Math.floor(y0 / 60); cy <= Math.floor(y1 / 60); cy++) {
        for (const s of cells.get(`${cx},${cy}`) ?? []) {
          if (s.mx < x0 || s.mx > x1 || s.my < y0 || s.my > y1) continue;
          const across = o === "h" ? s.dy : s.dx;
          const along = o === "h" ? s.dx : s.dy;
          const d = c2 - c1;
          const tol = Math.max(1.5, 0.12 * d);
          // a hatch stroke runs from one line of the pair to the other, not from some third line
          if (Math.abs(across - d) <= tol && Math.abs((o === "h" ? s.my : s.mx) - (c1 + c2) / 2) <= tol && along <= 3 * across) n++;
        }
      }
    }
    return n;
  };
}

// Parallel segments 5..60 cm apart that overlap by at least half -> one wall each. A pair with hatching
// between its lines is a strong wall. Without hatching the pair must be mutually nearest and must not be
// crossed by many thin perpendicular lines (table rows).
function pairSegments(segs, hatchCount) {
  const pieces = [];
  for (const o of ["h", "v"]) {
    const list = segs.filter((s) => s.o === o).sort((p, q) => p.c - q.c);
    const cross = segs.filter((s) => s.o !== o).sort((p, q) => p.c - q.c);
    const near = list.map(() => []);
    const cand = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].c - list[i].c <= MAX_THICKNESS; j++) {
        const d = list[j].c - list[i].c;
        if (d < MIN_HATCHED) continue;
        const lo = Math.max(list[i].a, list[j].a);
        const hi = Math.min(list[i].b, list[j].b);
        const shorter = Math.min(list[i].b - list[i].a, list[j].b - list[j].a);
        if (hi - lo < 0.5 * shorter) continue;
        if (d >= MIN_THICKNESS) {
          near[i].push(d);
          near[j].push(d);
        }
        cand.push({ i, j, d, lo, hi });
      }
    }
    const best = near.map((n) => Math.min(...n));
    const crossings = (c1, c2, lo, hi) => {
      let n = 0;
      let last = -Infinity;
      let from = 0;
      let to = cross.length;
      while (from < to) {
        const mid = (from + to) >> 1;
        if (cross[mid].c < lo) from = mid + 1;
        else to = mid;
      }
      for (let q = from; q < cross.length && cross[q].c <= hi; q++) {
        const s = cross[q];
        if (s.a <= c1 + 1 && s.b >= c2 - 1 && s.c - last >= 3) {
          n++;
          last = s.c;
        }
      }
      return n;
    };
    for (const { i, j, d, lo, hi } of cand) {
      const strong = hatchCount(o, list[i].c, list[j].c, lo, hi) >= HATCH_MIN;
      if (!strong) {
        if (d < MIN_THICKNESS || d > MAX_PLAIN_PAIR || hi - lo < MIN_PLAIN_PAIR || d > best[i] + 1 || d > best[j] + 1) continue;
        if (crossings(list[i].c, list[j].c, lo, hi) >= TABLE_CROSS) continue;
      }
      const c = (list[i].c + list[j].c) / 2;
      const piece = o === "h" ? { x1: lo, y1: c, x2: hi, y2: c, t: d } : { x1: c, y1: lo, x2: c, y2: hi, t: d };
      pieces.push(strong ? { ...piece, strong: true } : piece);
    }
  }
  return pieces;
}

// ---------------------------------------------------------------- junk regions: tables, title blocks, dense text

const inRect = (r, x, y, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
const overlaps = (a, b, gap = 0) => a.x0 <= b.x1 + gap && b.x0 <= a.x1 + gap && a.y0 <= b.y1 + gap && b.y0 <= a.y1 + gap;

function unionRects(rects, gap = 20) {
  const list = rects.map((r) => ({ ...r }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!overlaps(list[i], list[j], gap)) continue;
        const a = list[i];
        const b = list[j];
        list[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
        list.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return list;
}

// Four or more parallel lines of the same extent and (mostly) equal spacing are table rows or columns.
function findTables(all, hatchCount) {
  const out = [];
  for (const o of ["h", "v"]) {
    const groups = new Map();
    for (const s of all) {
      if (s.o !== o) continue;
      const key = `${Math.round(s.a / 4)},${Math.round(s.b / 4)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)).push(s);
    }
    for (const g of groups.values()) {
      const cs = cluster(g.map((s) => s.c), 0.5);
      if (cs.length < TABLE_MIN_LINES) continue;
      const diffs = cs.slice(1).map((c, i) => c - cs[i]);
      const median = [...diffs].sort((p, q) => p - q)[diffs.length >> 1];
      if (median > 150 || diffs.filter((d) => Math.abs(d - median) <= 0.2 * median).length < 0.85 * diffs.length) continue;
      const a = Math.min(...g.map((s) => s.a));
      const b = Math.max(...g.map((s) => s.b));
      if (cs.slice(1).some((c, i) => c - cs[i] <= MAX_THICKNESS && hatchCount(o, cs[i], c, a, b) >= HATCH_MIN)) continue; // hatched wall bands, not table rows
      out.push(o === "h" ? { x0: a - 2, x1: b + 2, y0: cs[0] - 2, y1: cs.at(-1) + 2 } : { x0: cs[0] - 2, x1: cs.at(-1) + 2, y0: a - 2, y1: b + 2 });
    }
  }
  return unionRects(out);
}

// Boxes that sit on the sheet edge or on the drawing frame (title block, revision box), but are not the frame.
function borderBoxes(boxes, pageW, pageH) {
  const isFrame = (b) => b.x1 - b.x0 >= 0.7 * pageW && b.y1 - b.y0 >= 0.7 * pageH;
  const refs = [{ x0: 0, y0: 0, x1: pageW, y1: pageH }, ...boxes.filter(isFrame)];
  const tol = Math.max(3, 0.01 * Math.max(pageW, pageH));
  return boxes.filter((b) => {
    if (isFrame(b) || (b.x1 - b.x0) * (b.y1 - b.y0) < 0.005 * pageW * pageH) return false;
    return refs.some((r) => Math.abs(b.x0 - r.x0) <= tol || Math.abs(b.x1 - r.x1) <= tol || Math.abs(b.y0 - r.y0) <= tol || Math.abs(b.y1 - r.y1) <= tol);
  });
}

// Cells (cm rects) holding many text items: title blocks, legends, schedules.
function denseTextRects(texts, k) {
  const cells = new Map();
  for (const t of texts ?? []) {
    if (!Number.isFinite(t?.x) || !Number.isFinite(t?.y)) continue;
    const key = `${Math.floor(t.x / DENSE_CELL)},${Math.floor(t.y / DENSE_CELL)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const out = [];
  for (const [key, n] of cells) {
    if (n < DENSE_TEXTS) continue;
    const [cx, cy] = key.split(",").map(Number);
    out.push({ x0: cx * DENSE_CELL * k, y0: cy * DENSE_CELL * k, x1: (cx + 1) * DENSE_CELL * k, y1: (cy + 1) * DENSE_CELL * k });
  }
  return out;
}

// ---------------------------------------------------------------- clean-up

const orient = (w) => (w.y1 === w.y2 ? "h" : w.x1 === w.x2 ? "v" : "d");

function snapAngle(w) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  let out = { ...w };
  if (edgeDeg(dx, dy) < SNAP_DEG) {
    const y = (w.y1 + w.y2) / 2;
    out = { ...w, y1: y, y2: y };
    if (out.x1 > out.x2) [out.x1, out.x2] = [out.x2, out.x1];
  } else if (edgeDeg(dx, dy) > 90 - SNAP_DEG) {
    const x = (w.x1 + w.x2) / 2;
    out = { ...w, x1: x, x2: x };
    if (out.y1 > out.y2) [out.y1, out.y2] = [out.y2, out.y1];
  }
  return out;
}

const axisOf = (w) => (orient(w) === "h" ? { c: w.y1, a: w.x1, b: w.x2 } : { c: w.x1, a: w.y1, b: w.y2 });
const fromAxis = (o, c, a, b, t) => (o === "h" ? { x1: a, y1: c, x2: b, y2: c, t } : { x1: c, y1: a, x2: c, y2: b, t });

// Merges collinear walls of similar thickness that overlap or abut. Repeats until stable.
function mergeCollinear(walls) {
  let list = walls;
  for (let changed = true; changed; ) {
    changed = false;
    const keyed = list.map((w) => ({ w, o: orient(w), ...(orient(w) === "d" ? {} : axisOf(w)) }));
    const axis = keyed.filter((k) => k.o !== "d").sort((p, q) => (p.o < q.o ? -1 : p.o > q.o ? 1 : p.c - q.c || p.a - q.a));
    const out = keyed.filter((k) => k.o === "d").map((k) => k.w);
    const used = new Set();
    for (let i = 0; i < axis.length; i++) {
      if (used.has(i)) continue;
      let cur = axis[i];
      for (let j = i + 1; j < axis.length; j++) {
        const n = axis[j];
        if (n.o !== cur.o || n.c - cur.c > 0.5 * MAX_THICKNESS) break;
        if (used.has(j)) continue;
        const tol = Math.max(2, 0.3 * Math.min(cur.w.t, n.w.t));
        const similar = Math.abs(cur.w.t - n.w.t) <= Math.max(2, 0.2 * Math.max(cur.w.t, n.w.t));
        if (!similar || Math.abs(cur.c - n.c) > tol || n.a > cur.b + 2) continue;
        const la = Math.max(0, cur.b - cur.a);
        const lb = Math.max(0, n.b - n.a);
        const c = (cur.c * la + n.c * lb) / (la + lb || 1);
        const merged = { ...fromAxis(cur.o, c, Math.min(cur.a, n.a), Math.max(cur.b, n.b), Math.max(cur.w.t, n.w.t)), ...(cur.w.strong || n.w.strong ? { strong: true } : {}) };
        cur = { w: merged, o: cur.o, ...axisOf(merged) };
        used.add(j);
        changed = true;
      }
      out.push(cur.w);
    }
    list = out;
  }
  return list;
}

// Uniform grid over padded wall bounding boxes, so joins and connectivity avoid O(n^2).
function gridOf(walls, pad = MAX_THICKNESS, size = 100) {
  const cells = new Map();
  walls.forEach((w, i) => {
    const x0 = Math.floor((Math.min(w.x1, w.x2) - pad) / size);
    const x1 = Math.floor((Math.max(w.x1, w.x2) + pad) / size);
    const y0 = Math.floor((Math.min(w.y1, w.y2) - pad) / size);
    const y1 = Math.floor((Math.max(w.y1, w.y2) + pad) / size);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        (cells.get(key) ?? cells.set(key, []).get(key)).push(i);
      }
    }
  });
  return (x, y) => cells.get(`${Math.floor(x / size)},${Math.floor(y / size)}`) ?? [];
}

// Snaps wall ends onto the centre line of perpendicular walls they nearly touch (corners, T junctions),
// and closes small gaps between collinear walls. Decisions use the original positions.
function joinEnds(walls) {
  const near = gridOf(walls);
  const out = walls.map((w) => ({ ...w }));
  walls.forEach((a, ai) => {
    const oa = orient(a);
    if (oa === "d") return;
    for (const end of [1, 2]) {
      const px = end === 1 ? a.x1 : a.x2;
      const py = end === 1 ? a.y1 : a.y2;
      let best = null;
      for (const bi of near(px, py)) {
        if (bi === ai) continue;
        const b = walls[bi];
        const ob = orient(b);
        const tol = Math.max(a.t, b.t);
        if (ob !== "d" && ob !== oa) {
          // b is perpendicular: its centre line is x = b.x1 (vertical) or y = b.y1 (horizontal)
          const gap = oa === "h" ? Math.abs(px - b.x1) : Math.abs(py - b.y1);
          const along = oa === "h" ? py : px;
          const [lo, hi] = oa === "h" ? [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)] : [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)];
          if (gap <= tol && along >= lo - tol && along <= hi + tol && (!best || gap < best.gap)) best = { gap, target: oa === "h" ? b.x1 : b.y1 };
        } else if (ob === oa) {
          // collinear neighbour: meet in the middle of a small gap
          const cA = oa === "h" ? a.y1 : a.x1;
          const cB = oa === "h" ? b.y1 : b.x1;
          if (Math.abs(cA - cB) > 0.5 * Math.min(a.t, b.t)) continue;
          const [aS, aE] = oa === "h" ? [a.x1, a.x2] : [a.y1, a.y2];
          const [bS, bE] = oa === "h" ? [b.x1, b.x2] : [b.y1, b.y2];
          const here = end === 1 ? aS : aE;
          const there = end === 1 ? bE : bS;
          const gap = end === 1 ? aS - bE : bS - aE;
          if (gap > 0 && gap <= Math.min(tol, 25) && (!best || gap < best.gap)) best = { gap, target: (here + there) / 2 };
        }
      }
      if (!best) continue;
      const o = out[ai];
      if (oa === "h") o[end === 1 ? "x1" : "x2"] = best.target;
      else o[end === 1 ? "y1" : "y2"] = best.target;
    }
  });
  return out.map(snapAngle);
}

function distanceToSegment(px, py, w) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : clamp(((px - w.x1) * dx + (py - w.y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (w.x1 + u * dx), py - (w.y1 + u * dy));
}

function dropIsolated(walls) {
  const near = gridOf(walls);
  const connected = walls.map((a, ai) =>
    [[a.x1, a.y1], [a.x2, a.y2]].some(([px, py]) =>
      near(px, py).some((bi) => bi !== ai && distanceToSegment(px, py, walls[bi]) <= Math.max(a.t, walls[bi].t) / 2 + 1),
    ),
  );
  return walls.filter((w, i) => connected[i] || w.strong || wallLength(w) >= ISOLATED_BELOW);
}

// ---------------------------------------------------------------- stray walls, clusters, plan area

const segPointDist = (px, py, w) => distanceToSegment(px, py, w);
const ccw = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function segDist(a, b) {
  const d1 = ccw(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = ccw(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = ccw(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = ccw(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segPointDist(a.x1, a.y1, b), segPointDist(a.x2, a.y2, b), segPointDist(b.x1, b.y1, a), segPointDist(b.x2, b.y2, a));
}

// Index pairs of walls that may be within ~80 cm of each other (sampled along each wall, deduplicated).
function nearPairs(walls) {
  const near = gridOf(walls, 80, 100);
  const seen = new Set();
  const out = [];
  walls.forEach((a, i) => {
    const steps = Math.max(1, Math.ceil(wallLength(a) / 50));
    for (let s = 0; s <= steps; s++) {
      const x = a.x1 + ((a.x2 - a.x1) * s) / steps;
      const y = a.y1 + ((a.y2 - a.y1) * s) / steps;
      for (const j of near(x, y)) {
        if (j === i) continue;
        const key = i < j ? i * 100_003 + j : j * 100_003 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(i < j ? [i, j] : [j, i]);
      }
    }
  });
  return out;
}

// h/v walls that cross each other through both interiors (not a corner or a T).
function crossesThrough(a, b) {
  const oa = orient(a);
  const ob = orient(b);
  if (oa === ob || oa === "d" || ob === "d") return false;
  const [h, v] = oa === "h" ? [a, b] : [b, a];
  const m = Math.max(a.t, b.t) / 2 + 2;
  return v.x1 > Math.min(h.x1, h.x2) + m && v.x1 < Math.max(h.x1, h.x2) - m && h.y1 > Math.min(v.y1, v.y2) + m && h.y1 < Math.max(v.y1, v.y2) - m;
}

// A long thin line drawn across the whole plan passes through many walls; real walls meet at corners and T junctions.
function dropCrossers(walls) {
  const count = walls.map(() => 0);
  for (const [i, j] of nearPairs(walls)) {
    if (crossesThrough(walls[i], walls[j])) {
      count[i]++;
      count[j]++;
    }
  }
  return walls.filter((w, i) => w.strong || count[i] < CROSSING_MAX);
}

export function clusterWalls(walls) {
  const parent = walls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [i, j] of nearPairs(walls)) {
    if (segDist(walls[i], walls[j]) <= (walls[i].t + walls[j].t) / 2 + 2) parent[find(i)] = find(j);
  }
  const groups = new Map();
  walls.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))).push(i));
  return [...groups.values()].map((idx) => {
    const ws = idx.map((i) => walls[i]);
    return {
      idx,
      length: ws.reduce((s, w) => s + wallLength(w), 0),
      box: boxOf(ws),
    };
  });
}

function boxOf(ws) {
  return {
    x0: Math.min(...ws.map((w) => Math.min(w.x1, w.x2) - w.t / 2)),
    y0: Math.min(...ws.map((w) => Math.min(w.y1, w.y2) - w.t / 2)),
    x1: Math.max(...ws.map((w) => Math.max(w.x1, w.x2) + w.t / 2)),
    y1: Math.max(...ws.map((w) => Math.max(w.y1, w.y2) + w.t / 2)),
  };
}

// A wall longer than everything else in its cluster put together reaches: the stray line seen on real sheets.
function dropOversized(walls) {
  const drop = new Set();
  for (const c of clusterWalls(walls)) {
    if (c.idx.length < 6) continue;
    for (const i of c.idx) {
      const rest = boxOf(c.idx.filter((j) => j !== i).map((j) => walls[j]));
      const extent = Math.max(rest.x1 - rest.x0, rest.y1 - rest.y0);
      if (wallLength(walls[i]) > 1.05 * extent + 10) drop.add(i);
    }
  }
  return walls.filter((_, i) => !drop.has(i));
}

// The plan is the biggest connected cluster of walls (length outside dense text, tables and the sheet margin),
// plus clusters of a meaningful size close to it (a balcony, a detached room).
function guessArea(walls, soft, pageW, pageH) {
  const centre = (w) => [(w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2];
  const mx = MARGIN_SHARE * pageW;
  const my = MARGIN_SHARE * pageH;
  const usable = (w) => {
    const [x, y] = centre(w);
    return !(x < mx || x > pageW - mx || y < my || y > pageH - my) && !soft.some((r) => inRect(r, x, y));
  };
  const clusters = clusterWalls(walls).map((c) => ({ ...c, score: c.idx.reduce((s, i) => s + (usable(walls[i]) ? wallLength(walls[i]) : 0), 0) }));
  const main = clusters.reduce((best, c) => (!best || c.score > best.score ? c : best), null);
  if (!main || main.score <= 0) return boxOf(walls);
  const chosen = [main];
  const second = clusters.reduce((best, c) => (c !== main && c.length > best ? c.length : best), 0);
  const dominant = main.length >= 2 * second; // otherwise no cluster clearly is "the plan": keep every sizeable one
  for (let grew = true; grew; ) {
    grew = false;
    const box = boxOf(chosen.flatMap((c) => c.idx.map((i) => walls[i])));
    for (const c of clusters) {
      if (chosen.includes(c)) continue;
      if ((!dominant && c.length >= 0.15 * main.length) || (c.length >= 0.05 * main.length && overlaps(box, c.box, 150))) {
        chosen.push(c);
        grew = true;
      }
    }
  }
  const b = boxOf(chosen.flatMap((c) => c.idx.map((i) => walls[i])));
  return { x0: b.x0 - 20, y0: b.y0 - 20, x1: b.x1 + 20, y1: b.y1 + 20 };
}

// ---------------------------------------------------------------- confidence

const ENCLOSE_REACH = 50; // cm: door openings up to ~1 m do not break an enclosed room
const ENCLOSE_FULL = 0.2; // share of the plan box that is enclosed floor which already counts as "closed"

// 0..1 from how well the walls join up, whether they enclose floor, and how little length was left outside the area.
function rateConfidence(walls, outsideShare) {
  if (walls.length === 0) return { value: 0, joined: 0, enclosed: 0, inside: 1 - outsideShare };
  const near = gridOf(walls);
  let ends = 0;
  let both = 0;
  for (const [ai, a] of walls.entries()) {
    const joined = [[a.x1, a.y1], [a.x2, a.y2]].map(([px, py]) =>
      near(px, py).some((bi) => bi !== ai && distanceToSegment(px, py, walls[bi]) <= Math.max(a.t, walls[bi].t) / 2 + 2),
    );
    ends += joined.filter(Boolean).length;
    if (joined[0] && joined[1]) both++;
  }
  const joined = 0.5 * (both / walls.length) + 0.5 * (ends / (2 * walls.length));
  const box = boxOf(walls);
  const pad = ENCLOSE_REACH + 10;
  const x0 = box.x0 - pad;
  const y0 = box.y0 - pad;
  const cell = Math.max(10, Math.max(box.x1 - box.x0, box.y1 - box.y0) / 250);
  const nx = Math.ceil((box.x1 + pad - x0) / cell) + 1;
  const ny = Math.ceil((box.y1 + pad - y0) / cell) + 1;
  const solid = new Uint8Array(nx * ny);
  const stamp = (cx, cy, r) => {
    const i0 = Math.max(0, Math.floor((cx - r - x0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((cx + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((cy - r - y0) / cell));
    const j1 = Math.min(ny - 1, Math.floor((cy + r - y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) solid[j * nx + i] = 1;
  };
  for (const w of walls) {
    const r = w.t / 2 + ENCLOSE_REACH;
    const steps = Math.max(1, Math.ceil(wallLength(w) / (cell / 2)));
    for (let s = 0; s <= steps; s++) stamp(w.x1 + ((w.x2 - w.x1) * s) / steps, w.y1 + ((w.y2 - w.y1) * s) / steps, r);
  }
  const reached = new Uint8Array(nx * ny);
  const queue = [];
  const push = (i, j) => {
    const at = j * nx + i;
    if (i < 0 || j < 0 || i >= nx || j >= ny || solid[at] || reached[at]) return;
    reached[at] = 1;
    queue.push(at);
  };
  for (let i = 0; i < nx; i++) {
    push(i, 0);
    push(i, ny - 1);
  }
  for (let j = 0; j < ny; j++) {
    push(0, j);
    push(nx - 1, j);
  }
  for (let q = 0; q < queue.length; q++) {
    const at = queue[q];
    const i = at % nx;
    const j = (at - i) / nx;
    push(i + 1, j);
    push(i - 1, j);
    push(i, j + 1);
    push(i, j - 1);
  }
  let enclosedCells = 0;
  for (let at = 0; at < solid.length; at++) if (!solid[at] && !reached[at]) enclosedCells++;
  const enclosed = clamp(enclosedCells / (nx * ny) / ENCLOSE_FULL, 0, 1);
  const inside = clamp(1 - outsideShare, 0, 1);
  let value = 0.35 * joined + 0.4 * enclosed + 0.25 * inside;
  if (enclosed < 0.15) value = Math.min(value, 0.35);
  return { value: clamp(value, 0, 1), joined, enclosed, inside };
}

// ---------------------------------------------------------------- public API

export function detectWalls(page, { cmPerUnit, area } = {}) {
  const warnings = [];
  const hasScale = Number.isFinite(cmPerUnit) && cmPerUnit > 0;
  const k = hasScale ? cmPerUnit : PT_CM * PROVISIONAL_RATIO;
  if (!hasScale) warnings.push("no_scale");
  const paths = Array.isArray(page?.paths) ? page.paths : [];
  const empty = (extra) => ({ walls: [], outside: [], areaCm: null, confidence: 0, warnings: [...warnings, ...extra], originCm: { x: 0, y: 0 }, cmPerUnit: k, arcs: [] });
  if (paths.length === 0) return empty(["no_vector"]);

  const pageW = (page.width ?? 0) * k;
  const pageH = (page.height ?? 0) * k;
  const pieces = [];
  const segs = []; // edges that may pair up into walls
  const allSegs = []; // every axis edge, for the table search
  const strokes = []; // short strokes: hatching candidates
  const boxes = [];
  const arcs = [];

  for (const path of paths) {
    const lineWidth = (Number.isFinite(path.lineWidth) ? path.lineWidth : 0) * k;
    const dark = path.fill && luminance(path.fillColor) < DARK;
    if (arcs.length < 5000) arcs.push(...curveExtents(path, k));
    for (const sub of subpaths(path, k)) {
      const pts = cleanPoly(sub.pts);
      if (dark) {
        pieces.push(...fillPieces(pts));
        continue;
      }
      if (!path.stroke || lineWidth > MAX_THICKNESS) continue;
      // A loop is closed by "Z" or by repeating its first point (cleanPoly drops the repeat).
      const closed = sub.closed || (sub.pts.length >= 4 && Math.hypot(sub.pts[0][0] - sub.pts.at(-1)[0], sub.pts[0][1] - sub.pts.at(-1)[1]) <= 0.01);
      const rect = closed ? orientedRect(pts) : null;
      if (rect) {
        const quad = pts;
        if (isAxis(rect.e0[0], rect.e0[1]) && isAxis(rect.e1[0], rect.e1[1])) {
          const xs = quad.map((p) => p[0]);
          const ys = quad.map((p) => p[1]);
          if (Math.min(rect.a, rect.b) >= 20) boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
          pushEdges(quad, true, allSegs, pageW, pageH);
        }
        const short = Math.min(rect.a, rect.b);
        const long = Math.max(rect.a, rect.b);
        if (short <= 40 && short >= MIN_THICKNESS && long >= 4 * short) pieces.push(pieceFromRect(rect));
        else if (long > 300) pushEdges(quad, true, segs, pageW, pageH);
        continue; // furniture-sized rectangles are not walls
      }
      if (lineWidth >= MIN_THICKNESS && pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) >= MIN_LENGTH) {
        pieces.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], t: lineWidth }); // a wall drawn as one fat line
        continue;
      }
      pushEdges(pts, closed, segs, pageW, pageH);
      pushEdges(pts, closed, allSegs, pageW, pageH);
      if (strokes.length < 300_000) {
        const n = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) {
          const [x1, y1] = pts[i];
          const [x2, y2] = pts[(i + 1) % pts.length];
          const len = Math.hypot(x2 - x1, y2 - y1);
          if (len >= 2 && len <= HATCH_MAX_LEN) strokes.push({ mx: (x1 + x2) / 2, my: (y1 + y2) / 2, dx: Math.abs(x2 - x1), dy: Math.abs(y2 - y1) });
        }
      }
    }
  }

  const hatchCount = hatchIndex(strokes);
  const strict = [...findTables(allSegs, hatchCount), ...borderBoxes(boxes, pageW, pageH)];
  const inStrict = (x, y) => strict.some((r) => inRect(r, x, y, 2));
  const keepSeg = (s) => (s.o === "h" ? !inStrict((s.a + s.b) / 2, s.c) : !inStrict(s.c, (s.a + s.b) / 2));
  pieces.push(...pairSegments(segs.filter(keepSeg), hatchCount));

  let walls = pieces
    .filter((p) => p && [p.x1, p.y1, p.x2, p.y2, p.t].every(Number.isFinite))
    .filter((p) => !inStrict((p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2))
    .map(snapAngle)
    .filter((w) => wallLength(w) > 0);
  walls = mergeCollinear(walls);
  walls = dropOversized(dropCrossers(walls)); // before joining, so a stray line cannot pull real wall ends onto itself
  walls = joinEnds(walls);
  walls = mergeCollinear(walls);
  walls = walls.filter((w) => wallLength(w) >= MIN_LENGTH);
  walls = dropIsolated(walls);
  walls = dropOversized(walls);

  if (walls.length === 0) return empty(["no_walls"]);

  let box;
  if (area && [area.x0, area.y0, area.x1, area.y1].every(Number.isFinite)) {
    box = { x0: Math.min(area.x0, area.x1) * k, y0: Math.min(area.y0, area.y1) * k, x1: Math.max(area.x0, area.x1) * k, y1: Math.max(area.y0, area.y1) * k };
  } else {
    box = guessArea(walls, denseTextRects(page.texts, k), pageW, pageH);
  }
  const centreIn = (w) => inRect(box, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2);
  const outsideRaw = walls.filter((w) => !centreIn(w));
  let insideRaw = walls.filter(centreIn);
  const lengthOf = (list) => list.reduce((s, w) => s + wallLength(w), 0);
  const outsideShare = lengthOf(outsideRaw) / (lengthOf(walls) || 1);

  if (insideRaw.length === 0) {
    const out = empty(["no_walls"]);
    out.areaCm = { x: Math.round(box.x0), y: Math.round(box.y0), w: Math.round(box.x1 - box.x0), h: Math.round(box.y1 - box.y0) };
    return out;
  }
  if (insideRaw.length > MAX_WALLS) {
    const keep = new Set(
      insideRaw
        .map((w, i) => [i, wallLength(w)])
        .sort((p, q) => q[1] - p[1] || p[0] - q[0])
        .slice(0, MAX_WALLS)
        .map(([i]) => i),
    );
    insideRaw = insideRaw.filter((_, i) => keep.has(i));
    warnings.push("capped");
  }

  const rating = rateConfidence(insideRaw, outsideShare);
  const thick = (w) => clamp(Math.round(w.t), MIN_THICKNESS, MAX_THICKNESS);
  const originCm = {
    x: Math.round(Math.min(...insideRaw.map((w) => Math.min(w.x1, w.x2) - thick(w) / 2))),
    y: Math.round(Math.min(...insideRaw.map((w) => Math.min(w.y1, w.y2) - thick(w) / 2))),
  };
  const shape = (w) => {
    const thickness = thick(w);
    return {
      id: uid("w"),
      x1: Math.round(w.x1 - originCm.x),
      y1: Math.round(w.y1 - originCm.y),
      x2: Math.round(w.x2 - originCm.x),
      y2: Math.round(w.y2 - originCm.y),
      thickness,
      kind: kindOf(thickness),
    };
  };
  const inRange = (w) => [w.x1, w.y1, w.x2, w.y2].every((v) => Math.abs(v) <= MAX_COORD) && wallLength(w) >= 1;
  let out = insideRaw.map(shape);
  if (!out.every(inRange)) {
    out = out.filter(inRange);
    warnings.push("out_of_range");
  }
  const outside = outsideRaw.slice(0, MAX_WALLS).map(shape).filter(inRange);
  const areaCm = { x: Math.round(box.x0 - originCm.x), y: Math.round(box.y0 - originCm.y), w: Math.round(box.x1 - box.x0), h: Math.round(box.y1 - box.y0) };
  return { walls: out, outside, areaCm, confidence: rating.value, confidenceParts: rating, warnings, originCm, cmPerUnit: k, arcs };
}

// ---------------------------------------------------------------- plan area helpers (PDF units <-> plan cm)

// A plan-cm area { x, y, w, h } of a detection result as PDF-unit corners, stable across recalibration.
export function areaToPage(areaCm, result) {
  if (!areaCm || !result) return null;
  const k = result.cmPerUnit;
  return { x0: (areaCm.x + result.originCm.x) / k, y0: (areaCm.y + result.originCm.y) / k, x1: (areaCm.x + areaCm.w + result.originCm.x) / k, y1: (areaCm.y + areaCm.h + result.originCm.y) / k };
}

export function areaFromPage(area, result) {
  if (!area || !result) return null;
  const k = result.cmPerUnit;
  return { x: Math.round(area.x0 * k - result.originCm.x), y: Math.round(area.y0 * k - result.originCm.y), w: Math.round((area.x1 - area.x0) * k), h: Math.round((area.y1 - area.y0) * k) };
}

// Walls the user switched off in `prev` stay off in `next` (a new detection after recalibration or a scale or
// area change): matched by orientation and by lying on the same spot of the page.
export function carryOverDisabled(prev, disabledIds, next) {
  const out = new Set();
  if (!prev || !next || !disabledIds?.size) return out;
  const toPage = (res, w) => ({ x1: (w.x1 + res.originCm.x) / res.cmPerUnit, y1: (w.y1 + res.originCm.y) / res.cmPerUnit, x2: (w.x2 + res.originCm.x) / res.cmPerUnit, y2: (w.y2 + res.originCm.y) / res.cmPerUnit });
  const nextWalls = next.walls.map((w) => ({ id: w.id, o: orient(w), ...toPage(next, w) }));
  const tolerance = 8; // PDF units, about 3 mm on the printed sheet
  for (const w of prev.walls) {
    if (!disabledIds.has(w.id)) continue;
    const p = toPage(prev, w);
    const o = orient(w);
    const mx = (p.x1 + p.x2) / 2;
    const my = (p.y1 + p.y2) / 2;
    let best = null;
    for (const n of nextWalls) {
      if (n.o !== o) continue;
      const d = distanceToSegment(mx, my, n);
      if (d <= tolerance && (!best || d < best.d)) best = { d, id: n.id };
    }
    if (best) out.add(best.id);
  }
  return out;
}

// ---------------------------------------------------------------- scale from shapes

const ratioPlausible = (v, lo, hi) => (v >= lo && v <= hi ? 1 : Math.max(0, 1 - Math.abs(Math.log(v < lo ? v / lo : v / hi)) / Math.log(2)));

// How believable a detection is as a real apartment at its scale: typical wall thickness (10-30 cm), door
// openings and swings (70-100 cm), room spans (2-8 m) and the size of the whole plan (6-25 m).
function plausibility(res) {
  const walls = res.walls;
  if (walls.length < 3 || !res.areaCm) return { score: 0, parts: {} };
  const total = walls.reduce((s, w) => s + wallLength(w), 0) || 1;
  const thickness = walls.filter((w) => w.thickness >= 10 && w.thickness <= 30).reduce((s, w) => s + wallLength(w), 0) / total;

  const axis = (o) => walls.filter((w) => orient(w) === o);
  let spans = 0;
  for (const o of ["h", "v"]) {
    const list = axis(o).map((w) => ({ len: wallLength(w), ...(o === "h" ? { c: w.y1, a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2) } : { c: w.x1, a: Math.min(w.y1, w.y2), b: Math.max(w.y1, w.y2) }) }));
    for (const w of list) {
      let nearest = Infinity;
      for (const q of list) {
        if (q === w || Math.abs(q.c - w.c) < 50) continue;
        if (Math.min(w.b, q.b) - Math.max(w.a, q.a) >= 100) nearest = Math.min(nearest, Math.abs(q.c - w.c));
      }
      if (nearest >= 150 && nearest <= 800) spans += w.len;
    }
  }
  const room = spans / total;

  let cues = 0;
  let good = 0;
  for (const e of res.arcs ?? []) {
    const m = Math.max(e.w, e.h);
    if (m >= 30 && m <= 150) {
      cues++;
      if (m >= 70 && m <= 100) good++;
    }
  }
  for (const o of ["h", "v"]) {
    const list = axis(o).map((w) => (o === "h" ? { c: w.y1, a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2), t: w.thickness } : { c: w.x1, a: Math.min(w.y1, w.y2), b: Math.max(w.y1, w.y2), t: w.thickness }));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i];
        const q = list[j];
        if (Math.abs(p.c - q.c) > Math.max(p.t, q.t) / 2) continue;
        const gap = Math.max(p.a, q.a) - Math.min(p.b, q.b);
        if (gap >= 30 && gap <= 150) {
          cues++;
          if (gap >= 70 && gap <= 100) good++;
        }
      }
    }
  }
  const doors = cues === 0 ? 0.5 : good / cues;
  const { w, h } = res.areaCm;
  const footprint = Math.min(ratioPlausible(Math.min(w, h), 300, 1200), ratioPlausible(Math.max(w, h), 400, 1800), ratioPlausible((w * h) / 1e4, 20, 250));
  const parts = { thickness, doors, room, footprint, cues, good };
  return { score: 0.25 * thickness + 0.25 * doors + 0.15 * room + 0.35 * footprint, parts };
}

// Suggests 1:20, 1:50 or 1:100 when no ratio text could be read. Returns { ratio, scores } (ratio null when no
// option looks like a plausible apartment). Only a suggestion: the user confirms or calibrates.
export function suggestScale(page, ratios = [20, 50, 100]) {
  const scores = ratios.map((ratio) => ({ ratio, ...plausibility(detectWalls(page, { cmPerUnit: PT_CM * ratio })) }));
  const best = scores.reduce((b, s) => (!b || s.score > b.score ? s : b), null);
  return { ratio: best && best.score >= 0.3 ? best.ratio : null, scores };
}

// Recalibration: scales coordinates and thickness by `factor` and re-classifies each wall.
export function rescale(walls, factor) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const coord = (v) => clamp(Math.round(v * f * 10) / 10, -MAX_COORD, MAX_COORD);
  return walls.map((w) => {
    const thickness = clamp(Math.round(w.thickness * f * 10) / 10, MIN_THICKNESS, MAX_THICKNESS);
    return { ...w, x1: coord(w.x1), y1: coord(w.y1), x2: coord(w.x2), y2: coord(w.y2), thickness, kind: kindOf(thickness) };
  });
}
