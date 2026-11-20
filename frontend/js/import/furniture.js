// Pure furniture detection for an imported vector floor plan. No DOM, no pdf.js: it works on the same page
// object as walls.js ({ width, height, paths, texts }, y down, PDF units) and returns furniture in the same
// plan centimetres as the walls (page cm minus the walls' originCm), in the plan.js shape
// { x, y (centre), w, d, rotation }. Every threshold is in cm AFTER scaling, never in PDF units.
//
// How it works: every stroked or filled outline is cut into straight edges (curves are flattened); edges that
// meet end to end form connected line work; line work that contains a closed loop is a candidate shape. Shapes
// inside a bigger shape are its details (pillows, cushions, a basin); shapes that look like walls, door swings,
// light fixtures or whole rooms are dropped. Each remaining shape is scored against the catalog by size (either
// orientation), shape cues (round, inner outline, diagonal, burner circles), where it stands (against a wall or
// free) and what is around it (chairs, a toilet, a bed, room labels). A score below THRESHOLD leaves the type
// null: "unidentified", which the review step only imports once the user picks a type.
import { FURNITURE_BY_TYPE } from "../catalog.js";

const PT_CM = 2.54 / 72;
const MIN_SIDE = 30; // furniture footprint, per side
const MIN_CHAIR_SIDE = 25; // a chair tucked under a table shows only part of its seat
const MAX_SIDE = 300;
const MAX_STRIP_LEN = 600; // a long, shallow counter or wardrobe run may exceed MAX_SIDE
const MAX_STRIP_DEPTH = 70;
const SNAP_TOL = 0.8; // edge ends this close are the same point
const MIN_EDGE = 0.2;
const MAX_EDGE = 350; // longer single edges are wall faces, not furniture
const MAX_LINE_WIDTH = 6; // strokes thicker than this are drawn walls
const WALL_MAX_T = 30; // detected walls up to this thick are real walls; thicker ones may be furniture
const WALL_INNER = 1.5; // edges this deep inside a wall band are hatching or glazing, not furniture
const THICK_FROM = 35; // a detected wall at least this thick may be furniture
const WALL_LOOP = 0.55; // share of a shape's outline lying on walls above which it is a room, not furniture
const THRESHOLD = 0.6; // below this the type stays null
const GAP = 0.08; // the best type must beat the runner-up by this
const MAX_ITEMS = 300;
const UNIDENTIFIED_MIN_SIDE = 35;
const UNIDENTIFIED_MIN_AREA = 2500;
const ZONE_REACH = 400; // room label reach, cm
const FAR = 1e6;

