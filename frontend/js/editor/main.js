// Editor controller: owns the state, wires tools, keyboard, zoom, save and versions.
// Two modes: a saved project (?project=<id>, needs sign-in) or a local draft (guest or not yet saved).
import { api, getSession, requireSession, signOut } from "../api.js";
import { FURNITURE } from "../catalog.js";
import * as P from "../plan.js";
import { KEYS, load, save as store } from "../store.js";
import { $, action, h, run, showStudio, toast } from "../ui.js";
import { renderInspector } from "./panel.js";
import { attachPointer, zoomAt } from "./pointer.js";
import { draw, visibleArea } from "./render.js";

const TOOLS = [
  { id: "select", icon: "near_me", key: "V", label: "Select and move" },
  { id: "exterior", icon: "polyline", key: "W", label: "Draw exterior wall" },
  { id: "partition", icon: "vertical_split", key: "P", label: "Draw partition" },
  { id: "door", icon: "meeting_room", key: "D", label: "Place door" },
  { id: "window", icon: "window", key: "N", label: "Place window" },
  { id: "furniture", icon: "chair", key: "F", label: "Furniture catalog" },
];
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const params = new URLSearchParams(location.search);
const projectId = params.get("project");
const canvas = $("#canvas");

const state = {
  history: null,
  live: null, // plan being dragged, not yet in history
  selection: null,
  tool: "select",
  catalogOpen: false,
  view: { x: 0, y: 0, w: 1000, h: 800 },
  previewLine: null,
  saved: null, // the plan object last written to the server
  project: null,
  draft: null,
  versions: null,
  signedIn: false,
};

const editor = {
  get plan() {
    return state.live ?? state.history.present;
  },
  get selection() {
    return state.selection;
  },
  get tool() {
    return state.tool;
  },
  get view() {
    return state.view;
  },
  preview(plan) {
    state.live = plan;
    render();
  },
  commitPreview() {
    if (state.live) editor.commit(state.live);
  },
  commit(plan, selection = state.selection) {
    state.live = null;
    state.history = P.history.push(state.history, plan);
    state.selection = selection;
    keepDraft();
    render();
  },
  select(selection) {
    if (selection?.kind === state.selection?.kind && selection?.id === state.selection?.id) return;
    state.selection = selection;
    render();
  },
  setTool(tool) {
    state.tool = tool;
    state.catalogOpen = false;
    render();
  },
  setView(view) {
    state.view = view;
    render();
  },
  setPreviewLine(line) {
    state.previewLine = line;
    render();
  },
  refresh: () => render(),
  toast,
};

// A draft lives in this browser until it is saved to an account, so a refresh never loses work.
function keepDraft() {
  if (!state.draft) return;
  state.draft = { ...state.draft, plan: state.history.present };
  store(KEYS.draft, state.draft);
}

const isDirty = () => state.project && state.history.present !== state.saved;

function render() {
  const plan = editor.plan;
  const { selection } = state;
  if (selection && !plan[selection.kind].some((item) => item.id === selection.id)) state.selection = null;

  const { x, y, w, h: height } = state.view;
  canvas.setAttribute("viewBox", `${x} ${y} ${w} ${height}`);
  canvas.dataset.tool = state.tool;
  const hadFocus = canvas.contains(document.activeElement);
  draw(canvas, { plan, selection: state.selection, preview: state.previewLine });
  if (hadFocus) {
    const node = state.selection && canvas.querySelector(`[data-kind="${state.selection.kind}"][data-id="${state.selection.id}"]`);
    (node ?? canvas).focus({ preventScroll: true });
  }

  renderInspector($("#inspector"), editor, { versions: state.versions, onLoadVersion: loadVersion });

  for (const button of $("#tools").children) {
    const { tool } = button.dataset;
    const active = tool === "furniture" ? state.catalogOpen || state.tool.startsWith("furniture:") : tool === state.tool;
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of $("#catalog").querySelectorAll("button")) button.setAttribute("aria-pressed", String(`furniture:${button.dataset.type}` === state.tool));
  $("#catalog").hidden = !state.catalogOpen;
  $("#tool-name").textContent = state.tool.startsWith("furniture:") ? "Place furniture" : TOOLS.find((tool) => tool.id === state.tool).label;
  $("#undo").disabled = state.history.past.length === 0;
  $("#redo").disabled = state.history.future.length === 0;

  $("#actions").hidden = !state.selection;
  const isFurniture = state.selection?.kind === "furniture";
  $("#rotate").hidden = !isFurniture;
  $("#duplicate").hidden = !isFurniture;

  const zoom = `${Math.round(100 / visibleArea(canvas).scale)}%`;
  $("#zoom-level").textContent = zoom;
  $("#status-zoom").textContent = `Zoom: ${zoom}`;
  $("#context-area").textContent = `${P.planArea(plan).toFixed(1)} m²`;
  const latest = state.versions?.[0];
  $("#crumb-version").textContent = state.project ? `Plan Editor (${latest ? `v${latest.version_no}` : "no versions"}${isDirty() ? ", edited" : ""})` : "Plan Editor (Draft)";
  $("#status-save").textContent = state.project
    ? isDirty() ? "Unsaved changes" : latest ? `Saved · v${latest.version_no}` : "Nothing saved yet"
    : state.signedIn ? "Draft · not saved to your account yet" : "Guest draft · kept in this browser only";
}

