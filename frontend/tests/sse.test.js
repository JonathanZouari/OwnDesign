import assert from "node:assert/strict";
import { test } from "node:test";
import { createSseParser, readSse } from "../js/sse.js";

const encode = (text) => new TextEncoder().encode(text);

function parse(...chunks) {
  const events = [];
  const parser = createSseParser((event) => events.push(event));
  for (const chunk of chunks) parser.push(typeof chunk === "string" ? encode(chunk) : chunk);
  parser.end();
  return events;
}

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test("parses an event with its name and data", () => {
  assert.deepEqual(parse('event: delta\ndata: {"text":"hi"}\n\n'), [{ event: "delta", data: '{"text":"hi"}' }]);
});

test("several events in one chunk arrive in order", () => {
  const events = parse(frame("delta", { text: "a" }) + frame("delta", { text: "b" }) + frame("done", { truncated: false }));
  assert.deepEqual(events.map((e) => e.event), ["delta", "delta", "done"]);
});

test("a stream cut at every possible byte gives the same events", () => {
  const wire = encode(frame("delta", { text: "שלום עולם 🛋️" }) + frame("delta", { text: "ok" }) + frame("done", { truncated: false }));
  const expected = parse(wire);
  assert.equal(expected.length, 3);
  for (let cut = 0; cut <= wire.length; cut++) {
    assert.deepEqual(parse(wire.slice(0, cut), wire.slice(cut)), expected, `cut at byte ${cut}`);
  }
});

test("one byte at a time still decodes Hebrew and emoji", () => {
  const text = "ספה של 2.4 מ' (Kvadrat) 🛋️";
  const wire = encode(frame("delta", { text }));
  const events = parse(...Array.from(wire, (byte) => Uint8Array.of(byte)));
  assert.equal(JSON.parse(events[0].data).text, text);
});

test("a Hebrew letter split between two chunks is not damaged", () => {
  const wire = encode(frame("delta", { text: "א" }));
  const letter = wire.indexOf(0xd7); // first byte of U+05D0
  const events = parse(wire.slice(0, letter + 1), wire.slice(letter + 1));
  assert.equal(JSON.parse(events[0].data).text, "א");
});

test("CRLF and bare CR line endings work", () => {
  assert.deepEqual(parse("event: x\r\ndata: 1\r\n\r\n"), [{ event: "x", data: "1" }]);
  assert.deepEqual(parse("event: x\rdata: 1\r\r"), [{ event: "x", data: "1" }]);
});

test("a CR at the end of one chunk and LF at the start of the next is one line break", () => {
  assert.deepEqual(parse("event: x\r\ndata: 1\r", "\n\r\n"), [{ event: "x", data: "1" }]);
});

test("comment lines are ignored, and an event with only a comment is not dispatched", () => {
  assert.deepEqual(parse(": keep-alive\n\n"), []);
  assert.deepEqual(parse(": hello\nevent: x\ndata: 1\n\n"), [{ event: "x", data: "1" }]);
});

test("several data lines are joined with a newline", () => {
  assert.deepEqual(parse("data: a\ndata: b\n\n"), [{ event: "message", data: "a\nb" }]);
});

test("a missing space after the colon is accepted, and only one leading space is removed", () => {
  assert.deepEqual(parse("data:abc\n\n"), [{ event: "message", data: "abc" }]);
  assert.deepEqual(parse("data:  two\n\n"), [{ event: "message", data: " two" }]);
});

test("an unknown event name is passed on for the caller to ignore", () => {
  assert.deepEqual(parse("event: surprise\ndata: 1\n\n"), [{ event: "surprise", data: "1" }]);
});

test("the event name does not leak into the next event", () => {
  assert.deepEqual(parse("event: delta\ndata: 1\n\ndata: 2\n\n").map((e) => e.event), ["delta", "message"]);
});

test("an event without data is not dispatched", () => {
  assert.deepEqual(parse("event: delta\n\n"), []);
});

test("an unfinished last event is dropped", () => {
  assert.deepEqual(parse(frame("delta", { text: "a" }) + 'event: delta\ndata: {"text":"b"}\n'), [{ event: "delta", data: '{"text":"a"}' }]);
  assert.deepEqual(parse(""), []);
});

test("a newline inside the JSON text does not break the framing", () => {
  const events = parse(frame("delta", { text: "line one\nline two\r\nline three" }));
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0].data).text, "line one\nline two\r\nline three");
});

function bodyOf(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encode(chunk));
      controller.close();
    },
  });
}

test("readSse reports every event of a body and then resolves", async () => {
  const events = [];
  await readSse(bodyOf("event: delta\ndata: 1\n\nevent: do", "ne\ndata: 2\n\n"), (event) => events.push(event.event));
  assert.deepEqual(events, ["delta", "done"]);
});

test("readSse rejects when the connection breaks part-way, after delivering what arrived", async () => {
  const events = [];
  let pulls = 0;
  const body = new ReadableStream({
    // error() discards chunks that are still queued, so the failure comes on the second read.
    pull(controller) {
      if (pulls++ === 0) controller.enqueue(encode("event: delta\ndata: 1\n\n"));
      else controller.error(new TypeError("network error"));
    },
  });
  await assert.rejects(readSse(body, (event) => events.push(event.event)), /network error/);
  assert.deepEqual(events, ["delta"]);
});
