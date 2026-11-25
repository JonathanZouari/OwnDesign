import { projectChat } from "../project-chat.js";
import { FURNITURE, FURNITURE_BY_TYPE } from "../catalog.js";
import { roomBox, planBox, openingSegment } from "../plan.js";
import {
  svg,
  wallNode,
  openingNode,
  clientFurniture,
  drawClientPlan,
} from "../editor/render.js";

const $ = (id) => document.getElementById(id),
  board = $("canvas");
const names = {
  sofa: "ספה",
  armchair: "כורסה",
  "coffee-table": "שולחן סלון",
  "tv-unit": "מזנון",
  "dining-table": "שולחן אוכל",
  chair: "כיסא",
  "double-bed": "מיטה זוגית",
  "single-bed": "מיטת יחיד",
  wardrobe: "ארון בגדים",
  desk: "שולחן עבודה",
  "kitchen-counter": "משטח מטבח",
  "kitchen-island": "אי מטבח",
  sink: "כיור",
  stove: "כיריים",
  fridge: "מקרר",
  toilet: "אסלה",
  bathtub: "אמבטיה",
  shower: "מקלחת",
  vanity: "ארון רחצה",
};
for (const spec of FURNITURE) spec.label = names[spec.type] || spec.label;
const bounds = new Map(),
  owners = new Map(),
  openingWalls = new Map();
const groupByType = {
  living: ["Living", "Kitchen"],
  kitchen: ["Kitchen", "Living"],
  balcony: ["Outdoor"],
  bedroom: ["Bedroom", "Living"],
  bathroom: ["Bathroom"],
  hallway: ["Entry"],
};
let current = "",
  selected = null,
  zones = [],
  nodes = new Map();
