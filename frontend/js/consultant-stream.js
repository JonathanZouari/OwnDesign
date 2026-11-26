// Server-Sent Events over fetch. The browser's EventSource cannot POST or send an Authorization header,
// so the stream is read by hand. Pure: fetch, token and callbacks are passed in, which keeps it testable.

export function createSseParser() {
  let buffer = "";
  return {
    // Returns the complete events found so far; an unfinished frame waits for the next chunk.
    push(chunk) {
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop();
      const events = [];
      for (const frame of frames) {
        let name = "message";
        const data = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith(":")) continue; // comment / keep-alive
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!data.length) continue;
        try {
          events.push([name, JSON.parse(data.join("\n"))]);
        } catch {
          // A broken frame is dropped; the stream continues.
        }
      }
      return events;
    },
  };
}

const UNAVAILABLE = "The design consultant is unavailable. Please try again.";

export async function streamFetch({ fetch: fetchImpl, url, token, body, signal, onEvent }) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let message = UNAVAILABLE;
    try {
      const payload = await response.json();
      if (typeof payload?.error === "string" && payload.error) message = payload.error;
    } catch {
      // not JSON: keep the generic message
    }
    throw Object.assign(new Error(message), { status: response.status });
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const [name, data] of parser.push(decoder.decode(value, { stream: true }))) onEvent(name, data);
  }
  for (const [name, data] of parser.push(decoder.decode() + "\n\n")) onEvent(name, data);
}
