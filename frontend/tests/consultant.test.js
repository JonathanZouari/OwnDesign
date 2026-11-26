import assert from "node:assert/strict";
import { test } from "node:test";
import * as L from "../js/consultant-logic.js";
import { createSseParser, streamFetch } from "../js/consultant-stream.js";
import { parseMarkdown, toDom } from "../js/markdown.js";

const PLAN = {
  schema: 1,
  units: "cm",
  rooms: [{ id: "r1", name: "Living room", type: "living" }, { id: "r2", name: "Bedroom", type: "bedroom" }],
  walls: [],
  openings: [],
  furniture: [{ id: "f1", type: "sofa", x: 0, y: 0, w: 200, d: 90, rotation: 0 }],
};

// ---- SSE parser -------------------------------------------------------------------------------------------------

test("parses whole frames", () => {
  const parser = createSseParser();
  const events = parser.push('event: token\ndata: {"text":"Hi"}\n\nevent: message_complete\ndata: {"message_id":3}\n\n');
  assert.deepEqual(events, [["token", { text: "Hi" }], ["message_complete", { message_id: 3 }]]);
});

test("a frame split across chunks is held until it is complete", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: tok'), []);
  assert.deepEqual(parser.push('en\ndata: {"te'), []);
  assert.deepEqual(parser.push('xt":"a"}\n'), []);
  assert.deepEqual(parser.push("\n"), [["token", { text: "a" }]]);
});

test("handles CRLF, comments, multi-line data and unknown events", () => {
  const parser = createSseParser();
  const events = parser.push(': keep-alive\r\n\r\nevent: custom\r\ndata: {"a":\r\ndata: 1}\r\n\r\n');
  assert.deepEqual(events, [["custom", { a: 1 }]]);
});

test("a frame with broken JSON is skipped, the next one still parses", () => {
  const parser = createSseParser();
  const events = parser.push('event: token\ndata: {oops\n\nevent: token\ndata: {"text":"ok"}\n\n');
  assert.deepEqual(events, [["token", { text: "ok" }]]);
});

test("multi-byte text split between chunks is decoded correctly by streamFetch", async () => {
  const bytes = new TextEncoder().encode('event: token\ndata: {"text":"שלום"}\n\n');
  const cut = 28; // inside a Hebrew letter
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });
  const seen = [];
  await streamFetch({
    fetch: async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    url: "/x", token: "t", body: {}, onEvent: (name, data) => seen.push([name, data]),
  });
  assert.deepEqual(seen, [["token", { text: "שלום" }]]);
});

test("streamFetch sends the bearer token and a JSON body", async () => {
  let request;
  await streamFetch({
    fetch: async (url, init) => {
      request = { url, init };
      return new Response("", { status: 200 });
    },
    url: "http://api/x", token: "abc", body: { message: "hi" }, onEvent() {},
  });
  assert.equal(request.url, "http://api/x");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer abc");
  assert.equal(request.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.init.body), { message: "hi" });
});

test("a failed request throws the server's message and status before any event", async () => {
  const response = new Response(JSON.stringify({ success: false, error: "Daily message limit reached." }), { status: 429 });
  await assert.rejects(
    streamFetch({ fetch: async () => response, url: "/x", token: "t", body: {}, onEvent() {} }),
    (error) => error.status === 429 && error.message === "Daily message limit reached.",
  );
});

test("a failed request without a JSON body still throws a readable error", async () => {
  await assert.rejects(
    streamFetch({ fetch: async () => new Response("<html>", { status: 502 }), url: "/x", token: "t", body: {}, onEvent() {} }),
    (error) => error.status === 502 && error.message.length > 0 && !error.message.includes("<html>"),
  );
});

