// Import a contractor's PDF floor plan: pick file/page, review detected walls on top of the drawing,
// calibrate the scale, then hand a draft (plan + underlay) to the editor. Everything stays in the browser.
// Text that comes from the PDF is never inserted as HTML.
import { emptyPlan, metres } from "../plan.js";
import { areaToPage, carryOverDisabled, detectScale, detectWalls, suggestScale, wallLength } from "../import/walls.js";
import { carryOverChoices, detectFurniture, fitToType, toPlanFurniture } from "../import/furniture.js";
import { calibrationFactor, imagePlacement, parseLength } from "../import/placement.js";
import { FURNITURE, FURNITURE_BY_TYPE } from "../catalog.js";
import { deleteImage, draftKey, putImage } from "../import/underlay.js";
import { svg, visibleArea } from "../editor/render.js";
import { zoomAt } from "../editor/pointer.js";
import { IMPORT, ltr } from "../strings.js";
import { KEYS, load, save } from "../store.js";
import { $, h, showStudio, toast } from "../ui.js";

// The PDF reader (pdf.js) is loaded only when a file is chosen.
let reader = null;
const loadReader = () => (reader ??= import("../import/pdf.js"));

const studio = new URLSearchParams(location.search).get("via") === "studio" ? load(KEYS.studio) : null;
if (studio) showStudio(studio.name);

const canvas = $("#import-canvas");
const MIN_VIEW = 100;

const state = {
  doc: null,
  pageNumber: 1,
  page: null, // readPage() result
  blob: null,
  imageUrl: null,
  base: null, // detectWalls() result for the current scale
  candidates: [],
  ratio: null, // chosen printed ratio, or null when none was found
  calibrated: false,
  suggested: null, // scale guessed from shapes when no ratio text exists (a suggestion until confirmed)
  confirmed: false,
  areaPage: null, // plan area the user chose, PDF units { x0, y0, x1, y1 }; null = automatic guess
  drawingArea: false,
  disabled: new Set(), // ids of walls the user switched off
  choice: new Map(), // furniture id -> { on?, type? }: what the user changed; everything else follows the detection
  layer: "all",
  opacity: 0.55,
  picking: false,
  points: [], // calibration clicks, plan cm
  view: { x: 0, y: 0, w: 1000, h: 800 },
  token: 0, // guards against a slow analysis finishing after a newer one started
};

const nodes = { image: null, outside: null, walls: null, furn: null, area: null, cal: null };
const wallNodes = new Map();
const furnNodes = new Map();
const furnRows = new Map();

// ---------------------------------------------------------------- derived data

const walls = () => state.base?.walls ?? [];
const enabledWalls = () => walls().filter((w) => !state.disabled.has(w.id));
const furniture = () => state.base?.furniture ?? [];
const typeOf = (f) => state.choice.get(f.id)?.type ?? f.type;
const isOn = (f) => Boolean(typeOf(f)) && (state.choice.get(f.id)?.on ?? true);
const fittedOf = (f) => {
  const type = typeOf(f);
  return type && type !== f.type ? { ...f, ...fitToType(f, type) } : f;
};
const labelOf = (type) => FURNITURE_BY_TYPE.get(type)?.label ?? type;
const enabledFurniture = () => toPlanFurniture(furniture(), (f) => (isOn(f) ? typeOf(f) : null));
const needsCalibration = () => state.ratio === null && !state.calibrated && !state.confirmed;
const placement = () => imagePlacement(state.page, state.base.cmPerUnit, state.base.originCm);
const lengthText = (cm) => ltr(metres(cm));

// ---------------------------------------------------------------- viewer

function setView(view) {
  state.view = view;
  canvas.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
}

function fit() {
  const p = placement();
  const pad = Math.max(p.width, p.height) * 0.03;
  setView({ x: p.x - pad, y: p.y - pad, w: p.width + 2 * pad, h: p.height + 2 * pad });
}

