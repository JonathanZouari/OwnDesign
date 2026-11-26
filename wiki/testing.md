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
| `backend/tests/test_e2e.py` | end to end, edge | client journey (portal, wizard, editor, sign-up, save, reload); designer journey (studio dashboard metrics, invite, project cards, search, activity, edit a client's project); portal entry points (personal invite, blank canvas, invalid links, markup and long names) |
| `frontend/tests/plan.test.js` | unit | plan functions: add, move, remove, undo, rooms from the wizard |
| `frontend/tests/studio.test.js` | unit, edge | dashboard metrics, activity sentences, project filter |

## Required after every change

End to end, regression (both full suites) and edge cases for the change (`CLAUDE.md`, step 5).

## Last result

2026-11-26 (history and correction): backend 131 passed, frontend 37 passed. `test_invites.py` grew to 19 tests
(correction kills the old link and keeps both in history, 5 parallel corrections give one invite and one email,
failed send recorded and retried with the same token, only open invites, reuse of an open invite, membership and
malformed input, direct calls to `correct_invite` refused). The designer journey corrects an address in the dialog
and checks both links in fresh browser contexts. Screens checked at 1280 and 390 px.

Earlier the same day, 
2026-11-26: backend 122 passed (9 browser journeys included), frontend 33 passed, on a fresh Supabase test
project. New: `backend/tests/test_invites.py` (who may accept, forwards, letter case, unconfirmed address,
expiry and renewal, one open invite per address with 5 parallel requests, cancel rules, double-send guard,
project gate) and `test_invite_email.py` (message escaping, header injection, Resend failures, daily cap). The
`admit` fixture in `conftest.py` gives a test client an accepted invite. The real Resend call was not made: no
key yet.

Earlier, 
2026-11-23: backend 94 passed (incl. 3 browser journeys), frontend 31 passed. New files:
`backend/tests/test_design.py` (brief, finishes, uploads, moodboard, isolation, quota, suspended studio) and
`test_consultant.py` (fake OpenAI client: context, privacy, cap, failure, injection, tag escaping);
`frontend/tests/design-logic.test.js`. `backend/tests/test_e2e_design.py` (6 browser tests: client journey for brief, finishes and moodboard with
reload; designer sees the client's data; client-side rejections, markup stays text; stranger and signed-out
visitor; consultant page limits) passes together with `test_e2e.py` (9 browser tests in all). No chat message
reaches OpenAI in the suite; the real call was checked by hand once.

## Local setup notes

`backend/.env` needs `ALLOWED_ORIGINS` to include both `http://localhost:5500` and `http://127.0.0.1:5500` (the
journeys use the second). A system-level `OPENAI_API_KEY` overrides the one in `.env`; unset it before starting the backend.

## Not covered

Real touch devices (pinch zoom), browsers other than Chromium, screen readers, load, a studio with
many projects, a clean clone on another machine.

## Gotchas

- Every run of the backend suite deletes all `*@owndesign-test.example.com` accounts and their studios.
  Do not run it while someone is checking pages by hand with such accounts.
- Playwright matches accessible names by substring. A second link containing "Start designing" or a
  second heading containing the studio name breaks the journeys.