test("aborting stops the stream with an AbortError", async () => {
  const controller = new AbortController();
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const pending = streamFetch({ fetch: fetchImpl, url: "/x", token: "t", body: {}, signal: controller.signal, onEvent() {} });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

// ---- reducer ----------------------------------------------------------------------------------------------------

test("reply state follows the events", () => {
  let state = L.newReply();
  for (const event of [["message_start", {}], ["status", { status: "generating_response" }], ["token", { text: "A" }], ["token", { text: "B" }]]) {
    state = L.applyEvent(state, event);
  }
  assert.deepEqual([state.text, state.phase, state.done], ["AB", "generating_response", false]);
  state = L.applyEvent(state, ["message_complete", { message_id: 9, status: "complete" }]);
  assert.deepEqual([state.done, state.messageId, state.error], [true, 9, null]);
});

test("an error event keeps the text received so far", () => {
  let state = L.applyEvent(L.newReply(), ["token", { text: "Part" }]);
  state = L.applyEvent(state, ["error", { message: "Try again." }]);
  assert.deepEqual([state.text, state.error, state.done], ["Part", "Try again.", true]);
});

test("unknown events are ignored", () => {
  const state = L.newReply();
  assert.deepEqual(L.applyEvent(state, ["mystery", { a: 1 }]), state);
});

// ---- context ----------------------------------------------------------------------------------------------------

test("context from selection", () => {
  assert.deepEqual(L.contextFromSelection({ kind: "furniture", id: "f1" }, PLAN), { type: "object", ids: ["f1"] });
  assert.deepEqual(L.contextFromSelection({ kind: "rooms", id: "r2" }, PLAN), { type: "room", id: "r2" });
  assert.deepEqual(L.contextFromSelection({ kind: "walls", id: "w1" }, PLAN), { type: "plan" });
  assert.deepEqual(L.contextFromSelection({ kind: "openings", id: "o1" }, PLAN), { type: "plan" });
  assert.deepEqual(L.contextFromSelection(null, PLAN), { type: "plan" });
});

test("a selection that is no longer in the plan falls back to the whole plan", () => {
  assert.deepEqual(L.contextFromSelection({ kind: "furniture", id: "gone" }, PLAN), { type: "plan" });
  assert.deepEqual(L.contextFromSelection({ kind: "rooms", id: "gone" }, PLAN), { type: "plan" });
  assert.deepEqual(L.contextFromSelection({ kind: "furniture", id: "f1" }, null), { type: "plan" });
  assert.deepEqual(L.contextFromSelection({ kind: "nonsense", id: "f1" }, PLAN), { type: "plan" });
});

test("context labels", () => {
  assert.equal(L.contextLabel({ type: "plan" }, PLAN), "Entire plan");
  assert.equal(L.contextLabel({ type: "room", id: "r1" }, PLAN), "Living room");
  assert.equal(L.contextLabel({ type: "object", ids: ["f1"] }, PLAN), "sofa");
  assert.equal(L.contextLabel({ type: "object", ids: ["f1", "f1"] }, PLAN), "2 objects");
  assert.equal(L.contextLabel({ type: "room", id: "gone" }, PLAN), "Entire plan");
});

test("source: unsaved edits are sent as the working plan, a clean plan as its version", () => {
  assert.deepEqual(L.sourceFor({ dirty: true, versionId: "v1", plan: PLAN }), { kind: "working", plan: PLAN });
  assert.deepEqual(L.sourceFor({ dirty: false, versionId: "v1", plan: PLAN }), { kind: "version", version_id: "v1" });
  assert.deepEqual(L.sourceFor({ dirty: false, versionId: null, plan: PLAN }), { kind: "working", plan: PLAN });
});

test("source label tells the user what the consultant sees", () => {
  assert.equal(L.sourceLabel({ dirty: true, versionNo: 3 }), "Working plan (unsaved changes)");
  assert.equal(L.sourceLabel({ dirty: false, versionNo: 3 }), "Saved version 3");
  assert.equal(L.sourceLabel({ dirty: false, versionNo: null }), "Working plan (not saved yet)");
});

test("suggested prompts differ by context and are never empty", () => {
  for (const type of ["plan", "room", "object"]) assert.ok(L.suggestedPrompts(type).length >= 3);
  assert.notDeepEqual(L.suggestedPrompts("plan"), L.suggestedPrompts("object"));
  assert.deepEqual(L.suggestedPrompts("wat"), L.suggestedPrompts("plan"));
});

test("scroll follows the stream only near the bottom", () => {
  assert.equal(L.isNearBottom({ scrollHeight: 1000, scrollTop: 590, clientHeight: 400 }), true);
  assert.equal(L.isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 400 }), false);
});