const uid = (prefix) =>
  `${prefix}_${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const luminance = (rgb) => (rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 : 1);
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- edges from paths

// Flattens a path into polylines of cm points with a per-edge "curved" flag.
function polylines(path, k) {
  const out = [];
  let cur = null;
  const add = (x, y, curved) => {
    cur.pts.push([x * k, y * k]);
    cur.curve.push(curved);
  };
  const finish = () => {
    if (cur && cur.pts.length >= 2) out.push(cur);
    cur = null;
  };
  for (const { op, pts } of path.ops ?? []) {
    if (op === "M") {
      finish();
      cur = { pts: [[pts[0] * k, pts[1] * k]], curve: [], closed: false, curved: false };
    } else if (!cur) {
      continue;
    } else if (op === "L") {
      add(pts[0], pts[1], false);
    } else if (op === "C") {
      const [x0, y0] = cur.pts.at(-1).map((v) => v / k);
      const cubic = pts.length >= 6;
      const n = cubic ? 6 : 5;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        let x;
        let y;
        if (cubic) {
          x = u * u * u * x0 + 3 * u * u * t * pts[0] + 3 * u * t * t * pts[2] + t * t * t * pts[4];
          y = u * u * u * y0 + 3 * u * u * t * pts[1] + 3 * u * t * t * pts[3] + t * t * t * pts[5];
        } else {
          x = u * u * x0 + 2 * u * t * pts[0] + t * t * pts[2];
          y = u * u * y0 + 2 * u * t * pts[1] + t * t * pts[3];
        }
        add(x, y, true);
      }
      cur.curved = true;
    } else if (op === "Z") {
      cur.closed = true;
      const [fx, fy] = cur.pts[0];
      const [lx, ly] = cur.pts.at(-1);
      if (Math.hypot(fx - lx, fy - ly) > 0.01) {
        cur.pts.push([fx, fy]);
        cur.curve.push(false);
      }
    }
  }
  finish();
  return out;
}

// Total turning along a polyline, degrees. A quarter circle turns ~90, a half circle ~180.
function turning(pts) {
  let sum = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const b = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sum += d;
  }
  return Math.abs((sum * 180) / Math.PI);
}

function extractEdges(paths, k, box) {
  const edges = [];
  const reach = 160; // an item's centre is inside the area, so its edges are within half its size of it
  for (const path of paths) {
    if (!path.stroke && !path.fill) continue;
    if (path.stroke && (Number(path.lineWidth) || 0) * k > MAX_LINE_WIDTH) continue;
    const dark = path.fill && luminance(path.fillColor) < 0.4;
    for (const sub of polylines(path, k)) {
      const closed = sub.closed || Math.hypot(sub.pts[0][0] - sub.pts.at(-1)[0], sub.pts[0][1] - sub.pts.at(-1)[1]) <= 0.01;
      if (sub.curved && !closed && turning(sub.pts) < 130) continue; // door swings and other arcs
      if (!sub.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < FAR && Math.abs(y) < FAR)) continue;
      for (let i = 0; i + 1 < sub.pts.length; i++) {
        const [x1, y1] = sub.pts[i];
        const [x2, y2] = sub.pts[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < MIN_EDGE || len > MAX_EDGE) continue;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        if (box && (mx < box.x0 - reach || mx > box.x1 + reach || my < box.y0 - reach || my > box.y1 + reach)) continue;
        edges.push({ x1, y1, x2, y2, len, curve: sub.curve[i], dark });
      }
    }
  }
  return edges;
}

// ---------------------------------------------------------------- geometry helpers

function segDistance(px, py, w) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : clamp(((px - w.x1) * dx + (py - w.y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (w.x1 + u * dx), py - (w.y1 + u * dy));
}

function hull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

function extentsAt(pts, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    const u = x * c + y * s;
    const v = -x * s + y * c;
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
  }
  return { x0, x1, y0, y1, a: x1 - x0, b: y1 - y0, area: (x1 - x0) * (y1 - y0), c, s };
}

// Oriented bounding rectangle: the axis-aligned one unless a rotated one is clearly tighter. Angles within 3
// degrees of an axis snap to it. `a` runs along `theta` (degrees, 0..90), `b` across.
function orientedBox(points) {
  const h = hull(points);
  const axis = extentsAt(h, 0);
  let best = { deg: 0, e: axis };
  const angles = new Set();
  for (let i = 0; i < Math.min(h.length, 80); i++) {
    const [x1, y1] = h[i];
    const [x2, y2] = h[(i + 1) % h.length];
    if (Math.hypot(x2 - x1, y2 - y1) < 5) continue;
    angles.add(Math.round((((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) % 90 + 90) % 90 * 10) / 10);
  }
  for (const deg of angles) {
    const e = extentsAt(h, deg);
    if (e.area < best.e.area) best = { deg, e };
  }
  if (best.deg !== 0 && (axis.area <= 1.03 * best.e.area || best.deg < 3 || best.deg > 87)) best = { deg: 0, e: axis };
  const { e } = best;
  // centre of the box in original coordinates: rotate (u, v) back
  const u = (e.x0 + e.x1) / 2;
  const v = (e.y0 + e.y1) / 2;
  return { cx: u * e.c - v * e.s, cy: u * e.s + v * e.c, a: e.a, b: e.b, theta: best.deg };
}

// Distance from a point to an oriented rectangle (0 inside).
function distToBox(px, py, box) {
  const r = (box.theta * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  const u = Math.abs(dx * Math.cos(r) + dy * Math.sin(r)) - box.a / 2;
  const v = Math.abs(-dx * Math.sin(r) + dy * Math.cos(r)) - box.b / 2;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0));
}

const insideBox = (px, py, box, pad = 0) => distToBox(px, py, box) <= pad;

// ---------------------------------------------------------------- shapes: edges that close up into loops

function buildShapes(edges) {
  // endpoints that are within SNAP_TOL are one node
  const nodeOf = new Int32Array(edges.length * 2).fill(-1);
  const cell = SNAP_TOL * 1.5;
  const grid = new Map();
  const nodes = []; // [x, y]
  const keyOf = (cx, cy) => cx * 73_856_093 + cy * 19_349_663;
  const nodeAt = (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const id of grid.get(keyOf(cx + i, cy + j)) ?? []) if (Math.hypot(nodes[id][0] - x, nodes[id][1] - y) <= SNAP_TOL) return id;
      }
    }
    const id = nodes.length;
    nodes.push([x, y]);
    const key = keyOf(cx, cy);
    (grid.get(key) ?? grid.set(key, []).get(key)).push(id);
    return id;
  };
  const links = new Map(); // "a,b" -> edge index, one per node pair
  const adj = [];
  edges.forEach((e, i) => {
    const a = nodeAt(e.x1, e.y1);
    const b = nodeAt(e.x2, e.y2);
    nodeOf[2 * i] = a;
    nodeOf[2 * i + 1] = b;
    if (a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (links.has(key)) return;
    links.set(key, i);
    (adj[a] ??= []).push([b, i]);
    (adj[b] ??= []).push([a, i]);
  });

  // components
  const comp = new Int32Array(nodes.length).fill(-1);
  const shapes = [];
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1 || !adj[s]) continue;
    const members = [];
    const stack = [s];
    comp[s] = shapes.length;
    while (stack.length) {
      const n = stack.pop();
      members.push(n);
      for (const [m] of adj[n]) {
        if (comp[m] === -1) {
          comp[m] = shapes.length;
          stack.push(m);
        }
      }
    }
    // 2-core: strip dangling lines until only the loops are left
    const degree = new Map(members.map((n) => [n, adj[n].length]));
    const dead = new Set();
    const queue = members.filter((n) => degree.get(n) <= 1);
    while (queue.length) {
      const n = queue.pop();
      if (dead.has(n)) continue;
      dead.add(n);
      for (const [m] of adj[n]) {
        if (dead.has(m)) continue;
        degree.set(m, degree.get(m) - 1);
        if (degree.get(m) <= 1) queue.push(m);
      }
    }
    const core = members.filter((n) => !dead.has(n));
    if (core.length >= 3) {
      const inCore = new Set(core);
      const coreEdges = [];
      for (const n of core) for (const [m, ei] of adj[n]) if (n < m && inCore.has(m)) coreEdges.push(ei);
      shapes.push({ nodes: core.map((n) => nodes[n]), edges: coreEdges.map((i) => edges[i]), all: members.length });
    } else shapes.push(null);
  }
  return shapes.filter(Boolean);
}

function describeShape(s) {
  const xs = s.nodes.map((p) => p[0]);
  const ys = s.nodes.map((p) => p[1]);
  const total = s.edges.reduce((sum, e) => sum + e.len, 0) || 1;
  const bbox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const obb = orientedBox(s.nodes);
  const h = hull(s.nodes);
  let hullArea = 0;
  for (let i = 0; i < h.length; i++) {
    const [x1, y1] = h[i];
    const [x2, y2] = h[(i + 1) % h.length];
    hullArea += x1 * y2 - x2 * y1;
  }
  hullArea = Math.abs(hullArea) / 2;
  return {
    ...s,
    bbox,
    obb,
    L: Math.max(obb.a, obb.b),
    S: Math.min(obb.a, obb.b),
    curvedFrac: s.edges.filter((e) => e.curve).reduce((sum, e) => sum + e.len, 0) / total,
    ring: s.edges.filter((e) => e.curve).reduce((sum, e) => sum + e.len, 0) >= 2.6 * Math.min(obb.a, obb.b), // a full circle or oval outline, even with strokes attached
    straightEdges: s.edges.filter((e) => !e.curve).length,
    dark: s.edges.filter((e) => e.dark).length > s.edges.length / 2,
    fill: hullArea / (obb.a * obb.b || 1),
    perimeter: total,
  };
}

// ---------------------------------------------------------------- walls as context

function wallBands(walls, origin) {
  const list = [...(walls?.walls ?? []), ...(walls?.outside ?? [])].map((w) => ({
    id: w.id,
    x1: w.x1 + origin.x,
    y1: w.y1 + origin.y,
    x2: w.x2 + origin.x,
    y2: w.y2 + origin.y,
    t: w.thickness ?? 10,
  }));
  return list;
}

// ---------------------------------------------------------------- room labels

// Hebrew labels may be extracted in visual order (reversed), so both spellings are accepted.
const words = (list, latin) => new RegExp([...list, ...list.map((w) => [...w].reverse().join("")), latin].join("|"), "i");
const ZONES = {
  kitchen: words(["מטבח"], "kitchen"),
  bath: words(["שירותים", "שרותים", "אמבט", "מקלחת", "מקלחון", "רחצה"], "\\bwc\\b|bath|toilet|shower"),
  bed: words(["שינה", "הורים", "ילדים"], "bedroom|\\bbed\\b"),
  work: words(["עבודה", "משרד"], "study|office|desk"),
  living: words(["סלון"], "living|lounge"),
  dining: words(["אוכל"], "dining"),
};

function labelsOf(texts, k) {
  const out = [];
  for (const t of texts ?? []) {
    if (typeof t?.str !== "string" || !Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    for (const [zone, re] of Object.entries(ZONES)) if (re.test(t.str)) out.push({ zone, x: t.x * k, y: t.y * k });
  }
  return out;
}

// ---------------------------------------------------------------- scoring

const fit = (v, lo, hi, soft = 0.15) => (v >= lo && v <= hi ? 1 : v < lo ? Math.max(0, 1 - (lo - v) / (soft * lo)) : Math.max(0, 1 - (v - hi) / (soft * hi)));
const both = (f, L, S, soft = 0.15) => Math.min(fit(f.L, L[0], L[1], soft), fit(f.S, S[0], S[1], soft));
const cue = (size, factor, bonus = 0) => (size < 0.4 ? size * factor : clamp(size * factor + bonus, 0, 1));

// f: shape features (L >= S, cm) and context. Returns a score 0..1 per catalog type.
function scores(f) {
  const square = f.aspect <= 1.3;
  const wallOr = (a, b) => (f.wall ? a : b);
  const s = {};
  const oval = f.curved || f.innerCurved > 0;

  s.toilet = cue(both(f, [52, 74], [32, 50], 0.08) * (f.aspect >= 1.2 ? 1 : 0.5), oval ? 1 : 0.55, f.bath ? 0.1 : 0);
  s.bathtub = cue(both(f, [140, 200], [62, 85]), f.innerCurved > 0 || f.rounded ? 1 : 0.62, f.bath ? 0.2 : 0);
  s.shower = cue(both(f, [75, 110], [75, 110]) * (square ? 1 : 0), f.diag || f.innerCurved > 0 || f.circles > 0 ? 1 : 0.5, f.bath ? 0.2 : 0);
  s.stove = cue(both(f, [50, 70], [50, 70]) * (square ? 1 : 0), f.circles >= 3 ? 1 : f.circles >= 1 ? 0.75 : 0.4, f.kitchen ? 0.15 : 0);
  s.fridge = cue(both(f, [55, 85], [55, 85]) * (square ? 1 : 0), f.circles >= 2 ? 0.3 : f.kitchen ? 1 : wallOr(0.7, 0.55));
  s.armchair = cue(both(f, [65, 105], [65, 105]) * (f.aspect <= 1.35 ? 1 : 0), f.inner >= 1 || f.curved ? 1 : f.hatch ? 0.85 : 0.5, f.living ? 0.1 : 0);
  s.chair = cue(both(f, [36, 58], f.tableNear ? [25, 58] : [36, 58]) * (f.aspect <= (f.tableNear ? 1.9 : 1.3) ? 1 : 0), f.tableNear ? 1 : 0.7);
  const basin = f.innerCurved > 0 || f.inner > 0 || (f.circles > 0 && f.circles < 3);
  const sinkSize = both(f, [55, 95], [35, 62]);
  const basinCue = basin || f.curved ? (f.bath && !f.kitchen ? 0.7 : 1) : 0.4;
  s.sink = cue(Math.max(sinkSize, f.curved && f.L <= 62 && f.L >= 28 ? (f.bath || f.kitchen ? 0.85 : 0.45) : 0), basinCue, f.kitchen && !f.bath ? 0.2 : 0);
  s.vanity = cue(both(f, [55, 120], [38, 60]), basin ? 1 : 0.45, f.bath ? 0.3 : -0.2);
  s["double-bed"] = cue(both(f, [185, 215], [138, 205]), f.inner >= 1 ? 1 : 0.85);
  s["single-bed"] = cue(both(f, [185, 215], [78, 105]), f.inner === 1 ? 1 : f.inner === 0 ? 0.85 : 0.7);
  s.sofa = cue(both(f, [150, 300], [75, 105]) * (f.chairsAround >= 2 ? 0.45 : 1), f.inner >= 2 ? 1 : f.inner === 1 ? 0.75 : 0.65, f.living ? 0.1 : 0);
  const roundTable = f.curved && f.aspect <= 1.2 && f.L >= 90 && f.L <= 150;
  s["dining-table"] = cue(Math.max(both(f, [120, 240], [75, 115]), roundTable ? 1 : 0), f.chairsAround >= 2 || f.dining ? 1 : f.chairsAround === 1 ? 0.7 : 0.45);
  s["coffee-table"] = cue(both(f, [55, 130], [38, 80]), f.free && f.sofaNear ? 1 : f.free ? 0.6 : 0.4, f.bath || f.kitchen ? -0.4 : 0);
  s["tv-unit"] = cue(both(f, [110, 230], [32, 52]), wallOr(1, 0.65));
  s.desk = cue(both(f, [95, 165], [48, 82]), wallOr(0.85, 0.55), f.work ? 0.15 : 0);
  s.wardrobe = cue(both(f, [90, 320], [50, 68]), wallOr(0.85, 0.5), (f.bed ? 0.15 : 0) - (f.kitchen ? 0.2 : 0));
  s["kitchen-counter"] = cue(both(f, [90, 600], [52, 68]), wallOr(0.85, 0.5), (f.kitchen ? 0.2 : 0) - (f.bed ? 0.1 : 0));
  s["kitchen-island"] = cue(both(f, [110, 320], [70, 125]) * (f.chairsAround >= 2 ? 0.6 : 1), f.free ? (f.kitchen ? 1 : 0.45) : f.kitchen ? 0.75 : 0.35);
  return s;
}

function bestType(sc) {
  const ranked = Object.entries(sc).sort((p, q) => q[1] - p[1]);
  const [type, score] = ranked[0];
  const second = ranked.find(([t, v], i) => i > 0 && t !== type)?.[1] ?? 0;
  if (score < THRESHOLD || score - second < GAP) return { type: null, score: Math.round(score * 100) / 100 };
  return { type, score: Math.round(score * 100) / 100 };
}

// Sizes for a type: the box side nearer the catalog width becomes w, the other d; the angle follows.
export function fitToType(item, type) {
  const spec = FURNITURE_BY_TYPE.get(type);
  const { w, d, rotation } = item;
  if (!spec) return { w, d, rotation };
  const keep = Math.abs(w - spec.w) + Math.abs(d - spec.d);
  const swap = Math.abs(d - spec.w) + Math.abs(w - spec.d);
  if (keep <= swap) return { w, d, rotation };
  return { w: d, d: w, rotation: (rotation + 90) % 180 };
}

// ---------------------------------------------------------------- furniture standing against a wall

// Drawings often leave out the side of a counter or cabinet run that lies on the wall: only the two ends and the
// front are drawn. Axis segments (merged when they continue each other) give { c: coordinate across, a, b }.
function axisSegments(edges, horizontal) {
  const raw = [];
  for (const e of edges) {
    if (e.curve || e.len < 8) continue;
    const dx = Math.abs(e.x2 - e.x1);
    const dy = Math.abs(e.y2 - e.y1);
    if (horizontal ? dy > 0.02 * dx + 0.5 : dx > 0.02 * dy + 0.5) continue;
    raw.push(horizontal ? { c: (e.y1 + e.y2) / 2, a: Math.min(e.x1, e.x2), b: Math.max(e.x1, e.x2) } : { c: (e.x1 + e.x2) / 2, a: Math.min(e.y1, e.y2), b: Math.max(e.y1, e.y2) });
  }
  raw.sort((p, q) => p.c - q.c);
  const out = [];
  for (let i = 0; i < raw.length; ) {
    let j = i + 1;
    while (j < raw.length && raw[j].c - raw[j - 1].c <= 1) j++;
    const cluster = raw.slice(i, j).sort((p, q) => p.a - q.a);
    let cur = null;
    for (const seg of cluster) {
      if (cur && seg.a <= cur.b + 1.5) cur.b = Math.max(cur.b, seg.b);
      else {
        if (cur) out.push(cur);
        cur = { c: seg.c, a: seg.a, b: seg.b };
      }
    }
    if (cur) out.push(cur);
    i = j;
  }
  return out;
}

// Rectangles { u0, u1, w0, w1 } (u along the wall, w away from it) bounded by a wall face, two drawn ends that
// leave the face at right angles, and a drawn front line (or another wall face, for a run between two walls).
// `across`: segments running across the wall, `along`: segments parallel to it, `faces`: { c, a, b, dir }.
function wallRuns(faces, across, along, otherFaces) {
  const out = [];
  const TOL = 3;
  for (const f of faces) {
    const ends = across.filter((v) => v.c >= f.a - TOL && v.c <= f.b + TOL && (f.dir > 0 ? Math.abs(v.a - f.c) <= TOL && v.b - f.c >= MIN_SIDE - 5 : Math.abs(v.b - f.c) <= TOL && f.c - v.a >= MIN_SIDE - 5));
    const groups = new Map();
    for (const v of ends) {
      const depth = f.dir > 0 ? v.b - f.c : f.c - v.a;
      const key = Math.round(depth / 4);
      (groups.get(key) ?? groups.set(key, []).get(key)).push({ x: v.c, depth });
    }
    for (const list of groups.values()) {
      list.sort((p, q) => p.x - q.x);
      for (let i = 0; i < list.length; ) {
        let j = i + 1;
        while (j < list.length && list[j].x - list[j - 1].x <= MAX_SIDE) j++;
        const run = list.slice(i, j);
        i = j;
        if (run.length < 2) continue;
        const x0 = run[0].x;
        const x1 = run.at(-1).x;
        const depth = run.reduce((sum, r) => sum + r.depth, 0) / run.length;
        if (x1 - x0 < MIN_SIDE - 5 || x1 - x0 > MAX_STRIP_LEN || depth > MAX_SIDE) continue;
        const front = f.c + f.dir * depth;
        const covered = (segs, level) => segs.some((q) => Math.abs(q.c - level) <= TOL && Math.min(q.b, x1) - Math.max(q.a, x0) >= 0.85 * (x1 - x0));
        if (!covered(along, front) && !covered(otherFaces, front)) continue;
        out.push({ u0: x0, u1: x1, w0: Math.min(f.c, front), w1: Math.max(f.c, front) });
      }
    }
  }
  return out;
}

function faceRects(edges, real) {
  const H = axisSegments(edges, true);
  const V = axisSegments(edges, false);
  const hFaces = [];
  const vFaces = [];
  for (const w of real) {
    const dx = Math.abs(w.x2 - w.x1);
    const dy = Math.abs(w.y2 - w.y1);
    if (w.t < 4) continue;
    if (dy <= 0.02 * dx + 0.5) {
      const a = Math.min(w.x1, w.x2);
      const b = Math.max(w.x1, w.x2);
      const y = (w.y1 + w.y2) / 2;
      hFaces.push({ c: y - w.t / 2, a, b, dir: -1 }, { c: y + w.t / 2, a, b, dir: 1 });
    } else if (dx <= 0.02 * dy + 0.5) {
      const a = Math.min(w.y1, w.y2);
      const b = Math.max(w.y1, w.y2);
      const x = (w.x1 + w.x2) / 2;
      vFaces.push({ c: x - w.t / 2, a, b, dir: -1 }, { c: x + w.t / 2, a, b, dir: 1 });
    }
  }
  const out = [];
  for (const r of wallRuns(hFaces, V, H, hFaces)) out.push({ x0: r.u0, x1: r.u1, y0: r.w0, y1: r.w1 });
  for (const r of wallRuns(vFaces, H, V, vFaces)) out.push({ x0: r.w0, x1: r.w1, y0: r.u0, y1: r.u1 });
  return out;
}

// ---------------------------------------------------------------- public API

export function detectFurniture(page, { cmPerUnit, areaPage, walls } = {}) {
  const warnings = [];
  const empty = (extra) => ({ items: [], wallsExplained: [], warnings: [...warnings, ...extra] });
  if (!Number.isFinite(cmPerUnit) || !(cmPerUnit > 0)) return empty(["no_scale"]);
  const k = cmPerUnit;
  const paths = Array.isArray(page?.paths) ? page.paths : [];
  if (paths.length === 0) return empty([]);
  const origin = walls?.originCm ?? { x: 0, y: 0 };

  let area = null;
  if (areaPage && [areaPage.x0, areaPage.y0, areaPage.x1, areaPage.y1].every(Number.isFinite)) {
    area = { x0: Math.min(areaPage.x0, areaPage.x1) * k, y0: Math.min(areaPage.y0, areaPage.y1) * k, x1: Math.max(areaPage.x0, areaPage.x1) * k, y1: Math.max(areaPage.y0, areaPage.y1) * k };
  } else if (walls?.areaCm) {
    const a = walls.areaCm;
    area = { x0: a.x + origin.x, y0: a.y + origin.y, x1: a.x + a.w + origin.x, y1: a.y + a.h + origin.y };
  }
  if (!area) return empty(["no_area"]);
  const inArea = (x, y) => x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;

  const bands = wallBands(walls, origin);
  const real = bands.filter((w) => w.t <= WALL_MAX_T);

  // 1. edges, minus what sits inside a real wall (hatching, glazing)
  let edges = extractEdges(paths, k, area);
  if (real.length) {
    edges = edges.filter((e) => {
      for (const w of real) {
        const lim = w.t / 2 - WALL_INNER;
        if (lim > 0 && segDistance(e.x1, e.y1, w) <= lim && segDistance(e.x2, e.y2, w) <= lim) return false;
      }
      return true;
    });
  }

  // 2. shapes
  const shapes = buildShapes(edges).map(describeShape);
  const sizeOk = (s) => s.L <= MAX_SIDE || (s.S <= MAX_STRIP_DEPTH && s.L <= MAX_STRIP_LEN);
  const loopSmall = (s) => s.L < MIN_SIDE;
  const tooThin = (s) => s.S < MIN_SIDE && !(s.L <= 58 && s.S >= MIN_CHAIR_SIDE); // only chair-like shapes may be thinner than 30
  const onWalls = (s) => {
    if (!real.length) return 0;
    let on = 0;
    for (const e of s.edges) {
      const mx = (e.x1 + e.x2) / 2;
      const my = (e.y1 + e.y2) / 2;
      if (real.some((w) => Math.abs(segDistance(mx, my, w) - w.t / 2) <= 3 || segDistance(mx, my, w) <= w.t / 2)) on += e.len;
    }
    return on / s.perimeter;
  };

  // spatial index of every remaining edge midpoint, for the cues inside a shape
  const CELL = 50;
  const grid = new Map();
  edges.forEach((e, i) => {
    const key = `${Math.floor((e.x1 + e.x2) / 2 / CELL)},${Math.floor((e.y1 + e.y2) / 2 / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)).push(i);
  });
  const edgesIn = (bb, fn) => {
    for (let cx = Math.floor(bb.x0 / CELL); cx <= Math.floor(bb.x1 / CELL); cx++) {
      for (let cy = Math.floor(bb.y0 / CELL); cy <= Math.floor(bb.y1 / CELL); cy++) {
        for (const i of grid.get(`${cx},${cy}`) ?? []) {
          const e = edges[i];
          const mx = (e.x1 + e.x2) / 2;
          const my = (e.y1 + e.y2) / 2;
          if (mx >= bb.x0 && mx <= bb.x1 && my >= bb.y0 && my <= bb.y1) fn(e);
        }
      }
    }
  };

  const small = shapes.filter(loopSmall); // burner rings, basins, pillows too small to be items
  const cands = shapes
    .filter((s) => !loopSmall(s) && s.S >= MIN_CHAIR_SIDE && s.L >= MIN_SIDE && sizeOk(s) && inArea(s.obb.cx, s.obb.cy))
    .filter((s) => !tooThin(s) && s.fill >= 0.35 && onWalls(s) < WALL_LOOP);

  // Thick "walls" that are really furniture: a counter or wardrobe run drawn with hatching reads as a 60 cm wall.
  for (const w of walls?.walls ?? []) {
    if (w.thickness < THICK_FROM || w.thickness > MAX_STRIP_DEPTH) continue;
    const x1 = w.x1 + origin.x;
    const y1 = w.y1 + origin.y;
    const x2 = w.x2 + origin.x;
    const y2 = w.y2 + origin.y;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < MIN_SIDE || length > MAX_STRIP_LEN || !inArea((x1 + x2) / 2, (y1 + y2) / 2)) continue;
    const theta = ((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 180) % 180;
    const deg = theta % 90;
    const obb = { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, a: length, b: w.thickness, theta: deg < 1 || deg > 89 ? 0 : deg };
    const half = Math.hypot(length / 2, w.thickness / 2);
    const axisAligned = obb.theta === 0;
    // axis walls: a is the extent along x
    const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
    if (axisAligned) {
      obb.a = horizontal ? length : w.thickness;
      obb.b = horizontal ? w.thickness : length;
    }
    const bbox = axisAligned
      ? { x0: obb.cx - obb.a / 2, y0: obb.cy - obb.b / 2, x1: obb.cx + obb.a / 2, y1: obb.cy + obb.b / 2 }
      : { x0: obb.cx - half, y0: obb.cy - half, x1: obb.cx + half, y1: obb.cy + half };
    const L = Math.max(obb.a, obb.b);
    const S = Math.min(obb.a, obb.b);
    cands.push({ nodes: [], edges: [], all: 0, bbox, obb, L, S, curvedFrac: 0, dark: false, fill: 1, perimeter: 2 * (L + S), wallId: w.id });
  }

  // Runs of cabinets or counters whose back is the wall.
  for (const r of faceRects(edges, real)) {
    const a = r.x1 - r.x0;
    const b = r.y1 - r.y0;
    const L = Math.max(a, b);
    const S = Math.min(a, b);
    const obb = { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, a, b, theta: 0 };
    if (S < MIN_SIDE || !sizeOk({ L, S }) || !inArea(obb.cx, obb.cy)) continue;
    cands.push({ nodes: [], edges: [], all: 0, bbox: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, obb, L, S, curvedFrac: 0, dark: false, fill: 1, perimeter: 2 * (a + b) });
  }

  // 3. cues inside a shape: hatching, diagonals, a cross; light fixtures are dropped here
  const cuesOf = (s) => {
    const inner = { diag: false, hatch: false, cross: 0, dense: 0 };
    const bins = new Map();
    let diags = 0;
    const ownEdges = new Set(s.edges);
    const r = (s.obb.theta * Math.PI) / 180;
    edgesIn({ x0: s.bbox.x0 + 1, y0: s.bbox.y0 + 1, x1: s.bbox.x1 - 1, y1: s.bbox.y1 - 1 }, (e) => {
      if (e.len >= 0.7 * s.L && !e.curve && Math.hypot((e.x1 + e.x2) / 2 - s.obb.cx, (e.y1 + e.y2) / 2 - s.obb.cy) < 0.2 * s.L) inner.cross += 1;
      if (ownEdges.has(e)) return;
      inner.dense += 1;
      if (e.curve) return;
      const ang = ((Math.atan2(e.y2 - e.y1, e.x2 - e.x1) - r) * 180) / Math.PI;
      const rel = ((ang % 90) + 90) % 90;
      const off = Math.min(rel, 90 - rel);
      if (off > 12 && e.len >= 0.45 * s.S) diags += 1;
      if (e.len <= 0.9 * s.L) {
        const bin = Math.round((((ang % 180) + 180) % 180) / 5);
        bins.set(bin, (bins.get(bin) ?? 0) + 1);
      }
    });
    inner.hatch = [...bins.values()].some((n) => n >= 6);
    inner.diag = !inner.hatch && diags >= 1 && diags <= 3;
    return inner;
  };

  const isLight = (s, c) => (s.curvedFrac >= 0.6 || s.ring) && s.L / s.S <= 1.25 && s.L >= 18 && s.L <= 80 && (s.dark || s.straightEdges >= 8 || c.hatch || c.cross >= 2 || c.dense >= 10);

  const kept = [];
  for (const s of cands) {
    const c = cuesOf(s);
    if (isLight(s, c)) continue;
    kept.push({ ...s, cues: c });
  }

  // 4. nesting: shapes inside a bigger shape are its details; a shape holding a real item is a container (rug, room)
  kept.sort((p, q) => q.L * q.S - p.L * p.S);
  const absorbed = new Set();
  const dropped = new Set();
  const inside = (a, b) => a.bbox.x0 >= b.bbox.x0 - 1.5 && a.bbox.y0 >= b.bbox.y0 - 1.5 && a.bbox.x1 <= b.bbox.x1 + 1.5 && a.bbox.y1 <= b.bbox.y1 + 1.5;
  kept.forEach((outer, i) => {
    if (absorbed.has(i) || dropped.has(i)) return;
    const contained = [];
    for (let j = i + 1; j < kept.length; j++) if (!absorbed.has(j) && !dropped.has(j) && inside(kept[j], outer)) contained.push(j);
    if (contained.some((j) => kept[j].S >= 70 && kept[j].L * kept[j].S <= 0.45 * outer.L * outer.S)) {
      dropped.add(i);
      return;
    }
    outer.kids = contained.map((j) => kept[j]);
    for (const j of contained) absorbed.add(j);
  });
  const roots = kept.filter((_, i) => !absorbed.has(i) && !dropped.has(i));

  // 5. features per item
  const labels = labelsOf(page.texts, k);
  // The nearest room label (within reach) names the room an item stands in; every other label is ignored.
  const zoneAt = (x, y) => {
    let best = null;
    for (const l of labels) {
      const d = Math.hypot(l.x - x, l.y - y);
      if (d <= ZONE_REACH && (!best || d < best.d)) best = { d, zone: l.zone };
    }
    return best?.zone ?? null;
  };
  const wallFaceDistance = (px, py) => {
    let best = Infinity;
    for (const w of real) best = Math.min(best, segDistance(px, py, w) - w.t / 2);
    return best;
  };
  const againstWall = (s) => {
    const { cx, cy, a, b, theta } = s.obb;
    const r = (theta * Math.PI) / 180;
    const ux = [Math.cos(r), Math.sin(r)]; // a runs along ux, b along vx
    const vx = [-Math.sin(r), Math.cos(r)];
    // each side: outward normal, its distance from the centre, the tangent and its length
    const sides = [[ux, a / 2, vx, b], [ux, -a / 2, vx, b], [vx, b / 2, ux, a], [vx, -b / 2, ux, a]];
    for (const [normal, dist, tangent, len] of sides) {
      const n = Math.max(3, Math.floor(len / 15));
      const out = dist + Math.sign(dist) * 3;
      let hit = 0;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * len;
        if (wallFaceDistance(cx + tangent[0] * t + normal[0] * out, cy + tangent[1] * t + normal[1] * out) <= 4) hit++;
      }
      if (hit / n >= 0.6) return true;
    }
    return false;
  };

  const smallIn = (s, test) => small.filter((q) => q.obb.cx >= s.bbox.x0 && q.obb.cx <= s.bbox.x1 && q.obb.cy >= s.bbox.y0 && q.obb.cy <= s.bbox.y1 && test(q));
  const featuresOf = (s) => {
    const kids = s.kids ?? [];
    const rings = smallIn(s, (q) => q.curvedFrac >= 0.7 && q.L >= 5 && q.L <= 30).length + kids.filter((q) => q.curvedFrac >= 0.7 && q.L <= 30).length;
    const innerCurved = kids.filter((q) => q.curvedFrac >= 0.5 && q.L >= 20).length + smallIn(s, (q) => q.curvedFrac >= 0.5 && q.L >= 20).length;
    const inner = kids.length + smallIn(s, (q) => q.L >= 15).length;
    const wall = real.length > 0 && againstWall(s);
    return {
      L: s.L,
      S: s.S,
      aspect: s.L / Math.max(s.S, 1),
      curved: s.curvedFrac >= 0.6 || (s.ring && s.straightEdges < 8),
      rounded: s.curvedFrac > 0.03,
      inner,
      innerCurved,
      circles: rings,
      diag: s.cues.diag,
      hatch: s.cues.hatch,
      wall,
      free: !wall,
      chairsAround: 0,
      tableNear: false,
      sofaNear: false,
      bath: false,
      kitchen: false,
      bed: false,
      living: false,
      dining: false,
      work: false,
    };
  };

  const items = roots.map((s) => ({ shape: s, f: featuresOf(s) }));
  const chairLike = (it) => it.f.L >= 36 && it.f.L <= 58 && it.f.S >= 25 && it.f.aspect <= 1.9;
  const tableLike = (it) => it.f.S >= 70 && ((it.f.aspect <= 1.2 && it.f.curved && it.f.L >= 90) || (it.f.L >= 120 && it.f.L <= 240));
  for (const it of items) {
    const { cx, cy } = it.shape.obb;
    it.zone = zoneAt(cx, cy);
    for (const zone of ["bath", "kitchen", "bed", "living", "dining", "work"]) it.f[zone] = it.zone === zone;
  }
  // chairs around tables
  for (const t of items.filter(tableLike)) {
    t.f.chairsAround = items.filter((c) => c !== t && chairLike(c) && distToBox(c.shape.obb.cx, c.shape.obb.cy, t.shape.obb) <= 45).length;
    for (const c of items) if (c !== t && chairLike(c) && distToBox(c.shape.obb.cx, c.shape.obb.cy, t.shape.obb) <= 45) c.f.tableNear = true;
  }

  // first pass without anchors, then context from confident anchors
  const first = items.map((it) => bestType(scores(it.f)));
  const anchors = items.map((it, i) => ({ i, type: first[i].score >= 0.75 ? first[i].type : null, x: it.shape.obb.cx, y: it.shape.obb.cy }));
  const near = (types, it, reach) => anchors.some((a) => a.type && types.includes(a.type) && items[a.i] !== it && Math.hypot(a.x - it.shape.obb.cx, a.y - it.shape.obb.cy) <= reach);
  for (const it of items) {
    if (!it.zone) {
      // no label near: guess the room from what stands around
      it.f.bath = near(["toilet", "bathtub", "shower"], it, 400);
      it.f.kitchen = near(["stove", "fridge", "kitchen-island"], it, 400) || it.f.circles >= 2;
      it.f.bed = near(["double-bed", "single-bed"], it, 450);
    }
    it.f.sofaNear = near(["sofa"], it, 250);
  }

  const result = [];
  for (const it of items) {
    const s = it.shape;
    const sc = scores(it.f);
    const { type, score } = bestType(sc);
    const unidentifiedOk = s.S >= UNIDENTIFIED_MIN_SIDE && s.L * s.S >= UNIDENTIFIED_MIN_AREA;
    if (!type && !unidentifiedOk) continue;
    const base = { w: s.obb.a, d: s.obb.b, rotation: s.obb.theta };
    const fitted = type ? fitToType(base, type) : base;
    result.push({
      id: uid("f"),
      type,
      score,
      x: round1(s.obb.cx - origin.x),
      y: round1(s.obb.cy - origin.y),
      w: round1(fitted.w),
      d: round1(fitted.d),
      rotation: round1(fitted.rotation),
      source: "auto",
    });
  }
  let out = result;
  if (out.length > MAX_ITEMS) {
    out = [...out].sort((p, q) => q.w * q.d - p.w * p.d).slice(0, MAX_ITEMS);
    warnings.push("furniture_capped");
  }

  // 6. detected walls that are really an identified item (a counter or sofa read as a thick wall)
  const wallsExplained = [];
  for (const w of walls?.walls ?? []) {
    const wx1 = w.x1 + origin.x;
    const wy1 = w.y1 + origin.y;
    const wx2 = w.x2 + origin.x;
    const wy2 = w.y2 + origin.y;
    const length = Math.hypot(wx2 - wx1, wy2 - wy1);
    if (length < 1) continue;
    const hit = out.find((f) => {
      if (!f.type) return false;
      const box = { cx: f.x + origin.x, cy: f.y + origin.y, a: f.w, b: f.d, theta: f.rotation };
      if (length > Math.max(f.w, f.d) + 8 || w.thickness > Math.min(f.w, f.d) + 8) return false;
      const n = Math.max(2, Math.ceil(length / 10));
      let inside = 0;
      for (let i = 0; i <= n; i++) if (insideBox(wx1 + ((wx2 - wx1) * i) / n, wy1 + ((wy2 - wy1) * i) / n, box, 3)) inside++;
      return inside / (n + 1) >= 0.8 && (w.thickness >= 25 || length <= Math.max(f.w, f.d));
    });
    if (hit) wallsExplained.push(w.id);
  }
  return { items: out, wallsExplained, warnings };
}

