// On phones (max-width 767 px) the inspector is a bottom sheet: collapsed to its handle (#sheet-toggle),
// expanded when #inspector has the class sheet-open. Wider screens ignore the class.
// The toggle sits outside #inspector because the inspector's contents are re-rendered.

const parts = () => ({ inspector: document.getElementById("inspector"), toggle: document.getElementById("sheet-toggle") });

export function setSheetOpen(open) {
  const { inspector, toggle } = parts();
  if (!inspector) return;
  inspector.classList.toggle("sheet-open", Boolean(open));
  toggle?.setAttribute("aria-expanded", String(Boolean(open)));
}

export function initSheet() {
  const { inspector, toggle } = parts();
  if (!inspector || !toggle) return;
  toggle.addEventListener("click", () => setSheetOpen(!inspector.classList.contains("sheet-open")));
  setSheetOpen(inspector.classList.contains("sheet-open"));
}
