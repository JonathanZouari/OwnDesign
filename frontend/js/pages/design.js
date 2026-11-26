// Design brief, finishes and moodboard for one saved project (?project=<id>). Everything shown comes from the API.
import { api, requireSession, signOut } from "../api.js";
import * as L from "../design-logic.js";
import { COMMON, DESIGN, ROOM_TYPE_LABELS } from "../strings.js";
import { $, h, run, showStudio, userMessage } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else (like "..") is not used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}`;
const TABS = ["brief", "finishes", "moodboard"];

const state = {
  catalog: { styles: [], materials: [], surfaces: [] },
  styles: [], // brief: chosen style ids
  colors: [], // brief: chosen hex colours
  rooms: [], // rooms of the latest saved plan
  finishes: {}, // finishKey -> material id
  assets: [],
  board: [],
};

const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, name);

function setStatus(node, message, kind = "ok") {
  node.textContent = message;
  node.classList.toggle("error", kind === "error");
}

// Runs a save / upload: the button is disabled while busy and the outcome is announced beside it.
async function busy(button, status, work, done) {
  button.disabled = true;
  setStatus(status, COMMON.working);
  try {
    await work();
    setStatus(status, done);
  } catch (error) {
    setStatus(status, userMessage(error), "error");
  } finally {
    button.disabled = false;
  }
}

const swatch = (color) => {
  const node = h("span", { class: "swatch-dot", "aria-hidden": "true" });
  node.style.backgroundColor = L.swatchColor(color);
  return node;
};

const styleById = (id) => state.catalog.styles.find((style) => style.id === id);
const materialById = (id) => state.catalog.materials.find((material) => material.id === id);
const assetById = (id) => state.assets.find((asset) => asset.id === id);

// ---- tabs -------------------------------------------------------------------------------------------

function showTab(name, focus = false) {
  for (const tab of TABS) {
    const button = $(`#tab-${tab}`);
    const selected = tab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !selected;
    if (selected && focus) button.focus();
  }
  history.replaceState(null, "", `#${name}`);
  if (name === "moodboard") refreshImageLinks();
}

// Signed image links expire after 10 minutes, so they are renewed whenever the Moodboard tab is shown.
async function refreshImageLinks() {
  try {
    state.assets = await api(`${base}/assets`);
    renderAssets();
    renderBoard();
  } catch {
    /* the images already on screen stay as they are */
  }
}

function initTabs() {
  for (const tab of TABS) $(`#tab-${tab}`).addEventListener("click", () => showTab(tab));
  $(".tablist").addEventListener("keydown", (event) => {
    const current = TABS.findIndex((tab) => $(`#tab-${tab}`).getAttribute("aria-selected") === "true");
    const next = L.tabStep(event.key, current, TABS.length);
    if (next === null) return;
    event.preventDefault();
    showTab(TABS[next], true);
  });
  const wanted = location.hash.slice(1);
  showTab(TABS.includes(wanted) ? wanted : "brief");
}

// ---- brief ------------------------------------------------------------------------------------------

function renderBriefStyles() {
  const full = state.styles.length >= L.MAX_STYLES;
  $("#style-count").textContent = `${state.styles.length} / ${L.MAX_STYLES}`;
  const focused = document.activeElement?.dataset?.style;
  $("#brief-styles").replaceChildren(
    ...state.catalog.styles.map((style) => {
      const chosen = state.styles.includes(style.id);
      return h(
        "button",
        {
          type: "button",
          class: "style-chip",
          "data-style": style.id,
          "aria-pressed": String(chosen),
          disabled: full && !chosen,
          onclick: () => {
            state.styles = L.toggleStyle(state.styles, style.id);
            renderBriefStyles();
          },
        },
        h("span", {}, style.label),
        h("small", {}, style.description),
      );
    }),
  );
  if (focused) $(`#brief-styles [data-style="${CSS.escape(focused)}"]`)?.focus();
}

function renderBriefColors() {
  $("#color-count").textContent = `${state.colors.length} / ${L.MAX_COLORS}`;
  $("#color-add").disabled = state.colors.length >= L.MAX_COLORS;
  $("#brief-colors").replaceChildren(
    ...state.colors.map((color) =>
      h(
        "li",
        {},
        swatch(color),
        h("span", { class: "mono" }, color),
        h(
          "button",
          {
            type: "button",
            class: "ghost",
            "aria-label": DESIGN.removeColor(color),
            onclick: () => {
              state.colors = state.colors.filter((item) => item !== color);
              renderBriefColors();
              $("#color-pick").focus();
            },
          },
          icon("close"),
        ),
      ),
    ),
  );
}