function fit() {
  const box = P.planBox(editor.plan);
  const pad = 180;
  editor.setView({ x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad });
}

const zoomBy = (factor) => {
  const area = visibleArea(canvas);
  editor.setView(zoomAt(state.view, { x: area.x + area.w / 2, y: area.y + area.h / 2 }, factor));
};

const undo = () => {
  state.history = P.history.undo(state.history);
  keepDraft();
  render();
};
const redo = () => {
  state.history = P.history.redo(state.history);
  keepDraft();
  render();
};
const removeSelection = () => state.selection && editor.commit(P.remove(editor.plan, state.selection.kind, state.selection.id), null);
const rotateSelection = () => {
  const item = editor.plan.furniture.find((candidate) => candidate.id === state.selection?.id);
  if (item) editor.commit(P.patch(editor.plan, "furniture", item.id, { rotation: item.rotation + 90 }));
};

function nudge([dx, dy]) {
  const { selection } = state;
  const plan = editor.plan;
  if (selection.kind === "openings") {
    const opening = plan.openings.find((candidate) => candidate.id === selection.id);
    return editor.commit(P.patch(plan, "openings", selection.id, { offset: opening.offset + (dx || dy) * P.GRID }));
  }
  editor.commit(P.translate(plan, selection.kind, selection.id, dx * P.GRID, dy * P.GRID));
}

function onKey(event) {
  if (event.target.closest("input, select, textarea, dialog")) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && key === "z") event.shiftKey ? redo() : undo();
  else if (mod && key === "y") redo();
  else if (mod && key === "s") openSave();
  else if (mod || event.altKey) return;
  else if ((key === "Delete" || key === "Backspace") && state.selection) removeSelection();
  else if (key === "Escape") {
    state.selection = null;
    editor.setTool("select");
  } else if (ARROWS[key] && state.selection) nudge(ARROWS[key]);
  else if (key === "r" && state.selection?.kind === "furniture") rotateSelection();
  else {
    const tool = TOOLS.find((candidate) => candidate.key.toLowerCase() === key);
    if (!tool) return;
    pickTool(tool.id);
  }
  event.preventDefault();
}

function pickTool(id) {
  if (id !== "furniture") return editor.setTool(id);
  state.catalogOpen = !state.catalogOpen;
  if (state.tool.startsWith("furniture:")) state.tool = "select";
  render();
}

async function loadVersion(summary) {
  const version = await api(`/v1/projects/${state.project.id}/versions/${summary.id}`).catch((error) => toast(error.message, "error"));
  if (!version) return;
  editor.commit(version.geometry, null);
  fit();
  toast(`Loaded v${version.version_no}. Save to make it the newest version, or Undo to go back.`);
}

function openSave() {
  if (!state.project && !state.signedIn) return $("#signup-dialog").showModal();
  const dialog = $("#save-dialog");
  dialog.querySelector("form").reset();
  dialog.showModal();
}

async function savePlan(label) {
  const plan = state.history.present;
  if (!state.project) {
    // First save of a draft: create the project, then store the plan as version 1.
    const { name, property_type: propertyType, studio } = state.draft;
    const id = state.draft.projectId ?? (await api("/v1/projects", { method: "POST", body: { studio_id: studio.id, name, property_type: propertyType } })).id;
    state.draft = { ...state.draft, projectId: id }; // if the next call fails, a retry reuses this project
    store(KEYS.draft, state.draft);
    await api(`/v1/projects/${id}/versions`, { method: "POST", body: { label, geometry: plan } });
    store(KEYS.draft, null);
    return location.replace(`editor.html?project=${id}`);
  }
  const version = await api(`/v1/projects/${state.project.id}/versions`, { method: "POST", body: { label, geometry: plan } });
  state.saved = plan;
  state.versions = [version, ...state.versions];
  render();
  toast(`Saved as v${version.version_no}`);
}