function drawImage() {
  const p = placement();
  nodes.image.setAttribute("href", state.imageUrl);
  for (const [key, value] of Object.entries({ x: p.x, y: p.y, width: p.width, height: p.height })) nodes.image.setAttribute(key, value);
  nodes.image.setAttribute("opacity", state.opacity);
}

function toggleWall(id) {
  if (state.disabled.has(id)) state.disabled.delete(id);
  else state.disabled.add(id);
  syncWallNodes();
  renderSummary();
}

function syncWallNodes() {
  for (const [id, node] of wallNodes) {
    const on = !state.disabled.has(id);
    node.setAttribute("aria-pressed", String(on));
    node.setAttribute("aria-label", node.dataset.label.replace("{state}", on ? "נבחר" : "לא נבחר"));
  }
}

function drawWalls() {
  wallNodes.clear();
  const list = walls();
  nodes.walls.replaceChildren(
    ...list.map((wall, i) => {
      const length = wallLength(wall);
      const coords = { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 };
      const node = svg(
        "g",
        { class: "iw", role: "button", tabindex: 0, "data-wall": wall.id, "data-kind": wall.kind, "data-length": length.toFixed(1) },
        svg("line", { ...coords, class: "hit" }),
        svg("line", { ...coords, class: "body", "stroke-width": wall.thickness }),
      );
      // The label is built once; the on/off word is filled in by syncWallNodes.
      node.dataset.label = IMPORT.wallLabel(i + 1, metres(length), true).replace("נבחר", "{state}");
      wallNodes.set(wall.id, node);
      return node;
    }),
  );
  syncWallNodes();
}

function setChoice(id, change) {
  state.choice.set(id, { ...state.choice.get(id), ...change });
}

function toggleFurniture(id) {
  const f = furniture().find((item) => item.id === id);
  if (!f) return;
  if (!typeOf(f)) return furnRows.get(id)?.querySelector("select")?.focus(); // nothing to switch on until a type is chosen
  setChoice(id, { on: !isOn(f) });
  syncFurniture();
}

function syncFurniture() {
  for (const f of furniture()) {
    const g = fittedOf(f);
    const type = typeOf(f);
    const on = isOn(f);
    const node = furnNodes.get(f.id);
    node.setAttribute("transform", `translate(${g.x} ${g.y}) rotate(${g.rotation})`);
    node.setAttribute("aria-pressed", String(on));
    node.dataset.type = type ?? "";
    node.setAttribute("aria-label", type ? IMPORT.furnitureLabel(labelOf(type), Math.round(g.w), Math.round(g.d), on) : IMPORT.furnitureLabelUnknown(Math.round(g.w), Math.round(g.d)));
    const [rect, text] = node.children;
    rect.setAttribute("x", -g.w / 2);
    rect.setAttribute("y", -g.d / 2);
    rect.setAttribute("width", g.w);
    rect.setAttribute("height", g.d);
    text.textContent = type ? labelOf(type) : IMPORT.chooseType;
    const row = furnRows.get(f.id);
    row.querySelector("select").value = type ?? "";
    const box = row.querySelector("input");
    box.checked = on;
    box.disabled = !type;
    row.querySelector(".dims").textContent = ltr(`${Math.round(g.w)} × ${Math.round(g.d)}`);
  }
  renderSummary();
}

