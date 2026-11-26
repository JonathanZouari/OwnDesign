// Product catalog, favorites and shopping list for one project (?project=<id>). Products are mock data;
// favorites, the list and its approval live in this browser only.
import { api, requireSession, signOut } from "../api.js";
import { CATEGORIES, COLORS, PRODUCTS, PRODUCT_BY_ID } from "../products.js";
import * as S from "../shop-logic.js";
import { load, save } from "../store.js";
import { $, h, run, showStudio, toast } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null;
const TABS = ["catalog", "favorites", "list"];
const TINT = {
  Aluminum: "#a8adb3", Beige: "#cbb593", Black: "#242523", Brown: "#6f4e37", Chrome: "#9aa6ad", Gold: "#b8923c", Gray: "#8b8d8a",
  Green: "#47654f", Natural: "#b98d5c", Red: "#a8322d", Terracotta: "#bf542c", Walnut: "#5c4033", White: "#f4f1ea",
};

let state = S.emptyState();
let currency = "USD";
let project = null;
let wasApproved = false; // an approval dropped by an edit in this visit

const money = (amount) => S.formatMoney(amount, currency);
const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, name);

function update(next) {
  if (next === state) return render();
  if (state.status === "approved" && next.status === "draft") wasApproved = true;
  if (next.status === "approved") wasApproved = false;
  state = next;
  if (!save(S.storageKey(projectId), state)) toast("This browser would not save the change.", "error");
  render();
}

// The silhouettes are used as masks, so one drawing serves every colour.
function picture(product, color = product.colors[0], extra = "") {
  const node = h("div", { class: `shop-picture ${extra}`, role: "img", "aria-label": color ? `${product.name} in ${color}` : product.name });
  const shape = h("span", {});
  shape.style.maskImage = `url("${product.image}")`;
  shape.style.backgroundColor = TINT[color] ?? "#8a726a";
  node.append(h("div", { class: "shop-outline" }, shape)); // a filter on the masked element itself would be clipped
  return node;
}

function priceText(product) {
  const prices = new Set(product.sizes.map((size) => size.price));
  return `${prices.size > 1 ? "From " : ""}${money(S.minPrice(product))}`;
}

function card(product) {
  const favorite = state.favorites.includes(product.id);
  return h(
    "article",
    { class: "card shop-card", "data-id": product.id },
    picture(product),
    h("h3", {}, product.name),
    h("p", { class: "muted small" }, product.description),
    h("strong", {}, priceText(product)),
    h("p", { class: "small" }, product.colors.length ? `Colours: ${product.colors.join(", ")}` : "One finish"),
    h("p", { class: "small" }, product.sizes.length > 1 ? `Sizes: ${product.sizes.map((s) => s.name).join(", ")}` : "One size"),
    h(
      "div",
      { class: "row between" },
      h(
        "button",
        {
          type: "button",
          class: "shop-fav",
          "data-fav": product.id,
          "aria-pressed": String(favorite),
          "aria-label": `Favorite ${product.name}`,
          onclick: (event) => {
            const grid = event.currentTarget.closest(".shop-grid");
            update(S.toggleFavorite(state, product.id));
            (grid.querySelector(`[data-fav="${product.id}"]`) ?? $("#tab-favorites")).focus(); // the card was redrawn
          },
        },
        icon(favorite ? "heart_check" : "favorite"),
      ),
      h("button", { type: "button", "aria-label": `Add ${product.name} to list`, onclick: () => openSelection(product) }, "Add to list"),
    ),
  );
}

function renderCatalog() {
  const min = Number($("#f-min").value);
  const max = Number($("#f-max").value);
  $("#f-min-value").textContent = money(min);
  $("#f-max-value").textContent = money(max);
  const filtered = S.filterProducts(PRODUCTS, { category: $("#f-category").value, color: $("#f-color").value, min, max });
  const shown = S.sortProducts(filtered, $("#f-sort").value);
  $("#grid").replaceChildren(...shown.map(card));
  $("#no-results").hidden = shown.length > 0;
  $("#result-count").textContent = `${shown.length} ${shown.length === 1 ? "product" : "products"}`;
}

