// Pure helpers for the editor's consultant panel: no DOM, no network.

export const MAX_MESSAGE = 2000; // the server accepts 1 to 2000 characters

export function newReply() {
  return { text: "", phase: null, done: false, error: null, messageId: null };
}

// Folds one server event into the reply being shown. Unknown events are ignored.
export function applyEvent(reply, [name, data]) {
  switch (name) {
    case "status":
      return { ...reply, phase: data?.status ?? reply.phase };
    case "token":
      return { ...reply, text: reply.text + String(data?.text ?? "") };
    case "message_complete":
      return { ...reply, done: true, messageId: data?.message_id ?? null };
    case "error":
      return { ...reply, done: true, error: String(data?.message ?? "The consultant could not answer.") };
    default:
      return reply;
  }
}

// Selection kinds in the editor are plan keys: rooms, walls, openings, furniture.
export function contextFromSelection(selection, plan) {
  if (!selection || !plan) return { type: "plan" };
  if (selection.kind === "furniture" && plan.furniture?.some((item) => item.id === selection.id)) return { type: "object", ids: [selection.id] };
  if (selection.kind === "rooms" && plan.rooms?.some((room) => room.id === selection.id)) return { type: "room", id: selection.id };
  return { type: "plan" };
}

export function contextLabel(scope, plan) {
  if (scope.type === "room") return plan?.rooms?.find((room) => room.id === scope.id)?.name ?? "Entire plan";
  if (scope.type === "object") {
    if (scope.ids.length > 1) return `${scope.ids.length} objects`;
    return plan?.furniture?.find((item) => item.id === scope.ids[0])?.type ?? "1 object";
  }
  return "Entire plan";
}

// Unsaved edits are sent as the working plan, so the answer matches what the user sees on the canvas.
export function sourceFor({ dirty, versionId, plan }) {
  return dirty || !versionId ? { kind: "working", plan } : { kind: "version", version_id: versionId };
}

export function sourceLabel({ dirty, versionNo }) {
  if (dirty) return "Working plan (unsaved changes)";
  return versionNo ? `Saved version ${versionNo}` : "Working plan (not saved yet)";
}

const PROMPTS = {
  plan: ["Analyze this floor plan.", "Identify potential design issues.", "Suggest improvements.", "Review the overall functionality."],
  room: ["Analyze this room.", "Improve the furniture arrangement.", "Review circulation and accessibility.", "Suggest design improvements."],
  object: [
    "Is this furniture placement optimal?",
    "What alternatives would work here?",
    "Is the size appropriate for the room?",
    "What should I consider when positioning this item?",
  ],
};

export const suggestedPrompts = (type) => PROMPTS[type] ?? PROMPTS.plan;

export function isNearBottom({ scrollHeight, scrollTop, clientHeight }, threshold = 80) {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function composerState(text, busy) {
  const value = String(text ?? "");
  return { canSend: !busy && value.trim().length > 0 && value.length <= MAX_MESSAGE, canStop: Boolean(busy) };
}
