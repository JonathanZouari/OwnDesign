// Draws a plan into an <svg>. The whole drawing is rebuilt on every change: residential plans are a few
// hundred elements, so this stays fast and there is no stale state to reconcile.
// User text (room names) only ever enters as text nodes.
import { FURNITURE_BY_TYPE } from "../catalog.js";
import { metres, openingSegment, roomBox, roomArea, containsPoint, wallLength } from "../plan.js";

const NS = "http://www.w3.org/2000/svg";
const RULER_PX = 22;
const RULER_STEPS_M = [0.5, 1, 2, 5, 10, 20, 50];

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) node.setAttribute(key, value);
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

// The part of the plan currently on screen, in plan centimetres, and how many cm one screen pixel covers.
export function visibleArea(canvas) {
  const inverse = canvas.getScreenCTM()?.inverse();
  const rect = canvas.getBoundingClientRect();
  if (!inverse || rect.width === 0) return { x: 0, y: 0, w: 1000, h: 800, scale: 1 };
  const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
  const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, scale: (b.x - a.x) / rect.width };
}

function grid(area) {
  const showMinor = 10 / area.scale >= 8; // only when 10 cm is at least 8 px wide
  const pattern = (id, size, cls) =>
    svg("pattern", { id, width: size, height: size, patternUnits: "userSpaceOnUse" },
      svg("path", { d: `M${size} 0H0V${size}`, fill: "none", class: cls, "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
  const fill = (id) => svg("rect", { x: area.x, y: area.y, width: area.w, height: area.h, fill: `url(#${id})`, "pointer-events": "none" });
  return [
    svg("defs", {}, pattern("grid-major", 100, "grid-major"), showMinor && pattern("grid-minor", 10, "grid-minor")),
    showMinor && fill("grid-minor"),
    fill("grid-major"),
  ];
}

function rulers(area) {
  const { x, y, w, h, scale } = area;
  const band = RULER_PX * scale;
  const step = (RULER_STEPS_M.find((m) => (m * 100) / scale >= 60) ?? 100) * 100;
  const font = 10 * scale;
  const label = (cm) => `${(cm / 100).toFixed(step < 100 ? 1 : 0)}m`;
  const marks = [];
  for (let cm = Math.ceil((x + band) / step) * step; cm < x + w; cm += step) {
    marks.push(
      svg("line", { x1: cm, y1: y + band * 0.6, x2: cm, y2: y + band, class: "ruler-tick", "stroke-width": scale }),
      svg("text", { x: cm + 3 * scale, y: y + band * 0.55, "font-size": font, class: "ruler-text" }, label(cm)),
    );
  }
  for (let cm = Math.ceil((y + band) / step) * step; cm < y + h; cm += step) {
    marks.push(
      svg("line", { x1: x + band * 0.6, y1: cm, x2: x + band, y2: cm, class: "ruler-tick", "stroke-width": scale }),
      svg("text", { x: x + band * 0.55, y: cm - 3 * scale, "font-size": font, class: "ruler-text", transform: `rotate(-90 ${x + band * 0.55} ${cm - 3 * scale})` }, label(cm)),
    );
  }
  return svg("g", { "pointer-events": "none" },
    svg("rect", { x, y, width: w, height: band, class: "ruler" }),
    svg("rect", { x, y, width: band, height: h, class: "ruler" }),
    marks,
  );
}

// A dark measurement pill that keeps a constant on-screen size.
function chip(x, y, text, scale) {
  const font = 11 * scale;
  const width = (text.length * 0.62 + 1.4) * font;
  const height = font * 1.7;
  return svg("g", { "pointer-events": "none" },
    svg("rect", { x: x - width / 2, y: y - height / 2, width, height, rx: 3 * scale, class: "chip-bg" }),
    svg("text", { x, y: y + font * 0.35, "text-anchor": "middle", "font-size": font, class: "chip-text" }, text),
  );
}

const focusable = (kind, id, label, cls) => ({ "data-kind": kind, "data-id": id, tabindex: 0, role: "button", "aria-label": label, class: cls });

export function wallNode(wall, selected) {
  const line = (cls, width) => svg("line", { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, class: cls, "stroke-width": width });
  const name = wall.kind === "exterior" ? "Exterior wall" : "Partition";
  return svg("g", focusable("walls", wall.id, `${name}, ${metres(wallLength(wall))} m`, selected ? "selected" : ""),
    line(`wall ${wall.kind}`, wall.thickness),
    line("hit", Math.max(wall.thickness, 36)),
  );
}

export function openingNode(opening, wall, selected) {
  const s = openingSegment(wall, opening);
  const nx = -s.uy; // unit normal to the wall
  const ny = s.ux;
  const t = wall.thickness;
  const along = (cls, width, shift = 0) =>
    svg("line", { x1: s.x1 + nx * shift, y1: s.y1 + ny * shift, x2: s.x2 + nx * shift, y2: s.y2 + ny * shift, class: cls, "stroke-width": width });
  let symbol =
    opening.type === "door"
      ? [
          // Door leaf standing open at 90 degrees, and the arc it sweeps when closing.
          svg("line", { x1: s.x1, y1: s.y1, x2: s.x1 + nx * opening.width, y2: s.y1 + ny * opening.width, class: "symbol" }),
          svg("path", { d: `M${s.x1 + nx * opening.width} ${s.y1 + ny * opening.width} A${opening.width} ${opening.width} 0 0 0 ${s.x2} ${s.y2}`, class: "symbol", "stroke-dasharray": "6 6" }),
        ]
      : [along("symbol", 2, t / 4), along("symbol", 2, -t / 4)];
  if (opening.type === "passage") symbol = [];
  if (opening.type === "sliding") {
    const panel = (start,end,shift) => svg("line", {
      x1:s.x1 + s.ux * opening.width * start + nx*shift, y1:s.y1 + s.uy * opening.width * start + ny*shift,
      x2:s.x1 + s.ux * opening.width * end + nx*shift, y2:s.y1 + s.uy * opening.width * end + ny*shift,
      class:"symbol","stroke-width":4
    });
    symbol = [panel(0,.54,-3),panel(.46,1,3)];
  }
  const label = `${({door:"Door",window:"Window",sliding:"Sliding door",passage:"Open passage"})[opening.type]}, ${Math.round(opening.width)} cm wide`;
  return svg("g", focusable("openings", opening.id, label, selected ? "selected" : ""), along("gap", t + 4), symbol, along("hit", Math.max(t, 36)));
}

function furnitureNode(item, selected) {
  const spec = FURNITURE_BY_TYPE.get(item.type);
  const label = spec?.label ?? item.type;
  const font = Math.min(Math.max(Math.min(item.w, item.d) * 0.16, 9), 15);
  const cls = ["item", spec?.review && "review", selected && "selected"].filter(Boolean).join(" ");
  return svg("g", { ...focusable("furniture", item.id, `${label}, ${Math.round(item.w)} by ${Math.round(item.d)} cm`, cls), transform: `translate(${item.x} ${item.y}) rotate(${item.rotation})` },
    svg("rect", { x: -item.w / 2, y: -item.d / 2, width: item.w, height: item.d, rx: 4 }),
    svg("text", { y: font * 0.35, "text-anchor": "middle", "font-size": font }, label),
  );
}

export function clientFurniture(item) {
  // Normalized footprints keep each symbol aligned with the saved size and rotation.
  const ink = "#344942", linen = "#faf5e8", sage = "#a4bdaf", steel = "#b7c7cb";
  const rect = (x,y,width,height,fill,rx=4) => svg("rect",{x,y,width,height,fill,rx});
  const line = d => svg("path",{d,fill:"none"});
  const ring = (cx,cy,r,fill=linen) => svg("circle",{cx,cy,r,fill});
  const cushion = (x,w) => rect(x,29,w,57,linen,7);
  let shapes;
  switch (item.type) {
    case "shower":
      shapes=[rect(3,3,94,94,"#d3e7e7",5),
        line("M11 76V11H89 M12 89H64 M89 12V62 M63 89L89 63"),
        line("M16 15L31 30"),ring(34,33,8,"#66898d"),ring(70,69,6,"#819a9b")];
      break;
    case "shoe-cabinet":
      shapes=[rect(2,3,96,94,"#bba184"),rect(6,9,42,82,linen),rect(52,9,42,82,linen),line("M17 25H36 M64 25H83")];
      break;
    case "entry-bench":
      shapes=[rect(7,13,86,76,"#96785f"),rect(2,5,96,77,sage,12),line("M12 24H88 M12 61H88")];
      break;
    case "wall-mirror":
      shapes=[rect(2,4,96,92,"#947858"),rect(6,15,88,70,"#c7e0e2"),line("M27 70L45 25 M47 70L65 25")];
      break;
    case "washer":
      shapes=[rect(2,2,96,96,steel),rect(8,7,30,10,linen),ring(82,13,6),
        ring(50,59,31,linen),ring(50,59,23,"#92bbca"),line("M30 62Q40 54 50 61T70 60")];
      break;
    case "dryer":
      shapes=[rect(2,2,96,96,"#d7c4ab"),ring(82,13,6),rect(12,23,76,57,"#f4ebdc",13),
        line("M33 66Q44 58 36 50T40 35 M55 66Q66 57 58 49T62 35 M18 88H81")];
      break;
    case "utility-cabinet":
      shapes=[rect(2,2,96,96,"#bdab90"),rect(8,9,84,82,linen),line("M56 10V90 M9 37H54 M9 64H54 M68 73L79 23 M64 75L74 78")];
      break;
    case "toilet":
      shapes=[svg("path",{d:"M15 1H85L85 44Q87 96 50 98Q13 96 15 44Z",fill:"#fffdf7"}),
        svg("ellipse",{cx:50,cy:56,rx:25,ry:31,fill:"#c4dcdc"})];
      break;
    case "vanity":
      shapes=[rect(2,3,96,94,"#d2bc9e",6),
        svg("ellipse",{cx:50,cy:56,rx:39,ry:32,fill:"#fffdf7"}),
        svg("ellipse",{cx:50,cy:56,rx:29,ry:22,fill:"#c9dfdf"}),
        line("M50 11V39"),ring(50,60,3,"#708888")];
      break;
    case "wardrobe":
      shapes=[rect(2,3,96,94,"#b19a7e",3),rect(5,7,43,85,"#e3d5c1",2),
        rect(52,7,43,85,"#e3d5c1",2),line("M40 36V63 M60 36V63")];
      break;
    case "chair":
      shapes=[line("M20 69L14 97 M80 69L86 97"),
        svg("path",{d:"M13 28Q50 14 87 28L83 72Q50 94 17 72Z",fill:sage}),
        svg("path",{d:"M7 12Q50 -4 93 12L90 29Q50 16 10 29Z",fill:"#89735f"})];
      break;
    case "desk":
      shapes=[rect(2,7,96,86,"#cfb592",6),rect(28,17,44,36,"#435b60",2),
        svg("path",{d:"M28 54H72L79 67H21Z",fill:steel})];
      break;
    case "dressing-table":
      shapes=[rect(2,22,96,72,"#d9bea8",14),
        svg("ellipse",{cx:50,cy:25,rx:29,ry:19,fill:"#dbe8e7"}),line("M42 30L53 16")];
      break;
    case "dining-table":
      shapes=[rect(2,5,96,90,"#c9ad8c",25),
        ...[[28,27],[72,27],[28,73],[72,73]].map(([x,y])=>
          svg("ellipse",{cx:x,cy:y,rx:7,ry:12,fill:linen}))];
      break;
    case "outdoor-table":
      shapes=[rect(2,7,96,86,"#b59971",22),line("M10 32H90 M7 50H93 M10 68H90")];
      break;
    case "side-table":
    case "coffee-table":
      shapes=[svg("ellipse",{cx:50,cy:50,rx:48,ry:46,fill:"#cfb49b"}),
        rect(42,28,19,38,linen,2)];
      break;
    case "single-bed":
    case "double-bed":
      shapes = [rect(2,2,96,96,"#ad9077"),rect(6,8,88,86,linen),
        ...(item.type==="double-bed" ? [rect(10,11,37,19,"white",7),rect(53,11,37,19,"white",7)] : [rect(20,11,60,19,"white",7)]),
        rect(6,37,88,57,"#a4b8c5"),line("M7 46H93")];
      break;
    case "armchair":
    case "sofa":
    case "outdoor-sofa":
      shapes = [rect(3,6,94,88,sage,13),rect(10,9,80,20,linen,6),
        ...(item.type==="armchair"?[cushion(17,66)]:[cushion(13,36),cushion(51,36)]),
        rect(3,29,10,55,sage),rect(87,29,10,55,sage)];
      break;
    case "swing-sofa":
      shapes = [line("M3 91L9 9H91L97 91 M2 91H13 M87 91H98 M12 10L22 51 M88 10L78 51"),
        rect(18,48,64,33,"#c79569",9),line("M24 59H76 M24 69H76")];
      break;
    case "hob-hood":
    case "stove":
      shapes=[rect(2,2,96,96,steel), ...[[27,27],[73,27],[27,73],[73,73]].map(([x,y])=>ring(x,y,16,"#546970"))];
      break;
    case "fridge":
      shapes=[rect(2,2,96,96,steel),line("M3 38H97 M16 14V30 M16 49V70")]; break;
    case "oven-microwave":
      shapes=[rect(2,2,96,96,steel),rect(10,9,62,24,"#435b60"),ring(84,20,5),line("M3 42H97 M18 53H82"),rect(14,61,72,28,"#435b60")]; break;
    case "dishwasher":
      shapes=[rect(2,2,96,96,steel),line("M5 23H95 M28 12H68"),ring(50,60,27),ring(50,60,18)]; break;
    case "coffee-station":
      shapes=[rect(2,4,96,92,"#ceb99c"),rect(7,16,40,66,steel),ring(27,57,12),line("M19 32H35"),
        svg("path",{d:"M58 72Q52 65 62 42L58 34L69 38Q78 28 84 40Q98 64 84 74Z",fill:linen}),line("M85 43Q101 43 90 61")]; break;
    default: return furnitureNode(item,false);
  }
  const label=FURNITURE_BY_TYPE.get(item.type)?.label ?? item.type;
  return svg("g",{"data-id":item.id,transform:`translate(${item.x} ${item.y}) rotate(${item.rotation})`},
    svg("title",{},label),
    svg("svg",{x:-item.w/2,y:-item.d/2,width:item.w,height:item.d,viewBox:"0 0 100 100",preserveAspectRatio:"none",stroke:ink,"stroke-width":2.6,"stroke-linejoin":"round","stroke-linecap":"round"},shapes),
    svg("text",{x:0,y:item.d/2+8,"text-anchor":"middle","font-size":9,fill:ink},label));
}

export function roomSurface(room,b,attrs) {
  const e=room.ellipse;
  if (b.polygon) return svg("polygon",{points:b.polygon.map(p=>p.join(",")).join(" "),...attrs});
  if (!e) return svg("rect",{x:b.x,y:b.y,width:b.w,height:b.h,...attrs});
  return svg("ellipse",{cx:e.cx,cy:e.cy,rx:e.width/2,ry:e.length/2,
    transform:`rotate(${e.rotation} ${e.cx} ${e.cy})`,stroke:"#475b52","stroke-width":3,...attrs});
}

export function layoutSurface(room) {
  return svg("polygon", {
    points:room.layout.points.map(p=>p.join(",")).join(" "),
    fill:"#c4d9c7","fill-opacity":0.54,stroke:"#356748","stroke-width":2.5,
    "stroke-dasharray":"9 5","data-room":room.id,"data-layout":room.id,
  });
}

function roomNode(plan, room, selected, scale) {
  const b = roomBox(plan, room.id);
  if (!b) return null;
  const cx = b.x + b.w / 2;
  const cy = b.y + Math.min(b.h / 2, 60);
  const nameSize = Math.max(22, 13 * scale); // never smaller than 13 px on screen
  const metaSize = Math.max(13, 10 * scale);
  const width = Math.max(room.name.length * nameSize * 0.6, nameSize * 5);
  return svg("g", focusable("rooms", room.id, `Room ${room.name}, ${roomArea(plan,room).toFixed(1)} square metres`, selected ? "selected" : ""),
    svg("rect", { x: cx - width / 2, y: cy - nameSize * 1.3, width, height: nameSize * 2.8, class: "room-hit" }),
    svg("text", { x: cx, y: cy, "text-anchor": "middle", "font-size": nameSize, class: "room-name" }, room.name),
    svg("text", { x: cx, y: cy + metaSize * 1.6, "text-anchor": "middle", "font-size": metaSize, class: "room-meta" }, `${roomArea(plan,room).toFixed(1)} m²`),
  );
}

// One length label per distinct wall position, so two rooms sharing a wall are not labelled twice.
function dimensions(plan, scale) {
  const font = Math.max(12, 10 * scale);
  const seen = new Set();
  return plan.walls.flatMap((wall) => {
    const length = wallLength(wall);
    const mx = (wall.x1 + wall.x2) / 2;
    const my = (wall.y1 + wall.y2) / 2;
    const key = `${Math.round(mx)}:${Math.round(my)}`;
    if (length < 80 || seen.has(key)) return [];
    seen.add(key);
    const off = wall.thickness / 2 + font * 1.2;
    const nx = -(wall.y2 - wall.y1) / length;
    const ny = (wall.x2 - wall.x1) / length;
    return [svg("text", { x: mx - nx * off, y: my - ny * off + font * 0.35, "text-anchor": "middle", "font-size": font, class: "dim" }, `${metres(length)} m`)];
  });
}

function selectionOverlay(plan, selection, scale) {
  if (!selection) return [];
  if (selection.kind === "walls") {
    const wall = plan.walls.find((w) => w.id === selection.id);
    if (!wall) return [];
    const handle = (end, x, y) => svg("circle", { cx: x, cy: y, r: 7 * scale, class: "handle", "stroke-width": 2 * scale, "data-kind": "handle", "data-end": end });
    return [chip((wall.x1 + wall.x2) / 2, (wall.y1 + wall.y2) / 2, `${metres(wallLength(wall))} m`, scale), handle(1, wall.x1, wall.y1), handle(2, wall.x2, wall.y2)];
  }
  if (selection.kind === "furniture") {
    const item = plan.furniture.find((f) => f.id === selection.id);
    if (!item) return [];
    const reach = Math.hypot(item.w, item.d) / 2;
    return [chip(item.x, item.y + reach + 14 * scale, `${metres(item.w)} × ${metres(item.d)} m`, scale)];
  }
  return [];
}

// Presentation layer only: room selection never changes the saved geometry.
function roomLabelPlacement(room, box, furniture, name, initialSize, rows=1) {
  const obstacles = furniture.map(item => {
    const angle = item.rotation * Math.PI / 180;
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    return {x:item.x, y:item.y, w:(item.w*c + item.d*s)/2 + 6, h:(item.w*s + item.d*c)/2 + 8};
  }).filter(o => o.x+o.w > box.x && o.x-o.w < box.x+box.w && o.y+o.h > box.y && o.y-o.h < box.y+box.h);
  for (const factor of [1,.9,.8,.7,.6,.5,.4]) {
    const size = initialSize * factor;
    const halfWidth = size * (name.length * .33 + .2), halfHeight = size * (.62 + (rows-1)*.56);
    let best;
    for (let y=box.y+halfHeight+12; y<=box.y+box.h-halfHeight-12; y+=6) {
      for (let x=box.x+halfWidth+12; x<=box.x+box.w-halfWidth-12; x+=6) {
        if ((room.ellipse || box.polygon) && [-1,1].some(dx=>[-1,1].some(dy=>
          !containsPoint(room,box,{x:x+dx*halfWidth,y:y+dy*halfHeight})))) continue;
        const clearance = Math.min(x-box.x-halfWidth, box.x+box.w-x-halfWidth,
          y-box.y-halfHeight, box.y+box.h-y-halfHeight,
          ...obstacles.map(o=>Math.max(Math.abs(x-o.x)-o.w-halfWidth,Math.abs(y-o.y)-o.h-halfHeight)));
        const score = clearance - .03*Math.hypot(x-box.x-box.w/2,y-box.y-box.h/2);
        if (clearance>=0 && (!best || score>best.score)) best={x,y:y+size*.32,size,score};
      }
    }
    if (best) return best;
  }
  return null;
}
export function drawClientPlan(canvas, plan, selectedId) {
  const { scale } = visibleArea(canvas);
  if (selectedId) {
    const box = roomBox(plan, selectedId);
    if (box) {
      const walls = plan.walls.filter(w => w.roomId === selectedId);
      const wallIds = new Set(walls.map(w => w.id));
      plan = {
        ...plan,
        rooms: plan.rooms.filter(room => room.id === selectedId),
        walls,
        openings: plan.openings.filter(o => wallIds.has(o.wallId)),
        furniture: plan.furniture.filter(f => containsPoint(plan.rooms.find(r=>r.id===selectedId),box,f)),
      };
    }
  }
  const backgrounds = [], labels = [];
  for (const room of plan.rooms) {
    const box = roomBox(plan, room.id);
    if (!box) continue;
    const selected = room.id === selectedId;
    const tint = { balcony: "#e2ebda", bathroom: "#e0ebec", bedroom: "#f1eae4" }[room.type] || "#f7f2e5";
    backgrounds.push(roomSurface(room,box,{
      fill:selected ? "#ccdcca" : tint, "data-room":room.id}));
    if (room.layout) backgrounds.push(layoutSurface(room));
    const words = room.name.trim().split(/\s+/);
    const wrap = words.length > 1 && (room.type === "bathroom" || room.name.includes("ארונות"));
    const split = Math.ceil(words.length/2);
    const lines = wrap ? [words.slice(0,split).join(" "),words.slice(split).join(" ")] : [room.name];
    const longest = lines.reduce((a,b)=>a.length>b.length?a:b);
    const size = Math.min(14 * scale, box.w / (Math.max(1, longest.length) * 0.62 + 1), box.h * .26);
    const placement = roomLabelPlacement(room, box, plan.furniture, longest, size, lines.length);
    const callout = wrap && (!placement || placement.size < 10*scale) &&
      !plan.rooms.some(other => {
        if(other.id===room.id) return false;
        const b=roomBox(plan,other.id);
        return b && b.x < box.x && b.x+b.w >= box.x-200 && b.y<box.y+box.h && b.y+b.h>box.y;
      });
    const fontSize = callout ? 11*scale : placement?.size ?? size;
    const labelX = callout ? box.x-104 : placement?.x ?? box.x+box.w/2;
    const labelY = callout ? box.y+box.h/2 : placement?.y ?? box.y+Math.min(box.h*.48,size*1.5);
    labels.push(svg("g", {role:"button", tabindex:0, "aria-label":room.name,
      "aria-pressed":String(selected), "data-room":room.id},
      callout ? svg("path",{d:`M${box.x-30} ${labelY}H${box.x}`,stroke:"#75857c","stroke-width":2}) : null,
      svg("text",{x:labelX,y:labelY,
        "text-anchor":"middle","font-size":fontSize, class:"tour-room-name",direction:"auto"},lines.map((line,i)=>svg("tspan",{x:labelX,dy:i?"1.12em":wrap?"-.56em":0},line)))));
  }
  const walls = new Map(plan.walls.map(w => [w.id,w]));
  const objects = svg("g", {class:"tour-objects","aria-hidden":"true"},
    plan.furniture.map(clientFurniture),
    plan.walls.map(w => wallNode(w,false)),
    plan.openings.map(o => openingNode(o,walls.get(o.wallId),false)));
  for (const item of objects.querySelectorAll("[tabindex]")) item.removeAttribute("tabindex");
  canvas.replaceChildren(...backgrounds, objects, ...labels);
}

export function draw(canvas, { plan, selection, preview }) {
  const area = visibleArea(canvas);
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const is = (kind, id) => selection?.kind === kind && selection.id === id;
  canvas.replaceChildren(
    ...[
      grid(area),
      plan.rooms.flatMap(room => {
        const bounds = roomBox(plan,room.id);
        return room.ellipse || bounds?.polygon ? [roomSurface(room,bounds,{
          "data-kind":"rooms", "data-id":room.id, fill:"#f5f3ec",
        })] : [];
      }),
      plan.rooms.filter(room=>room.layout).map(layoutSurface),
      plan.furniture.map((item) => furnitureNode(item, is("furniture", item.id))),
      plan.walls.map((wall) => wallNode(wall, is("walls", wall.id))),
      plan.openings.map((opening) => openingNode(opening, walls.get(opening.wallId), is("openings", opening.id))),
      dimensions(plan, area.scale),
      plan.rooms.map((room) => roomNode(plan, room, is("rooms", room.id), area.scale)),
      selectionOverlay(plan, selection, area.scale),
      preview && [
        svg("line", { ...preview, class: "preview", "stroke-width": 3 * area.scale, "pointer-events": "none" }),
        chip((preview.x1 + preview.x2) / 2, (preview.y1 + preview.y2) / 2 - 16 * area.scale, `${metres(Math.hypot(preview.x2 - preview.x1, preview.y2 - preview.y1))} m`, area.scale),
      ],
      rulers(area),
    ].flat(3).filter(Boolean),
  );
}