function fillBrief(brief) {
  const known = new Set(state.catalog.styles.map((style) => style.id));
  state.styles = (brief.styles ?? []).filter((id) => known.has(id));
  state.colors = (brief.colors ?? []).reduce((colors, color) => L.addColor(colors, color), []);
  const form = $("#brief-form").elements; // `.elements`: form.children would be the DOM child list
  form.budget_min.value = brief.budget_min ?? "";
  form.budget_max.value = brief.budget_max ?? "";
  form.currency.value = brief.currency ?? "USD";
  form.adults.value = brief.adults ?? 1;
  form.children.value = brief.children ?? 0;
  form.pets.checked = Boolean(brief.pets);
  for (const key of ["lifestyle", "needs", "constraints", "existing_items"]) form[key].value = brief[key] ?? "";
  renderBriefStyles();
  renderBriefColors();
}

function initBrief() {
  $("#color-add").addEventListener("click", () => {
    const next = L.addColor(state.colors, $("#color-pick").value);
    setStatus($("#brief-status"), next === state.colors ? DESIGN.colorExists : "");
    state.colors = next;
    renderBriefColors();
  });
  $("#brief-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget.elements;
    const { payload, error } = L.buildBriefPayload({
      styles: state.styles,
      colors: state.colors,
      budget_min: form.budget_min.value,
      budget_max: form.budget_max.value,
      currency: form.currency.value,
      adults: form.adults.value,
      children: form.children.value,
      pets: form.pets.checked,
      lifestyle: form.lifestyle.value,
      needs: form.needs.value,
      constraints: form.constraints.value,
      existing_items: form.existing_items.value,
    });
    if (error) return setStatus($("#brief-status"), error, "error");
    busy($("#brief-save"), $("#brief-status"), async () => fillBrief((await api(`${base}/brief`, { method: "PUT", body: payload })).brief), DESIGN.briefSaved);
  });
}

// ---- finishes ---------------------------------------------------------------------------------------

function surfacePicker(room, surface) {
  const key = L.finishKey(room.id, surface);
  const name = `finish-${key}`;
  const option = (value, label, color) =>
    h(
      "label",
      { class: "swatch" },
      h("input", {
        type: "radio",
        name,
        value,
        checked: (state.finishes[key] ?? "") === value,
        onchange: () => {
          state.finishes = { ...state.finishes, [key]: value };
          setStatus($("#finishes-status"), COMMON.unsaved);
        },
      }),
      color === null ? h("span", { class: "swatch-dot none", "aria-hidden": "true" }) : swatch(color),
      label,
    );
  return h(
    "fieldset",
    { class: "surface" },
    h("legend", {}, DESIGN.surfaces[surface] ?? surface),
    h("div", { class: "swatches" }, option("", DESIGN.notChosen, null), L.materialsForSurface(state.catalog.materials, surface).map((material) => option(material.id, material.label, material.color))),
  );
}

function renderFinishes() {
  const hasRooms = state.rooms.length > 0;
  $("#finishes-empty").hidden = hasRooms;
  $("#finishes-body").hidden = !hasRooms;
  $("#finishes-rooms").replaceChildren(
    ...state.rooms.map((room) =>
      h(
        "section",
        { class: "card room-finishes", "aria-label": DESIGN.roomMaterials(room.name) },
        h("div", { class: "row between" }, h("h2", {}, room.name), room.type && h("span", { class: "chip" }, ROOM_TYPE_LABELS[room.type] ?? ROOM_TYPE_LABELS.other)),
        h("div", { class: "surfaces" }, state.catalog.surfaces.map((surface) => surfacePicker(room, surface))),
      ),
    ),
  );
}

function initFinishes() {
  $("#finishes-save").addEventListener("click", () =>
    busy(
      $("#finishes-save"),
      $("#finishes-status"),
      async () => {
        const selections = L.finishSelections(state.rooms, state.catalog.surfaces, state.catalog.materials, state.finishes);
        state.finishes = L.finishesToMap(await api(`${base}/finishes`, { method: "PUT", body: { selections } }));
      },
      DESIGN.materialsSaved,
    ),
  );
}