function drawFurniture() {
  furnNodes.clear();
  furnRows.clear();
  const list = furniture();
  nodes.furn.replaceChildren(
    ...list.map((f) => {
      const font = Math.min(Math.max(Math.min(f.w, f.d) * 0.22, 10), 22);
      const node = svg(
        "g",
        { class: "if", role: "button", tabindex: 0, "data-furn": f.id, "data-type": f.type ?? "", "aria-pressed": "false" },
        svg("rect", {}),
        svg("text", { y: font * 0.35, "font-size": font }),
      );
      furnNodes.set(f.id, node);
      return node;
    }),
  );
  const groups = [...new Set(FURNITURE.map((spec) => spec.group))];
  $("#furniture-list").replaceChildren(
    ...list.map((f) => {
      const select = h(
        "select",
        { "aria-label": IMPORT.typeFor(f.type ? labelOf(f.type) : IMPORT.chooseType), onchange: () => onType(f.id, select.value) },
        h("option", { value: "" }, IMPORT.chooseType),
        ...groups.map((group) =>
          h("optgroup", { label: group }, ...FURNITURE.filter((spec) => spec.group === group).map((spec) => h("option", { value: spec.type }, spec.label))),
        ),
      );
      const box = h("input", { type: "checkbox", "aria-label": IMPORT.furnitureImport, onchange: () => toggleFurniture(f.id) });
      const row = h("li", { "data-furn-row": f.id }, h("label", {}, box, " ", IMPORT.furnitureImport), h("span", { class: "dims" }), select);
      row.addEventListener("focusin", () => furnNodes.get(f.id)?.classList.add("current"));
      row.addEventListener("focusout", () => furnNodes.get(f.id)?.classList.remove("current"));
      furnRows.set(f.id, row);
      return row;
    }),
  );
  syncFurniture();
}

function onType(id, type) {
  const f = furniture().find((item) => item.id === id);
  if (!f) return;
  if (!type && !f.type) state.choice.delete(id);
  else setChoice(id, { type: type || f.type });
  syncFurniture();
}

function drawArea() {
  const a = state.base?.areaCm;
  nodes.outside.replaceChildren(
    ...(state.base?.outside ?? []).map((w) => svg("line", { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, class: "ow", "stroke-width": w.thickness })),
  );
  nodes.area.replaceChildren(...(a ? [svg("rect", { x: a.x, y: a.y, width: a.w, height: a.h, class: "area-rect", "data-area": "" })] : []));
  const ids = { "area-x0": a?.x, "area-y0": a?.y, "area-x1": a ? a.x + a.w : undefined, "area-y1": a ? a.y + a.h : undefined };
  for (const [id, v] of Object.entries(ids)) $(`#${id}`).value = v === undefined ? "" : String(Math.round(v));
  $("#area-hint").textContent = state.areaPage ? IMPORT.areaHintManual : IMPORT.areaHint;
  $("#area-reset").disabled = !state.areaPage;
}

function drawCalibration() {
  const scale = visibleArea(canvas).scale;
  const [a, b] = state.points;
  nodes.cal.replaceChildren(
    ...(a && b ? [svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "cal-line" })] : []),
    ...state.points.map((p) => svg("circle", { cx: p.x, cy: p.y, r: 6 * scale, class: "cal-dot" })),
  );
}

const toPlan = (event) => {
  const inverse = canvas.getScreenCTM().inverse();
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  return { x: p.x, y: p.y };
};