function indexPlan() {
  bounds.clear();
  owners.clear();
  openingWalls.clear();
  $("room").replaceChildren(new Option("הדירה כולה", ""));
  for (const r of plan.rooms) {
    const b = roomBox(plan, r.id);
    if (!b) continue;
    bounds.set(r.id, b);
    $("room").add(new Option(r.name, r.id));
  }
  for (const w of plan.walls) openingWalls.set(w.id, w);
  for (const f of plan.furniture) {
    const hit = [...bounds].find(
      ([, b]) =>
        f.x >= b.x && f.x <= b.x + b.w && f.y >= b.y && f.y <= b.y + b.h,
    );
    if (hit) owners.set(f.id, hit[0]);
  }
}
function focusBox(b) {
  const pad = 25;
  board.setAttribute(
    "viewBox",
    [b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad].join(" "),
  );
}
function go(id) {
  current = id;
  syncControls();
  $("room").value = id;
  selected = null;
  nodes.clear();
  $("toolbar").hidden = !id;
  if (!id) {
    $("status").textContent = "בחרו חלל בתוכנית";
    focusBox(planBox(plan));
    drawClientPlan(board, plan, null);
    board.onclick = (e) => {
      const id = e.target.closest("[data-room]")?.dataset.room;
      if (id) go(id);
    };
    board.onkeydown = (e) => {
      if (["Enter", " "].includes(e.key)) {
        const id = e.target.closest("[data-room]")?.dataset.room;
        if (id) {
          e.preventDefault();
          go(id);
        }
      }
    };
    return;
  }
  board.onclick = null;
  board.onkeydown = null;
  const r = plan.rooms.find((r) => r.id === id),
    b = bounds.get(id);
  focusBox(b);
  board.replaceChildren(
    svg("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "#f8f4e9" }),
  );
  const defs = svg("defs"),
    clip = svg("clipPath", { id: "access" });
  defs.append(clip);
  board.append(defs);
  zones = [];
  const walls = plan.walls.filter((w) => w.roomId === id);
  for (const w of walls) board.append(wallNode(w, false));
  for (const op of plan.openings) {
    const w = openingWalls.get(op.wallId);
    if (w.roomId !== id) continue;
    board.append(openingNode(op, w, false));
    if (op.type === "window") continue;
    const s = openingSegment(w, op);
    const cx = (s.x1 + s.x2) / 2,
      cy = (s.y1 + s.y2) / 2;
    const sign =
      Math.sign((b.x + b.w / 2 - cx) * -s.uy + (b.y + b.h / 2 - cy) * s.ux) ||
      1;
    const nx = -s.uy * sign,
      ny = s.ux * sign,
      depth = clearance();
    const z = {
      cx: cx + (nx * (w.thickness + depth)) / 2,
      cy: cy + (ny * (w.thickness + depth)) / 2,
      ux: s.ux,
      uy: s.uy,
      width: op.width,
      height: depth,
    };
    const attrs = {
      x: -z.width / 2,
      y: -depth / 2,
      width: z.width,
      height: depth,
      transform: "matrix(" + [s.ux, s.uy, nx, ny, z.cx, z.cy].join(" ") + ")",
    };
    zones.push(z);
    clip.append(svg("rect", attrs));
    board.append(
      svg("rect", { ...attrs, class: "zone", "pointer-events": "none" }),
    );
  }
  const group =
    groupByType[r.type] ?? (id === "closet" ? ["Bedroom"] : ["Utility"]);
  const types = FURNITURE.filter(
    (f) =>
      group.includes(f.group) ||
      plan.furniture.some((i) => owners.get(i.id) === id && i.type === f.type),
  );
  $("catalog").replaceChildren(
    ...types.map((f) => new Option(f.label, f.type)),
  );
  board.append(
    svg("g", { id: "items" }),
    svg("g", {
      id: "overlaps",
      "clip-path": "url(#access)",
      "pointer-events": "none",
    }),
  );
  for (const f of plan.furniture.filter((f) => owners.get(f.id) === id))
    mount(f);
  choose(null);
  report();
  drawComparison();
  showReviews();
}
function intersects(f, z) {
  const a = (f.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    dx = f.x - z.cx,
    dy = f.y - z.cy;
  return Math.max(
    0,
    Math.min(
      ...[
        [z.ux, z.uy],
        [-z.uy, z.ux],
        [c, s],
        [-s, c],
      ].map(
        ([ax, ay]) =>
          (f.w * Math.abs(ax * c + ay * s) +
            f.d * Math.abs(-ax * s + ay * c) +
            z.width * Math.abs(ax * z.ux + ay * z.uy) +
            z.height * Math.abs(-ax * z.uy + ay * z.ux)) /
            2 -
          Math.abs(dx * ax + dy * ay),
      ),
    ),
  );
}
function report() {
  const blocked = plan.furniture.filter(
    (f) =>
      owners.get(f.id) === current &&
      zones.some((z) => intersects(f, z) > 1e-7),
  );
  const msg = blocked.length
    ? "חפיפה באזור הגישה: " +
      blocked
        .map(
          (f) =>
            itemName(f) +
            " · " +
            Math.ceil(Math.max(...zones.map((z) => intersects(f, z)))) +
            " ס״מ",
        )
        .join(", ")
    : "אזור הגישה פנוי";
  if ($("status").textContent !== msg) $("status").textContent = msg;
}
function itemName(f) {
  return FURNITURE_BY_TYPE.get(f.type)?.label ?? f.type;
}
function choose(f) {
  selected = f;
  for (const [id, [n]] of nodes) n.classList.toggle("picked", id === f?.id);
  $("remove").disabled = $("angle").disabled = !f;
  $("dimensions").hidden = !f;
  if (f) {
    $("width").value = f.w;
    $("depth").value = f.d;
  }
  $("exact-angle").disabled = !f;
  $("exact-angle").value = f ? (f.rotation < 0 ? f.rotation+360 : f.rotation) : "";
  $("gesture").textContent = f ? itemName(f) + " · גררו את הידית העגולה לסיבוב חופשי, או הזינו זווית במעלות." : "בחרו רהיט לסיבוב. גררו את הרהיט כדי להזיז אותו.";
  positionHandle();
  $("angle").value = f ? (f.rotation < 0 ? f.rotation + 360 : f.rotation) : 0;
  $("selected").textContent = f
    ? itemName(f) +
      " · " +
      f.w +
      " × " +
      f.d +
      " ס״מ · " +
      (f.dimension_source === "measured"
        ? "מידות שנמדדו"
        : f.dimension_source === "catalog"
          ? "מידות קטלוג"
          : "מידות מהתוכנית")
    : "בחרו רהיט בתוכנית";
}
function reposition(f, x, y) {
  if (!editing) return;
  markDirty();
  const a = (f.rotation * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a)),
    b = bounds.get(current);
  const ex = (f.w * c + f.d * s) / 2,
    ey = (f.w * s + f.d * c) / 2;
  const limit = (v, start, size, reach) =>
    size <= 2 * reach
      ? start + size / 2
      : Math.max(start + reach, Math.min(start + size - reach, v));
  f.x = limit(x, b.x, b.w, ex);
  f.y = limit(y, b.y, b.h, ey);
  for (const n of nodes.get(f.id))
    n.setAttribute(
      "transform",
      "translate(" + f.x + " " + f.y + ") rotate(" + f.rotation + ")",
    );
  positionHandle();
  report();
}
function positionHandle() {
  let handle = document.getElementById("rotation-handle");
  if (!selected || !editing) { handle?.remove(); return; }
  if (!handle) {
    handle = svg("g", { id:"rotation-handle", "aria-hidden":"true" },
      svg("title", {}, "גררו לסיבוב חופשי"),
      svg("circle", { r:20, fill:"transparent" }),
      svg("circle", { r:11, fill:"#fffdf9", stroke:"#745739", "stroke-width":3 }),
      svg("path", { d:"M-5 2 A5 5 0 1 1 4 3 M4 -1 L4 4 L0 3", fill:"none", stroke:"#594027", "stroke-width":2 })
    );
    board.append(handle);
    let offset = 0;
    const bearing = e => {
      const p = new DOMPoint(e.clientX,e.clientY).matrixTransform(board.getScreenCTM().inverse());
      return Math.atan2(p.y-selected.y,p.x-selected.x)*180/Math.PI;
    };
    handle.onpointerdown = e => {
      if(e.button || !selected)return;
      offset=selected.rotation-bearing(e);
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    handle.onpointermove = e => {
      if(handle.hasPointerCapture(e.pointerId)) rotateTo(Math.round(((bearing(e)+offset+720)%360)*10)/10);
    };
  }
  const a=selected.rotation*Math.PI/180;
  // Keep the handle inside the item's footprint so it is reachable against a wall.
  const r=Math.max(0,selected.w/2-12);
  handle.setAttribute("transform","translate("+(selected.x+r*Math.cos(a))+" "+(selected.y+r*Math.sin(a))+")");
}
function mount(f) {
  const n = clientFurniture(f),
    tf = n.getAttribute("transform");
  n.classList.add("editable");
  n.setAttribute("tabindex", "0");
  n.setAttribute("role", "button");
  n.setAttribute("aria-label", itemName(f));
  const overlay = svg("rect", {
    x: -f.w / 2,
    y: -f.d / 2,
    width: f.w,
    height: f.d,
    transform: tf,
    fill: "#c65428",
    opacity: ".6",
  });
  nodes.set(f.id, [n, overlay]);
  $("items").append(n);
  $("overlaps").append(overlay);
  let drag = null;
  const point = (e) =>
    new DOMPoint(e.clientX, e.clientY).matrixTransform(
      board.getScreenCTM().inverse(),
    );
  n.onfocus = () => choose(f);
  n.onpointerdown = (e) => {
    if (e.button || drag) return;
    n.focus();
    choose(f);
    if (!editing) return;
    const p = point(e);
    drag = { id: e.pointerId, x: p.x - f.x, y: p.y - f.y };
    n.setPointerCapture(e.pointerId);
  };
  n.onpointermove = (e) => {
    if (drag?.id === e.pointerId) {
      const p = point(e);
      reposition(f, p.x - drag.x, p.y - drag.y);
    }
  };
  n.onlostpointercapture = () => (drag = null);
  n.onkeydown = (e) => {
    const d = {
      ArrowLeft: [-10, 0],
      ArrowRight: [10, 0],
      ArrowUp: [0, -10],
      ArrowDown: [0, 10],
    }[e.key];
    if (d) {
      e.preventDefault();
      reposition(f, f.x + d[0], f.y + d[1]);
    }
  };
}
$("measure").onclick = () => {
  if (!selected || !editing) return;
  const w = $("width").valueAsNumber,
    d = $("depth").valueAsNumber;
  if (![w, d].every((v) => Number.isFinite(v) && v >= 1 && v <= 100000)) {
    notice("בדקו את הרוחב והעומק בסנטימטרים.");
    return;
  }
  const f = selected;
  f.w = w;
  f.d = d;
  f.dimension_source = "measured";
  for (const node of nodes.get(f.id)) node.remove();
  mount(f);
  reposition(f, f.x, f.y);
  choose(f);
};
function rotateTo(angle) {
  if (!editing || !selected || !Number.isFinite(angle) || angle<0 || angle>360)return;
  selected.rotation=angle;
  reposition(selected,selected.x,selected.y);
  choose(selected);
}
$("angle").oninput=e=>rotateTo(e.target.valueAsNumber);
$("exact-angle").onchange=e=>{
  if(e.target.value && e.target.validity.valid)rotateTo(e.target.valueAsNumber);
  else if(selected)choose(selected);
};
$("add").onclick = () => {
  if (!editing) return;
  markDirty();
  const spec = FURNITURE_BY_TYPE.get($("catalog").value),
    b = bounds.get(current);
  const f = {
    id: crypto.randomUUID(),
    dimension_source: "catalog",
    type: spec.type,
    w: spec.w,
    d: spec.d,
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
    rotation: 0,
  };
  plan.furniture.push(f);
  owners.set(f.id, current);
  mount(f);
  nodes.get(f.id)[0].focus();
  choose(f);
  report();
};
$("remove").onclick = () => {
  if (!selected || !editing) return;
  markDirty();
  const id = selected.id;
  plan.furniture.splice(plan.furniture.indexOf(selected), 1);
  for (const n of nodes.get(id)) n.remove();
  nodes.delete(id);
  owners.delete(id);
  choose(null);
  report();
};
$("room").onchange = (e) => go(e.target.value);
$("overview").onclick = () => go("");

const params = new URLSearchParams(location.search),
  projectId = params.get("project");
const demoKey = "atelier-apartment-v1";
let plan,
  versions = [],
  versionId,
  reviews = [],
  comparisonPlan = null,
  canDesign = false,
  designerMode = false,
  maySave = false,
  editing = false,
  dirty = false,
  api;
const decisions = { comment: "הערה", approve: "אישור", revise: "בקשת שינוי" };
const endpoint = projectId
  ? "/v1/projects/" + encodeURIComponent(projectId)
  : "";
const app = $("workspace");
function notice(message) {
  $("notice").textContent = message;
}
function markDirty() {
  invalidateAudit();
  if (!dirty) {
    dirty = true;
    notice(maySave ? "יש שינויים בחלופה. שמרו אותה בשם חדש כדי לשתף או להשוות." : "סידור לניסיון אישי. אפשר לבטל אותו כדי לחזור לחלופה המשותפת.");
    $("revert").hidden=false;
    $("review").hidden = true;
  }
}
function syncControls() {
  $("designer").hidden = !canDesign;
  $("designer").setAttribute("aria-pressed", String(designerMode));
  $("client").setAttribute("aria-pressed", String(!designerMode));
  $("save").hidden = !maySave;
  $("editing").hidden = !editing;
  $("room-tools").hidden = !current || !editing;
  $("revert").hidden = !dirty;
  $("paneltitle").textContent = designerMode ? "שולחן התכנון" : "החלופות שלי";
  $("review").hidden = dirty;
  $("selected").textContent = current
    ? "בחרו רהיט בתוכנית"
    : "בחרו חדר כדי לפתוח את הפרטים שלו";
}
async function busy(action) {
  app.inert = true;
  try {
    await action();
  } catch (error) {
    notice("הפעולה לא הושלמה. " + error.message);
  } finally {
    app.inert = false;
  }
}
function readDemo() {
  return JSON.parse(localStorage.getItem(demoKey) || "null");
}
async function initialize() {
  if (projectId) {
    const client = await import("../api.js");
    const session=await client.requireSession();
    chatUser=session.user.id;
    api = client.api;
    const project = await api(endpoint);
    maySave=project.access==="save" && project.studio.status==="active";
    canDesign =
      project.my_role === "designer" &&
      project.access === "save" &&
      project.studio.status === "active";
    $("title").textContent = project.name;
    $("context").textContent = project.studio.name;
    $("back").textContent = "לעורך הפרויקט";
    $("back").href = "editor.html?project=" + encodeURIComponent(projectId);
    versions = await api(endpoint + "/versions");
  } else {
    if (!readDemo()) {
      const response = await fetch("assets/sample-apartment.json");
      if (!response.ok) throw Error("טעינת הדירה נכשלה");
      const original = await response.json(),
        alternative = structuredClone(original);
      const sofa = alternative.furniture.find((f) => f.type === "sofa");
      sofa.x = 310;
      sofa.y = 180;
      sofa.rotation = 25;
      localStorage.setItem(
        demoKey,
        JSON.stringify({
          versions: [
            { id: "proposal", label: "ישיבה אלכסונית", geometry: alternative },
            { id: "source", label: "הדירה המקורית", geometry: original },
          ],
          reviews: [],
        }),
      );
    }
    versions = readDemo().versions;
    canDesign = maySave = true;
    $("context").textContent = "דירת הדגמה · השמירה בדפדפן הזה";
  }
  designerMode = canDesign && params.get("mode") !== "client";
  editing = true;
  if (!versions.length) {
    notice("יש לשמור תחילה תוכנית בעורך הפרויקט.");
    app.querySelector(".workgrid").hidden = true;
    return;
  }
  await loadVersion(versions[0].id);
}
function versionName(v) {
  return v.label || "גרסה " + v.version_no;
}
async function geometry(id) {
  return projectId
    ? (await api(endpoint + "/versions/" + id)).geometry
    : structuredClone(versions.find((v) => v.id === id).geometry);
}
async function loadVersion(id) {
  const next = await geometry(id);
  const feedback = projectId
    ? await api(endpoint + "/versions/" + id + "/reviews")
    : readDemo().reviews.filter((r) => r.version_id === id);
  const other = versions.find((v) => v.id !== id);
  const comparison = other ? await geometry(other.id) : null;
  plan = next;
  versionId = id;
  invalidateAudit();
  dirty = false;
  reviews = feedback;
  comparisonPlan = comparison;
  $("version").replaceChildren(
    ...versions.map((v) => new Option(versionName(v), v.id)),
  );
  $("version").value = id;
  $("compare").replaceChildren(
    new Option("ללא השוואה", ""),
    ...versions
      .filter((v) => v.id !== id)
      .map((v) => new Option(versionName(v), v.id)),
  );
  $("compare").value = other?.id ?? "";
  indexPlan();
  go(bounds.has(current) ? current : !projectId ? "living" : "");
  notice("");
}
function drawComparison() {
  const container = $("comparison");
  const b = current && bounds.get(current);
  container.hidden = !comparisonPlan || !b;
  if (container.hidden) return;
  const canvas = $("before");
  canvas.setAttribute("viewBox", board.getAttribute("viewBox"));
  if (comparisonPlan.rooms.some((r) => r.id === current))
    drawClientPlan(canvas, comparisonPlan, current);
  else canvas.replaceChildren();
  $("compareLabel").textContent =
    (comparisonPlan.rooms.some((r) => r.id === current)
      ? "אותו מבט · "
      : "החדר חסר בחלופה · ") + $("compare").selectedOptions[0].text;
}
function showReviews() {
  $("reviews").replaceChildren(
    ...reviews
      .filter((r) => r.room_id === current)
      .map((r) => {
        const f = plan.furniture.find((f) => f.id === r.item_id);
        const li = document.createElement("li");
        li.textContent = [
          r.author_role === "designer" ? "מעצב" : "לקוח",
          f ? itemName(f) : "החדר",
          decisions[r.decision],
          r.note,
        ]
          .filter(Boolean)
          .join(" · ");
        return li;
      }),
  );
}
$("version").onchange = () => {
  const id = $("version").value;
  $("version").value = versionId;
  if (!dirty || confirm("לעבור לחלופה אחרת ולוותר על העריכה שטרם נשמרה?"))
    busy(() => loadVersion(id));
};
$("compare").onchange = () =>
  busy(async () => {
    comparisonPlan = $("compare").value
      ? await geometry($("compare").value)
      : null;
    drawComparison();
  });
$("save").onsubmit = (e) => {
  e.preventDefault();
  busy(async () => {
    if (!maySave) return;
    const label = $("label").value.trim();
    if (!label) throw Error("נדרש שם לחלופה");
    let saved;
    if (projectId) {
      saved = await api(endpoint + "/versions", {
        method: "POST",
        body: { label, geometry: plan },
      });
      versions = await api(endpoint + "/versions");
    } else {
      saved = {
        id: crypto.randomUUID(),
        label,
        geometry: structuredClone(plan),
      };
      const state = readDemo();
      state.versions.unshift(saved);
      localStorage.setItem(demoKey, JSON.stringify(state));
      versions = state.versions;
    }
    await loadVersion(saved.id);
    $("label").value = "";
    notice("החלופה נשמרה");
  });
};
$("review").onsubmit = (e) => {
  e.preventDefault();
  busy(async () => {
    if (dirty || !current) return;
    const row = {
      room_id: current,
      item_id: selected?.id ?? "",
      decision: $("decision").value,
      note: $("note").value.trim(),
    };
    if (row.decision === "comment" && !row.note)
      throw Error("יש לכתוב הערה או לבחור החלטה");
    if (projectId) {
      const path = endpoint + "/versions/" + versionId + "/reviews";
      await api(path, { method: "PUT", body: row });
      reviews = await api(path);
    } else {
      const state = readDemo();
      const role = designerMode ? "designer" : "client";
      state.reviews = state.reviews.filter(
        (r) =>
          !(
            r.version_id === versionId &&
            r.author_role === role &&
            r.room_id === current &&
            r.item_id === row.item_id
          ),
      );
      state.reviews.unshift({
        ...row,
        author_role: role,
        version_id: versionId,
      });
      localStorage.setItem(demoKey, JSON.stringify(state));
      reviews = state.reviews.filter((r) => r.version_id === versionId);
    }
    $("note").value = "";
    showReviews();
    notice("המשוב נשמר לחלופה הנבחרת");
  });
};
for (const [id, mode] of [
  ["designer", true],
  ["client", false],
])
  $(id).onclick = () => {
    if (dirty) {
      notice("שמרו את החלופה לפני המעבר בין התצוגות.");
      return;
    }
    designerMode = mode && canDesign;
    go(current);
  };
$("revert").onclick=()=>{if(dirty && confirm("לבטל את השינויים בסידור הזה?"))busy(()=>loadVersion(versionId))};
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
let chatUser;
const clearance=()=>Math.max(30,Math.min(200,Number($("clearance").value)||90));
let auditRevision=0;
function invalidateAudit(){
 auditRevision++;
 $("findings").replaceChildren();
 $("audit-result").textContent="";
 document.querySelector(".audit-target")?.classList.remove("audit-target");
}
$("clearance").onchange=()=>{ $("clearance").value=clearance();invalidateAudit();go(current) };
$("audit-run").onclick=()=>busy(async()=>{
 const revision=++auditRevision;
 const {config}=await import("../config.js");
 const resp=await fetch(config.apiUrl+"/v1/layout-audit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({geometry:plan,clearance_cm:clearance()})});
 if(!resp.ok)throw Error("בדיקת התוכנית נכשלה");
 const result=(await resp.json()).data;
 if(revision!==auditRevision)return;
 const labels={window:"בחדר לא סומן חלון",blocked:"רהיט חופף לאזור הגישה",fit:"חלק מהרהיט חורג משטח החדר הפנוי",narrow:"פתח צר מהסף",corridor:"מסדרון צר מהסף",incomplete:"גבולות החדר אינם סגורים באופן חד־משמעי",unassigned:"רהיט מחוץ לחדר מזוהה"};
 $("audit-result").textContent=(dirty?"הטיוטה הנוכחית":$("version").selectedOptions[0].text)+" · "+result.findings.length+" ממצאים · סף "+result.clearance_cm+" ס״מ";
 $("findings").replaceChildren(...result.findings.map(f=>{
 const li=document.createElement("li"),button=document.createElement("button");
 const furniture=plan.furniture.find(x=>x.id===f.target);
 const room=plan.rooms.find(x=>x.id===f.room);
 button.textContent=[room?.name,labels[f.rule],furniture?itemName(furniture):"",f.value==null?"":f.value+(["fit","blocked"].includes(f.rule)?" סמ״ר":" ס״מ")].filter(Boolean).join(" · ");
 button.onclick=()=>{go(bounds.has(f.room)?f.room:"");const node=nodes.get(f.target)?.[0]||[...board.querySelectorAll("[data-id]")].find(n=>n.dataset.id===f.target);
 if(node)node.classList.add("audit-target");if(furniture&&nodes.has(f.target))choose(furniture);
 if(f.other){const opening=[...board.querySelectorAll("[data-id]")].find(n=>n.dataset.id===f.other);opening?.classList.add("audit-target")}
 board.scrollIntoView({block:"nearest"})};li.append(button);return li;
 }));
});
busy(async()=>{await initialize();projectChat({endpoint,user:chatUser,role:()=>designerMode?"designer":"client",request:(...args)=>api(...args)})});