function buildChrome(name, role) {
  $("#tools").replaceChildren(
    ...TOOLS.map((tool) =>
      h("button", { type: "button", title: `${tool.label} (${tool.key})`, "aria-label": tool.label, "data-tool": tool.id, onclick: () => pickTool(tool.id) },
        h("span", { class: "icon", "aria-hidden": "true" }, tool.icon),
        h("span", { class: "key", "aria-hidden": "true" }, tool.key),
      ),
    ),
  );
  const groups = [...new Set(FURNITURE.map((item) => item.group))];
  $("#catalog").replaceChildren(
    ...groups.flatMap((group) => [
      h("span", { class: "label" }, group),
      h("div", { class: "items" },
        FURNITURE.filter((item) => item.group === group).map((item) =>
          h("button", { type: "button", "data-type": item.type, onclick: () => editor.setTool(`furniture:${item.type}`) },
            item.label,
            h("span", { class: "code" }, `${item.w}×${item.d}`),
          ),
        ),
      ),
    ]),
  );

  document.title = `${name} · 2D Canvas`;
  $("#crumb-name").textContent = name;
  $("#context-name").textContent = name;
  $("#context-role").textContent = role;
  $("#account").textContent = state.signedIn ? "Sign out" : "Sign in";
  $("#account").addEventListener("click", () => (state.signedIn ? signOut() : location.assign("auth.html?next=editor.html")));
  $("#home-link").href = state.signedIn ? "projects.html" : "index.html";

  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#rotate").addEventListener("click", rotateSelection);
  $("#delete").addEventListener("click", removeSelection);
  $("#duplicate").addEventListener("click", () => {
    const next = P.duplicateFurniture(editor.plan, state.selection.id);
    editor.commit(next, { kind: "furniture", id: next.furniture.at(-1).id });
  });
  $("#zoom-in").addEventListener("click", () => zoomBy(1 / 1.25));
  $("#zoom-out").addEventListener("click", () => zoomBy(1.25));
  $("#zoom-fit").addEventListener("click", fit);
  $("#save").addEventListener("click", openSave);
  $("#save-dialog").addEventListener("close", action(async (event) => {
    const dialog = event.currentTarget;
    if (dialog.returnValue === "save") await savePlan(dialog.querySelector("input").value.trim());
  }));

  attachPointer(canvas, editor);
  canvas.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-kind]");
    if (target && target.dataset.kind !== "handle") editor.select({ kind: target.dataset.kind, id: target.dataset.id });
  });
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", render);
  window.addEventListener("beforeunload", (event) => {
    if (isDirty()) event.preventDefault();
  });
}

run(async () => {
  let plan;
  let name;
  let role;
  if (projectId) {
    await requireSession();
    state.signedIn = true;
    const base = `/v1/projects/${encodeURIComponent(projectId)}`;
    [state.project, state.versions] = await Promise.all([api(base), api(`${base}/versions`)]);
    plan = state.versions.length ? (await api(`${base}/versions/latest`)).geometry : P.emptyPlan();
    name = state.project.name;
    role = `Editing as ${state.project.my_role}`;
    showStudio(state.project.studio.name);
    // Starting over from the wizard would discard this saved plan's context, so those links go to the project list.
    $("#tab-wizard").href = state.project.my_role === "designer" ? "studio.html" : "projects.html";
    $("#tab-wizard").textContent = "All projects";
    $("#nav-wizard").hidden = true;
  } else {
    state.draft = load(KEYS.draft);
    if (!state.draft || !P.isPlan(state.draft.plan)) return location.replace("wizard.html");
    state.signedIn = Boolean(await getSession());
    plan = state.draft.plan;
    name = state.draft.name;
    role = "Draft";
    showStudio(state.draft.studio.name);
  }
  state.history = P.history.start(plan);
  state.saved = plan;
  buildChrome(name, role);
  fit();
  if (params.get("save") && state.draft && state.signedIn) openSave();
});
