// Design brief, finishes, moodboard and the items already in the home for one saved project (?project=<id>).
// Everything shown comes from the API.
import { api, requireSession, signOut } from "../api.js";
import * as L from "../design-logic.js";
import * as R from "../room-logic.js";
import * as S from "../style-logic.js";
import { $, h, run, showStudio } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else (like "..") is not used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}`;
const SURFACE_LABEL = { floor: "Floor", walls: "Walls", ceiling: "Ceiling", cabinets: "Cabinets" };
const KIND_LABEL = { inspiration: "Inspiration", existing_item: "Item I own" };
const TABS = ["brief", "finishes", "moodboard", "room"];

const state = {
  catalog: { styles: [], materials: [], surfaces: [] },
  styles: [], // brief: chosen style ids
  colors: [], // brief: chosen hex colours
  rooms: [], // rooms of the latest saved plan
  finishes: {}, // finishKey -> material id
  assets: [],
  profile: null, // style profile built from the analysed inspiration images
  styleSaving: false, // "Add colours to the brief" is saving
  board: [],
  items: [], // the list of items already in the home
  drafts: [], // scan results waiting to be checked
  photo: "", // signed link of the scanned photo
  editing: null, // id of the item whose edit form is open
};

const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, name);

function setStatus(node, message, kind = "ok") {
  node.textContent = message;
  node.classList.toggle("error", kind === "error");
}

// Runs a save / upload: the button is disabled while busy and the outcome is announced beside it.
async function busy(button, status, work, done) {
  button.disabled = true;
  setStatus(status, "Working…");
  try {
    await work();
    setStatus(status, done);
  } catch (error) {
    setStatus(status, error.message || "Something went wrong.", "error");
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
    if (selected) button.scrollIntoView({ block: "nearest", inline: "nearest" }); // the tab row scrolls sideways on phones
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
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    showTab(TABS[(next + TABS.length) % TABS.length], true);
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
            "aria-label": `Remove colour ${color}`,
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
  renderStyleButton(); // its count depends on the brief colours
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
    setStatus($("#brief-status"), next === state.colors ? "That colour is already in the list." : "");
    state.colors = next;
    renderBriefColors();
  });
  $("#brief-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveBrief($("#brief-save"), $("#brief-status"), "Brief saved.");
  });
}

// Saves the brief form with the chosen styles and colours: used by "Save brief" and by the style
// profile's "Add colours to the brief". Resolves to true when saved; problems are shown in `status`.
async function saveBrief(button, status, done, problemPrefix = "") {
  const form = $("#brief-form").elements;
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
  if (error) {
    setStatus(status, problemPrefix + error, "error");
    return false;
  }
  let saved = false;
  await busy(
    button,
    status,
    async () => {
      fillBrief((await api(`${base}/brief`, { method: "PUT", body: payload })).brief);
      saved = true;
    },
    done,
  );
  return saved;
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
          setStatus($("#finishes-status"), "Unsaved changes.");
        },
      }),
      color === null ? h("span", { class: "swatch-dot none", "aria-hidden": "true" }) : swatch(color),
      label,
    );
  return h(
    "fieldset",
    { class: "surface" },
    h("legend", {}, SURFACE_LABEL[surface] ?? surface),
    h("div", { class: "swatches" }, option("", "Not chosen", null), L.materialsForSurface(state.catalog.materials, surface).map((material) => option(material.id, material.label, material.color))),
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
        { class: "card room-finishes", "aria-label": `Materials for ${room.name}` },
        h("div", { class: "row between" }, h("h2", {}, room.name), room.type && h("span", { class: "chip" }, room.type.replaceAll("_", " "))),
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
      "Materials saved.",
    ),
  );
}

// ---- moodboard --------------------------------------------------------------------------------------

function boardChanged(message = "Unsaved changes.") {
  renderBoard();
  renderBoardSources();
  renderAssets();
  setStatus($("#board-status"), message);
}

function boardView(item) {
  if (item.kind === "style") {
    const style = styleById(item.ref);
    return { title: style?.label ?? item.ref, kind: "Style", preview: h("div", { class: "preview" }, icon("style")) };
  }
  if (item.kind === "material") {
    const material = materialById(item.ref);
    const preview = h("div", { class: "preview" });
    preview.style.backgroundColor = L.swatchColor(material?.color);
    return { title: material?.label ?? item.ref, kind: "Material", preview };
  }
  const asset = assetById(item.ref);
  const url = L.safeImageUrl(item.url || asset?.url);
  const title = asset?.caption || KIND_LABEL[asset?.kind] || "Image";
  return { title, kind: "Image", preview: url ? h("img", { class: "preview", src: url, alt: "", loading: "lazy" }) : h("div", { class: "preview" }, icon("image")) };
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
        boardChanged(`${view.title} moved to position ${index + delta + 1} of ${state.board.length}. Unsaved changes.`);
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
          h("label", { for: noteId, class: "sr-only" }, `Note for ${view.title}`),
          h("input", {
            id: noteId,
            value: item.note ?? "",
            maxLength: L.MAX_NOTE,
            placeholder: "Add a note",
            oninput: (event) => {
              state.board = L.setBoardNote(state.board, item.kind, item.ref, event.target.value);
              setStatus($("#board-status"), "Unsaved changes.");
            },
          }),
        ),
        h(
          "div",
          { class: "board-actions" },
          h("button", { type: "button", "data-move": "-1", disabled: index === 0, "aria-label": `Move ${view.title} up`, onclick: move(-1) }, icon("arrow_upward")),
          h("button", { type: "button", "data-move": "1", disabled: index === state.board.length - 1, "aria-label": `Move ${view.title} down`, onclick: move(1) }, icon("arrow_downward")),
          h(
            "button",
            {
              type: "button",
              class: "danger",
              "aria-label": `Remove ${view.title} from the board`,
              onclick: () => {
                state.board = L.removeBoardItem(state.board, item.kind, item.ref);
                boardChanged(`${view.title} removed. Unsaved changes.`);
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
  if (next === state.board) return setStatus($("#board-status"), `The board holds at most ${L.MAX_BOARD_ITEMS} items.`, "error");
  state.board = next;
  boardChanged(`${title} added to the board. Unsaved changes.`);
}

function renderBoardSources() {
  const source = (kind, ref, label, lead) =>
    h("button", { type: "button", class: "swatch", disabled: L.onBoard(state.board, kind, ref), "aria-label": `Add ${label} to the board`, onclick: () => addToBoard(kind, ref, label) }, lead, label);
  $("#board-styles").replaceChildren(...state.catalog.styles.map((style) => source("style", style.id, style.label, icon("add"))));
  $("#board-materials").replaceChildren(...state.catalog.materials.map((material) => source("material", material.id, material.label, swatch(material.color))));
}

function renderAssets() {
  $("#asset-count").textContent = String(state.assets.length);
  $("#assets-empty").hidden = state.assets.length > 0;
  $("#assets").replaceChildren(
    ...state.assets.map((asset) => {
      const name = asset.caption || KIND_LABEL[asset.kind] || "Image";
      const url = L.safeImageUrl(asset.url);
      const remove = h("button", { type: "button", class: "danger", "aria-label": `Delete image ${name}` }, icon("delete"));
      remove.addEventListener("click", () => {
        if (!confirm(`Delete the image "${name}"? This cannot be undone.`)) return;
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
            await refreshProfile();
          },
          "Image deleted.",
        );
      });
      return h(
        "li",
        { class: "asset", "data-asset": asset.id },
        url ? h("img", { src: url, alt: name, loading: "lazy" }) : h("div", { class: "preview" }, icon("image")),
        h("span", { class: "chip" }, KIND_LABEL[asset.kind] ?? asset.kind),
        asset.caption && h("span", { class: "small caption" }, asset.caption),
        asset.kind === "inspiration" && analysisView(asset, name),
        h(
          "div",
          { class: "board-actions" },
          h("button", { type: "button", disabled: L.onBoard(state.board, "asset", asset.id), "aria-label": `Add image ${name} to the board`, onclick: () => addToBoard("asset", asset.id, name) }, icon("add"), "Board"),
          remove,
        ),
      );
    }),
  );
}

// ---- style profile ----------------------------------------------------------------------------------

// A palette colour: the swatch helper (hex-validated) or the "no colour" pattern for anything else.
const paletteSwatch = (hex, extra) => {
  const node = L.swatchColor(hex) === "transparent" ? h("span", { class: "swatch-dot none", "aria-hidden": "true" }) : swatch(hex);
  node.classList.add(extra);
  return node;
};

// Under an inspiration image: its colours as a strip, what was found, or an Analyse button.
function analysisView(asset, name) {
  const analysis = asset.analysis;
  if (!analysis) {
    const analyse = h("button", { type: "button", class: "style-analyse", "aria-label": `Analyse image ${name}` }, icon("auto_awesome"), "Analyse");
    analyse.addEventListener("click", () => analyseAsset(asset, analyse));
    return h("div", { class: "style-analysis" }, h("span", { class: "small muted" }, "Not analysed yet"), analyse);
  }
  const palette = Array.isArray(analysis.palette) ? analysis.palette : [];
  return h(
    "div",
    { class: "style-analysis" },
    palette.length > 0 &&
      h(
        "ul",
        { class: "style-strip", "aria-label": `Colours in image ${name}` },
        palette.map((color) => {
          const label = S.swatchLabel({ name: color?.name, hex: color?.hex, share: color?.share });
          const segment = h("li", { class: "style-strip-item", role: "img", "aria-label": label, title: label }, paletteSwatch(color?.hex, "style-strip-dot"));
          segment.style.flexGrow = String(Math.max(Number(color?.share) || 0, 0.05)); // a sliver stays visible
          return segment;
        }),
      ),
    h("span", { class: "small muted style-summary" }, S.analysisSummary(analysis)),
  );
}

function analyseAsset(asset, button) {
  busy(
    button,
    $("#upload-status"),
    async () => {
      const analysis = await api(`${base}/assets/${encodeURIComponent(asset.id)}/analysis`, { method: "POST" });
      state.assets = state.assets.map((item) => (item.id === asset.id ? { ...item, analysis } : item));
      renderAssets();
      $(`#assets [data-asset="${CSS.escape(asset.id)}"] button:not(:disabled)`)?.focus(); // the Analyse button is gone
      await refreshProfile();
    },
    "Image analysed.",
  );
}

