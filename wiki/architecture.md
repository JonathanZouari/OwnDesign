# Architecture

Sources: `backend/app/`, `frontend/js/`, `supabase/migrations/`.

```
frontend/   static HTML + ES modules, no build step
backend/    FastAPI, Python 3.13, uv
supabase/   migrations and managed auth settings
```

## Environments

- **Dev Supabase project `owndesign-dev`**, in the user's own organisation, region eu-central-1 (Frankfurt), free
  plan, created 2026-11-26 with the Supabase CLI. All migrations in `supabase/migrations/` applied with
  `supabase db push --remote`; auth settings from `supabase/config.toml` applied with `supabase config push --remote`.
  The repository is linked to it (`supabase/.temp`, git-ignored).
- Local config: `backend/.env` (URL, publishable and secret keys, allowed origins, OpenAI settings, and
  `SUPABASE_DB_PASSWORD` for the CLI only) and `frontend/js/config.js` (URL and publishable key). Both git-ignored.
- The consultant has no OpenAI key in this environment yet, so its endpoint answers 503 until one is added.
- Hosted CLI commands need `--remote`, and creating or changing hosted resources needs `--yes` when run by an agent.

## Request path

1. The browser signs in with supabase-js (`frontend/js/api.js`). That is its only direct use of Supabase.
2. Every data call goes to the backend at `/v1/...` with `Authorization: Bearer <JWT>`.
3. `backend/app/auth.py` verifies the token and builds a per-request Supabase client carrying it.
4. Responses use the envelope `{success, data, error}` (`backend/app/responses.py`).

## Access model

- **Reads** use the caller's JWT, so Postgres row-level security decides what is visible.
- **Writes** use the service key, after the payload is validated and an RLS-scoped read confirms access.
- Role `authenticated` has SELECT only. Role `anon` has nothing.
- A new table needs: RLS enabled, a SELECT policy, explicit grants, and an isolation test.

## Tables

`studios`, `studio_memberships` (owner or designer; one owned studio per user), `studio_invites`,
`projects`, `plan_versions` (insert only, unique `(project_id, version_no)`), `audit_events` (insert only).

Phase 2 (`supabase/migrations/20261123*`): `project_briefs` (one JSON document per project),
`finish_selections` (unique per room and surface), `inspiration_assets`, `moodboard_items`,
`ai_conversations` (unique per project and user), `ai_messages`, `storage_deletions` (queue of files to remove).
Their SELECT policies go through `projects`, except conversations: only their own user reads them.

Tasks (`supabase/migrations/20261126090000_project_tasks.sql`): `project_tasks` (open or done, client note,
`done_at`/`done_by`). SELECT through `projects`. Triggers: a 200-per-project cap (done tasks count too) and an
update guard (a task never changes project, author or creation time; `updated_at` is kept current).

## Plan geometry

One JSON document per version, validated in `backend/app/schemas.py` and edited by pure functions in
`frontend/js/plan.js`.

```json
{ "schema": 1, "units": "cm", "rooms": [], "walls": [], "openings": [], "furniture": [] }
```

- An opening is positioned by `offset` along its wall, so it moves with the wall.
- Furniture `x`/`y` is the centre.
- Limits: 100 rooms, 1000 of each other kind, coordinates within 100,000 cm, body under 2 MB.

## Editor

`frontend/js/editor/`: `main.js` (state, tools, keyboard, save), `render.js` (SVG), `pointer.js`
(drag, draw, pan, pinch, wheel), `panel.js` (inspector and versions). The whole canvas is redrawn on
each change; the plan object is never mutated.

## API

Studios, invites, studio activity (`GET /v1/studios/{id}/audit`, the latest 10 audit events, members
only): `backend/app/routes/studios.py`. Projects, versions: `backend/app/routes/projects.py`.
Quotas: 20 projects per client per studio, 500 versions per project.

Design assistance (`backend/app/routes/design.py`, `consultant.py`, catalog in `backend/app/catalog.py`):
`GET /v1/catalog`; under `/v1/projects/{id}`: `brief`, `finishes`, `assets`, `moodboard`
(GET and PUT, assets POST and DELETE), `consultant/messages` (GET, POST). Every write goes through
`_writable_project`, which refuses a suspended studio.

- **Images:** private bucket `project-assets`, no storage policies. The backend checks the file's bytes
  (not the declared type), stores it under `<project_id>/<uuid>.<ext>` and returns signed URLs valid for
  10 minutes. Deleting an asset row, directly or by cascade, queues the file in `storage_deletions`;
  the backend removes queued files after an asset is deleted. The 30-image limit is enforced by a
  database trigger. The body cap is 6 MB for `POST .../assets` only, 2 MB elsewhere.
- **Consultant:** `reserve_ai_message` (database function) takes a per-user lock, counts the user's
  messages of the last 24 hours across all projects, and stores the user message before the paid call.
  The project context goes to OpenAI as a separate, escaped, untrusted input item, not in the
  system prompt. A failed call keeps its slot. The OpenAI client is a FastAPI dependency (`get_openai`)
  so tests replace it. `OPENAI_API_KEY` and `OPENAI_MODEL` are read from `backend/.env`; without a key
  the endpoint answers 503.
- **Frontend:** `design.html` (brief, materials, moodboard tabs), `consultant.html`; pure logic in
  `frontend/js/design-logic.js`.

Client tasks (`backend/app/routes/tasks.py`): under `/v1/projects/{id}/tasks`: GET (open first, newest first),
POST (studio members only), `PATCH /{task_id}` with `{status, client_note}` (the client marks done or undoes;
a member reopens), `DELETE /{task_id}` (members only). `GET /v1/tasks` is the client's inbox: open tasks on
projects where the caller is the client. A status change is a conditional update on the current status, so
two simultaneous clicks give one change and one 409. CORS allows PATCH for this. Frontend: `tasks.html`, pure
logic in `frontend/js/task-logic.js`; the projects list shows "Tasks (n open)".