function row(item, index) {
  const product = PRODUCT_BY_ID.get(item.productId);
  const stepper = (delta, label, disabled) =>
    h(
      "button",
      {
        type: "button",
        "data-step": `${index}:${delta}`,
        disabled,
        "aria-label": `${label} quantity of ${product.name}, ${item.color ?? "one finish"}`,
        onclick: () => {
          update(S.setQuantity(state, index, item.quantity + delta));
          const same = $(`[data-step="${index}:${delta}"]`);
          (same.disabled ? $(`[data-step="${index}:${-delta}"]`) : same).focus();
        },
      },
      delta > 0 ? "+" : "−",
    );
  return h(
    "li",
    {},
    picture(product, item.color, "small"),
    h(
      "div",
      { class: "shop-line-name" },
      h("strong", {}, product.name),
      h("span", { class: "muted small" }, `${item.color ?? "One finish"} · ${S.sizeOf(product.id, item.sizeId).name}`),
      h("span", { class: "muted small print-only" }, `${product.id} · ${S.categoryName(product.category)}`),
    ),
    h("span", { class: "shop-unit" }, `${money(S.unitPrice(item))} each`),
    h(
      "div",
      { class: "shop-qty" },
      stepper(-1, "Decrease", item.quantity <= 1),
      h("span", { class: "mono qty" }, String(item.quantity)),
      stepper(1, "Increase", item.quantity >= S.MAX_QTY),
    ),
    h("strong", { class: "shop-line-total" }, money(S.lineTotal(item))),
    h(
      "button",
      {
        type: "button",
        class: "no-print",
        "aria-label": `Remove ${product.name}, ${item.color ?? "one finish"}`,
        onclick: () => {
          update(S.removeItem(state, index));
          $("#tab-list").focus();
        },
      },
      "Remove",
    ),
  );
}

function renderList() {
  const approved = state.status === "approved";
  const empty = state.items.length === 0;
  $("#list").replaceChildren(...state.items.map(row));
  $("#list-empty").hidden = !empty;
  $("#list-total").textContent = money(S.estimatedTotal(state));
  $("#list-status").textContent = approved ? "Approved" : "Draft";
  $("#list-status").classList.toggle("ok", approved);
  $("#list-changed").hidden = !wasApproved;
  $("#approve").disabled = approved || empty;
  $("#export-csv").disabled = empty;
  $("#export-pdf").disabled = empty;
  $("#print-meta").textContent = `Exported ${new Date().toLocaleDateString()} · Status: ${approved ? "Approved" : "Draft"}`;
  $("#tab-list").textContent = empty ? "Shopping list" : `Shopping list (${state.items.length})`;
}

function render() {
  renderCatalog();
  const favorites = PRODUCTS.filter((p) => state.favorites.includes(p.id));
  $("#fav-grid").replaceChildren(...favorites.map(card));
  $("#fav-empty").hidden = favorites.length > 0;
  renderList();
}

// ---- selection dialog -------------------------------------------------------------------------------

let selected = null;
const checked = (name) => $(`#select-form input[name=${name}]:checked`)?.value ?? null;

function refreshSelection() {
  const color = checked("color");
  $("#select-image").replaceChildren(picture(selected, color ?? selected.colors[0]));
  const size = S.sizeOf(selected.id, checked("size"));
  $("#select-price").textContent = size ? money(size.price) : priceText(selected);
}

const radio = (name, value, label, isChecked) =>
  h("label", { class: "swatch" }, h("input", { type: "radio", name, value, checked: isChecked, required: true, onchange: refreshSelection }), label);

const dimensions = (size) => `${Object.entries(size.dimensions).map(([key, value]) => `${key} ${value}`).join(", ")} cm`;

