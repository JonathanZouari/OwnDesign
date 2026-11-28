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
| `backend/tests/test_estimate_db.py` | integration, edge | estimate tables: read-only RLS, `replace_estimate` atomicity, rollback, parallel calls, cascade |
| `backend/tests/test_estimate.py` | integration, edge | estimate API: amounts, statuses, invalid and boundary input, isolation, suspended studio, concurrency |
| `backend/tests/test_e2e_budget.py` | end to end, edge | budget page: sample, edit, save, comparison, CSV export and import, invalid files, access, 375 px |
| `backend/tests/test_catalog.py` | unit | Hebrew catalog labels, unchanged ids |
| `frontend/tests/budget-logic.test.js` | unit, edge | line amounts, validation, CSV writing and parsing |

## Required after every change

End to end, regression (both full suites) and edge cases for the change (`CLAUDE.md`, step 5).

## Last result

2026-11-28: backend `uv run pytest` 375 passed; frontend `npm test` 203 passed, 1 skipped.

2026-11-26: backend `uv run pytest` 295 passed (incl. browser journeys); frontend `npm test` 187 passed,
1 skipped (pdf.js smoke test needs a browser). No lint run: ruff is not installed in the backend environment.

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

- Never run two backend test sessions at once: the teardown of one deletes the other's test users.
- The local static server sends no cache headers; after a change a browser can mix old and new ES modules and
  show an empty page. Hard-reload (Ctrl+F5).
- `uvicorn --reload` once failed to restart after a change on Windows; restart the server if behaviour looks old.
- Every run of the backend suite deletes all `*@owndesign-test.example.com` accounts and their studios.
  Do not run it while someone is checking pages by hand with such accounts.
- Playwright matches accessible names by substring. A second link containing "Start designing" or a
  second heading containing the studio name breaks the journeys.