// The profile changes when an inspiration image is uploaded, deleted or analysed.
async function refreshProfile() {
  try {
    state.profile = await api(`${base}/style-profile`);
  } catch {
    /* the profile on screen stays as it is */
  }
  renderStyleProfile();
}

function renderStyleButton() {
  const button = $("#style-to-brief");
  if (!button) return;
  const view = S.styleButton(state.colors, state.profile?.palette);
  $("#style-to-brief-text").textContent = view.text;
  button.disabled = state.styleSaving || view.disabled;
}

function renderStyleProfile() {
  const profile = state.profile;
  const analysed = Number(profile?.analysed) || 0;
  const total = Number(profile?.total) || 0;
  $("#style-empty").hidden = analysed > 0;
  $("#style-empty").textContent =
    total > 0 ? "None of your inspiration images has been analysed yet. Use the Analyse button under an image." : "Upload inspiration images to see the colours and pieces they share.";
  $("#style-body").hidden = analysed === 0;
  const palette = Array.isArray(profile?.palette) ? profile.palette : [];
  $("#style-palette").replaceChildren(
    ...palette.map((color) =>
      h(
        "li",
        { class: "style-color" },
        paletteSwatch(color?.hex, "style-swatch"),
        h("span", { class: "style-color-name" }, color?.name || color?.hex || "Colour"),
        h("span", { class: "mono small" }, S.percent(color?.share)),
        h("span", { class: "small muted" }, S.imagesText(color?.images)),
      ),
    ),
  );
  const sentences = S.profileSentences(profile);
  $("#style-pieces").replaceChildren(...(sentences.length ? sentences.map((line) => h("li", {}, line)) : [h("li", { class: "muted" }, "No furniture found in these images.")]));
  $("#style-basis").textContent = S.basisText(profile);
  renderStyleButton();
}

