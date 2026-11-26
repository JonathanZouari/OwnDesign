// The Design Consultant side panel inside the editor. It reads the editor (selection, plan, saved version)
// but never changes the plan: the consultant advises, the person decides.
import { getSession } from "../api.js";
import { config } from "../config.js";
import {
  MAX_MESSAGE, applyEvent, composerState, contextFromSelection, contextLabel, isNearBottom, newReply, sourceFor, sourceLabel,
  suggestedPrompts,
} from "../consultant-logic.js";
import { streamFetch } from "../consultant-stream.js";
import { renderMarkdown } from "../markdown.js";
import { formatDate, h } from "../ui.js";

const WELCOME =
  "I can help you analyze your floor plan, identify design issues, explore alternatives and make informed design decisions. What would you like to focus on?";

export function initConsultant({ projectId, toggle, panel, host }) {
  const base = `/v1/projects/${encodeURIComponent(projectId)}/consultant`;
  const state = {
    open: false,
    wide: false,
    sessionId: null,
    messages: [], // { role, content, status }
    reply: null, // the assistant message being streamed
    busy: false,
    controller: null,
    manual: null, // a scope the user chose in the selector; null follows the editor's selection
    history: false,
    sessions: [],
    error: "",
    lastQuestion: "",
    follow: true,
  };

  const scope = () => state.manual ?? contextFromSelection(host.getSelection(), host.getPlan());

  // ---- panel skeleton (built once) ---------------------------------------------------------------------------
  const title = h("h2", { id: "consultant-title" }, "Design Consultant");
  const chip = h("p", { class: "consultant-context", id: "consultant-context" });
  const select = h("select", { id: "consultant-scope", "aria-label": "Consultation context", onchange: onScopeChange });
  const newButton = h("button", { type: "button", "aria-label": "New conversation", title: "New conversation", onclick: newConversation }, h("span", { class: "icon", "aria-hidden": "true" }, "add_comment"));
  const historyButton = h("button", { type: "button", "aria-label": "Conversation history", title: "Conversation history", "aria-pressed": "false", onclick: toggleHistory }, h("span", { class: "icon", "aria-hidden": "true" }, "history"));
  const expandButton = h("button", { type: "button", "aria-label": "Expand panel", title: "Expand panel", "aria-pressed": "false", onclick: toggleWide }, h("span", { class: "icon", "aria-hidden": "true" }, "open_in_full"));
  const closeButton = h("button", { type: "button", "aria-label": "Close consultant", title: "Close", onclick: () => setOpen(false) }, h("span", { class: "icon", "aria-hidden": "true" }, "close"));
  const thread = h("ol", { class: "consultant-thread", id: "consultant-thread", tabindex: "0", "aria-label": "Conversation" });
  const sessionsList = h("ul", { class: "consultant-sessions", hidden: true, "aria-label": "Earlier conversations" });
  const suggestions = h("div", { class: "consultant-suggestions" });
  const jump = h("button", { type: "button", class: "consultant-jump", hidden: true, onclick: () => scrollToEnd(true) }, "Jump to latest");
  const errorLine = h("p", { class: "consultant-error", role: "alert" });
  const live = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const input = h("textarea", { id: "consultant-input", rows: 2, maxLength: MAX_MESSAGE, placeholder: "Ask anything about this design...", "aria-label": "Message to the consultant", dir: "auto" });
  const send = h("button", { type: "button", class: "primary", onclick: submit }, "Send");
  const stop = h("button", { type: "button", hidden: true, onclick: stopReply }, "Stop");

  panel.replaceChildren(
    h("header", { class: "consultant-head" },
      h("div", {}, title, h("p", { class: "muted small" }, "AI design assistant")),
      h("div", { class: "consultant-tools" }, newButton, historyButton, expandButton, closeButton),
    ),
    h("div", { class: "consultant-scope" }, h("label", { for: "consultant-scope" }, "Context"), select, chip),
    sessionsList,
    h("div", { class: "consultant-body" }, thread, jump),
    suggestions,
    errorLine,
    live,
    h("div", { class: "consultant-composer" }, input, h("div", { class: "consultant-actions" }, stop, send)),
  );

  // ---- rendering ---------------------------------------------------------------------------------------------
  function scopeOptions() {
    const plan = host.getPlan();
    const selected = contextFromSelection(host.getSelection(), plan);
    const options = [{ value: "auto", label: `Follow selection (${contextLabel(selected, plan)})` }, { value: "plan", label: "Entire plan" }];
    for (const room of plan.rooms) options.push({ value: `room:${room.id}`, label: room.name });
    if (selected.type === "object") options.push({ value: "object", label: `Selected object (${contextLabel(selected, plan)})` });
    return options;
  }

  function renderScope() {
    const current = state.manual ? (state.manual.type === "room" ? `room:${state.manual.id}` : state.manual.type) : "auto";
    const options = scopeOptions();
    select.replaceChildren(...options.map((o) => h("option", { value: o.value, selected: o.value === current }, o.label)));
    if (!options.some((o) => o.value === current)) select.value = "auto";
    const plan = host.getPlan();
    const version = host.getVersion();
    chip.textContent = `Looking at: ${contextLabel(scope(), plan)} · ${sourceLabel({ dirty: host.isDirty(), versionNo: version?.version_no })}`;
  }

  function messageNode(message) {
    const body = h("div", { class: "msg-text", dir: "auto" });
    if (message.role === "assistant") body.append(renderMarkdown(message.content));
    else body.textContent = message.content;
    const item = h("li", { class: `msg ${message.role}` }, h("span", { class: "who" }, message.role === "user" ? "You" : "Consultant"), body);
    if (message.status === "interrupted") item.append(h("p", { class: "muted small" }, "Stopped before the reply finished."));
    return item;
  }

  function renderThread() {
    const stick = isNearBottom(thread);
    const nodes = state.messages.map(messageNode);
    if (state.reply) {
      const text = state.reply.text;
      const body = h("div", { class: "msg-text", dir: "auto" });
      if (text) body.append(renderMarkdown(text));
      else body.append(h("span", { class: "muted" }, "Thinking…"));
      nodes.push(h("li", { class: "msg assistant streaming" }, h("span", { class: "who" }, "Consultant"), body));
    }
    if (!nodes.length) {
      nodes.push(h("li", { class: "msg assistant" }, h("span", { class: "who" }, "Consultant"), h("div", { class: "msg-text" }, WELCOME)));
    }
    thread.replaceChildren(...nodes);
    if (stick) scrollToEnd(false);
    jump.hidden = stick || !state.reply;
  }

  function renderControls() {
    const { canSend, canStop } = composerState(input.value, state.busy);
    send.disabled = !canSend;
    stop.hidden = !canStop;
    send.hidden = canStop;
    errorLine.textContent = state.error;
    const empty = !state.messages.length && !state.reply;
    suggestions.replaceChildren(
      ...(empty ? suggestedPrompts(scope().type).map((text) => h("button", { type: "button", class: "chip", onclick: () => ask(text) }, text)) : []),
    );
    if (state.error && state.lastQuestion && !state.busy) {
      suggestions.replaceChildren(h("button", { type: "button", class: "chip", onclick: retry }, "Retry"));
    }
  }

  function renderSessions() {
    sessionsList.hidden = !state.history;
    historyButton.setAttribute("aria-pressed", String(state.history));
    sessionsList.replaceChildren(
      ...(state.sessions.length
        ? state.sessions.map((s) => h("li", {}, h("button", { type: "button", onclick: () => openSession(s.id) }, s.title || "Untitled conversation", h("span", { class: "code" }, formatDate(s.updated_at)))))
        : [h("li", { class: "muted small" }, "No earlier conversations.")]),
    );
  }

  function renderAll() {
    renderScope();
    renderThread();
    renderControls();
    renderSessions();
  }

  let pending = false;
  function scheduleThread() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      renderThread();
    });
  }

  function scrollToEnd(force) {
    thread.scrollTop = thread.scrollHeight;
    if (force) jump.hidden = true;
  }
  thread.addEventListener("scroll", () => {
    jump.hidden = isNearBottom(thread) || !state.reply;
  });

  // ---- behaviour ---------------------------------------------------------------------------------------------
  function setOpen(open) {
    state.open = open;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      renderAll();
      if (!state.sessionId && !state.messages.length) resumeLatest().catch(() => {});
      input.focus();
    } else toggle.focus();
  }

  function toggleWide() {
    state.wide = !state.wide;
    panel.classList.toggle("wide", state.wide);
    expandButton.setAttribute("aria-pressed", String(state.wide));
  }

  function onScopeChange() {
    const value = select.value;
    if (value === "auto") state.manual = null;
    else if (value === "plan") state.manual = { type: "plan" };
    else if (value === "object") state.manual = contextFromSelection(host.getSelection(), host.getPlan());
    else state.manual = { type: "room", id: value.slice(5) };
    renderAll();
  }

  async function authed(path, init = {}) {
    const session = await getSession();
    const response = await fetch(config.apiUrl + path, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw Object.assign(new Error(payload?.error || "Something went wrong."), { status: response.status });
    return payload.data;
  }

  async function resumeLatest() {
    state.sessions = await authed(`${base}/sessions`);
    if (state.sessions.length && !state.busy && !state.messages.length) await openSession(state.sessions[0].id);
    renderAll();
  }

  async function openSession(id) {
    try {
      const session = await authed(`${base}/sessions/${encodeURIComponent(id)}`);
      state.sessionId = session.id;
      state.messages = session.messages.map(({ role, content, status }) => ({ role, content, status }));
      state.history = false;
      state.error = "";
      renderAll();
      scrollToEnd(true);
    } catch (error) {
      state.error = error.message;
      renderControls();
    }
  }

  async function toggleHistory() {
    state.history = !state.history;
    if (state.history) {
      try {
        state.sessions = await authed(`${base}/sessions`);
      } catch (error) {
        state.error = error.message;
      }
    }
    renderAll();
  }

  function newConversation() {
    state.controller?.abort();
    Object.assign(state, { sessionId: null, messages: [], reply: null, busy: false, error: "", history: false, lastQuestion: "" });
    renderAll();
    input.focus();
  }

  function stopReply() {
    state.controller?.abort();
  }

  function retry() {
    input.value = state.lastQuestion;
    state.error = "";
    renderControls();
    input.focus();
  }

  const ask = (text) => {
    input.value = text;
    submit();
  };

  async function submit() {
    const text = input.value.trim();
    if (!composerState(input.value, state.busy).canSend) return;
    const chosen = scope();
    const plan = host.getPlan();
    state.busy = true;
    state.error = "";
    state.lastQuestion = text;
    state.controller = new AbortController();
    state.reply = null;
    renderControls();
    let reply = newReply();
    let started = false;
    try {
      if (!state.sessionId) {
        const session = await authed(`${base}/sessions`, {
          method: "POST",
          body: JSON.stringify({ context_type: chosen.type, context_id: chosen.type === "room" ? chosen.id : null }),
        });
        state.sessionId = session.id;
      }
      const token = (await getSession())?.access_token;
      const version = host.getVersion();
      await streamFetch({
        fetch: (url, init) => fetch(url, init),
        url: `${config.apiUrl}${base}/sessions/${encodeURIComponent(state.sessionId)}/messages`,
        token,
        body: { message: text, scope: chosen, source: sourceFor({ dirty: host.isDirty(), versionId: version?.id ?? null, plan }) },
        signal: state.controller.signal,
        onEvent(name, data) {
          if (name === "message_start" && !started) {
            started = true;
            state.messages.push({ role: "user", content: text });
            input.value = ""; // the question is stored now: the draft is only kept while nothing was accepted
            state.reply = reply;
            live.textContent = "The consultant is replying.";
          }
          reply = applyEvent(reply, [name, data]);
          state.reply = reply;
          scheduleThread();
        },
      });
    } catch (error) {
      if (error.name === "AbortError") {
        if (started) reply = { ...reply, done: true, stopped: true };
      } else {
        state.error = error.status ? error.message : "Connection lost. Your message is kept; please try again.";
      }
    } finally {
      if (reply.error) state.error = reply.error;
      if (started && reply.text) state.messages.push({ role: "assistant", content: reply.text, status: reply.stopped ? "interrupted" : "complete" });
      state.reply = null;
      state.busy = false;
      state.controller = null;
      live.textContent = reply.error ? "" : "Reply complete.";
      renderAll();
      input.focus();
      if (state.sessionId) authed(`${base}/sessions`).then((rows) => ((state.sessions = rows), renderSessions())).catch(() => {});
    }
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
  input.addEventListener("input", renderControls);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open && !state.busy) {
      event.stopPropagation();
      setOpen(false);
    }
  });
  toggle.addEventListener("click", () => setOpen(!state.open));
  toggle.hidden = false;
  panel.hidden = true;

  return {
    // Called by the editor after every change: keeps the context chip and selector current.
    onEditorChange() {
      if (state.open) {
        renderScope();
        if (!state.messages.length && !state.reply) renderControls();
      }
    },
  };
}
