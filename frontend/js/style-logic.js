// Pure helpers for the style profile on the Moodboard tab: the analysis of inspiration images
// (objects and colour palette) and the profile shared across them. No DOM, no network.
import { addColor, MAX_COLORS } from "./design-logic.js";
import { categoryLabel } from "./room-logic.js";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const list = (value) => (Array.isArray(value) ? value : []);

// Merges a palette into the brief colours with the brief's own rules (lower case, once, valid hex,
// at most `max`). `added` and `skipped` list the palette values that were and were not taken.
export function paletteToBriefColors(briefColors, palette, max = MAX_COLORS) {
  let colors = list(briefColors);
  const added = [];
  const skipped = [];
  const known = new Set(colors.map((color) => String(color).toLowerCase())); // the brief may hold upper case
  for (const entry of list(palette)) {
    const value = String(entry?.hex ?? "").trim().toLowerCase();
    const next = known.has(value) ? colors : addColor(colors, value, max);
    known.add(value);
    if (next === colors) skipped.push(entry?.hex ?? null);
    else added.push(next[next.length - 1]);
    colors = next;
  }
  return { colors, added, skipped };
}

// The "Add N colours to the brief" button: how many colours it would add, and its text.
export function styleButton(briefColors, palette, max = MAX_COLORS) {
  const count = paletteToBriefColors(briefColors, palette, max).added.length;
  if (count > 0) return { count, disabled: false, text: `Add ${plural(count, "colour")} to the brief` };
  if (list(palette).length === 0) return { count, disabled: true, text: "No colours to add" };
  if (list(briefColors).length >= max) return { count, disabled: true, text: `The brief has ${max} colours` };
  return { count, disabled: true, text: "Palette already in the brief" };
}

export const addedMessage = (count) => `Added ${plural(count, "colour")} to the brief.`;

// "Seating in 3 of 4 images" for each category, counted against the analysed images.
export function profileSentences(profile) {
  const analysed = Number(profile?.analysed) || 0;
  if (analysed <= 0) return [];
  const noun = analysed === 1 ? "image" : "images";
  return list(profile.categories)
    .filter((entry) => entry && typeof entry.category === "string" && entry.category)
    .map((entry) => `${categoryLabel(entry.category)} in ${Number(entry.images) || 0} of ${analysed} ${noun}`);
}

// A short line under one image: "2 seating · 1 plants".
export function analysisSummary(analysis) {
  if (!analysis) return "";
  const counts = new Map();
  for (const found of list(analysis.objects)) {
    if (!found || typeof found !== "object") continue;
    const category = (typeof found?.category === "string" && found.category) || "other";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  if (counts.size === 0) return "No furniture found";
  return [...counts] // Map keeps first-seen order; the sort is stable, so ties keep it
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${count} ${category}`)
    .join(" · ");
}

// 0.45 -> "45%", clamped to 0..100.
export function percent(share) {
  const value = Number(share);
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

export const imagesText = (count) => `in ${plural(Number(count) || 0, "image")}`;

// The accessible name of a palette swatch: "beige, 45%" (", in 3 images" for the shared palette).
export function swatchLabel(color) {
  const parts = [color?.name || color?.hex || "Colour", percent(color?.share)];
  if (color?.images != null) parts.push(imagesText(color.images));
  return parts.join(", ");
}

export function basisText(profile) {
  const total = Number(profile?.total) || 0;
  return `Based on ${Number(profile?.analysed) || 0} of ${total} inspiration image${total === 1 ? "" : "s"}`;
}