// ---------------------------------------------------------------- after a new detection

// What the user chose in `prev` (a Map id -> { on?, type? }) is carried to the nearest item of `next` that lies
// on the same spot of the page (positions compared in PDF units, so a change of scale keeps the match).
export function carryOverChoices(prevItems, prevCtx, choices, nextItems, nextCtx) {
  const out = new Map();
  if (!choices?.size || !prevItems?.length || !nextItems?.length) return out;
  const toPage = (ctx, f) => [(f.x + ctx.originCm.x) / ctx.cmPerUnit, (f.y + ctx.originCm.y) / ctx.cmPerUnit];
  const next = nextItems.map((f) => ({ id: f.id, p: toPage(nextCtx, f) }));
  const taken = new Set();
  const tolerance = 12; // PDF units, about 4 mm on the printed sheet
  for (const f of prevItems) {
    const choice = choices.get(f.id);
    if (!choice) continue;
    const p = toPage(prevCtx, f);
    let best = null;
    for (const n of next) {
      if (taken.has(n.id)) continue;
      const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
      if (d <= tolerance && (!best || d < best.d)) best = { d, id: n.id };
    }
    if (best) {
      taken.add(best.id);
      out.set(best.id, choice);
    }
  }
  return out;
}

// The plan.furniture entries for the items the user keeps: measured size and rotation, no catalog defaults.
export function toPlanFurniture(items, chosen) {
  return items.flatMap((f) => {
    const type = chosen(f);
    if (!type || !FURNITURE_BY_TYPE.has(type)) return [];
    const fitted = type === f.type ? { w: f.w, d: f.d, rotation: f.rotation } : fitToType(f, type);
    return [{ id: f.id, type, x: f.x, y: f.y, w: fitted.w, d: fitted.d, rotation: fitted.rotation }];
  });
}
