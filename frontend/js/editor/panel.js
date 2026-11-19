// The PANEL.title: numeric editing of the selected element, the plan summary and the version list.
// It is rebuilt only when the selection (or version list) changes; otherwise values are refreshed in place,
// so tabbing between fields never loses focus.
import { FURNITURE_BY_TYPE, REVIEW_NOTE, ROOM_TYPES } from "../catalog.js";
import * as P from "../plan.js";
import { PANEL, ROLES, UNITS } from "../strings.js";
import { formatDate, h } from "../ui.js";

const number = (label, unit, read, write, { min = 1, max = 3000, step = 1 } = {}) => ({ label, unit, read, write, min, max, step });
const choice = (label, options, read, write) => ({ label, options, read, write });
const text = (label, read, write) => ({ label, read, write, text: true });
const set = (kind, key) => (plan, id, value) => P.patch(plan, kind, id, { [key]: value });

const SPEC = {
  walls: {
    title: (wall) => (wall.kind === "exterior" ? PANEL.wall.exterior : PANEL.wall.partition),
    review: () => true,
    fields: [
      number(PANEL.fields.length, UNITS.m, (wall) => P.metres(P.wallLength(wall)), (plan, id, m) => P.setWallLength(plan, id, m * 100), { min: 0.1, max: 100, step: 0.1 }),
      number(PANEL.fields.thickness, UNITS.cm, (wall) => wall.thickness, set("walls", "thickness"), { max: 100 }),
      choice(PANEL.fields.type, [["exterior", PANEL.exteriorOption], ["partition", PANEL.partitionOption]], (wall) => wall.kind, set("walls", "kind")),
    ],
  },
  openings: {
    title: (opening) => (opening.type === "door" ? PANEL.opening.door : PANEL.opening.window),
    review: () => true,
    fields: [
      number(PANEL.fields.width, UNITS.cm, (opening) => Math.round(opening.width), set("openings", "width"), { min: 30 }),
      number(PANEL.fields.fromWallStart, UNITS.cm, (opening) => Math.round(opening.offset), set("openings", "offset"), { min: 0, max: 100_000 }),
      choice(PANEL.fields.type, [["door", PANEL.doorOption], ["window", PANEL.windowOption]], (opening) => opening.type, set("openings", "type")),
    ],
  },
  furniture: {
    title: (item) => FURNITURE_BY_TYPE.get(item.type)?.label ?? item.type,
    review: (item) => Boolean(FURNITURE_BY_TYPE.get(item.type)?.review),
    fields: [
      number(PANEL.fields.widthX, UNITS.cm, (item) => Math.round(item.w), set("furniture", "w"), { min: 10 }),
      number(PANEL.fields.depthY, UNITS.cm, (item) => Math.round(item.d), set("furniture", "d"), { min: 10 }),
      number(PANEL.fields.rotation, UNITS.deg, (item) => Math.round(item.rotation), set("furniture", "rotation"), { min: -360, max: 360, step: 15 }),
    ],
  },
  rooms: {
    title: (room) => room.name,
    review: () => false,
    fields: [
      text(PANEL.fields.name, (room) => room.name, (plan, id, value) => (value.trim() ? P.patch(plan, "rooms", id, { name: value.trim().slice(0, 80) }) : plan)),
      choice(PANEL.fields.roomType, ROOM_TYPES, (room) => room.type, set("rooms", "type")),
    ],
  },
};

let built = { key: null, versions: null };
let syncers = [];