test("composer state", () => {
  assert.deepEqual(L.composerState("", false), { canSend: false, canStop: false });
  assert.deepEqual(L.composerState("hi", false), { canSend: true, canStop: false });
  assert.deepEqual(L.composerState("hi", true), { canSend: false, canStop: true });
  assert.equal(L.composerState("x".repeat(2001), false).canSend, false);
  assert.equal(L.composerState("   ", false).canSend, false);
});

// ---- markdown ---------------------------------------------------------------------------------------------------

const text = (v) => ({ t: "text", v });

test("paragraphs, bold, italic and inline code", () => {
  assert.deepEqual(parseMarkdown("Hello **bold** and *it* and `code`"), [
    { type: "p", inline: [text("Hello "), { t: "strong", c: [text("bold")] }, text(" and "), { t: "em", c: [text("it")] }, text(" and "), { t: "code", v: "code" }] },
  ]);
});

test("headings, lists and code fences", () => {
  const blocks = parseMarkdown("## Title\n\n- one\n- two\n\n1. a\n2. b\n\n```\nlet x = 1;\n```");
  assert.deepEqual(blocks.map((b) => b.type), ["h", "ul", "ol", "code"]);
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[3].text, "let x = 1;");
});

test("html is never interpreted: it stays text", () => {
  const blocks = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
  assert.equal(blocks.length, 1);
  const flat = JSON.stringify(blocks);
  assert.ok(flat.includes("<script>alert(1)</script>"));
  assert.equal(blocks[0].inline.every((n) => ["text", "strong", "em", "code"].includes(n.t)), true);
});

test("links and images are plain text, so javascript: urls cannot become clickable", () => {
  const blocks = parseMarkdown("[click](javascript:alert(1)) ![x](http://a/b.png)");
  assert.deepEqual(blocks[0].inline, [text("[click](javascript:alert(1)) ![x](http://a/b.png)")]);
});

test("unfinished markdown while streaming never throws and shows the text", () => {
  for (const partial of ["**bold", "*em", "`code", "```\nunclosed", "## ", "- ", "1.", "**a* b", "***", "``", "_"]) {
    const blocks = parseMarkdown(partial);
    assert.ok(Array.isArray(blocks), partial);
  }
  assert.deepEqual(parseMarkdown("**bold")[0].inline, [text("**bold")]);
  assert.equal(parseMarkdown("```\nunclosed")[0].type, "code");
});

test("empty input and very long lines", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("   \n\n  "), []);
  assert.equal(parseMarkdown("a".repeat(200000))[0].inline[0].v.length, 200000);
});

test("nested and adjacent markers do not hang", () => {
  const started = Date.now();
  parseMarkdown("*".repeat(5000) + "`".repeat(5000) + "**a".repeat(3000));
  assert.ok(Date.now() - started < 1500);
});

test("Hebrew and mixed text pass through", () => {
  const blocks = parseMarkdown("**מומלץ** להזיז את ה-sofa");
  assert.equal(blocks[0].inline[0].c[0].v, "מומלץ");
});

test("toDom builds elements with textContent only", () => {
  const made = [];
  const doc = {
    createDocumentFragment: () => ({ children: [], append(...n) { this.children.push(...n); } }),
    createElement: (tag) => {
      const node = { tag, children: [], _text: undefined, append(...n) { this.children.push(...n); }, set textContent(v) { this._text = v; }, get textContent() { return this._text; } };
      made.push(node);
      return node;
    },
    createTextNode: (v) => ({ text: v }),
  };
  const fragment = toDom(parseMarkdown("Hi <b>x</b>\n\n- a"), doc);
  assert.ok(fragment.children.length === 2);
  assert.ok(made.every((node) => !("innerHTML" in node)));
  assert.deepEqual(made.map((n) => n.tag).sort(), ["li", "p", "ul"]);
});
