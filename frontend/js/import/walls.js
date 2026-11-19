// Pure wall detection for an imported vector floor plan. No DOM, no pdf.js: it works on the page
// object produced by pdf.js's readPage() ({ width, height, paths }, y down, PDF units) and returns
// walls in centimetres in the plan.js shape. Every threshold below is in cm AFTER scaling, never in
// PDF units, so 1:20, 1:50 and 1:100 drawings behave the same.

const PT_CM = 2.54 / 72; // one PDF unit at scale 1:1, in cm
const PROVISIONAL_RATIO = 50; // used for detection only when no scale was found
const MAX_WALLS = 1000;
const MAX_COORD = 100_000;
const MIN_THICKNESS = 5;
const MAX_THICKNESS = 60;
const EXTERIOR_FROM = 17;
const MIN_LENGTH = 30;
const ISOLATED_BELOW = 100;
const SNAP_DEG = 2;
const DARK = 0.55;
const MAX_POLY_POINTS = 64;
const FAR = 1e6; // subpaths reaching further than this (cm) are garbage

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

// Mutually nearest parallel segments 5..60 cm apart that overlap by at least half -> one wall each.
function pairSegments(segs) {
  const pieces = [];
  for (const o of ["h", "v"]) {
    const list = segs.filter((s) => s.o === o).sort((p, q) => p.c - q.c);
    const near = list.map(() => []); // valid partners per segment: { j, d }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].c - list[i].c <= MAX_THICKNESS; j++) {
        const d = list[j].c - list[i].c;
        if (d < MIN_THICKNESS) continue;
        const lo = Math.max(list[i].a, list[j].a);
        const hi = Math.min(list[i].b, list[j].b);
        const shorter = Math.min(list[i].b - list[i].a, list[j].b - list[j].a);
        if (hi - lo < 0.5 * shorter) continue;
        near[i].push({ j, d });
        near[j].push({ j: i, d });
      }
    }
    const best = near.map((n) => Math.min(...n.map((x) => x.d)));
    for (let i = 0; i < list.length; i++) {
      for (const { j, d } of near[i]) {
        if (j < i || d > best[i] + 1 || d > best[j] + 1) continue;
        const lo = Math.max(list[i].a, list[j].a);
        const hi = Math.min(list[i].b, list[j].b);
        const c = (list[i].c + list[j].c) / 2;
        pieces.push(o === "h" ? { x1: lo, y1: c, x2: hi, y2: c, t: d } : { x1: c, y1: lo, x2: c, y2: hi, t: d });
      }
    }
  }
  return pieces;
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
        const merged = fromAxis(cur.o, c, Math.min(cur.a, n.a), Math.max(cur.b, n.b), Math.max(cur.w.t, n.w.t));
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
  return walls.filter((w, i) => connected[i] || wallLength(w) >= ISOLATED_BELOW);
}

// ---------------------------------------------------------------- public API

export function detectWalls(page, { cmPerUnit } = {}) {
  const warnings = [];
  const hasScale = Number.isFinite(cmPerUnit) && cmPerUnit > 0;
  const k = hasScale ? cmPerUnit : PT_CM * PROVISIONAL_RATIO;
  if (!hasScale) warnings.push("no_scale");
  const paths = Array.isArray(page?.paths) ? page.paths : [];
  const empty = (extra) => ({ walls: [], confidence: 0, warnings: [...warnings, ...extra], originCm: { x: 0, y: 0 }, cmPerUnit: k });
  if (paths.length === 0) return empty(["no_vector"]);

  const pageW = (page.width ?? 0) * k;
  const pageH = (page.height ?? 0) * k;
  const pieces = [];
  const segs = [];
  let darkArea = 0;

  for (const path of paths) {
    const lineWidth = (Number.isFinite(path.lineWidth) ? path.lineWidth : 0) * k;
    const dark = path.fill && luminance(path.fillColor) < DARK;
    for (const sub of subpaths(path, k)) {
      const pts = cleanPoly(sub.pts);
      if (dark) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const covers = Math.max(...xs) - Math.min(...xs) >= 0.9 * pageW && Math.max(...ys) - Math.min(...ys) >= 0.9 * pageH;
        if (!covers && pts.length >= 3) darkArea += polyArea(pts);
        pieces.push(...fillPieces(pts));
        continue;
      }
      if (!path.stroke || lineWidth > MAX_THICKNESS) continue;
      const rect = sub.closed || pts.length === 5 ? orientedRect(pts.length === 5 ? pts.slice(0, 4) : pts) : null;
      if (rect) {
        const short = Math.min(rect.a, rect.b);
        const long = Math.max(rect.a, rect.b);
        if (short <= 40 && short >= MIN_THICKNESS && long >= 4 * short) pieces.push(pieceFromRect(rect));
        else if (long > 300) pushEdges(pts.slice(0, 4), true, segs, pageW, pageH);
        continue; // furniture-sized rectangles are not walls
      }
      if (lineWidth >= MIN_THICKNESS && pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) >= MIN_LENGTH) {
        pieces.push({ x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], t: lineWidth }); // a wall drawn as one fat line
        continue;
      }
      pushEdges(pts, sub.closed, segs, pageW, pageH);
    }
  }
  pieces.push(...pairSegments(segs));

  let walls = pieces
    .filter((p) => p && [p.x1, p.y1, p.x2, p.y2, p.t].every(Number.isFinite))
    .map(snapAngle)
    .filter((w) => wallLength(w) > 0);
  walls = mergeCollinear(walls);
  walls = joinEnds(walls);
  walls = mergeCollinear(walls);
  walls = walls.filter((w) => wallLength(w) >= MIN_LENGTH);
  walls = dropIsolated(walls);

  if (walls.length === 0) return empty(["no_walls"]);
  if (walls.length > MAX_WALLS) {
    const keep = new Set(
      walls
        .map((w, i) => [i, wallLength(w)])
        .sort((p, q) => q[1] - p[1] || p[0] - q[0])
        .slice(0, MAX_WALLS)
        .map(([i]) => i),
    );
    walls = walls.filter((_, i) => keep.has(i));
    warnings.push("capped");
  }

  const coveredArea = walls.reduce((sum, w) => sum + wallLength(w) * w.t, 0);
  const confidence = darkArea > 0 ? clamp(coveredArea / darkArea, 0, 1) : 0.6;

  const thick = (w) => clamp(Math.round(w.t), MIN_THICKNESS, MAX_THICKNESS);
  const originCm = {
    x: Math.round(Math.min(...walls.map((w) => Math.min(w.x1, w.x2) - thick(w) / 2))),
    y: Math.round(Math.min(...walls.map((w) => Math.min(w.y1, w.y2) - thick(w) / 2))),
  };
  let out = walls.map((w) => {
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
  });
  const inRange = (w) => [w.x1, w.y1, w.x2, w.y2].every((v) => Math.abs(v) <= MAX_COORD) && wallLength(w) >= 1;
  if (!out.every(inRange)) {
    out = out.filter(inRange);
    warnings.push("out_of_range");
  }
  return { walls: out, confidence, warnings, originCm, cmPerUnit: k };
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
