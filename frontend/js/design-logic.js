// Pure helpers for the design pages (brief, finishes, moodboard, consultant). No DOM, no network:
// the limits mirror backend/app/schemas.py so a mistake is reported before the request is sent.

export const MAX_STYLES = 5;
export const MAX_COLORS = 8;
export const MAX_TEXT = 1000;
export const MAX_MONEY = 100_000_000;
export const MAX_PEOPLE = 20;
export const MAX_BOARD_ITEMS = 40;
export const MAX_NOTE = 200;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_MESSAGE = 2000;
export const CURRENCIES = ["USD", "EUR", "GBP", "ILS"];

const HEX = /^#[0-9a-f]{6}$/;

// ---- catalog --------------------------------------------------------------------------------------

export const materialsForSurface = (materials, surface) => materials.filter((material) => material.surfaces.includes(surface));

// A catalog colour is only used as a CSS value when it is a plain hex colour.
export const swatchColor = (color) => (HEX.test(String(color ?? "").toLowerCase()) ? color : "transparent");

// ---- brief ----------------------------------------------------------------------------------------

// Adds or removes a style; a sixth style is refused (the list is returned unchanged).
export function toggleStyle(selected, id, max = MAX_STYLES) {
  if (selected.includes(id)) return selected.filter((style) => style !== id);
  return selected.length >= max ? selected : [...selected, id];
}

// Adds a colour once (case-insensitive); refuses invalid values and a ninth colour.
export function addColor(colors, color, max = MAX_COLORS) {
  const value = String(color ?? "").trim().toLowerCase();
  if (!HEX.test(value) || colors.includes(value) || colors.length >= max) return colors;
  return [...colors, value];
}

function wholeNumber(raw, label, max, fallback) {
  const text = String(raw ?? "").trim();
  if (text === "") return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${label} must be a whole number from 0 to ${max.toLocaleString("en-US")}.`);
  return value;
}

// Form values (strings as typed) -> { payload } for PUT /brief, or { error } with a message for the user.
export function buildBriefPayload(values) {
  try {
    const styles = [...new Set(values.styles ?? [])];
    if (styles.length > MAX_STYLES) throw new Error(`Choose at most ${MAX_STYLES} styles.`);
    const colors = [...new Set((values.colors ?? []).map((color) => String(color).trim().toLowerCase()))];
    if (colors.some((color) => !HEX.test(color))) throw new Error("Colours must be hex values such as #9f3c16.");
    if (colors.length > MAX_COLORS) throw new Error(`Choose at most ${MAX_COLORS} colours.`);
    const budget_min = wholeNumber(values.budget_min, "Minimum budget", MAX_MONEY, null);
    const budget_max = wholeNumber(values.budget_max, "Maximum budget", MAX_MONEY, null);
    if (budget_min !== null && budget_max !== null && budget_min > budget_max) throw new Error("Minimum budget must not exceed maximum budget.");
    if (!CURRENCIES.includes(values.currency)) throw new Error("Choose a currency.");
    const text = (key, label) => {
      const value = String(values[key] ?? "").trim();
      if (value.length > MAX_TEXT) throw new Error(`${label} can be at most ${MAX_TEXT} characters.`);
      return value;
    };
    return {
      payload: {
        styles,
        colors,
        budget_min,
        budget_max,
        currency: values.currency,
        adults: wholeNumber(values.adults, "Adults", MAX_PEOPLE, 1),
        children: wholeNumber(values.children, "Children", MAX_PEOPLE, 0),
        pets: Boolean(values.pets),
        lifestyle: text("lifestyle", "Lifestyle"),
        needs: text("needs", "Needs"),
        constraints: text("constraints", "Constraints"),
        existing_items: text("existing_items", "Existing items"),
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ---- finishes -------------------------------------------------------------------------------------

export const finishKey = (roomId, surface) => `${roomId}|${surface}`; // room ids never contain "|"

export const finishesToMap = (rows) => Object.fromEntries(rows.map((row) => [finishKey(row.room_id, row.surface), row.material_id]));

// The PUT /finishes list: only rooms of the saved plan, only surfaces with a material that fits them.
export function finishSelections(rooms, surfaces, materials, chosen) {
  return rooms.flatMap((room) =>
    surfaces.flatMap((surface) => {
      const material_id = chosen[finishKey(room.id, surface)];
      const fits = materialsForSurface(materials, surface).some((material) => material.id === material_id);
      return fits ? [{ room_id: room.id, surface, material_id }] : [];
    }),
  );
}

// ---- moodboard ------------------------------------------------------------------------------------

// Moves the item at `index` by `delta` places (-1 up, +1 down). Out-of-range moves return the list unchanged.
export function moveItem(items, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length || delta === 0) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export const onBoard = (items, kind, ref) => items.some((item) => item.kind === kind && item.ref === ref);

// An item appears once on the board, and the board holds at most 40 items.
export function addBoardItem(items, kind, ref, max = MAX_BOARD_ITEMS) {
  if (onBoard(items, kind, ref) || items.length >= max) return items;
  return [...items, { kind, ref, note: "" }];
}

export const removeBoardItem = (items, kind, ref) => items.filter((item) => !(item.kind === kind && item.ref === ref));

export const setBoardNote = (items, kind, ref, note) =>
  items.map((item) => (item.kind === kind && item.ref === ref ? { ...item, note } : item));

// The PUT /moodboard body: display-only fields (signed urls) are dropped.
export const boardPayload = (items) => ({
  items: items.map(({ kind, ref, note }) => ({ kind, ref, note: String(note ?? "").trim().slice(0, MAX_NOTE) })),
});

// ---- uploads --------------------------------------------------------------------------------------

// Returns a message for the user, or null when the file may be sent. The server checks the bytes again.
export function validateImageFile(file) {
  if (!file) return "Choose an image first.";
  if (!IMAGE_TYPES.includes(file.type)) return "Only JPEG, PNG and WebP images are accepted.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Images can be at most 5 MB.";
  return null;
}

// Signed image links come from the API; anything that is not an http(s) URL is not loaded.
export function safeImageUrl(url) {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol) ? url : "";
  } catch {
    return "";
  }
}

// ---- consultant -----------------------------------------------------------------------------------

// The server trims the message and accepts 1 to 2000 characters.
export function messageState(text, max = MAX_MESSAGE) {
  const length = String(text ?? "").length;
  return { length, canSend: String(text ?? "").trim().length > 0 && length <= max, counter: `${length} / ${max}` };
}
