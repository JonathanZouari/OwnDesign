// Navigation drawer for widths up to 1199 px, where the sidebar and the header tabs are hidden.
//
// The drawer has no links of its own. Each time it opens it copies the page's live navigation, so the
// page stays the one source of truth (href, hidden state and label, which page modules change after load):
//   - children of every element marked data-drawer-links (links are cloned; inactive spans stay inactive)
//   - every button marked data-drawer-action (a proxy button that clicks the original)
//   - the studio name from #studio-brand
// Names come from the DOM as text: copies are made with cloneNode and textContent, never innerHTML.

const WIDE = "(min-width: 1200px)";

function copyLink(item) {
  const copy = item.cloneNode(true);
  for (const node of [copy, ...copy.querySelectorAll("[id]")]) node.removeAttribute("id");
  copy.removeAttribute("class");
  if (copy.tagName === "SPAN") copy.setAttribute("aria-disabled", "true");
  return copy;
}

function copyAction(original, close) {
  const proxy = document.createElement("button");
  proxy.type = "button";
  proxy.textContent = original.textContent.trim();
  proxy.disabled = original.disabled;
  proxy.addEventListener("click", () => {
    close();
    original.click();
  });
  return proxy;
}

export function initNavDrawer() {
  const button = document.getElementById("nav-menu");
  const drawer = document.getElementById("nav-drawer");
  if (!button || !drawer || typeof drawer.showModal !== "function") return;
  const links = drawer.querySelector('[data-drawer-slot="links"]');
  const actions = drawer.querySelector('[data-drawer-slot="actions"]');
  const studio = drawer.querySelector('[data-drawer-slot="studio"]');
  const close = () => drawer.close();

  function fill() {
    links.replaceChildren(
      ...[...document.querySelectorAll("[data-drawer-links]")]
        .flatMap((source) => [...source.children])
        // Not from a hidden section either: while a page loads its nav still has placeholder hrefs.
        .filter((item) => item.matches("a[href], span") && !item.closest("[hidden]"))
        .map(copyLink),
    );
    actions.replaceChildren(
      ...[...document.querySelectorAll("[data-drawer-action]")]
        .filter((original) => !original.closest("[hidden]") && original.textContent.trim())
        .map((original) => copyAction(original, close)),
    );
    const chip = document.getElementById("studio-brand");
    studio.textContent = chip && !chip.hidden ? chip.textContent : "";
    studio.hidden = !studio.textContent;
  }

  // Copies exist only while the drawer is open, so the page never holds two links with the same name.
  function empty() {
    links.replaceChildren();
    actions.replaceChildren();
    studio.textContent = "";
    studio.hidden = true;
  }

  button.addEventListener("click", () => {
    fill();
    drawer.showModal();
    button.setAttribute("aria-expanded", "true");
  });
  // "close" fires after a clicked link has started its navigation, so emptying here is safe.
  drawer.addEventListener("close", () => {
    button.setAttribute("aria-expanded", "false");
    empty();
    button.focus({ preventScroll: true });
  });
  drawer.addEventListener("click", (event) => {
    // The dialog has no padding, so a click on the dialog element itself is a click on the backdrop.
    if (event.target === drawer || event.target.closest("a[href], [data-drawer-close]")) close();
  });
  matchMedia(WIDE).addEventListener("change", (event) => {
    if (event.matches && drawer.open) close();
  });
}
