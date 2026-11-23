// Server-Sent Events parser. Pure, no DOM, so it runs under `node --test`.
// The browser's EventSource cannot send an Authorization header or a POST body, so the advisor page
// reads a fetch() response body and feeds the bytes through this parser instead.

// Calls onEvent({ event, data }) for every complete event. `data` is the raw string; the caller parses it.
export function createSseParser(onEvent) {
  // stream:true keeps a multi-byte character (a Hebrew letter is two bytes) that was split across two chunks.
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  function dispatch(block) {
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue; // comment
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      // "id" and "retry" are not used by this protocol.
    }
    if (data.length) onEvent({ event, data: data.join("\n") });
  }

  function drain() {
    // A lone "\r" at the end of a chunk may be the first half of "\r\n", so it waits for the next chunk.
    const held = buffer.endsWith("\r") ? "\r" : "";
    let text = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, "\n");
    for (let end = text.indexOf("\n\n"); end !== -1; end = text.indexOf("\n\n")) {
      dispatch(text.slice(0, end));
      text = text.slice(end + 2);
    }
    buffer = text + held;
  }

  return {
    push(bytes) {
      buffer += decoder.decode(bytes, { stream: true });
      drain();
    },
    // The stream ended. An event that was not closed by a blank line is incomplete and is dropped.
    end() {
      buffer += decoder.decode();
      if (buffer.endsWith("\r")) buffer += "\n"; // nothing more is coming, so a held "\r" is a complete line break
      drain();
      buffer = "";
    },
  };
}

// Reads a whole response body (a ReadableStream of bytes) and reports each event. Resolves when the body ends.
// Rejects if the connection fails part-way, or when the request is aborted.
export async function readSse(body, onEvent) {
  const reader = body.getReader();
  const parser = createSseParser(onEvent);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(value);
  }
  parser.end();
}
