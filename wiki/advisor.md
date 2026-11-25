# AI advisor

Sources: `backend/app/advisor.py`, `backend/app/routes/advisor.py`, `backend/app/schemas.py`,
`frontend/advisor.html`, `frontend/js/pages/advisor.js`, `frontend/js/sse.js`, `frontend/js/api.js`,
`frontend/css/advisor.css`. Commits `baa3fa9`, `2490bec`, `e3d03d3`, `e9b2c9a`; switch from OpenAI to Groq
`d1608be`, `13d81bf`. Design reference: `design/stitch/ai-consultant.*` ([design.md](design.md)).

A client asks a question about their own project and the answer appears while it is being written,
streamed from Groq (free tier) as Server-Sent Events (SSE). There is no non-streaming path: a second endpoint
would duplicate the logic for no gain.

## Next to the consultant

Upstream (`upstream/dev`, 2026-11-23) added its own AI feature, the **consultant** (`consultant.html`,
`backend/app/routes/consultant.py`). The owner chose to keep both and to let the upstream author decide, in a
draft pull request, whether to merge, replace or fold one into the other ([decisions.md](decisions.md)).

| | Consultant (upstream) | Advisor (this page) |
|---|---|---|
| Provider | paid OpenAI, `gpt-5-mini` by default | Groq free tier, `openai/gpt-oss-120b` |
| Delivery | one JSON answer, `POST …/consultant/messages` | streaming SSE, `POST …/advisor` |
| Memory | saved in `ai_conversations` and `ai_messages`, private to the user | nothing saved |
| Daily cap | 30 messages per user, atomic in SQL (`reserve_ai_message`) | 50 questions per user, counted from `audit_events` |
| Who | writers of the project (client and studio) | the owning client only |
| Settings | `OPENAI_API_KEY`, `OPENAI_MODEL` | `GROQ_API_KEY`, `GROQ_MODEL` |
| Editor link | "AI Consultant" (sidebar, or the tab bar under 1200 px) | "AI Advisor" (tab bar) |

The two share nothing at run time: separate keys and hosts (a test checks that each client carries only its
own key to its own host), separate caps (a user at one cap is not blocked from the other, tested), separate
routes. The privacy notice on this page ("does not save the conversation") is true of the advisor only; the
consultant saves its conversations. PRD 9.1 says no paid third-party APIs: the advisor follows it, the
consultant does not ([open-items.md](open-items.md)).

## Who can use it

Only the client who owns the project. Checked in this order, all before the stream opens:

| Caller | Result |
|---|---|
| not signed in, bad token | 401 |
| project not visible to the caller (another studio, another client, unknown id) | 404 |
| member of the project's studio (designer or owner) | 403 |
| studio not active | 403 |
| Groq key or model not set (empty or only spaces counts as not set) | 503 (answered only after the checks above, so an outsider learns nothing about the setup) |
| 50 questions in the last 24 hours | 429 |
| another reply for the same user is still streaming | 429 |
| malformed project id, or invalid body | 422 |

Failures arrive as the usual JSON envelope, never as a half-open stream. Groq is not called for any
refused request (tested).

## Provider

Groq, through the `openai` Python package pointed at `GROQ_BASE_URL` (`https://api.groq.com/openai/v1`),
a constant in `backend/app/advisor.py` that no setting or input can change. Settings in `backend/.env`:
`GROQ_API_KEY` and `GROQ_MODEL` (no default). The model in use is `openai/gpt-oss-120b`, chosen by the
owner from the models listed in the Groq console for this account. `llama-3.3-70b-versatile` was the first
choice but is not in this account's list, which is why the first live call got a 404.

gpt-oss models reason before they answer, and the reasoning could use up `max_completion_tokens` before any
text appears. Two settings in `backend/app/advisor.py` guard against that:

- `REASONING_EFFORT = "low"`, sent as `reasoning_effort` only when the model ID starts with
  `openai/gpt-oss` (any other model would probably refuse the parameter, so switching `GROQ_MODEL` to
  another family keeps working). Groq's docs list `low`, `medium` and `high` for these models.
- `MAX_REPLY_TOKENS = 4000` (it was 1000): the longest reply the 8000-character cap allows is about 2,700
  tokens at 3 characters a token (a test checks this), plus 1,000 tokens of headroom. The docs do not say
  whether reasoning tokens count toward this limit; it is sized as if they do.

The reasoning arrives in a separate `reasoning` field of each chunk. The code reads only `delta.content`, so
reasoning text is never sent to the page or logged (tested with a marker). Reasoning chunks reach the
generator as empty pieces, which end the 20 s first-piece wait; the 90 s total still applies. If the limit
is ever reached during reasoning the reply is empty and the page shows "The advisor returned no answer"
(tested). `max_completion_tokens` and streaming are documented as supported by Groq's endpoint (Groq docs,
read 2026-11-25). Retries are off, as before.