function attachViewer() {
  nodes.image = svg("image", { preserveAspectRatio: "none", "pointer-events": "none" });
  nodes.outside = svg("g");
  nodes.walls = svg("g");
  nodes.furn = svg("g");
  nodes.area = svg("g", { "pointer-events": "none" });
  nodes.cal = svg("g", { "pointer-events": "none" });
  canvas.replaceChildren(nodes.image, nodes.outside, nodes.walls, nodes.furn, nodes.area, nodes.cal);

  let drag = null;
  let box = null; // plan-area rectangle being drawn: { id, from, rect }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (state.drawingArea) {
      const from = toPlan(event);
      box = { id: event.pointerId, from, rect: svg("rect", { class: "area-draft", x: from.x, y: from.y, width: 0, height: 0 }) };
      nodes.cal.append(box.rect);
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, view: state.view, inverse: canvas.getScreenCTM().inverse(), moved: false, target: event.target.closest?.("[data-wall], [data-furn]") };
    drag.start = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (box && event.pointerId === box.id) {
      const p = toPlan(event);
      box.rect.setAttribute("x", Math.min(box.from.x, p.x));
      box.rect.setAttribute("y", Math.min(box.from.y, p.y));
      box.rect.setAttribute("width", Math.abs(p.x - box.from.x));
      box.rect.setAttribute("height", Math.abs(p.y - box.from.y));
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    const now = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
    setView({ ...drag.view, x: drag.view.x - (now.x - drag.start.x), y: drag.view.y - (now.y - drag.start.y) });
  });
  const finish = (event) => {
    if (box && event.pointerId === box.id) {
      const done = box;
      box = null;
      done.rect.remove();
      const p = toPlan(event);
      if (event.type === "pointerup" && Math.abs(p.x - done.from.x) >= 20 && Math.abs(p.y - done.from.y) >= 20) {
        setArea({ x: Math.min(done.from.x, p.x), y: Math.min(done.from.y, p.y), w: Math.abs(p.x - done.from.x), h: Math.abs(p.y - done.from.y) });
      }
      return;
    }
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    if (current.moved || event.type === "pointercancel") return;
    if (state.picking) pickPoint(current.start);
    else if (current.target?.dataset.furn) toggleFurniture(current.target.dataset.furn);
    else if (current.target) toggleWall(current.target.dataset.wall);
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("keydown", (event) => {
    const node = event.target.closest?.("[data-wall], [data-furn]");
    if (!node || state.picking || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (node.dataset.furn) toggleFurniture(node.dataset.furn);
    else toggleWall(node.dataset.wall);
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, toPlan(event));
    },
    { passive: false },
  );
  const zoom = (factor, at) => {
    const area = visibleArea(canvas);
    const point = at ?? { x: area.x + area.w / 2, y: area.y + area.h / 2 };
    const next = zoomAt(state.view, point, factor);
    if (next.w >= MIN_VIEW && next.w <= 400_000) setView(next);
  };
  $("#v-zoom-in").addEventListener("click", () => zoom(1 / 1.3));
  $("#v-zoom-out").addEventListener("click", () => zoom(1.3));
  $("#v-zoom-fit").addEventListener("click", fit);
}

// ---------------------------------------------------------------- plan area

// The area is kept in PDF units, so it survives a change of scale or a recalibration.
function setArea(areaCm) {
  state.areaPage = areaToPage(areaCm, state.base);
  setDrawingArea(false);
  redetect(state.base.cmPerUnit);
  refresh();
}

function setDrawingArea(on) {
  state.drawingArea = on;
  canvas.classList.toggle("drawing", on);
  $("#area-draw").setAttribute("aria-pressed", String(on));
  $("#area-draw").textContent = on ? IMPORT.areaDrawing : IMPORT.areaDraw;
}

