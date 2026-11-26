// Pure logic for the tasks page and the projects list. No DOM, so it runs under node --test.

export const TITLE_MAX = 120;
export const DETAILS_MAX = 1000;
export const NOTE_MAX = 500;

const newestFirst = (a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));

/** Splits tasks into open and done, each newest first. Unknown statuses are dropped. */
export function splitTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  return {
    open: list.filter((task) => task?.status === "open").sort(newestFirst),
    done: list.filter((task) => task?.status === "done").sort(newestFirst),
  };
}

/**
 * What a role may do with a task, mirroring the API:
 * the client completes and undoes; the designer reopens and deletes. Nobody else acts.
 */
export function actionsFor(role, status) {
  if (role === "client") return status === "open" ? ["complete"] : status === "done" ? ["undo"] : [];
  if (role === "designer") return status === "done" ? ["reopen", "delete"] : status === "open" ? ["delete"] : [];
  return [];
}

/** Validates the new-task form the same way the API does (trimmed, 1-120 characters). */
export function taskFormState(title, details = "") {
  const trimmed = String(title ?? "").trim();
  const extra = String(details ?? "").trim();
  if (!trimmed) return { ok: false, error: "Write what the client should do." };
  if (trimmed.length > TITLE_MAX) return { ok: false, error: `The task can be at most ${TITLE_MAX} characters.` };
  if (extra.length > DETAILS_MAX) return { ok: false, error: `Details can be at most ${DETAILS_MAX} characters.` };
  return { ok: true, error: "", body: { title: trimmed, details: extra } };
}

/** Open-task counts per project, from the inbox (GET /v1/tasks). */
export function openCounts(inbox) {
  const counts = new Map();
  for (const task of Array.isArray(inbox) ? inbox : []) {
    if (task?.project_id) counts.set(task.project_id, (counts.get(task.project_id) ?? 0) + 1);
  }
  return counts;
}

/** Link text for the projects list: "Tasks" or "Tasks (3 open)". */
export const tasksLabel = (count) => (count > 0 ? `Tasks (${count} open)` : "Tasks");

/** The page intro, per role. */
export const introFor = (role) =>
  role === "designer"
    ? "Ask your client for what you need: measurements, photos, decisions. You see when each one is done."
    : "Your designer needs these from you. Mark each one done when you have finished it.";
