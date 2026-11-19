// Import a contractor's PDF floor plan: pick file/page, review detected walls on top of the drawing,
// calibrate the scale, then hand a draft (plan + underlay) to the editor. Everything stays in the browser.
// Text that comes from the PDF is never inserted as HTML.
import { emptyPlan, metres } from "../plan.js";
import { detectScale, detectWalls, wallLength } from "../import/walls.js";
import { calibrationFactor, imagePlacement, parseLength } from "../import/placement.js";
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
  disabled: new Set(), // ids of walls the user switched off
  opacity: 0.55,
  picking: false,
  points: [], // calibration clicks, plan cm
  view: { x: 0, y: 0, w: 1000, h: 800 },
  token: 0, // guards against a slow analysis finishing after a newer one started
};

const nodes = { image: null, walls: null, cal: null };
const wallNodes = new Map();

// ---------------------------------------------------------------- derived data

const walls = () => state.base?.walls ?? [];
const enabledWalls = () => walls().filter((w) => !state.disabled.has(w.id));
const needsCalibration = () => state.ratio === null && !state.calibrated;
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
  nodes.walls = svg("g");
  nodes.cal = svg("g", { "pointer-events": "none" });
  canvas.replaceChildren(nodes.image, nodes.walls, nodes.cal);

  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, view: state.view, inverse: canvas.getScreenCTM().inverse(), moved: false, target: event.target.closest?.("[data-wall]") };
    drag.start = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    const now = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
    setView({ ...drag.view, x: drag.view.x - (now.x - drag.start.x), y: drag.view.y - (now.y - drag.start.y) });
  });
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    if (current.moved || event.type === "pointercancel") return;
    if (state.picking) pickPoint(current.start);
    else if (current.target) toggleWall(current.target.dataset.wall);
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("keydown", (event) => {
    const node = event.target.closest?.("[data-wall]");
    if (!node || state.picking || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    toggleWall(node.dataset.wall);
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

// ---------------------------------------------------------------- calibration

function setPicking(on) {
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
  state.base = detect(state.base.cmPerUnit * multiplier);
  state.disabled = new Set();
  state.calibrated = true;
  setPicking(false);
  drawWalls();
  drawImage();
  fit();
  renderAll();
}

// ---------------------------------------------------------------- side panel

function renderSummary() {
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
  $("#warnings").replaceChildren(...base.warnings.filter((code) => IMPORT.warnings[code]).map((code) => h("li", {}, IMPORT.warnings[code])));

  $("#scale-text").textContent = state.calibrated ? IMPORT.scaleCalibrated : state.ratio === null ? IMPORT.scaleMissing : IMPORT.scaleDetected(state.ratio);
  const choose = state.candidates.length > 1;
  $("#scale-candidates").hidden = !choose;
  if (choose) {
    $("#candidates-legend").textContent = IMPORT.scaleCandidates;
    $("#candidates-list").replaceChildren(
      ...state.candidates.map((ratio) =>
        h(
          "label",
          {},
          h("input", { type: "radio", name: "scale-candidate", value: String(ratio), checked: !state.calibrated && ratio === state.ratio, onchange: () => chooseRatio(ratio) }),
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

function detect(cmPerUnit) {
  const page = state.page.hasVector ? state.page : { ...state.page, paths: [] };
  const result = detectWalls(page, { cmPerUnit });
  if (!state.page.hasVector && !result.warnings.includes("no_vector")) result.warnings.push("no_vector");
  return result;
}

function chooseRatio(ratio) {
  state.ratio = ratio;
  state.calibrated = false;
  state.disabled = new Set();
  state.base = detect((2.54 / 72) * ratio);
  setPicking(false);
  drawWalls();
  drawImage();
  fit();
  renderAll();
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
    state.disabled = new Set();
    state.base = detect(scale.cmPerUnit ?? undefined);
    setPicking(false);
    $("#step-review").hidden = false;
    drawWalls();
    drawImage();
    fit();
    renderAll();
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
      plan: { ...emptyPlan(), walls: enabledWalls() },
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
window.addEventListener("pagehide", () => state.imageUrl && URL.revokeObjectURL(state.imageUrl));
