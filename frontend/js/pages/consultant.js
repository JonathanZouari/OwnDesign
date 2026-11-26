// Design consultant chat for one saved project (?project=<id>). Only messages returned by the API are shown.
import { api, requireSession, signOut } from "../api.js";
import { messageState } from "../design-logic.js";
import { planThumbnail } from "../thumbnail.js";
import { $, formatDate, h, run, showStudio } from "../ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requested = new URLSearchParams(location.search).get("project");
const projectId = UUID.test(requested ?? "") ? requested : null; // anything else (like "..") is not used in an API path
const base = `/v1/projects/${encodeURIComponent(projectId)}`;
const WHO = { user: "You", assistant: "Design consultant" };

// Message text is user and model output: it is set with textContent only, and CSS keeps its line breaks.
function messageNode(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const who = h("span", { class: "who" });
  who.textContent = WHO[role];
  const when = h("time", { class: "code" });
  when.dateTime = message.created_at ?? "";
  when.textContent = message.created_at ? formatDate(message.created_at) : "";
  const text = h("p", { class: "msg-text" });
  text.textContent = message.content;
  return h("li", { class: `msg ${role}` }, h("div", { class: "msg-head" }, who, when), text);
}

function append(messages) {
  $("#thread").append(...messages.map(messageNode));
  $("#thread-empty").hidden = $("#thread").children.length > 0;
  $("#thread").lastElementChild?.scrollIntoView({ block: "nearest" });
}

async function reloadThread() {
  const messages = await api(`${base}/consultant/messages`);
  $("#thread").replaceChildren();
  append(messages);
}

function refreshComposer() {
  const { counter, canSend } = messageState($("#message").value);
  $("#message-counter").textContent = counter;
  $("#send").disabled = !canSend || $("#message").readOnly;
}

async function send() {
  const box = $("#message");
  const { canSend } = messageState(box.value);
  if (!canSend || box.readOnly) return;
  // readOnly (not disabled) while sending: the text stays readable and focus is not lost.
  box.readOnly = true;
  refreshComposer();
  $("#chat-error").textContent = "";
  $("#chat-status").textContent = "The consultant is writing a reply…";
  try {
    append(await api(`${base}/consultant/messages`, { method: "POST", body: { message: box.value.trim() } }));
    box.value = "";
  } catch (error) {
    // 429 / 502 / 503 carry a friendly sentence. After a 429 nothing was stored, so the typed text stays.
    // After any other server error the question is already stored (a failed answer may have been billed),
    // so the thread is reloaded to show it and the box is cleared, instead of sending a duplicate.
    $("#chat-error").textContent = error.message || "Something went wrong.";
    if (error.status === 502) {
      await reloadThread().catch(() => {});
      box.value = "";
    }
  } finally {
    $("#chat-status").textContent = "";
    box.readOnly = false;
    refreshComposer();
    box.focus();
  }
}

run(async () => {
  if (!projectId) return location.replace("projects.html");
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);

  const [project, versions, messages] = await Promise.all([api(base), api(`${base}/versions`), api(`${base}/consultant/messages`)]);
  const query = `?project=${encodeURIComponent(projectId)}`;
  document.title = `${project.name} · Design consultant`;
  $("#project-name").textContent = project.name;
  $("#crumb-name").textContent = project.name;
  if (project.studio) showStudio(project.studio.name);
  $("#nav-projects").href = project.my_role === "designer" ? "studio.html" : "projects.html";
  for (const id of ["#nav-editor", "#plan-link"]) $(id).href = `editor.html${query}`;
  for (const id of ["#nav-design", "#brief-link"]) $(id).href = `design.html${query}`;
  $("#nav-consultant").href = `consultant.html${query}`;
  $("#nav-budget").href = `budget.html${query}`;

  if (versions.length) {
    const latest = await api(`${base}/versions/latest`);
    const rooms = latest.geometry.rooms.length;
    const items = latest.geometry.furniture.length;
    $("#plan-figure").replaceChildren(planThumbnail(latest.geometry, `Floor plan of ${project.name}`));
    $("#plan-summary").textContent = `Version ${latest.version_no} · ${rooms} ${rooms === 1 ? "room" : "rooms"} · ${items} furniture ${items === 1 ? "item" : "items"}`;
  } else {
    $("#plan-summary").textContent = "No saved plan yet. The consultant can still discuss your brief.";
  }

  append(messages);
  $("#thread-empty").hidden = messages.length > 0;
  $("#message").addEventListener("input", refreshComposer);
  $("#message").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    send();
  });
  $("#composer").addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });
  refreshComposer();
  $("#consult").hidden = false;
  $("#composer").scrollIntoView({ block: "nearest" });
});
