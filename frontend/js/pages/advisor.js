// AI Consultant page. Sends a question and shows the reply while it is being written (Server-Sent Events).
// Nothing is stored: the conversation lives in this page only, and the page sends its own recent turns with each question.
import { api, apiStream, requireSession, signOut } from "../api.js";
import { readSse } from "../sse.js";
import { $, h, run } from "../ui.js";

const MAX_QUESTION = 2000; // characters, the same limit the server enforces
const MAX_HISTORY = 10; // turns the server accepts
const HINT = "Enter sends, Shift+Enter adds a line.";
const LOST = "Connection lost. The reply is incomplete.";

const projectId = new URLSearchParams(location.search).get("project");
const thread = $("#thread");
const box = $("#question");
const send = $("#send");

const state = {
  history: [], // completed turns only: a reply joins it after "done", never half of one
  busy: false,
  controller: null,
};

// The server counts characters, not UTF-16 units, so an emoji is one.
const length = (text) => [...text.trim()].length;
const announce = (message) => ($("#status").textContent = message);
const nearBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 120;
const scrollDown = () => scrollTo({ top: document.documentElement.scrollHeight });
// Client errors (wrong project, invalid input, not allowed) will not succeed on a second try; the rest might.
const retryable = (error) => !(error.status >= 400 && error.status < 500 && error.status !== 429);

function refresh() {
  const count = length(box.value);
  const over = count > MAX_QUESTION;
  $("#count").textContent = `${count} / ${MAX_QUESTION}`;
  $("#count").classList.toggle("over", over);
  $("#hint").textContent = over ? "This question is too long. Shorten it to send." : HINT;
  send.disabled = state.busy || count === 0 || over;
}

function setBusy(busy) {
  state.busy = busy;
  box.disabled = busy;
  refresh();
  if (!busy) box.focus();
}

function addMessage(role) {
  // dir="auto": each message takes the direction of its own language, so Hebrew and English can share a page.
  const text = h("p", { class: "text", dir: "auto" });
  const item = h("li", { class: `msg ${role}` }, h("p", { class: "who" }, role === "user" ? "You" : "Advisor"), h("div", { class: "bubble" }, text));
  thread.append(item);
  return { item, bubble: item.querySelector(".bubble"), text };
}

function showFailure(reply, message, partial, onRetry) {
  reply.item.classList.add("failed");
  reply.bubble.append(h("p", { class: "state" }, `${partial ? "Reply interrupted. " : ""}${message}`));
  if (onRetry) reply.bubble.append(h("button", { type: "button", class: "retry", onclick: onRetry }, "Try again"));
  announce(message);
}

async function streamReply(question) {
  setBusy(true);
  const reply = addMessage("advisor");
  const typing = h("span", { class: "typing", "aria-hidden": "true" }, h("span"), h("span"), h("span"));
  reply.text.append(typing);
  reply.item.setAttribute("aria-busy", "true");
  announce("The advisor is writing a reply.");
  scrollDown();

  const controller = new AbortController();
  state.controller = controller;
  const again = () => {
    reply.item.remove();
    run(() => streamReply(question));
  };
  const finish = () => {
    typing.remove();
    reply.item.removeAttribute("aria-busy");
    state.controller = null;
    setBusy(false);
  };

  let response;
  try {
    response = await apiStream(`/v1/projects/${encodeURIComponent(projectId)}/advisor`, { question, history: state.history.slice(-MAX_HISTORY) }, controller.signal);
  } catch (error) {
    if (error.name === "AbortError") return;
    finish();
    return showFailure(reply, error.message, false, retryable(error) ? again : null);
  }

  let text = "";
  let node = null; // the one text node that grows as pieces arrive
  let done = false;
  let truncated = false;
  let failure = null;
  try {
    await readSse(response.body, ({ event, data }) => {
      if (event !== "delta" && event !== "done" && event !== "error") return;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error("The reply could not be read.");
      }
      if (event === "delta" && typeof payload.text === "string") {
        const follow = nearBottom();
        if (!node) {
          typing.remove();
          node = document.createTextNode("");
          reply.text.append(node);
        }
        node.data += payload.text; // text node, never HTML
        text += payload.text;
        if (follow) scrollDown();
      } else if (event === "done") {
        done = true;
        truncated = payload.truncated === true;
      } else if (event === "error") {
        failure = typeof payload.message === "string" ? payload.message : "The advisor could not finish this reply.";
      }
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    controller.abort(); // stop the request, so the server stops writing a reply nobody will see
    failure ??= error.message === "The reply could not be read." ? error.message : LOST;
  }
  if (!done && !failure) failure = LOST; // the stream ended without "done"

  finish();
  if (failure && !done) return showFailure(reply, failure, text !== "", again);
  state.history.push({ role: "user", content: question }, { role: "assistant", content: text });
  if (truncated) reply.bubble.append(h("p", { class: "state" }, "Reply shortened because it reached the length limit."));
  announce("Reply complete.");
}

function block(message) {
  $("#blocked").textContent = message;
  $("#blocked").hidden = false;
}

$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = box.value.trim();
  if (state.busy || length(question) === 0 || length(question) > MAX_QUESTION) return;
  for (const button of thread.querySelectorAll(".retry")) button.remove(); // a new question replaces any pending retry
  $("#empty").hidden = true;
  addMessage("user").text.textContent = question;
  box.value = "";
  refresh();
  run(() => streamReply(question));
});

box.addEventListener("input", refresh);
box.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});

// Leaving the page ends the request, so the server stops the reply and nobody pays for words that will not be read.
addEventListener("pagehide", () => state.controller?.abort());

run(async () => {
  await requireSession();
  $("#sign-out").addEventListener("click", signOut);
  if (!projectId) return block("No project selected. Open the AI Consultant from one of your saved projects.");
  let project;
  try {
    project = await api(`/v1/projects/${encodeURIComponent(projectId)}`);
  } catch (error) {
    return block(error.status === 404 ? "This project was not found, or you do not have access to it." : error.message);
  }
  $("#project-name").textContent = project.name;
  $("#back").href = $("#tab-canvas").href = `editor.html?project=${encodeURIComponent(project.id)}`;
  if (project.my_role !== "client") return block("The AI Consultant is for the client who owns this project.");
  $("#chat").hidden = false;
  refresh();
  box.focus();
});
