// The canonical 2D plan and every edit to it. Pure functions: a plan is never mutated,
// each edit returns a new plan (which is what makes undo and versioning trivial).
// Units are centimetres, origin top-left, y grows downward. Furniture x/y is the item's centre.
// The backend validates the same shape in backend/app/schemas.py.

export const GRID = 10;
export const MIN_WALL = 10;
const THICKNESS = { exterior: 20, partition: 10 };
const OPENING_WIDTH = { door: 80, window: 120 };
const ROW_WIDTH = 1500; // wizard rooms wrap to a new row past this
const POSITIVE = new Set(["w", "d", "width", "thickness"]);

export const snap = (value, grid = GRID) => Math.round(value / grid) * grid;
export const wallLength = (wall) => Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
// getRandomValues works on plain HTTP too (randomUUID needs a secure context), e.g. when testing from a phone on the LAN.
const uid = (prefix) => `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(5)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

export const emptyPlan = () => ({ schema: 1, units: "cm", rooms: [], walls: [], openings: [], furniture: [] });

// Keeps every opening inside its wall and drops openings whose wall is gone.
function normalize(plan) {
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const openings = plan.openings.flatMap((opening) => {
    const wall = walls.get(opening.wallId);
    if (!wall) return [];
    const length = wallLength(wall);
    const width = Math.min(opening.width, length);
    const offset = clamp(opening.offset, 0, length - width);
    return [width === opening.width && offset === opening.offset ? opening : { ...opening, width, offset }];
  });
  return { ...plan, openings };
}

// Templates use fractions of the full bounding width and length. A stretched hexagon
// is intentionally not described as regular.
export const roomTemplates = {
  rectangle: [[0,0],[1,0],[1,1],[0,1]],
  hexagon: [[.25,0],[.75,0],[1,.5],[.75,1],[.25,1],[0,.5]],
  chamfer: [[0,0],[.65,0],[1,.35],[1,1],[0,1]],
  notch: [[0,0],[1,0],[1,.5],[.5,.5],[.5,1],[0,1]],
};

function polygonArea(points) {
  return Math.abs(points.reduce((sum,[x,y],i)=>{
    const [nx,ny]=points[(i+1)%points.length];
    return sum+x*ny-y*nx;
  },0))/2;
}

export function templateArea(shape,width,length) {
  return shape==="ellipse" ? ellipseArea(width,length) :
    polygonArea(roomTemplates[shape] ?? roomTemplates.rectangle)*width*length/10000;
}

export function addRoom(plan, { name, type, width, length, shape, rotation=0 }, x, y) {
  const room = { id: uid("r"), name, type };
  if (shape === "ellipse") {
    room.ellipse = {cx:x+width/2, cy:y+length/2, width, length, rotation};
    return {...plan, rooms:[...plan.rooms,room]};
  }
  const template = roomTemplates[shape] ?? roomTemplates.rectangle;
  const angle = rotation*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
  const corners = template.map(([u,v])=>{
    const dx=(u-.5)*width, dy=(v-.5)*length;
    return [x+width/2+dx*c-dy*s,y+length/2+dx*s+dy*c];
  });
  const walls = corners.map(([x1, y1], i) => {
    const [x2, y2] = corners[(i + 1) % corners.length];
    return { id: uid("w"), x1, y1, x2, y2, thickness: THICKNESS.exterior, kind: "exterior", roomId: room.id };
  });
  return { ...plan, rooms: [...plan.rooms, room], walls: [...plan.walls, ...walls] };
}

export function fromRooms(rooms) {
  let plan = emptyPlan();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const room of rooms) {
    if (x > 0 && x + room.width > ROW_WIDTH) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    plan = addRoom(plan, room, x, y);
    x += room.width;
    rowHeight = Math.max(rowHeight, room.length);
  }
  return plan;
}

export function addWall(plan, a, b, kind) {
  const wall = { id: uid("w"), x1: a.x, y1: a.y, x2: b.x, y2: b.y, thickness: THICKNESS[kind], kind };
  return wallLength(wall) < MIN_WALL ? plan : { ...plan, walls: [...plan.walls, wall] };
}

// `along` is where on the wall (cm from its start) the opening should be centred.
export function addOpening(plan, wallId, type, along) {
  const width = OPENING_WIDTH[type];
  const opening = { id: uid("o"), wallId, type, offset: along - width / 2, width };
  return normalize({ ...plan, openings: [...plan.openings, opening] });
}

export function addFurniture(plan, { type, w, d }, x, y) {
  const item = { id: uid("f"), type, x: snap(x), y: snap(y), w, d, rotation: 0 };
  return { ...plan, furniture: [...plan.furniture, item] };
}

// kind is the collection name: "rooms" | "walls" | "openings" | "furniture".
export function patch(plan, kind, id, changes) {
  const valid = Object.entries(changes).filter(
    ([key, value]) => typeof value !== "number" || (Number.isFinite(value) && (!POSITIVE.has(key) || value > 0)),
  );
  const clean = Object.fromEntries(valid);
  if ("rotation" in clean) clean.rotation = ((clean.rotation % 360) + 360) % 360;
  return normalize({ ...plan, [kind]: plan[kind].map((item) => (item.id === id ? { ...item, ...clean } : item)) });
}

export function remove(plan, kind, id) {
  const without = { ...plan, [kind]: plan[kind].filter((item) => item.id !== id) };
  if (kind === "rooms") return normalize({ ...without, walls: without.walls.filter((wall) => wall.roomId !== id) });
  if (kind !== "walls") return without;
  // A room only exists as its walls: once the last one is gone it could no longer be seen, selected or deleted.
  const walled = new Set(without.walls.map((wall) => wall.roomId));
  return normalize({ ...without, rooms: without.rooms.filter((room) => room.ellipse || walled.has(room.id)) });
}

const shiftWall = (wall, dx, dy) => ({ ...wall, x1: wall.x1 + dx, y1: wall.y1 + dy, x2: wall.x2 + dx, y2: wall.y2 + dy });

function editWall(plan, wall, moved) {
  if (!wall.roomId) return patch(plan, "walls", wall.id, moved);
  const walls = plan.walls.map(other => {
    if (other.id === wall.id) return moved;
    if (other.roomId !== wall.roomId) return other;
    const next = {...other};
    for (const end of [1, 2]) {
      for (const source of [1, 2]) {
        if (other["x"+end] === wall["x"+source] && other["y"+end] === wall["y"+source]) {
          next["x"+end] = moved["x"+source];
          next["y"+end] = moved["y"+source];
        }
      }
    }
    return next;
  });
  const boundary = walls.filter(w => w.roomId === wall.roomId);
  if (boundary.some(w => wallLength(w) < MIN_WALL)) return plan;
  // Reject crossings between non-adjacent edges, including collinear overlap.
  for (let i=0; i<boundary.length; i++) {
    const a=boundary[i];
    for (const b of boundary.slice(i+1)) {
      const ends = w => [[w.x1,w.y1],[w.x2,w.y2]];
      const [p,q]=ends(a), [r,s]=ends(b);
      const turn=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
      if ([p,q].some(u=>[r,s].some(v=>u[0]===v[0] && u[1]===v[1]))) continue;
      if ([0,1].some(k=>Math.max(p[k],q[k])<Math.min(r[k],s[k]) || Math.max(r[k],s[k])<Math.min(p[k],q[k]))) continue;
      if (turn(p,q,r)*turn(p,q,s)<=0 && turn(r,s,p)*turn(r,s,q)<=0) return plan;
    }
  }
  return normalize({...plan,walls});
}

export function translate(plan, kind, id, dx, dy) {
  if (!dx && !dy) return plan;
  if (kind === "rooms") {
    const room = plan.rooms.find(r=>r.id===id);
    if (room?.layout) {
      const points = room.layout.points.map(([x,y])=>[x+dx,y+dy]);
      plan = patch(plan,kind,id,{layout:{...room.layout,points}});
    }
  }
  const ellipse = kind === "rooms" && plan.rooms.find(room => room.id === id)?.ellipse;
  if (ellipse) return patch(plan,kind,id,{ellipse:{...ellipse,cx:ellipse.cx+dx,cy:ellipse.cy+dy}});
  if (kind === "rooms") return { ...plan, walls: plan.walls.map((wall) => (wall.roomId === id ? shiftWall(wall, dx, dy) : wall)) };
  if (kind === "walls") {
    const wall = plan.walls.find(w => w.id === id);
    return wall ? editWall(plan, wall, shiftWall(wall, dx, dy)) : plan;
  }
  if (kind === "furniture") {
    return { ...plan, furniture: plan.furniture.map((item) => (item.id === id ? { ...item, x: item.x + dx, y: item.y + dy } : item)) };
  }
  return plan;
}

export function moveWallEnd(plan, id, end, x, y) {
  const wall = plan.walls.find((candidate) => candidate.id === id);
  const moved = end === 1 ? { ...wall, x1: x, y1: y } : { ...wall, x2: x, y2: y };
  return wallLength(moved) < MIN_WALL ? plan : editWall(plan, wall, moved);
}

export function setWallLength(plan, id, length) {
  const wall = plan.walls.find((candidate) => candidate.id === id);
  const scale = length / wallLength(wall);
  return moveWallEnd(plan, id, 2, wall.x1 + (wall.x2 - wall.x1) * scale, wall.y1 + (wall.y2 - wall.y1) * scale);
}

export function projectOnWall(wall, point) {
  const length = wallLength(wall);
  const ux = (wall.x2 - wall.x1) / length;
  const uy = (wall.y2 - wall.y1) / length;
  const along = clamp((point.x - wall.x1) * ux + (point.y - wall.y1) * uy, 0, length);
  const distance = Math.hypot(point.x - (wall.x1 + ux * along), point.y - (wall.y1 + uy * along));
  return { along, distance };
}

export function nearestWall(plan, point, maxDistance) {
  let best = null;
  for (const wall of plan.walls) {
    const hit = projectOnWall(wall, point);
    if (hit.distance <= maxDistance && (!best || hit.distance < best.distance)) best = { wall, ...hit };
  }
  return best;
}

// End points of an opening, for drawing it on top of its wall.
export function openingSegment(wall, opening) {
  const length = wallLength(wall);
  const ux = (wall.x2 - wall.x1) / length;
  const uy = (wall.y2 - wall.y1) / length;
  const end = opening.offset + opening.width;
  return { x1: wall.x1 + ux * opening.offset, y1: wall.y1 + uy * opening.offset, x2: wall.x1 + ux * end, y2: wall.y1 + uy * end, ux, uy };
}

function box(points) {
  if (points.length === 0) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const wallPoints = (walls) => walls.flatMap((wall) => [[wall.x1, wall.y1], [wall.x2, wall.y2]]);

function ellipseBounds(e) {
  const angle = e.rotation*Math.PI/180, c = Math.cos(angle), s = Math.sin(angle);
  const w = Math.hypot(e.width*c,e.length*s), h = Math.hypot(e.width*s,e.length*c);
  return {x:e.cx-w/2,y:e.cy-h/2,w,h};
}
export function roomBox(plan, roomId) {
  const e = plan.rooms.find(r => r.id === roomId)?.ellipse;
  if (e) return ellipseBounds(e);
  const walls=plan.walls.filter(w=>w.roomId===roomId);
  const bounds=box(wallPoints(walls));
  if (!bounds || walls.length<3) return bounds;
  // Existing plans can contain unordered or unfinished walls. Attach a contour
  // only when every endpoint belongs to the same single closed loop.
  const key=(x,y)=>x+","+y;
  const neighbors=new Map();
  for (const wall of walls) {
    for (const [x,y,nx,ny] of [[wall.x1,wall.y1,wall.x2,wall.y2],[wall.x2,wall.y2,wall.x1,wall.y1]]) {
      const id=key(x,y);
      if (!neighbors.has(id)) neighbors.set(id,[]);
      neighbors.get(id).push([nx,ny]);
    }
  }
  if (neighbors.size!==walls.length || [...neighbors.values()].some(pair=>pair.length!==2)) return bounds;
  const points=[], visited=new Set();
  let point=[walls[0].x1,walls[0].y1], previous;
  while (!visited.has(key(...point))) {
    const id=key(...point);
    points.push(point);
    visited.add(id);
    point=neighbors.get(id).find(p=>key(...p)!==previous);
    if (!point) return bounds;
    previous=id;
  }
  if (points.length===walls.length && polygonArea(points)>0 &&
      (points.length!==4 || points.some(([x,y])=>(x!==bounds.x && x!==bounds.x+bounds.w) || (y!==bounds.y && y!==bounds.y+bounds.h)))) {
    bounds.polygon=points;
  }
  return bounds;
}
export function containsPoint(room,b,point) {
  const e = room.ellipse;
  if (b.polygon) {
    let inside=false;
    for (let i=0,j=b.polygon.length-1;i<b.polygon.length;j=i++) {
      const [x,y]=b.polygon[i], [nx,ny]=b.polygon[j];
      const cross=(point.x-x)*(ny-y)-(point.y-y)*(nx-x);
      if (Math.abs(cross)<1e-7 && (point.x-x)*(point.x-nx)+(point.y-y)*(point.y-ny)<=0) return true;
      if ((y>point.y)!==(ny>point.y) && point.x<(nx-x)*(point.y-y)/(ny-y)+x) inside=!inside;
    }
    return inside;
  }
  if (!e) return point.x>=b.x && point.x<=b.x+b.w && point.y>=b.y && point.y<=b.y+b.h;
  const angle = e.rotation*Math.PI/180, dx=point.x-e.cx, dy=point.y-e.cy;
  const x=dx*Math.cos(angle)+dy*Math.sin(angle), y=dy*Math.cos(angle)-dx*Math.sin(angle);
  return (2*x/e.width)**2 + (2*y/e.length)**2 <= 1+1e-10;
}
export const ellipseArea = (width,length) => Math.PI*width*length/40000;
export function roomArea(plan,room) {
  if (room.layout) return polygonArea(room.layout.points)/10000;
  if (room.ellipse) return ellipseArea(room.ellipse.width,room.ellipse.length);
  const b=roomBox(plan,room.id);
  return b?.polygon ? polygonArea(b.polygon)/10000 : squareMetres(b);
}

export function planBox(plan) {
  const reach = (item) => Math.hypot(item.w, item.d) / 2;
  const furniture = plan.furniture.flatMap((item) => [
    [item.x - reach(item), item.y - reach(item)],
    [item.x + reach(item), item.y + reach(item)],
  ]);
  const curves = plan.rooms.filter(r=>r.ellipse).flatMap(r=>{
    const b=ellipseBounds(r.ellipse);
    return [[b.x,b.y],[b.x+b.w,b.y+b.h]];
  });
  return box([...wallPoints(plan.walls), ...curves, ...furniture]) ?? { x: 0, y: 0, w: 600, h: 400 };
}

export const metres = (cm) => (cm / 100).toFixed(2);
export const squareMetres = (b) => (b ? (b.w * b.h) / 10_000 : 0);
export const planArea = (plan) => plan.rooms.reduce((total, room) => total + roomArea(plan,room), 0);

export function duplicateFurniture(plan, id) {
  const item = plan.furniture.find((candidate) => candidate.id === id);
  return { ...plan, furniture: [...plan.furniture, { ...item, id: uid("f"), x: item.x + 2 * GRID, y: item.y + 2 * GRID }] };
}

export const isPlan = (value) =>
  value?.schema === 1 && ["rooms", "walls", "openings", "furniture"].every((key) => Array.isArray(value[key]));

const HISTORY_LIMIT = 100;

export const history = {
  start: (plan) => ({ past: [], present: plan, future: [] }),
  push: (h, plan) =>
    plan === h.present ? h : { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: plan, future: [] },
  undo: (h) =>
    h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past.at(-1), future: [h.present, ...h.future] },
  redo: (h) =>
    h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) },
};