function fieldNode(spec, editor) {
  const control = spec.options
    ? h("select", { "aria-label": spec.label }, spec.options.map(([value, label]) => h("option", { value }, label)))
    : h("input", spec.text ? { "aria-label": spec.label, maxLength: 80 } : { "aria-label": spec.label, type: "number", min: spec.min, max: spec.max, step: spec.step, inputMode: "decimal" });
  control.addEventListener("change", () => {
    const { selection, plan } = editor;
    const value = spec.options || spec.text ? control.value : Number(control.value);
    const usable = typeof value === "string" || (control.value !== "" && Number.isFinite(value));
    if (usable) editor.commit(spec.write(plan, selection.id, typeof value === "string" ? value : Math.min(Math.max(value, spec.min), spec.max)));
    // Show what was actually applied (clamped, or unchanged if the input was not usable), even while focused.
    const item = editor.plan[selection.kind].find((candidate) => candidate.id === selection.id);
    if (item) control.value = spec.read(item);
  });
  syncers.push((item) => {
    if (document.activeElement !== control) control.value = spec.read(item);
  });
  return h("div", { class: "field" }, h("span", {}, spec.label), h("div", { class: "value" }, control, spec.unit && h("span", { class: "unit" }, spec.unit)));
}

function summaryNode() {
  const line = (label) => {
    const value = h("span", { class: "mono" });
    return { value, node: h("div", { class: "row between" }, h("span", { class: "muted" }, label), value) };
  };
  const rows = { rooms: line(PANEL.rooms), area: line(PANEL.roomArea), walls: line(PANEL.walls), openings: line(PANEL.openings), furniture: line(PANEL.furniture) };
  syncers.push((_, plan) => {
    rows.rooms.value.textContent = plan.rooms.length;
    rows.area.value.textContent = `${P.planArea(plan).toFixed(1)} ${UNITS.m2}`;
    rows.walls.value.textContent = plan.walls.length;
    rows.openings.value.textContent = plan.openings.length;
    rows.furniture.value.textContent = plan.furniture.length;
  });
  return [
    h("div", { class: "selection stack" }, h("span", { class: "label" }, PANEL.summary), Object.values(rows).map((row) => row.node)),
    h("p", { class: "muted small" }, PANEL.hint),
  ];
}

function versionsNode(versions, onLoad) {
  if (!versions) return null;
  return h("div", { class: "stack" },
    h("div", { class: "row between" }, h("span", { class: "label" }, PANEL.versions), h("span", { class: "code" }, PANEL.saved(versions.length))),
    versions.length === 0 && h("p", { class: "muted small" }, PANEL.nothingSaved),
    versions.map((version) =>
      h("button", { type: "button", class: "version", title: PANEL.loadVersion, onclick: () => onLoad(version) },
        h("span", { class: `chip ${version.author_role === "designer" ? "accent" : "ok"}` }, `גרסה ${version.version_no} · ${ROLES[version.author_role] ?? version.author_role}`),
        h("span", {}, version.label || PANEL.untitled),
        h("span", { class: "code when" }, formatDate(version.created_at)),
      ),
    ),
  );
}

export function renderInspector(root, editor, { versions, onLoadVersion }) {
  const { selection, plan } = editor;
  const item = selection ? plan[selection.kind].find((candidate) => candidate.id === selection.id) : null;
  const key = item ? `${selection.kind}:${selection.id}` : "none";
  if (key !== built.key || versions !== built.versions) {
    built = { key, versions };
    syncers = [];
    const spec = item && SPEC[selection.kind];
    const title = h("div", { class: "name" });
    if (spec) syncers.push((current) => (title.textContent = spec.title(current)));
    root.replaceChildren(
      ...[
        h("div", {}, h("h2", {}, PANEL.title), h("div", { class: "code" }, item ? PANEL.kinds[selection.kind] : PANEL.nothingSelected)),
        spec
          ? [
              h("div", { class: "selection" }, h("span", { class: "label" }, PANEL.activeSelection), title),
              h("div", { class: "stack" }, h("span", { class: "label" }, PANEL.dimensions), h("div", { class: "fields" }, spec.fields.map((field) => fieldNode(field, editor)))),
              spec.review(item) && h("p", { class: "note" }, REVIEW_NOTE),
            ]
          : summaryNode(),
        versionsNode(versions, onLoadVersion),
      ].flat().filter(Boolean),
    );
  }
  for (const sync of syncers) sync(item, plan);
}