function addPaletteToBrief() {
  const { colors, added } = S.paletteToBriefColors(state.colors, state.profile?.palette);
  if (added.length === 0) return renderStyleButton();
  state.colors = colors;
  state.styleSaving = true;
  renderBriefColors();
  saveBrief($("#style-to-brief"), $("#style-status"), S.addedMessage(added.length), "The colours were added to the brief but it was not saved: ").finally(() => {
    state.styleSaving = false;
    renderStyleButton();
  });
}

function initMoodboard() {
  $("#style-to-brief").addEventListener("click", addPaletteToBrief);
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
      "Moodboard saved.",
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
    let created = null;
    busy(
      $("#upload-send"),
      $("#upload-status"),
      async () => {
        const answer = await api(`${base}/assets`, { method: "POST", body });
        form.reset(); // the upload worked; a failed list refresh below must not invite a duplicate upload
        state.assets = await api(`${base}/assets`); // the upload answer has no link; the list carries signed links
        renderAssets();
        await refreshProfile();
        created = answer;
      },
      "",
    ).then(() => {
      if (!created) return; // the upload or the list refresh failed; busy() shows why
      const unanalysed = created.kind === "inspiration" && !created.analysis;
      setStatus(
        $("#upload-status"),
        unanalysed
          ? "Image uploaded, but it could not be analysed. Use its Analyse button to try again."
          : "Image uploaded. Use its Board button to add it to the moodboard.",
      );
    });
  });
}