function openSelection(product) {
  selected = product;
  $("#select-name").textContent = product.name;
  $("#select-description").textContent = product.description;
  $("#select-colors").hidden = !product.colors.length;
  $("#select-colors .swatches").replaceChildren(...product.colors.map((c) => radio("color", c, c, product.colors.length === 1)));
  const single = product.sizes.length === 1;
  $("#select-sizes .swatches").replaceChildren(
    ...product.sizes.map((s) => radio("size", s.id, single ? dimensions(s) : `${s.name} (${dimensions(s)})`, single)),
  );
  $("#qty").value = "1";
  refreshSelection();
  $("#select-dialog").returnValue = "";
  $("#select-dialog").showModal();
}

function addSelected(event) {
  if (event.submitter?.value !== "add") return; // Cancel and Escape just close the dialog
  try {
    update(S.addItem(state, { productId: selected.id, color: checked("color"), sizeId: checked("size"), quantity: Number($("#qty").value) }));
    toast(`${selected.name} added to the shopping list`);
  } catch (error) {
    event.preventDefault();
    toast(error.message, "error");
  }
}

// ---- tabs, filters, export --------------------------------------------------------------------------

function showTab(name, focus = false) {
  for (const tab of TABS) {
    const button = $(`#tab-${tab}`);
    const isSelected = tab === name;
    button.setAttribute("aria-selected", String(isSelected));
    button.tabIndex = isSelected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !isSelected;
    if (isSelected && focus) button.focus();
  }
}

function initTabs() {
  TABS.forEach((tab, index) => {
    const button = $(`#tab-${tab}`);
    button.addEventListener("click", () => showTab(tab));
    button.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (step) showTab(TABS[(index + step + TABS.length) % TABS.length], true);
    });
  });
}

function initFilters() {
  $("#f-category").append(...CATEGORIES.map((c) => h("option", { value: c.id }, c.name)));
  $("#f-color").append(...COLORS.map((c) => h("option", { value: c }, c)));
  const bounds = S.priceBounds(PRODUCTS);
  for (const [id, value] of [["#f-min", bounds.min], ["#f-max", bounds.max]]) {
    const range = $(id);
    range.min = bounds.min;
    range.max = bounds.max;
    range.defaultValue = String(value); // what "Clear filters" (form reset) returns to
  }
  // The two sliders never cross: moving one past the other drags it along.
  $("#f-min").addEventListener("input", () => {
    if (Number($("#f-min").value) > Number($("#f-max").value)) $("#f-max").value = $("#f-min").value;
  });
  $("#f-max").addEventListener("input", () => {
    if (Number($("#f-max").value) < Number($("#f-min").value)) $("#f-min").value = $("#f-max").value;
  });
  $("#filters").addEventListener("input", renderCatalog);
  $("#filters").addEventListener("reset", () => setTimeout(renderCatalog)); // values change after the event
  $("#filters").addEventListener("submit", (event) => event.preventDefault());
}

function exportCsv() {
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  // The BOM makes spreadsheet apps read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(["﻿", S.toCsv(state)], { type: "text/csv;charset=utf-8" }));
  h("a", { href: url, download: `shopping-list-${slug}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- start ------------------------------------------------------------------------------------------

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const base = `/v1/projects/${projectId}`;
  const [loaded, brief] = await Promise.all([api(base), api(`${base}/brief`)]);
  project = loaded;
  currency = brief.brief.currency;
  state = S.restore(load(S.storageKey(projectId)));

  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · Product catalog`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  $("#print-title").textContent = `${project.name} · Shopping list`;
  showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  for (const page of ["editor", "design", "catalog", "consultant"]) $(`#nav-${page}`).href = `${page}.html${query}`;

  initTabs();
  initFilters();
  $("#select-form").addEventListener("submit", addSelected);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#export-pdf").addEventListener("click", () => window.print());
  $("#approve").hidden = project.my_role === "designer";
  $("#approve").addEventListener("click", () => update(S.approve(state)));
  // Another tab of this browser may edit or approve the same list.
  window.addEventListener("storage", (event) => {
    if (event.key !== S.storageKey(projectId)) return;
    state = S.restore(load(event.key));
    render();
  });
  render();
  $("#shop").hidden = false;
});
