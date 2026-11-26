// Pure helpers for the plan export dialog. The file itself is built by the backend from a saved version
// (POST /v1/projects/{id}/versions/{version}/export); the browser never sends geometry.

export const FORMATS = [
  { id: "pdf", label: "PDF", hint: "To print or share. One page, fitted to A4 or A3." },
  { id: "png", label: "PNG image", hint: "The same page as an image, 300 DPI." },
  { id: "dxf", label: "DXF for CAD", hint: "Editable 2D drawing in centimetres, for AutoCAD or a similar program." },
];

export const needsPaper = (format) => format !== "dxf";

export const exportBody = (format, paper) => (needsPaper(format) ? { format, paper } : { format });

export const versionLabel = (version) => `v${version.version_no} · ${version.author_role} · ${version.label || "Untitled"}`;

export function exportNote(version, dirty) {
  if (!version) return "";
  const note = `Exports saved version v${version.version_no}.`;
  return dirty ? `${note} Unsaved changes on the canvas are not included.` : note;
}

// Same rule as file_name() in backend/app/exports/layout.py.
export function downloadName(projectName, versionNo, format) {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${slug || "plan"}-v${versionNo}.${format}`;
}