// ---- in the room ------------------------------------------------------------------------------------

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const roomName = (roomId) => state.rooms.find((room) => room.id === roomId)?.name ?? R.WHOLE_HOME;

// "Whole home" (no room) first, then the rooms of the saved plan.
const roomOptions = (selected) => [
  h("option", { value: "", selected: !selected }, R.WHOLE_HOME),
  ...state.rooms.map((room) => h("option", { value: room.id, selected: room.id === selected }, room.name)),
];
const categoryOptions = (selected) => R.CATEGORIES.map((category) => h("option", { value: category, selected: category === selected }, R.categoryLabel(category)));

// A colour square only for a valid hex colour; anything else shows the "no colour" pattern.
const itemSwatch = (hex) => (L.swatchColor(hex) === "transparent" ? h("span", { class: "swatch-dot none", "aria-hidden": "true" }) : swatch(hex));

function renderAddButton() {
  const count = state.drafts.filter((draft) => draft.selected).length;
  $("#review-add-text").textContent = `Add ${plural(count, "item")}`;
  $("#review-add").disabled = count === 0;
}

// Outlines the box of draft `number` on the photo while its row is hovered or focused.
function highlightBox(number, on) {
  $(`#review-photo [data-box="${number}"]`)?.classList.toggle("active", on);
}

