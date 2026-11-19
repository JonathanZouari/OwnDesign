import { ROOM_TYPES } from "../catalog.js";
import { emptyPlan, fromRooms, metres, planBox, roomBox } from "../plan.js";
import { svg } from "../editor/render.js";
import { UNITS, WIZARD, ltr } from "../strings.js";
import { KEYS, load, save } from "../store.js";
import { deleteImage } from "../import/underlay.js";
import { $, action, h, showStudio } from "../ui.js";

const MAX_ROOMS = 30;
const MIN_CM = 50;
const MAX_CM = 3000;
const PRESETS = [
  { label: WIZARD.presets["Living Room"], icon: "weekend", type: "living", width: 500, length: 400 },
  { label: WIZARD.presets["Primary Bed"], icon: "bed", type: "bedroom", width: 400, length: 350 },
  { label: WIZARD.presets.Kitchen, icon: "countertops", type: "kitchen", width: 350, length: 300 },
  { label: WIZARD.presets.Bathroom, icon: "bathtub", type: "bathroom", width: 250, length: 200 },
  { label: WIZARD.presets["Home Office"], icon: "desk", type: "other", width: 300, length: 300 },
  { label: WIZARD.presets.Custom, icon: "add_circle", type: "other", width: 300, length: 300 },
];

// Only a visitor who just came through a studio link works with that studio; a homeowner who once
// opened such a link in this browser must not have new projects attached to it silently.
const studio = new URLSearchParams(location.search).get("via") === "studio" ? load(KEYS.studio) : null;
const form = $("#wizard");
// Rooms are replaced, never mutated: each edit builds a new array.
let rooms = [
  { name: WIZARD.presets["Living Room"], type: "living", width: 500, length: 400 },
  { name: WIZARD.presets["Primary Bed"], type: "bedroom", width: 400, length: 350 },
];
let current = 0;

const area = (room) => (room.width * room.length) / 10_000;
const toCm = (value) => Math.min(Math.max(Math.round(Number(value) * 10) * 10 || MIN_CM, MIN_CM), MAX_CM);

function setRooms(next, select = current) {
  rooms = next;
  current = Math.min(Math.max(select, 0), rooms.length - 1);
  renderEditor();
  renderDerived();
}

const updateCurrent = (changes) => {
  rooms = rooms.map((room, i) => (i === current ? { ...room, ...changes } : room));
  renderDerived();
};

// The edit form is only refilled when the selection changes, so typing is never interrupted.
function renderEditor() {
  const room = rooms[current];
  $("#room-editor").hidden = !room;
  if (!room) return;
  $("#room-id").textContent = WIZARD.roomId(current + 1);
  $("#room-name").value = room.name;
  $("#room-type").value = room.type;
  $("#room-width").value = metres(room.width);
  $("#room-length").value = metres(room.length);
}

function renderPreview() {
  const plan = fromRooms(rooms);
  const bounds = planBox(plan);
  const pad = 60;
  const font = Math.max(bounds.w, bounds.h * 1.6) / 34;
  const preview = $("#preview");
  preview.setAttribute("viewBox", `${bounds.x - pad} ${bounds.y - pad} ${bounds.w + 2 * pad} ${bounds.h + 2 * pad}`);
  preview.replaceChildren(
    ...plan.rooms.flatMap((planRoom, i) => {
      const b = roomBox(plan, planRoom.id);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const rect = svg("rect", { x: b.x, y: b.y, width: b.w, height: b.h, class: i === current ? "room current" : "room" });
      rect.addEventListener("click", () => setRooms(rooms, i));
      const name = svg("text", { x: cx, y: cy, "text-anchor": "middle", "font-size": font, "font-weight": 500 }, rooms[i].name);
      const size = svg("text", { x: cx, y: cy + font * 1.3, "text-anchor": "middle", "font-size": font * 0.8 }, `${area(rooms[i]).toFixed(1)} ${UNITS.m2}`);
      return [rect, name, size];
    }),
  );
}

