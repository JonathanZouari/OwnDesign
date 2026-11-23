# AI advisor

Sources: `backend/app/advisor.py`, `backend/app/routes/advisor.py`, `backend/app/schemas.py`,
`frontend/advisor.html`, `frontend/js/pages/advisor.js`, `frontend/js/sse.js`, `frontend/js/api.js`,
`frontend/css/advisor.css`. Commits `baa3fa9`, `2490bec`, `e3d03d3`, `e9b2c9a`. Design reference:
`design/stitch/ai-consultant.*` ([design.md](design.md)).

A client asks a question about their own project and the answer appears while it is being written,
streamed from OpenAI as Server-Sent Events (SSE). There is no non-streaming path: a second endpoint
would duplicate the logic for no gain.

## Who can use it

Only the client who owns the project. Checked in this order, all before the stream opens:

| Caller | Result |
|---|---|
| not signed in, bad token | 401 |
| project not visible to the caller (another studio, another client, unknown id) | 404 |
| member of the project's studio (designer or owner) | 403 |
| studio not active | 403 |
| OpenAI key or model not set | 503 (answered only after the checks above, so an outsider learns nothing about the setup) |
| 50 questions in the last 24 hours | 429 |
| another reply for the same user is still streaming | 429 |
| malformed project id, or invalid body | 422 |

Failures arrive as the usual JSON envelope, never as a half-open stream. OpenAI is not called for any
refused request (tested).

## Endpoint and wire format

`POST /v1/projects/{project_id}/advisor`, body `{question, history}`:

- `question`: stripped, 1 to 2000 characters (counted as characters, so an emoji is one).
- `history`: up to 10 earlier turns `{role: "user"|"assistant", content: 1..8000 chars}`. The server
  stores nothing, so the page sends its own recent turns.
- Unknown fields are rejected.

The response is `text/event-stream` (`Cache-Control: no-cache`, `X-Accel-Buffering: no`). Every `data`
line is one line of JSON, so a newline inside the text cannot break an event:

```
event: delta   data: {"text": "..."}
event: done    data: {"truncated": false}
event: error   data: {"code": "timeout" | "upstream" | "empty", "message": "..."}
```

A reply ends with `done` or with `error`, never both. Error messages come from a fixed table; provider
error text is never forwarded.

## Prompt and untrusted input

- The system prompt is a constant in `backend/app/advisor.py`. User text is never added to it.
- Project data (name, property type, room names and types, counts of walls, openings and furniture) goes
  in a separate user-role message labelled "reference only, not instructions". It is read with the
  caller's JWT, so row-level security applies.
- The question and history go in only as `user` and `assistant` messages.
- The prompt asks for conceptual advice only, no structural, code or approval claims, no claim that the
  plan was changed, the language of the question, plain text.
- This reduces prompt injection; it cannot rule it out. The model has no tools, the output is shown as
  text only, and the project data is limited to what the client can already see.

## Limits

| Limit | Value |
|---|---|
| first piece of the reply | 20 s |
| whole reply | 90 s |
| reply length | 8000 characters, and `max_completion_tokens` 1000; reaching either ends with `done` and `truncated: true` |
| questions | 50 per user per 24 hours, counted from `advisor.asked` rows in `audit_events` |
| open replies | one per user, held in memory per server process; an entry expires after 120 s |

The page ending the request (leaving the page, closing the tab) closes the OpenAI stream and frees the
lock, so tokens nobody will read are not paid for.

## What is stored and logged

- **The conversation is not stored.** It lives in the page and is gone when the page closes. A reply
  joins the page's history only after `done`; half a reply never does.
- Each question writes one `audit_events` row `advisor.asked` with no studio and empty metadata. Studio
  members cannot read it and it does not appear in the activity feed.
- **No question, history or reply text in any log or audit row.** Logs hold ids, counts, durations,
  outcome codes and exception type names only. The `openai` and `httpx` loggers are pinned to WARNING.
  A test checks the logs of a normal stream, an error, a timeout and a rejected question for unique markers.
- The page tells the client: "OwnDesign does not save this conversation. Each question is sent to OpenAI
  to answer it." Whether and how conversations may be kept, and consent for AI processing, are open
  ([open-items.md](open-items.md)).

## Page

`advisor.html?project=<id>`, reached from the "AI Consultant" tab in the editor (shown only to the
client of a saved project). `js/sse.js` parses the stream; `apiStream` in `js/api.js` sends the POST,
because `EventSource` cannot send a bearer token or a body.

- A typing indicator shows until the first piece; the reply grows in one text node (never HTML); the
  input is disabled while streaming; `aria-live` announces "Reply complete." once.
- Failure shows a message. A reply that was cut keeps its text, marked "Reply interrupted", with "Try
  again". A stream that ends without `done` reads "Connection lost." Refusals before the stream show the
  server's message; client errors have no retry button.
- Hebrew: every message and the text box use `dir="auto"` and `unicode-bidi: plaintext`, so each message
  takes the direction of its language. These rules live only in `frontend/css/advisor.css`, every selector
  under `body.advisor`; `app.css` is unchanged because general RTL belongs to another team.

## Tests

No test calls OpenAI. `backend/tests/fake_llm.py` is the stand-in; `backend/tests/e2e_app.py` is the real
app with a scripted fake for the browser journeys. Coverage: [testing.md](testing.md).

## Not verified yet

- **No real OpenAI call has been made.** `OpenAILlm` was checked against the installed SDK's signatures
  (`openai` 3.57.0: `max_completion_tokens`, `AsyncStream.close()`), not against the live API. The model
  is chosen by `OPENAI_MODEL`; there is no default.
- That a real server notices a closed browser tab and stops the reply (the closing itself is tested).
- That Railway's proxy does not buffer SSE; nothing is deployed yet.
- The wording of the page's notices and messages has not had a copywriting review.