function renderReview() {
  const url = L.safeImageUrl(state.photo);
  const boxes = h(
    "div",
    { class: "room-boxes", "aria-hidden": "true" },
    state.drafts.map((draft) => {
      const place = R.boxToPercent(draft.box);
      if (!place) return null;
      const box = h("span", { class: `room-box${draft.selected ? "" : " off"}`, "data-box": String(draft.number) }, h("span", { class: "room-box-num" }, String(draft.number)));
      Object.assign(box.style, place);
      return box;
    }),
  );
  $("#review-photo").replaceChildren(
    url ? h("img", { src: url, alt: "The scanned photo of the room" }) : h("div", { class: "room-photo-missing" }, icon("image"), "The photo cannot be shown."),
    boxes,
  );
  $("#review-empty").hidden = state.drafts.length > 0;
  $("#review-list").replaceChildren(
    ...state.drafts.map((draft) => {
      const id = `draft-${draft.number}`;
      const row = h("li", { class: `room-draft${draft.selected ? "" : " off"}` });
      const pick = h("input", {
        type: "checkbox",
        id: `${id}-pick`,
        checked: draft.selected,
        onchange: (event) => {
          draft.selected = event.target.checked;
          row.classList.toggle("off", !draft.selected);
          $(`#review-photo [data-box="${draft.number}"]`)?.classList.toggle("off", !draft.selected);
          renderAddButton();
        },
      });
      const confidence = typeof draft.confidence === "number" ? `${Math.round(draft.confidence * 100)}% sure` : "";
      row.append(
        h("label", { for: `${id}-pick`, class: "sr-only" }, `Include item ${draft.number}`),
        pick,
        h("span", { class: "room-num", "aria-hidden": "true" }, String(draft.number)),
        h(
          "div",
          { class: "room-draft-fields" },
          h("label", { for: `${id}-name`, class: "sr-only" }, `Name of item ${draft.number}`),
          h("input", {
            id: `${id}-name`,
            value: draft.label,
            maxLength: R.MAX_LABEL,
            autocomplete: "off",
            oninput: (event) => {
              draft.label = event.target.value;
            },
          }),
          h("label", { for: `${id}-category`, class: "sr-only" }, `Category of item ${draft.number}`),
          h(
            "select",
            {
              id: `${id}-category`,
              onchange: (event) => {
                draft.category = event.target.value;
              },
            },
            categoryOptions(draft.category),
          ),
        ),
        h(
          "p",
          { class: "room-draft-meta" },
          itemSwatch(draft.color_hex),
          h("span", {}, draft.color_name || "No colour"),
          confidence && h("span", { class: "mono" }, confidence),
        ),
      );
      row.addEventListener("focusin", () => highlightBox(draft.number, true));
      row.addEventListener("focusout", () => highlightBox(draft.number, false));
      row.addEventListener("mouseenter", () => highlightBox(draft.number, true));
      row.addEventListener("mouseleave", () => highlightBox(draft.number, false));
      return row;
    }),
  );
  renderAddButton();
}

function closeReview() {
  state.drafts = [];
  state.photo = "";
  $("#review").hidden = true;
  $("#review-list").replaceChildren();
  $("#review-photo").replaceChildren();
  setStatus($("#review-status"), "");
}

