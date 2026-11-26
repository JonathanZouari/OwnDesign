// The editor's tools, and which of them a phone offers. On a phone the plan can be viewed and lightly
// edited (select, move, rotate, resize, furniture); drawing walls and placing doors or windows needs a
// larger screen (user decision, wiki/decisions.md). Pure, so it is unit tested.

export const TOOLS = Object.freeze([
  { id: "select", icon: "near_me", key: "V", label: "Select and move" },
  { id: "exterior", icon: "polyline", key: "W", label: "Draw exterior wall" },
  { id: "partition", icon: "vertical_split", key: "P", label: "Draw partition" },
  { id: "door", icon: "meeting_room", key: "D", label: "Place door" },
  { id: "window", icon: "window", key: "N", label: "Place window" },
  { id: "furniture", icon: "chair", key: "F", label: "Furniture catalog" },
].map(Object.freeze));

const PHONE_TOOLS = new Set(["select", "furniture"]);
const FURNITURE_PREFIX = "furniture:";

export const PHONE_QUERY = "(max-width: 767px)";

export const toolsFor = (compact) => TOOLS.filter((tool) => !compact || PHONE_TOOLS.has(tool.id));

// Walls and openings are the drawing part of a plan: on a phone they can be selected and read, not changed
// (moved, reshaped, retyped or deleted). Rooms and furniture stay editable.
const STRUCTURE = new Set(["walls", "openings", "handle"]);
export const isLocked = (kind, compact) => Boolean(compact) && STRUCTURE.has(kind);

// Dragging, nudging or deleting a room changes its walls (plan.js translate/remove), so on a phone only
// furniture is moved or deleted. A room's name and type stay editable in the inspector.
export const canMove = (kind, compact) => !compact || kind === "furniture";

export function isAllowed(tool, compact) {
  if (typeof tool !== "string") return false;
  if (tool.startsWith(FURNITURE_PREFIX)) return tool.length > FURNITURE_PREFIX.length;
  return toolsFor(compact).some((candidate) => candidate.id === tool);
}