function applyAreaInputs() {
  const [x0, y0, x1, y1] = ["x0", "y0", "x1", "y1"].map((id) => Number($(`#area-${id}`).value.trim().replace(",", ".")));
  if (![x0, y0, x1, y1].every(Number.isFinite) || Math.abs(x1 - x0) < 20 || Math.abs(y1 - y0) < 20) return toast(IMPORT.badLength, "error");
  setArea({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
}

// ---------------------------------------------------------------- calibration

function setPicking(on) {
  if (on) setDrawingArea(false);
  state.picking = on;
  state.points = [];
  canvas.classList.toggle("picking", on);
  $("#calibrate-panel").hidden = !on;
  $("#calibrate").hidden = on;
  $("#real-length").value = "";
  showCalibrationState();
  drawCalibration();
}

function pickPoint(point) {
  state.points = state.points.length >= 2 ? [point] : [...state.points, point];
  showCalibrationState();
  drawCalibration();
}

function measured() {
  const [a, b] = state.points;
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}

function showCalibrationState() {
  const ready = state.points.length === 2;
  $("#measured").hidden = !ready;
  $("#real-length-row").hidden = !ready;
  $("#calibrate-apply").disabled = !ready;
  $("#calibrate-error").hidden = true;
  if (ready) $("#measured").textContent = IMPORT.calibrateMeasured(lengthText(measured()));
}

function applyCalibration() {
  const error = $("#calibrate-error");
  const real = parseLength($("#real-length").value, $("#real-unit").value);
  const distance = measured();
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  if (real === null || !(distance > 0)) return fail(IMPORT.badLength);
  const multiplier = calibrationFactor(distance, real);
  if (multiplier === null) return fail(IMPORT.badFactor);
  // Detection thresholds are in cm, so the walls are detected again at the corrected scale instead of just stretched.
  redetect(state.base.cmPerUnit * multiplier);
  state.calibrated = true;
  setPicking(false);
  refresh();
  fit();
}

// ---------------------------------------------------------------- side panel

function renderSummary() {
  const items = furniture();
  const known = items.filter((f) => f.type).length;
  $("#furniture-card").hidden = items.length === 0;
  $("#furniture-count").textContent = items.length ? IMPORT.furnitureSummary(known, items.length - known) : IMPORT.furnitureNone;
  const kinds = new Map();
  for (const f of items) if (typeOf(f)) kinds.set(typeOf(f), (kinds.get(typeOf(f)) ?? 0) + 1);
  $("#furniture-kinds").textContent = [...kinds].map(([type, n]) => `${labelOf(type)} ${n}`).join(" · ");
  $("#furniture-selected").textContent = items.length ? `${IMPORT.furnitureSelected(items.filter(isOn).length, items.length)} ${items.length > known ? IMPORT.furnitureUnidentifiedHint : ""}`.trim() : "";
  const total = walls().length;
  $("#walls-count").textContent = total ? IMPORT.wallsSelected(enabledWalls().length, total) : "";
  const blocked = needsCalibration();
  $("#continue").disabled = blocked;
  $("#continue-error").hidden = !blocked;
  $("#continue-error").textContent = blocked ? IMPORT.needCalibration : "";
}

function renderAll() {
  const { base } = state;
  const total = walls().length;
  $("#confidence").textContent = total === 0 ? IMPORT.confidence.none : base.confidence >= 0.75 ? IMPORT.confidence.good : base.confidence >= 0.4 ? IMPORT.confidence.partial : IMPORT.confidence.weak;
  $("#warnings").replaceChildren(
    ...base.warnings.filter((code) => IMPORT.warnings[code]).map((code) => h("li", {}, IMPORT.warnings[code])),
    ...(base.wallsAsFurniture ? [h("li", {}, IMPORT.wallsAsFurniture(base.wallsAsFurniture))] : []),
  );

  const suggesting = state.ratio === null && !state.calibrated && state.suggested !== null;
  $("#scale-text").textContent = state.calibrated
    ? IMPORT.scaleCalibrated
    : state.ratio !== null
      ? IMPORT.scaleDetected(state.ratio)
      : suggesting
        ? state.confirmed
          ? IMPORT.scaleConfirmed(state.suggested)
          : IMPORT.scaleSuggested(state.suggested)
        : IMPORT.scaleMissing;
  $("#scale-confirm").hidden = !(suggesting && !state.confirmed);
  const options = suggesting ? SUGGESTED_RATIOS : state.candidates;
  const choose = suggesting || state.candidates.length > 1;
  $("#scale-candidates").hidden = !choose;
  if (choose) {
    $("#candidates-legend").textContent = suggesting ? IMPORT.scaleSuggestedChoose : IMPORT.scaleCandidates;
    $("#candidates-list").replaceChildren(
      ...options.map((ratio) =>
        h(
          "label",
          {},
          h("input", {
            type: "radio",
            name: "scale-candidate",
            value: String(ratio),
            checked: !state.calibrated && ratio === (suggesting ? state.suggested : state.ratio),
            onchange: () => (suggesting ? chooseSuggested(ratio) : chooseRatio(ratio)),
          }),
          `1:${ratio}`,
        ),
      ),
    );
  }
  const longest = walls().reduce((best, w) => (!best || wallLength(w) > wallLength(best) ? w : best), null);
  $("#sample-wall").textContent = longest ? IMPORT.sampleWall(lengthText(wallLength(longest))) : "";
  renderSummary();
}

// ---------------------------------------------------------------- analysis

const SUGGESTED_RATIOS = [20, 50, 100];

function detect(cmPerUnit) {
  const page = state.page.hasVector ? state.page : { ...state.page, paths: [] };
  const result = detectWalls(page, { cmPerUnit, area: state.areaPage ?? undefined });
  if (!state.page.hasVector && !result.warnings.includes("no_vector")) result.warnings.push("no_vector");
  if (state.ratio === null && !state.calibrated && state.suggested !== null && !result.warnings.includes("no_scale")) result.warnings.push("no_scale");
  // Furniture next: counters and sofas that were read as thick walls become furniture and leave the wall list.
  const found = detectFurniture(page, { cmPerUnit: result.cmPerUnit, areaPage: state.areaPage ?? undefined, walls: result });
  const explained = new Set(found.wallsExplained);
  result.walls = result.walls.filter((w) => !explained.has(w.id));
  result.wallsAsFurniture = explained.size;
  result.furniture = found.items;
  for (const code of found.warnings) if (!result.warnings.includes(code) && code !== "no_scale" && code !== "no_area") result.warnings.push(code);
  return result;
}

// A new detection (other scale, calibration, other area) keeps the walls the user switched off.
function redetect(cmPerUnit) {
  const previous = state.base;
  const next = detect(cmPerUnit);
  state.disabled = previous ? carryOverDisabled(previous, state.disabled, next) : new Set();
  state.choice = previous ? carryOverChoices(previous.furniture, previous, state.choice, next.furniture, next) : new Map();
  state.base = next;
}

function refresh() {
  drawWalls();
  drawFurniture();
  drawArea();
  drawImage();
  renderAll();
}

function chooseRatio(ratio) {
  state.ratio = ratio;
  state.calibrated = false;
  redetect((2.54 / 72) * ratio);
  setPicking(false);
  refresh();
  fit();
}

function chooseSuggested(ratio) {
  state.suggested = ratio;
  state.confirmed = false;
  redetect((2.54 / 72) * ratio);
  refresh();
  fit();
}

function showError(message) {
  $("#file-error").textContent = message;
  $("#file-error").hidden = !message;
}

function setStatus(message) {
  $("#status").textContent = message;
  $("#status").hidden = !message;
}

function resetImage() {
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = null;
  state.blob = null;
}

async function analyze(pageNumber) {
  const token = ++state.token;
  const { readPage, renderPage } = await loadReader();
  $("#step-review").hidden = true;
  showError("");
  setStatus(IMPORT.analyzing);
  try {
    const page = await readPage(state.doc, pageNumber);
    const rendered = await renderPage(state.doc, pageNumber);
    if (token !== state.token) return;
    const scale = detectScale(page.texts);
    resetImage();
    state.pageNumber = pageNumber;
    state.page = page;
    state.blob = rendered.blob;
    state.imageUrl = URL.createObjectURL(rendered.blob);
    state.candidates = scale.candidates;
    state.ratio = scale.ratio;
    state.calibrated = false;
    state.confirmed = false;
    state.areaPage = null;
    state.base = null;
    state.disabled = new Set();
    state.choice = new Map();
    state.suggested = scale.ratio === null && page.hasVector ? suggestScale(page).ratio : null;
    redetect(scale.cmPerUnit ?? (state.suggested ? (2.54 / 72) * state.suggested : undefined));
    setPicking(false);
    setDrawingArea(false);
    $("#step-review").hidden = false;
    refresh();
    fit();
    setStatus("");
    $("#step-review").scrollIntoView?.({ block: "nearest" });
  } catch (error) {
    if (token !== state.token) return;
    setStatus("");
    showError(IMPORT.errors[error?.code] ?? IMPORT.errors.generic);
  }
}

async function onFile() {
  const file = $("#pdf-file").files?.[0];
  state.token += 1;
  state.doc = null;
  $("#step-pages").hidden = true;
  $("#step-review").hidden = true;
  showError("");
  setStatus("");
  if (!file) return;
  setStatus(IMPORT.analyzing);
  try {
    const { openPdf } = await loadReader();
    const { doc, pageCount } = await openPdf(file);
    state.doc = doc;
    setStatus("");
    if (pageCount > 1) {
      $("#pages-prompt").textContent = IMPORT.pickPage(pageCount);
      $("#page-select").replaceChildren(...Array.from({ length: pageCount }, (_, i) => h("option", { value: String(i + 1) }, IMPORT.pageOption(i + 1))));
      $("#step-pages").hidden = false;
    } else {
      await analyze(1);
    }
  } catch (error) {
    setStatus("");
    showError(IMPORT.errors[error?.code] ?? IMPORT.errors.generic);
  }
}

// ---------------------------------------------------------------- continue to the editor

async function proceed() {
  const name = $("#project-name").value.trim();
  if (!name) {
    $("#project-name").focus();
    return toast(IMPORT.nameProject, "error");
  }
  if (needsCalibration()) return toast(IMPORT.needCalibration, "error");
  const button = $("#continue");
  button.disabled = true;
  try {
    const p = placement();
    const key = draftKey();
    const stored = await putImage(key, state.blob);
    if (!stored) toast(IMPORT.backgroundNotKept, "error");
    const previous = load(KEYS.draft)?.underlay?.key;
    const draft = {
      name,
      property_type: document.querySelector("input[name=property_type]:checked").value,
      ...(studio ? { studio } : {}),
      plan: { ...emptyPlan(), walls: enabledWalls(), furniture: enabledFurniture() },
      ...(stored ? { underlay: { key, x: p.x, y: p.y, width: p.width, height: p.height, opacity: state.opacity } } : {}),
    };
    if (!save(KEYS.draft, draft)) {
      if (stored) await deleteImage(key);
      throw new Error(IMPORT.storageBlocked);
    }
    if (previous && previous !== key) await deleteImage(previous);
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    location.assign("editor.html");
  } catch (error) {
    toast(error.message || IMPORT.errors.generic, "error");
    button.disabled = false;
  }
}

// ---------------------------------------------------------------- wiring

attachViewer();
$("#pdf-file").addEventListener("change", onFile);
$("#page-go").addEventListener("click", () => analyze(Number($("#page-select").value)));
$("#calibrate").addEventListener("click", () => setPicking(true));
$("#scale-confirm").addEventListener("click", () => {
  state.confirmed = true;
  renderAll();
});
$("#area-draw").addEventListener("click", () => {
  setPicking(false);
  setDrawingArea(!state.drawingArea);
});
$("#area-reset").addEventListener("click", () => {
  state.areaPage = null;
  redetect(state.base.cmPerUnit);
  refresh();
});
$("#area-apply").addEventListener("click", applyAreaInputs);
$("#calibrate-cancel").addEventListener("click", () => setPicking(false));
$("#calibrate-apply").addEventListener("click", applyCalibration);
$("#real-length").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyCalibration();
  }
});
$("#opacity").addEventListener("input", (event) => {
  state.opacity = Number(event.target.value);
  if (state.base) nodes.image.setAttribute("opacity", state.opacity);
});
$("#continue").addEventListener("click", proceed);
for (const radio of document.querySelectorAll("input[name=layer]")) {
  radio.addEventListener("change", () => {
    state.layer = radio.value;
    canvas.dataset.layer = radio.value;
  });
}
window.addEventListener("pagehide", () => state.imageUrl && URL.revokeObjectURL(state.imageUrl));