// ---- moodboard --------------------------------------------------------------------------------------

function boardChanged(message = COMMON.unsaved) {
  renderBoard();
  renderBoardSources();
  renderAssets();
  setStatus($("#board-status"), message);
}

function boardView(item) {
  if (item.kind === "style") {
    const style = styleById(item.ref);
    return { title: style?.label ?? item.ref, kind: DESIGN.boardKinds.style, preview: h("div", { class: "preview" }, icon("style")) };
  }
  if (item.kind === "material") {
    const material = materialById(item.ref);
    const preview = h("div", { class: "preview" });
    preview.style.backgroundColor = L.swatchColor(material?.color);
    return { title: material?.label ?? item.ref, kind: DESIGN.boardKinds.material, preview };
  }
  const asset = assetById(item.ref);
  const url = L.safeImageUrl(item.url || asset?.url);
  const title = asset?.caption || DESIGN.imageKinds[asset?.kind] || DESIGN.image;
  return { title, kind: DESIGN.boardKinds.asset, preview: url ? h("img", { class: "preview", src: url, alt: "", loading: "lazy" }) : h("div", { class: "preview" }, icon("image")) };
}

function renderBoard() {
  $("#board-count").textContent = `${state.board.length} / ${L.MAX_BOARD_ITEMS}`;
  $("#board-empty").hidden = state.board.length > 0;
  $("#board").replaceChildren(
    ...state.board.map((item, index) => {
      const view = boardView(item);
      const noteId = `note-${index}`;
      const move = (delta) => () => {
        state.board = L.moveItem(state.board, index, delta);
        boardChanged(DESIGN.moved(view.title, index + delta + 1, state.board.length));
        // Keep the keyboard on the moved item; at either end the pressed button is disabled, so use the other one.
        const row = $("#board").children[index + delta];
        (row.querySelector(`[data-move="${delta}"]:not(:disabled)`) ?? row.querySelector("[data-move]:not(:disabled)"))?.focus();
      };
      return h(
        "li",
        { class: "board-item" },
        view.preview,
        h(
          "div",
          { class: "board-text" },
          h("div", { class: "row between" }, h("strong", {}, view.title), h("span", { class: "chip" }, view.kind)),
          h("label", { for: noteId, class: "sr-only" }, DESIGN.noteFor(view.title)),
          h("input", {
            id: noteId,
            value: item.note ?? "",
            maxLength: L.MAX_NOTE,
            placeholder: DESIGN.notePlaceholder,
            oninput: (event) => {
              state.board = L.setBoardNote(state.board, item.kind, item.ref, event.target.value);
              setStatus($("#board-status"), COMMON.unsaved);
            },
          }),
        ),
        h(
          "div",
          { class: "board-actions" },
          h("button", { type: "button", "data-move": "-1", disabled: index === 0, "aria-label": DESIGN.moveUp(view.title), onclick: move(-1) }, icon("arrow_upward")),
          h("button", { type: "button", "data-move": "1", disabled: index === state.board.length - 1, "aria-label": DESIGN.moveDown(view.title), onclick: move(1) }, icon("arrow_downward")),
          h(
            "button",
            {
              type: "button",
              class: "danger",
              "aria-label": DESIGN.removeFromBoard(view.title),
              onclick: () => {
                state.board = L.removeBoardItem(state.board, item.kind, item.ref);
                boardChanged(DESIGN.removed(view.title));
                $("#board-save").focus();
              },
            },
            icon("close"),
          ),
        ),
      );
    }),
  );
}

function addToBoard(kind, ref, title) {
  const next = L.addBoardItem(state.board, kind, ref);
  if (next === state.board) return setStatus($("#board-status"), DESIGN.boardFull(L.MAX_BOARD_ITEMS), "error");
  state.board = next;
  boardChanged(DESIGN.added(title));
}

