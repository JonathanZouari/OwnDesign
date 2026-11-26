// Tasks for one project (?project=<id>): the designer asks, the client marks each one done.
// Task text comes from users, so every string goes in through h() / textContent, never as HTML.
import { api, requireSession, signOut } from "../api.js";
import { actionsFor, introFor, splitTasks, taskFormState } from "../task-logic.js";
import { $, formatDate, h, run, showStudio } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else is never used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}/tasks`;

let role = "client";
let tasks = [];

const say = (text) => {
  $("#tasks-status").textContent = text;
};

async function reload() {
  tasks = await api(base);
  render();
}

// Runs one task change; a 409 means someone else changed it first, so the list is reloaded either way.
async function change(button, request, done) {
  button.disabled = true;
  let message = done;
  try {
    await request();
  } catch (error) {
    message = error.message || "Something went wrong.";
  }
  // The list is refreshed first, so the announcement describes what is on screen.
  await reload().catch(() => {});
  say(message);
}

function actionsNode(task) {
  const box = h("div", { class: "task-actions" });
  for (const action of actionsFor(role, task.status)) {
    if (action === "complete") {
      const note = h("input", { class: "task-note-input", maxlength: "500", autocomplete: "off" });
      const button = h("button", { class: "primary", type: "submit" }, h("span", { class: "icon", "aria-hidden": "true" }, "check"), "Mark as done");
      const form = h("form", { "aria-label": `Complete: ${task.title}` }, h("label", {}, "Note (optional)", note), button);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const body = { status: "done", client_note: note.value.trim().slice(0, 500) };
        change(button, () => api(`${base}/${task.id}`, { method: "PATCH", body }), `Marked as done: ${task.title}`);
      });
      box.append(form);
    }
    if (action === "undo" || action === "reopen") {
      const label = action === "undo" ? "Not done yet" : "Reopen";
      const button = h("button", { type: "button", "aria-label": `${label}: ${task.title}` }, h("span", { class: "icon", "aria-hidden": "true" }, "undo"), label);
      button.addEventListener("click", () =>
        change(button, () => api(`${base}/${task.id}`, { method: "PATCH", body: { status: "open" } }), `Reopened: ${task.title}`),
      );
      box.append(button);
    }
    if (action === "delete") {
      // Two clicks, no browser dialog: the first arms the button, the second deletes.
      const button = h("button", { type: "button", "aria-label": `Delete: ${task.title}` }, "Delete");
      button.addEventListener("click", () => {
        if (button.dataset.armed !== "yes") {
          button.dataset.armed = "yes";
          button.textContent = "Confirm delete";
          button.setAttribute("aria-label", `Confirm delete: ${task.title}`);
          return;
        }
        change(button, () => api(`${base}/${task.id}`, { method: "DELETE" }), `Deleted: ${task.title}`);
      });
      box.append(button);
    }
  }
  return box;
}

function taskNode(task) {
  const main = h("div", { class: "task-main" }, h("h3", { class: "task-title" }, task.title));
  if (task.details) main.append(h("p", { class: "task-details" }, task.details));
  const meta = [`Asked ${formatDate(task.created_at)}`];
  if (task.done_at) meta.push(`Done ${formatDate(task.done_at)}`);
  main.append(h("p", { class: "task-meta mono small muted" }, meta.join(" · ")));
  if (task.client_note) main.append(h("p", { class: "task-note" }, h("span", { class: "label" }, "Client note"), task.client_note));
  const icon = task.status === "done" ? "check_circle" : "radio_button_unchecked";
  return h(
    "li",
    { class: "task", "data-status": task.status, "data-task-id": task.id },
    h("span", { class: "icon task-icon", "aria-hidden": "true" }, icon),
    main,
    actionsNode(task),
  );
}

function render() {
  const { open, done } = splitTasks(tasks);
  $("#open-list").replaceChildren(...open.map(taskNode));
  $("#done-list").replaceChildren(...done.map(taskNode));
  $("#open-count").textContent = `(${open.length})`;
  $("#done-count").textContent = `(${done.length})`;
  $("#open-empty").hidden = open.length > 0;
  $("#done-empty").hidden = done.length > 0;
}

async function addTask(event) {
  event.preventDefault();
  const state = taskFormState($("#task-title").value, $("#task-details").value);
  const status = $("#task-form-status");
  if (!state.ok) {
    status.textContent = state.error;
    $("#task-title").focus();
    return;
  }
  $("#task-add").disabled = true;
  try {
    await api(base, { method: "POST", body: state.body });
    $("#task-form").reset();
    status.textContent = `Added: ${state.body.title}`;
    await reload();
  } catch (error) {
    status.textContent = error.message || "Something went wrong.";
  } finally {
    $("#task-add").disabled = false;
    $("#task-title").focus();
  }
}

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const projectBase = `/v1/projects/${encodeURIComponent(projectId)}`;
  const [project, list] = await Promise.all([api(projectBase), api(base)]);
  role = project.my_role === "designer" ? "designer" : "client";
  tasks = list;

  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · Tasks`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  showStudio(project.studio.name);
  $("#tasks-intro").textContent = introFor(role);
  $("#nav-projects").href = role === "designer" ? "studio.html" : "projects.html";
  $("#nav-editor").href = `editor.html${query}`;
  $("#nav-design").href = `design.html${query}`;
  $("#nav-consultant").href = `consultant.html${query}`;
  $("#nav-tasks").href = `tasks.html${query}`;

  $("#task-new").hidden = role !== "designer";
  $("#task-form").addEventListener("submit", addTask);
  render();
  $("#tasks").hidden = false;
});