A chunk with no `choices` (a usage-only chunk), a role-only first chunk and a `null` content are skipped
(tested through the real SDK).

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
event: error   data: {"code": "timeout" | "upstream" | "empty" | "rate_limited", "message": "..."}
```

A reply ends with `done` or with `error`, never both. Error messages come from a fixed table; provider
error text is never forwarded.

`rate_limited` is Groq answering 429 (the free tier's limit, which is per organisation, so any user can
meet it). It is caught by the SDK's `RateLimitError` type, not by reading the error body, because Groq's
docs give no error-body format. The message is "The advisor is busy right now. Please try again in a
little while." (not "a minute": Groq also answers 429 when a daily quota is used up). A real 429 is an HTTP
status, so it arrives before any text and the page shows only the message, with "Try again". The case
"some text, then the rate limit" exists only in the tests, where the fake raises `RateLimitError` after two
pieces (the page then keeps the text, marked "Reply interrupted"): the SDK reports an error event inside an
open 200 stream as a plain `APIError`, which gets the generic "could not finish" message (tested). Only the
exception type name is logged. The question still counts against the user's daily 50
([open-items.md](open-items.md)).

## Prompt and untrusted input

- The system prompt is a constant in `backend/app/advisor.py`. User text is never added to it.
- Project data (name, property type, room names and types, counts of walls, openings and furniture) goes
  in a separate user-role message labelled "reference only, not instructions". It is read with the
  caller's JWT, so row-level security applies.
- The question and history go in only as `user` and `assistant` messages.
- The prompt asks for conceptual advice only, no structural, code or approval claims, no claim that the
  plan was changed, the language of the question, plain text. It also says that room and project names
  come from the studio or the client and are data, not instructions.
- This reduces prompt injection; it cannot rule it out. The model has no tools, the output is shown as
  text only, and the project data is limited to what the client can already see.

## Limits

| Limit | Value |
|---|---|
| first piece of the reply | 20 s |
| whole reply | 90 s |
| reply length | 8000 characters, and `max_completion_tokens` 4000 (room for reasoning, see Provider); reaching either ends with `done` and `truncated: true` |
| questions | 50 per user per 24 hours, counted from `advisor.asked` rows in `audit_events` |
| open replies | one per user, held in memory per server process; an entry expires after 120 s |

The page ending the request (leaving the page, closing the tab) closes the Groq stream and frees the
lock, so tokens nobody will read are not paid for.

## What is stored and logged

- **The conversation is not stored.** It lives in the page and is gone when the page closes. A reply
  joins the page's history only after `done`; half a reply never does.
- Each question writes one `audit_events` row `advisor.asked` with no studio and empty metadata. Studio
  members cannot read it and it does not appear in the activity feed.
- **No question, history or reply text in any log or audit row.** Logs hold ids, counts, durations,
  outcome codes and exception type names only. The `openai`, `httpx`, `httpx2` and `httpcore2` loggers
  are pinned to WARNING (openai 3.x sends requests through `httpx2`). A test checks the logs of a normal
  stream, an error, a timeout and a rejected question for unique markers, and another runs the real SDK
  over a canned network with every logger at DEBUG and fails if a logger outside `app.*` speaks.
- The page tells the client: "Each question, the earlier messages in this conversation, and your
  project's name, type, room names and room types are sent to Groq to answer it. OwnDesign does not
  save the conversation." Whether and how conversations may be kept, and consent for AI processing, are
  open ([open-items.md](open-items.md)).

## Page

`advisor.html?project=<id>`, reached from the "AI Advisor" tab in the editor (shown only to the
client of a saved project). The page, its tab and its messages all say "AI Advisor"; "AI Consultant" is
upstream's other feature (below). `js/sse.js` parses the stream; `apiStream` in `js/api.js` sends the POST,
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

No test calls Groq. `backend/tests/fake_llm.py` is the stand-in; `backend/tests/e2e_app.py` is the real
app with a scripted fake for the browser journeys (`[busy]` and `[busy-late]` in a question script a 429).
Coverage: [testing.md](testing.md).

## Not verified yet

- **Live checks so far (2026-11-25), one call each, a short Hebrew question through `get_llm()` and
  `stream_reply` with empty project data.** First, `llama-3.3-70b-versatile` got HTTP 404 before any text: the
  owner then saw in the Groq console that this model is not in the account's list, while `openai/gpt-oss-120b`
  is. (Groq's docs, read through a page summariser, had listed the Llama model as a production model and
  marked it "Enterprise".) Second, `openai/gpt-oss-120b` worked: Groq accepted `reasoning_effort: "low"` and
  the 4000-token limit, the reply streamed (100 chunks, 8 of them without text, 7 of those before the first
  text, which is what a short reasoning phase looks like; the reasoning itself was not inspected), the first
  text came after 0.63 s, the whole reply took 0.77 s, `finish_reason` was `stop` and the page-side events
  ended with `done` and `truncated: false`. The reply was 213 characters of fluent, relevant Hebrew with two
  small wording slips ("עמודי הדגש", accent pillars, where accent walls was meant, and "להרחיב אופק", broaden
  the horizon, for enlarging the room). That is Claude's reading; the owner is the judge of the Hebrew.
  Still not verified against the real API: a long reply (this one was short, so it says little about
  whether 4000 tokens is enough when the answer is long), the 429 path, and many questions in a row.
  `GroqLlm` was otherwise checked against the installed SDK's signatures (`openai` 3.57.0:
  `max_completion_tokens`, `reasoning_effort`, `AsyncStream.close()`) and a canned network.
- That a real server notices a closed browser tab and stops the reply (the closing itself is tested).
- That Railway's proxy does not buffer SSE; nothing is deployed yet.
- The wording of the page's notices and messages has not had a copywriting review.
