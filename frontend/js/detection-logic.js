// Pure helpers for existing-item detection (specs/item-detection.md). The model runs on the server;
// these only arrange what it returned and what the user chose.

export const SURE = 0.6; // below this an item is shown as "Not sure" and not ticked in advance
const MAX_QUANTITY = 20;

// One entry per kind of item, strongest first: "Chair × 2" rather than two separate chairs.
// The quantity counts the sure detections only (unsure ones are often the same chair seen twice),
// or all of them when none is sure.
export function groupDetections(items) {
  const groups = new Map();
  for (const item of items) {
    const group = groups.get(item.item_class) ?? { ...item, all: 0, certain: 0, boxes: [] };
    group.all += 1;
    if (item.confidence >= SURE) group.certain += 1;
    group.confidence = Math.max(group.confidence, item.confidence);
    group.boxes.push(item.box);
    groups.set(item.item_class, group);
  }
  return [...groups.values()]
    .map(({ box, all, certain, ...group }) => ({ ...group, quantity: certain || all, sure: certain > 0 }))
    .sort((a, b) => b.confidence - a.confidence);
}

const percent = (value) => `${Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 10}%`;

// Position of a detection box over the photo, in percent of the photo's size.
export function boxStyle({ x, y, w, h }) {
  const left = Math.min(Math.max(x, 0), 1);
  const top = Math.min(Math.max(y, 0), 1);
  return { left: percent(left), top: percent(top), width: percent(Math.min(x + w, 1) - left), height: percent(Math.min(y + h, 1) - top) };
}

// `chosen` maps item_class -> quantity for the ticked items.
export function acceptBody(groups, chosen, sourceAssetId) {
  const items = groups
    .filter((group) => chosen.has(group.item_class))
    .map((group) => ({ item_class: group.item_class, quantity: Math.min(Math.max(Math.round(chosen.get(group.item_class)) || 1, 1), MAX_QUANTITY) }));
  return { source_asset_id: sourceAssetId, items };
}

// Owned items the editor can place: those with a catalog type, one entry per type.
export function paletteItems(owned) {
  const byType = new Map();
  for (const item of owned) {
    if (!item.catalog_type) continue;
    const entry = byType.get(item.catalog_type) ?? { type: item.catalog_type, label: item.label, quantity: 0 };
    entry.quantity += item.quantity;
    byType.set(item.catalog_type, entry);
  }
  return [...byType.values()];
}