function renderDerived() {
  const room = rooms[current];
  const total = rooms.reduce((sum, each) => sum + area(each), 0);
  if (room) $("#room-area").textContent = `${area(room).toFixed(2)} ${UNITS.m2}`;
  $("#total-area").textContent = `${total.toFixed(1)} ${UNITS.m2}`;
  $("#total-chip").textContent = WIZARD.total(total.toFixed(1));
  $("#room-count").textContent = WIZARD.configured(rooms.length);
  $("#no-rooms").hidden = rooms.length > 0;
  $("#room-list").replaceChildren(
    ...rooms.map((each, i) =>
      h(
        "li",
        { class: i === current ? "current" : "" },
        h(
          "div",
          { class: "grow" },
          h("div", { class: "name" }, each.name || WIZARD.unnamedRoom),
          h("div", { class: "code" }, `${ltr(`${metres(each.width)} × ${metres(each.length)}`)} ${UNITS.m}`),
        ),
        h("span", { class: "mono" }, `${area(each).toFixed(1)} ${UNITS.m2}`),
        h("button", { type: "button", "aria-label": WIZARD.edit(each.name), onclick: () => setRooms(rooms, i) }, h("span", { class: "icon", "aria-hidden": "true" }, "edit")),
        h(
          "button",
          { type: "button", "aria-label": WIZARD.remove(each.name), onclick: () => setRooms(rooms.filter((_, j) => j !== i), current > i ? current - 1 : current) },
          h("span", { class: "icon", "aria-hidden": "true" }, "delete"),
        ),
      ),
    ),
  );
  renderPreview();
}

function addRoom(room) {
  if (rooms.length >= MAX_ROOMS) return;
  setRooms([...rooms, room], rooms.length);
  $("#room-name").focus();
  $("#room-name").select();
}

function start() {
  if (studio) showStudio(studio.name);
  $("#draft-notice").hidden = !load(KEYS.draft);
  form.hidden = false;
  if (studio) $("#import-link").href = "import.html?via=studio";
  // Buying from a contractor usually means a drawing exists, so the import button stands out then.
  const syncImport = () => $("#import-link").classList.toggle("accent", form.elements.property_type.value === "new_build");
  for (const radio of form.querySelectorAll("input[name=property_type]")) radio.addEventListener("change", syncImport);
  syncImport();

  $("#room-type").replaceChildren(...ROOM_TYPES.map(([value, label]) => h("option", { value }, label)));
  $("#presets").replaceChildren(
    ...PRESETS.map(({ label, icon, ...room }) =>
      h("button", { type: "button", onclick: () => addRoom({ name: label === WIZARD.presets.Custom ? WIZARD.newRoom : label, ...room }) }, h("span", { class: "icon", "aria-hidden": "true" }, icon), label),
    ),
  );

  $("#room-name").addEventListener("input", (event) => updateCurrent({ name: event.target.value }));
  $("#room-type").addEventListener("change", (event) => updateCurrent({ type: event.target.value }));
  for (const [id, key] of [["room-width", "width"], ["room-length", "length"]]) {
    const input = $(`#${id}`);
    // Clamp and tidy the number only when the user leaves the field, not on every keystroke.
    input.addEventListener("input", () => updateCurrent({ [key]: toCm(input.value) }));
    input.addEventListener("change", () => (input.value = metres(rooms[current][key])));
  }
  for (const button of form.querySelectorAll("[data-step]")) {
    button.addEventListener("click", () => {
      const input = $(`#${button.dataset.for}`);
      input.value = metres(toCm(Number(input.value) + Number(button.dataset.step)));
      input.dispatchEvent(new Event("input"));
    });
  }
  $("#duplicate-room").addEventListener("click", () => addRoom({ ...rooms[current], name: WIZARD.copyOf(rooms[current].name).slice(0, 80) }));
  $("#delete-room").addEventListener("click", () => setRooms(rooms.filter((_, i) => i !== current)));

  form.addEventListener(
    "submit",
    action(async (event) => {
      const blank = event.submitter?.value === "blank";
      const named = rooms.map((room) => ({ ...room, name: room.name.trim() }));
      const unnamed = named.findIndex((room) => !room.name);
      if (!blank && unnamed >= 0) {
        setRooms(rooms, unnamed);
        $("#room-name").focus();
        throw new Error(WIZARD.nameEveryRoom);
      }
      const data = new FormData(form);
      if (!data.get("name").trim()) throw new Error(WIZARD.nameProject);
      const draft = { name: data.get("name").trim(), property_type: data.get("property_type"), ...(studio ? { studio } : {}), plan: blank ? emptyPlan() : fromRooms(named) };
      const replaced = load(KEYS.draft)?.underlay?.key;
      if (!save(KEYS.draft, draft)) throw new Error(WIZARD.storageBlocked);
      if (replaced) await deleteImage(replaced); // the replaced draft's background drawing is no longer needed
      location.assign("editor.html");
    }),
  );

  renderEditor();
  renderDerived();
}

start();
