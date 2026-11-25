# Testing

Sources: `backend/tests/`, `frontend/tests/`.

```sh
cd backend  && uv run pytest     # unit + integration (real dev Supabase) + browser E2E
cd frontend && npm test          # plan logic, node --test
```

First E2E run needs `uv run playwright install chromium`. Integration and E2E tests are skipped when
`backend/.env` is missing. They create users at `*@owndesign-test.example.com` and delete them afterwards.

## Suites

| File | Kind | Covers |
|---|---|---|
| `backend/tests/test_geometry.py` | unit, edge | geometry validation: bounds, duplicates, openings outside walls |
| `backend/tests/test_api.py` | integration, edge | auth, studios, invites, projects, versions, isolation, quotas, 413 on chunked upload, studio activity (members only) |
| `backend/tests/test_e2e.py` | end to end, edge | client journey (portal, wizard, editor, sign-up, save, reload); designer journey (studio dashboard metrics, invite, project cards, search, activity, edit a client's project); portal entry points (personal invite, blank canvas, invalid links, markup and long names); nine advisor journeys (below) |
| `backend/tests/test_advisor.py` | unit, edge | the advisor's SSE generator and prompt without Supabase: normal stream, Hebrew and emoji, newlines in text, error before and mid-stream, empty reply, both timeouts, length cap, closing the stream, injection text, input limits, the per-user lock; the real SDK over a canned network (`httpx2.MockTransport`): the Groq URL, key header and request body, Groq settings (missing, empty, spaces, old OpenAI names ignored), chunks without choices or text, the token limit, Hebrew split byte by byte across network chunks, 429 before and after text (with and without `retry-after`, JSON or not) answered with the friendly message and no provider text in events or logs, a limit reported inside an open stream giving the generic message, and the real `Settings` ignoring leftover `OPENAI_*` variables; every logger at DEBUG, failing if a logger outside `app.*` speaks, plus a control that lifts a pin |
| `backend/tests/test_api.py` (advisor section) | integration, edge | who may use the advisor (owner 200; studio designer 403; other studio and other client 404; no or bad token 401; unknown and malformed id), Groq never called for a refusal, invalid input 422 (empty, spaces, 2001 characters in English and Hebrew, null, wrong type, 8001-character turn, 11 turns, body that is not JSON), the longest question and a full history, 503, daily quota and one open reply 429, a Groq 429 as a `rate_limited` event that frees the user for the next question, suspended studio, audit row has no text and is private, no question, history or reply text in logs (including after a 429) |
| `backend/tests/fake_llm.py`, `backend/tests/e2e_app.py` | helpers | the Groq stand-in, and the real app with a scripted fake that the browser journeys use (`[busy]`, `[busy-late]`, `[flaky]`, `[error]`). No test calls Groq |
| `frontend/tests/plan.test.js` | unit | plan functions: add, move, remove, undo, rooms from the wizard |
| `frontend/tests/studio.test.js` | unit, edge | dashboard metrics, activity sentences, project filter |
| `frontend/tests/sse.test.js` | unit, edge | the SSE parser: a stream cut at every byte, a Hebrew letter split between chunks, CRLF and bare CR, comments, several data lines, an unknown event, an unfinished last event, a body that breaks part-way, an error event with a Hebrew message (whole and byte by byte) |

Advisor browser journeys: the reply growing with the typing indicator and locked input, plus the tab and
the notice (which says Groq and not OpenAI); a Hebrew question and reply laid out right to left next to an
English one; a failed reply and "Try again"; Groq's rate limit before and after some text, with the busy
message and a working retry, and the same for a Hebrew question; a dropped connection and a refused request; input limits and keys; the designer and
other users refused; a phone width with a long unbroken word.

## Required after every change

End to end, regression (both full suites) and edge cases for the change (`CLAUDE.md`, step 5).

## Last result

2026-11-25 (`feat/advisor-groq`, after the code-review fixes): backend 144 passed (12 browser journeys), frontend 36 passed. None failed or skipped.
Baseline run the same day before any change: backend 109 passed, frontend 34 passed.
2026-11-24 (advisor branch, after the hardening commit): backend 109 passed (10 browser journeys), frontend 34 passed. None failed or skipped.
Earlier baseline, 2026-11-19: backend 43 passed (3 browser journeys), frontend 17 passed.

## Not covered

Real touch devices (pinch zoom), browsers other than Chromium, screen readers, load, a studio with
many projects, a clean clone on another machine.

## Gotchas

- Every run of the backend suite deletes all `*@owndesign-test.example.com` accounts and their studios.
  Do not run it while someone is checking pages by hand with such accounts.
- The browser journeys open the site at `http://127.0.0.1:5500`, but the backend only allows the origins
  in `ALLOWED_ORIGINS` (default `http://localhost:5500`). The backend the E2E fixture starts is given
  `ALLOWED_ORIGINS` for both addresses. Without it every page that calls the API shows an empty state and
  the browser console reports a CORS error.
- The fixture starts `tests.e2e_app:app` (the real app, with Groq replaced by a fake) on port 8000. If
  something else already serves port 8000 the fixture uses it, and the advisor journeys are skipped,
  because that backend could call real Groq. Stop it to run them.
- To see why a browser journey failed: `uv run pytest tests/test_e2e.py -k <name> --screenshot only-on-failure --tracing retain-on-failure`.
  The output goes to `backend/test-results/`, which is git-ignored.
- Playwright locators are re-evaluated every time they are used, and matches are strict: a locator ending
  in `.last` follows the newest element, and a text that also appears in a screen-reader live region
  matches two elements.
- Playwright matches accessible names by substring. A second link containing "Start designing" or a
  second heading containing the studio name breaks the journeys.
