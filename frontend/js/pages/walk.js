// "How we move" for one project (?project=<id>): trace a walking path from a short video in the browser,
// save it with one still frame, and pin notes on it. The video itself is never uploaded.
import { api, requireSession, signOut } from "../api.js";
import { buildPath, decodeYolo, letterbox, personScore, polylinePoints, toTensorData, YOLO_SIZE } from "../walk-logic.js";
import { $, formatDate, h, run, showStudio, toast } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else (like "..") is not used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}/walk-paths`;
const MAX_SECONDS = 30;
const SAMPLE_EVERY = 0.2; // seconds: 5 frames a second is enough for walking speed
const MAX_FRAME_WIDTH = 1280;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // the file is only read locally; this guards the tab's memory
const ROLE_LABEL = { client: "Client", designer: "Designer" };
const SVG = "http://www.w3.org/2000/svg";

let pending = null; // { points, width, height, blob, url } while a traced path waits to be saved

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

// ---- detection --------------------------------------------------------------------------------------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = h("script", { src });
    script.onload = resolve;
    script.onerror = () => reject(new Error("The person detector could not be loaded. Check your connection and try again."));
    document.head.append(script);
  });
}

let detector = null;
const ORT_DIR = "vendor/ort-1.20.1/";
const MODEL = "vendor/yolov8n.onnx"; // Ultralytics YOLOv8n (AGPL-3.0), exported to ONNX at 640x640
// The runtime and the model (about 25 MB together) load only when someone traces a path, not for viewing.
function loadDetector() {
  detector ??= (async () => {
    if (!globalThis.ort) await loadScript(`${ORT_DIR}ort.wasm.min.js`);
    const { ort } = globalThis;
    ort.env.wasm.wasmPaths = new URL(ORT_DIR, location.href).href;
    ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which this static site does not set
    const session = await ort.InferenceSession.create(MODEL, { executionProviders: ["wasm"] });
    const canvas = h("canvas", { width: YOLO_SIZE, height: YOLO_SIZE });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return {
      // Person detections in the source's own pixels, for a frame of width x height.
      async detect(source, width, height) {
        const box = letterbox(width, height);
        context.fillStyle = "rgb(114 114 114)"; // the grey YOLOv8 was trained with for padding
        context.fillRect(0, 0, YOLO_SIZE, YOLO_SIZE);
        context.drawImage(source, box.padX, box.padY, box.w, box.h);
        const pixels = context.getImageData(0, 0, YOLO_SIZE, YOLO_SIZE).data;
        const input = new ort.Tensor("float32", toTensorData(pixels), [1, 3, YOLO_SIZE, YOLO_SIZE]);
        const result = await session.run({ [session.inputNames[0]]: input });
        const output = result[session.outputNames[0]];
        return decodeYolo(output.data, output.dims[2], box);
      },
    };
  })().catch((error) => {
    detector = null; // allow another try
    console.error(error);
    throw new Error("The person detector could not be loaded. Check your connection and try again.");
  });
  return detector;
}

const once = (target, event) =>
  new Promise((resolve, reject) => {
    target.addEventListener(event, resolve, { once: true });
    target.addEventListener("error", () => reject(new Error("This video cannot be played in this browser. Try an MP4 or WebM file.")), { once: true });
  });

async function seek(video, time) {
  const done = once(video, "seeked");
  video.currentTime = time;
  await done;
}

async function trace(file, report) {
  const video = h("video", { muted: true, playsInline: true, preload: "auto" });
  const url = URL.createObjectURL(file);
  try {
    const ready = once(video, "loadeddata");
    video.src = url;
    await ready;
    // Recorded WebM files often report an unknown length until the end has been read.
    if (!Number.isFinite(video.duration)) await seek(video, 1e7);
    const duration = video.duration;
    if (!Number.isFinite(duration) || !video.videoWidth) throw new Error("This video cannot be read. Try another file.");
    if (duration > MAX_SECONDS + 0.5) throw new Error(`The video is ${Math.round(duration)} seconds long. Film up to ${MAX_SECONDS} seconds.`);

    report("Loading the person detector…");
    const model = await loadDetector();
    const width = video.videoWidth;
    const height = video.videoHeight;
    const scale = Math.min(1, MAX_FRAME_WIDTH / width);
    const canvas = h("canvas", { width: Math.round(width * scale), height: Math.round(height * scale) });
    const frames = [];
    let emptiest = Infinity;
    const times = [];
    for (let t = 0.05; t < duration; t += SAMPLE_EVERY) times.push(t);
    for (const [index, time] of times.entries()) {
      report(`Looking for the walker… ${Math.round((index / times.length) * 100)}%`);
      await seek(video, time);
      const detections = await model.detect(video, width, height);
      frames.push(detections);
      const score = personScore(detections);
      if (score < emptiest) {
        emptiest = score; // the background picture is the frame where the walker is least visible
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    }
    const points = buildPath(frames, width, height);
    if (points.length < 2) throw new Error("We could not see anyone walking. Film again with the whole body in view and the phone still.");
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("The picture could not be prepared. Try again.");
    return { points, width: canvas.width, height: canvas.height, blob, url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

// ---- drawing ----------------------------------------------------------------------------------------

// The frame with the path on top. `marker` is a point (index into points) to highlight, or null.
function figure({ url, points, width, height, notes = [] }, title, marker = null) {
  const drawing = svg("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  drawing.append(svg("polyline", { class: "walk-line", points: polylinePoints(points, width, height) }));
  const dot = (point, cls, r) => svg("circle", { class: cls, cx: point[0] * width, cy: point[1] * height, r });
  const radius = Math.max(width, height) / 90;
  drawing.append(dot(points[0], "walk-start", radius), dot(points.at(-1), "walk-end", radius));
  notes.forEach((note, i) => {
    const pin = svg("g", { class: "walk-note" });
    pin.append(dot([note.x, note.y], "", radius * 1.6));
    const label = svg("text", { x: note.x * width, y: note.y * height, "dominant-baseline": "central", "text-anchor": "middle", "font-size": radius * 1.8 });
    label.textContent = String(i + 1);
    pin.append(label);
    drawing.append(pin);
  });
  if (marker != null) drawing.append(dot(points[marker], "walk-marker", radius * 1.4));
  const image = h("img", { src: url, alt: title, width, height });
  return h("figure", { class: "walk-figure" }, image, drawing);
}

function noteItem(note, index) {
  const who = h("strong", {}, `${index + 1}. ${ROLE_LABEL[note.author_role] ?? "Someone"}`);
  const when = h("time", { class: "small muted", dateTime: note.created_at }, formatDate(note.created_at));
  const text = h("p", { class: "walk-note-text" }); // user text: textContent only
  text.textContent = note.text;
  return h("li", {}, h("div", { class: "walk-note-head" }, who, " ", when), text);
}

function pathCard(path) {
  const name = path.label || "Walking path";
  let marker = Math.floor(path.points.length / 2);
  const slot = h("div", {});
  const draw = () => slot.replaceChildren(figure(path, `${name}, drawn over the room`, marker));
  draw();

  const slider = h("input", { type: "range", min: 0, max: path.points.length - 1, value: marker, id: `where-${path.id}` });
  slider.addEventListener("input", () => {
    marker = Number(slider.value);
    draw();
  });
  // A click on the picture moves the marker to the nearest point of the path.
  slot.addEventListener("click", (event) => {
    const box = slot.querySelector("svg").getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    marker = path.points.reduce((best, p, i) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(path.points[best][0] - x, path.points[best][1] - y) ? i : best), 0);
    slider.value = marker;
    draw();
  });

  const textArea = h("textarea", { id: `note-${path.id}`, rows: 2, maxLength: 280, placeholder: "Tight here when carrying shopping bags" });
  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const form = h(
    "form",
    { class: "stack", novalidate: true },
    h("label", { for: slider.id }, "Where on the path", slider),
    h("label", { for: textArea.id }, "Note", textArea),
    h("div", {}, h("button", { class: "primary", type: "submit" }, "Add note")),
    status,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = textArea.value.trim();
    if (!text) {
      status.textContent = "Write a note first.";
      return;
    }
    const [x, y] = path.points[marker];
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const note = await api(`${base}/${path.id}/notes`, { method: "POST", body: { x, y, text } });
      path.notes.push(note);
      textArea.value = "";
      status.textContent = "Note added.";
      draw();
      list.replaceChildren(...path.notes.map(noteItem));
    } catch (error) {
      status.textContent = error.message || "Something went wrong.";
    } finally {
      button.disabled = false;
    }
  });

  const list = h("ol", { class: "walk-notes" }, ...path.notes.map(noteItem));
  const remove = h("button", { type: "button", class: "danger" }, h("span", { class: "icon", "aria-hidden": "true" }, "delete"), "Delete path");
  remove.addEventListener("click", async () => {
    if (!confirm(`Delete "${name}" and its notes? This cannot be undone.`)) return;
    remove.disabled = true;
    try {
      await api(`${base}/${path.id}`, { method: "DELETE" });
      card.remove();
      $("#paths-empty").hidden = $("#paths").children.length > 0;
    } catch (error) {
      toast(error.message || "Something went wrong.", "error");
      remove.disabled = false;
    }
  });

  const heading = h("h2", {});
  heading.textContent = name;
  const card = h(
    "section",
    { class: "card stack walk-card" },
    h("div", { class: "walk-card-head" }, h("div", {}, heading, h("p", { class: "small muted" }, `Traced ${formatDate(path.created_at)} · green dot is the start`)), remove),
    slot,
    list,
    form,
  );
  return card;
}

async function showPaths() {
  const paths = await api(base);
  $("#paths").replaceChildren(...paths.map(pathCard));
  $("#paths-empty").hidden = paths.length > 0;
}

// ---- tracing a new path -----------------------------------------------------------------------------

function clearPending() {
  if (pending) URL.revokeObjectURL(pending.url);
  pending = null;
  $("#preview").hidden = true;
  $("#preview-figure").replaceChildren();
}

async function onTrace(event) {
  event.preventDefault();
  const status = $("#trace-status");
  const file = $("#video").files[0];
  status.classList.remove("error");
  clearPending();
  if (!file) return void (status.textContent = "Choose a video first.");
  if (!file.type.startsWith("video/")) return void (status.textContent = "This file is not a video.");
  if (file.size > MAX_VIDEO_BYTES) return void (status.textContent = "This video is too large. Film up to 30 seconds.");
  $("#trace").disabled = true;
  try {
    pending = await trace(file, (message) => (status.textContent = message));
    $("#preview-figure").replaceChildren(figure(pending, "The traced path, drawn over the room"));
    $("#preview").hidden = false;
    status.textContent = `Path found with ${pending.points.length} points. Check it, then save.`;
  } catch (error) {
    status.textContent = error.message || "Something went wrong.";
    status.classList.add("error");
  } finally {
    $("#trace").disabled = false;
  }
}

async function onSave() {
  const status = $("#trace-status");
  const button = $("#save-path");
  const body = new FormData();
  body.append("file", pending.blob, "frame.jpg");
  body.append("points", JSON.stringify(pending.points));
  body.append("width", String(pending.width));
  body.append("height", String(pending.height));
  body.append("label", $("#label").value.trim());
  button.disabled = true;
  try {
    const path = await api(base, { method: "POST", body });
    $("#paths").prepend(pathCard(path));
    $("#paths-empty").hidden = true;
    clearPending();
    $("#trace-form").reset();
    status.textContent = "Path saved.";
  } catch (error) {
    status.textContent = error.message || "Something went wrong.";
    status.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const project = await api(`/v1/projects/${encodeURIComponent(projectId)}`);
  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · How we move`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  for (const page of ["editor", "design", "walk", "consultant"]) $(`#nav-${page}`).href = `${page}.html${query}`;

  $("#trace-form").addEventListener("submit", onTrace);
  $("#save-path").addEventListener("click", onSave);
  $("#discard-path").addEventListener("click", () => {
    clearPending();
    $("#trace-status").textContent = "";
  });
  await showPaths();
  $("#walk").hidden = false;
});
