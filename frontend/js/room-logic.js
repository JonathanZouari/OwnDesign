// Pure helpers for the "In the room" tab: turning a YOLOv8 scan into drafts the person confirms, and the item list.
// No DOM, no network. The limits mirror backend/app/schemas.py (RoomItemIn) so mistakes show before sending.

import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./design-logic.js";

export const CATEGORIES = ["seating", "sleeping", "tables", "storage", "appliances", "electronics", "decor", "plants", "bathroom", "other"];
export const MAX_LABEL = 80;
export const MAX_NOTE = 200;
export const MAX_BATCH = 50;
export const WHOLE_HOME = "Whole home";

const HEX = /^#[0-9a-f]{6}$/;
const cleanHex = (value) => (HEX.test(String(value ?? "").toLowerCase()) ? String(value).toLowerCase() : null);
export const categoryLabel = (category) => (category ? category[0].toUpperCase() + category.slice(1) : "");

export function scanFileProblem(file) {
  if (!file) return "Choose or take a photo first.";
  if (!file.size) return "The file is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Photos can be at most 5 MB.";
  if (!IMAGE_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP photo.";
  return null;
}

// One editable draft per detection, numbered as on the photo, all ticked.
export function detectionsToDrafts(detections, assetId, roomId) {
  return (detections ?? []).map((found, index) => ({
    number: index + 1,
    selected: true,
    label: String(found.label ?? "").slice(0, MAX_LABEL),
    category: CATEGORIES.includes(found.category) ? found.category : "other",
    color_hex: cleanHex(found.color_hex),
    color_name: found.color_name ?? "",
    confidence: found.confidence,
    box: found.box,
    position: found.position,
    room_id: roomId ?? null,
    asset_id: assetId,
  }));
}

export function selectedItems(drafts) {
  return drafts
    .filter((draft) => draft.selected)
    .map((draft) => ({
      label: draft.label.trim(),
      category: draft.category,
      color_hex: draft.color_hex,
      room_id: draft.room_id,
      note: "",
      source: "scan",
      asset_id: draft.asset_id,
      confidence: draft.confidence,
      box: draft.box,
    }));
}

// The first problem with one item, or null.
export function validateItem(item) {
  const label = String(item.label ?? "").trim();
  if (!label) return "Give the item a name.";
  if (label.length > MAX_LABEL) return `Names can be at most ${MAX_LABEL} characters.`;
  if (!CATEGORIES.includes(item.category)) return "Choose a category.";
  if (item.color_hex != null && item.color_hex !== "" && !HEX.test(String(item.color_hex).toLowerCase())) return "The colour must be a hex colour such as #a0b1c2.";
  if (String(item.note ?? "").length > MAX_NOTE) return `Notes can be at most ${MAX_NOTE} characters.`;
  return null;
}

// Checks a batch before POST; `drafts` gives each item its number on the photo for the message.
export function validateItems(items, drafts) {
  if (!items.length) return "Tick at least one item to add.";
  if (items.length > MAX_BATCH) return `Add at most ${MAX_BATCH} items at a time.`;
  for (const [index, item] of items.entries()) {
    const problem = validateItem(item);
    if (problem) return `Item ${drafts[index]?.number ?? index + 1}: ${problem}`;
  }
  return null;
}

// Items grouped by the plan's rooms in plan order; items without a known room go under "Whole home", last.
export function groupByRoom(items, rooms) {
  const known = new Map(rooms.map((room) => [room.id, room.name]));
  const groups = rooms.map((room) => ({ id: room.id, title: room.name, items: [] }));
  const home = { id: null, title: WHOLE_HOME, items: [] };
  for (const item of items) {
    (known.has(item.room_id) ? groups.find((g) => g.id === item.room_id) : home).items.push(item);
  }
  return [...groups, home].filter((group) => group.items.length);
}

const percent = (value) => `${Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 1000) / 10}%`;

export function boxToPercent(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [left, top, width, height] = box;
  return { left: percent(left), top: percent(top), width: percent(width), height: percent(height) };
}

export function itemSummary(item) {
  const parts = [categoryLabel(item.category)];
  if (item.color_name) parts.push(item.color_name);
  if (item.source === "scan" && typeof item.confidence === "number") parts.push(`${Math.round(item.confidence * 100)}% sure`);
  return parts.join(" · ");
}