function itemRow(item) {
  if (state.editing === item.id) return editRow(item);
  const edit = h("button", { type: "button", "data-edit": item.id, "aria-label": `Edit ${item.label}`, onclick: () => openEdit(item.id) }, icon("edit"), "Edit");
  const remove = h("button", { type: "button", class: "danger", "aria-label": `Delete ${item.label}` }, icon("delete"), "Delete");
  remove.addEventListener("click", () => {
    if (!confirm(`Delete "${item.label}" from the list? This cannot be undone.`)) return;
    busy(
      remove,
      $("#items-status"),
      async () => {
        await api(`${base}/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        state.items = state.items.filter((other) => other.id !== item.id);
        if (state.editing === item.id) state.editing = null;
        renderItems();
        $("#items-title").focus();
      },
      `${item.label} deleted.`,
    );
  });
  return h(
    "li",
    { class: "room-item", "data-item": item.id },
    itemSwatch(item.color_hex),
    h(
      "div",
      { class: "room-item-text" },
      h("div", { class: "room-item-head" }, h("strong", {}, item.label), item.source === "scan" && h("span", { class: "chip ok" }, "From photo")),
      h("span", { class: "small muted" }, R.itemSummary(item)),
      item.note && h("p", { class: "room-item-note small" }, item.note),
    ),
    h("div", { class: "room-item-actions" }, edit, remove),
  );
}

function editRow(item) {
  const id = `edit-${item.id}`;
  const hasColour = L.swatchColor(item.color_hex) !== "transparent";
  const colour = h("input", { type: "color", id: `${id}-colour`, value: hasColour ? item.color_hex : "#bf542c", disabled: !hasColour });
  const noColour = h("input", {
    type: "checkbox",
    id: `${id}-nocolour`,
    checked: !hasColour,
    onchange: (event) => {
      colour.disabled = event.target.checked;
    },
  });
  const field = (key, text, control) => h("label", { for: `${id}-${key}` }, text, control);
  const name = h("input", { id: `${id}-name`, value: item.label, maxLength: R.MAX_LABEL, autocomplete: "off" });
  const category = h("select", { id: `${id}-category` }, categoryOptions(item.category));
  const room = h("select", { id: `${id}-room` }, roomOptions(item.room_id));
  const note = h("input", { id: `${id}-note`, value: item.note ?? "", maxLength: R.MAX_NOTE, autocomplete: "off" });
  const save = h("button", { type: "submit", class: "primary" }, icon("save"), "Save");
  const cancel = h("button", { type: "button", onclick: () => closeEdit(item.id) }, "Cancel");
  const status = h("p", { class: "status", role: "status", "aria-live": "polite" });
  const form = h(
    "form",
    { class: "room-edit", novalidate: true, "aria-label": `Edit ${item.label}` },
    h(
      "div",
      { class: "room-edit-grid" },
      field("name", "Name", name),
      field("category", "Category", category),
      h(
        "div",
        { class: "stack-tight" },
        field("colour", "Colour", colour),
        h("label", { class: "check", for: `${id}-nocolour` }, noColour, "No colour"),
      ),
      field("room", "Room", room),
      h("label", { for: `${id}-note`, class: "room-edit-wide" }, "Note (optional)", note),
    ),
    h("div", { class: "savebar" }, save, cancel, status),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = {
      label: name.value.trim(),
      category: category.value,
      color_hex: noColour.checked ? null : colour.value.toLowerCase(),
      room_id: room.value || null,
      note: note.value.trim(),
    };
    const problem = R.validateItem(body);
    if (problem) return setStatus(status, problem, "error");
    cancel.disabled = true;
    busy(
      save,
      status,
      async () => {
        const saved = await api(`${base}/items/${encodeURIComponent(item.id)}`, { method: "PUT", body });
        state.items = state.items.map((other) => (other.id === saved.id ? saved : other));
        closeEdit(item.id, `${saved.label} saved.`);
      },
      "Saved.",
    ).finally(() => {
      cancel.disabled = false;
    });
  });
  return h("li", { class: "room-item editing", "data-item": item.id }, form);
}

function openEdit(itemId) {
  state.editing = itemId;
  setStatus($("#items-status"), "");
  renderItems();
  $(`#edit-${CSS.escape(itemId)}-name`)?.focus();
}

function closeEdit(itemId, message = "") {
  state.editing = null;
  renderItems();
  setStatus($("#items-status"), message);
  $(`#items-groups [data-edit="${CSS.escape(itemId)}"]`)?.focus();
}

function renderItems() {
  $("#items-count").textContent = String(state.items.length);
  $("#items-empty").hidden = state.items.length > 0;
  $("#items-groups").replaceChildren(
    ...R.groupByRoom(state.items, state.rooms).map((group, index) => {
      const titleId = `items-group-${index}`;
      return h(
        "section",
        { class: "room-group", "aria-labelledby": titleId },
        h("h3", { id: titleId }, group.title, " ", h("span", { class: "mono muted small" }, String(group.items.length))),
        h("ul", { class: "room-items" }, group.items.map(itemRow)),
      );
    }),
  );
}

function initRoom() {
  for (const select of [$("#scan-room"), $("#manual-room")]) select.replaceChildren(...roomOptions(null));
  $("#manual-category").replaceChildren(h("option", { value: "" }, "Choose a category"), ...categoryOptions(null));

  $("#scan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.file.files[0];
    const problem = R.scanFileProblem(file);
    if (problem) return setStatus($("#scan-status"), problem, "error");
    const body = new FormData();
    body.append("file", file);
    if (form.room_id.value) body.append("room_id", form.room_id.value);
    let found = null;
    busy(
      $("#scan-send"),
      $("#scan-status"),
      async () => {
        const scan = await api(`${base}/scans`, { method: "POST", body });
        form.file.value = ""; // the photo is stored; a second press must not send it again
        state.drafts = R.detectionsToDrafts(scan.detections, scan.asset.id, scan.room_id);
        state.photo = scan.asset.url;
        found = state.drafts.length;
        setStatus($("#review-status"), "");
        renderReview();
        $("#review").hidden = false;
      },
      "",
    ).then(() => {
      if (found === null) return; // the scan failed; busy() shows why
      setStatus($("#scan-status"), found ? `Found ${plural(found, "item")} in ${roomName(state.drafts[0].room_id)}. Check them below.` : "Nothing recognisable was found.");
      $("#review-title").focus();
    });
  });

  $("#review-add").addEventListener("click", () => {
    const chosen = state.drafts.filter((draft) => draft.selected);
    const items = R.selectedItems(state.drafts);
    const problem = R.validateItems(items, chosen);
    if (problem) return setStatus($("#review-status"), problem, "error");
    let created = null;
    $("#review-discard").disabled = true;
    busy(
      $("#review-add"),
      $("#review-status"),
      async () => {
        created = await api(`${base}/items`, { method: "POST", body: { items } });
      },
      "",
    ).then(() => {
      $("#review-discard").disabled = false;
      if (!created) return renderAddButton(); // the error stays beside the button
      state.items = [...state.items, ...created];
      closeReview();
      renderItems();
      setStatus($("#scan-status"), `Added ${plural(created.length, "item")}.`);
      $("#items-title").focus();
    });
  });

  $("#review-discard").addEventListener("click", () => {
    closeReview();
    setStatus($("#scan-status"), "Scan discarded. The photo stays with your images on the Moodboard tab.");
    $("#scan-file").focus();
  });

  $("#manual-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget.elements; // `.elements`: a control named "label" must not clash with form properties
    const item = {
      label: form.label.value.trim(),
      category: form.category.value,
      color_hex: null,
      room_id: form.room_id.value || null,
      note: form.note.value.trim(),
      source: "manual",
    };
    const problem = R.validateItem(item);
    if (problem) return setStatus($("#manual-status"), problem, "error");
    busy(
      $("#manual-add"),
      $("#manual-status"),
      async () => {
        const created = await api(`${base}/items`, { method: "POST", body: { items: [item] } });
        state.items = [...state.items, ...created];
        form.label.value = "";
        form.note.value = "";
        renderItems();
        form.label.focus();
      },
      `${item.label} added to ${roomName(item.room_id)}.`,
    );
  });
}

// ---- start ------------------------------------------------------------------------------------------

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const [project, catalog, brief, versions, finishes, assets, board, items, profile] = await Promise.all([
    api(base),
    api("/v1/catalog"),
    api(`${base}/brief`),
    api(`${base}/versions`),
    api(`${base}/finishes`),
    api(`${base}/assets`),
    api(`${base}/moodboard`),
    api(`${base}/items`),
    api(`${base}/style-profile`).catch(() => null), // optional: the page works without it
  ]);
  state.catalog = catalog;
  state.rooms = versions.length ? (await api(`${base}/versions/latest`)).geometry.rooms : [];
  state.finishes = L.finishesToMap(finishes);
  state.assets = assets;
  state.board = board;
  state.items = items;
  state.profile = profile;

  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · Brief & materials`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  $("#nav-editor").href = `editor.html${query}`;
  $("#finishes-editor-link").href = `editor.html${query}`;
  $("#nav-design").href = `design.html${query}`;
  $("#nav-consultant").href = `consultant.html${query}`;

  initTabs();
  initBrief();
  initFinishes();
  initMoodboard();
  initRoom();
  fillBrief(brief.brief);
  renderFinishes();
  renderBoard();
  renderBoardSources();
  renderAssets();
  renderStyleProfile();
  renderItems();
  $("#design").hidden = false;
});