function renderBoardSources() {
  const source = (kind, ref, label, lead) =>
    h("button", { type: "button", class: "swatch", disabled: L.onBoard(state.board, kind, ref), "aria-label": DESIGN.addToBoard(label), onclick: () => addToBoard(kind, ref, label) }, lead, label);
  $("#board-styles").replaceChildren(...state.catalog.styles.map((style) => source("style", style.id, style.label, icon("add"))));
  $("#board-materials").replaceChildren(...state.catalog.materials.map((material) => source("material", material.id, material.label, swatch(material.color))));
}

function renderAssets() {
  $("#asset-count").textContent = String(state.assets.length);
  $("#assets-empty").hidden = state.assets.length > 0;
  $("#assets").replaceChildren(
    ...state.assets.map((asset) => {
      const name = asset.caption || DESIGN.imageKinds[asset.kind] || DESIGN.image;
      const url = L.safeImageUrl(asset.url);
      const remove = h("button", { type: "button", class: "danger", "aria-label": DESIGN.deleteImage(name) }, icon("delete"));
      remove.addEventListener("click", () => {
        if (!confirm(DESIGN.confirmDelete(name))) return;
        busy(
          remove,
          $("#upload-status"),
          async () => {
            await api(`${base}/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
            state.assets = state.assets.filter((item) => item.id !== asset.id);
            state.board = L.removeBoardItem(state.board, "asset", asset.id);
            renderAssets();
            renderBoard();
            $("#upload-file").focus();
          },
          DESIGN.imageDeleted,
        );
      });
      return h(
        "li",
        { class: "asset" },
        url ? h("img", { src: url, alt: name, loading: "lazy" }) : h("div", { class: "preview" }, icon("image")),
        h("span", { class: "chip" }, DESIGN.imageKinds[asset.kind] ?? DESIGN.image),
        asset.caption && h("span", { class: "small caption" }, asset.caption),
        h(
          "div",
          { class: "board-actions" },
          h("button", { type: "button", disabled: L.onBoard(state.board, "asset", asset.id), "aria-label": DESIGN.addImageToBoard(name), onclick: () => addToBoard("asset", asset.id, name) }, icon("add"), DESIGN.boardButton),
          remove,
        ),
      );
    }),
  );
}

function initMoodboard() {
  $("#board-save").addEventListener("click", () =>
    busy(
      $("#board-save"),
      $("#board-status"),
      async () => {
        state.board = await api(`${base}/moodboard`, { method: "PUT", body: L.boardPayload(state.board) });
        renderBoard();
        renderBoardSources();
        renderAssets();
      },
      DESIGN.boardSaved,
    ),
  );
  $("#upload-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.file.files[0];
    const problem = L.validateImageFile(file);
    if (problem) return setStatus($("#upload-status"), problem, "error");
    const body = new FormData();
    body.append("file", file);
    body.append("kind", form.kind.value);
    body.append("caption", form.caption.value.trim());
    busy(
      $("#upload-send"),
      $("#upload-status"),
      async () => {
        await api(`${base}/assets`, { method: "POST", body });
        form.reset(); // the upload worked; a failed list refresh below must not invite a duplicate upload
        state.assets = await api(`${base}/assets`); // the upload answer has no link; the list carries signed links
        renderAssets();
      },
      DESIGN.imageUploaded,
    );
  });
}

// ---- start ------------------------------------------------------------------------------------------

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const [project, catalog, brief, versions, finishes, assets, board] = await Promise.all([
    api(base),
    api("/v1/catalog"),
    api(`${base}/brief`),
    api(`${base}/versions`),
    api(`${base}/finishes`),
    api(`${base}/assets`),
    api(`${base}/moodboard`),
  ]);
  state.catalog = catalog;
  state.rooms = versions.length ? (await api(`${base}/versions/latest`)).geometry.rooms : [];
  state.finishes = L.finishesToMap(finishes);
  state.assets = assets;
  state.board = board;

  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · ${DESIGN.pageTitle}`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  if (project.studio) showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  $("#nav-editor").href = `editor.html${query}`;
  $("#finishes-editor-link").href = `editor.html${query}`;
  $("#nav-design").href = `design.html${query}`;
  $("#nav-consultant").href = `consultant.html${query}`;
  $("#nav-budget").href = `budget.html${query}`;

  initTabs();
  initBrief();
  initFinishes();
  initMoodboard();
  fillBrief(brief.brief);
  renderFinishes();
  renderBoard();
  renderBoardSources();
  renderAssets();
  $("#design").hidden = false;
});
