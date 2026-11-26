# Architecture

Sources: `backend/app/`, `frontend/js/`, `supabase/migrations/`.

```
frontend/   static HTML + ES modules, no build step
backend/    FastAPI, Python 3.13, uv
supabase/   migrations and managed auth settings
```

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

Item detection (`supabase/migrations/20261126120000_owned_items.sql`, proposed): `owned_items` (accepted items only;
SELECT through `projects`; service role may insert and delete but not update), the private bucket `models`, and the
function `append_existing_items` (service role only).

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

**3D walkthrough:** `frontend/js/plan3d.js` (pure: wall boxes, collision, start point) and
`editor/view3d.js` (three.js, loaded with `import()` only when opened). three.js 0.180.0 is vendored in
`frontend/vendor/`. Assumed heights in cm: wall 260, door 210, window 90 to 210, eye 160. An opening cuts
every wall lying along it, because adjacent rooms have overlapping walls. Plans needing more than 5000
cuts are refused. No server or database change.

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

## Item detection (proposed)

Spec: `../specs/item-detection.md`. Code: `backend/app/detection/` (model, classes), `backend/app/routes/detection.py`,
`backend/scripts/publish_model.py`; frontend `frontend/js/detection-logic.js`, `design.js` (dialog, "My items" in
the brief) and the editor palette.

- `POST /v1/projects/{id}/assets/{asset_id}/detect`: the project and the "Item I own" photo are read through RLS,
  the stored photo is decoded (JPEG/PNG/WebP only, at most 40 MP, EXIF rotation applied) and the model returns
  boxes, classes and confidences. Nothing is stored. Allowed in a suspended studio (a read).
- `GET/POST /owned-items`, `DELETE /owned-items/{item_id}`: accepted items. POST stores them, then appends one line to
  the brief's existing items through `append_existing_items` (one statement under a row lock, so a brief saved at
  the same moment is not overwritten); if the brief cannot take the line, the items are removed again.
- Model: RF-DETR Small (Apache 2.0) exported to ONNX and quantized to int8 (39 MB), run by ONNX Runtime on CPU. It is
  downloaded once from the bucket, accepted only if its SHA-256 matches `MODEL_SHA256`, and the session is built
  from those same bytes. The cache is a folder only the server user owns. A failed load is not retried for 60 s.
- Only 14 COCO classes are kept (`classes.py`); each maps to an editor furniture type where one exists. The
  browser shows results under 0.6 as "Not sure".
- Two detections at a time per process, one per user; beyond that 429 with `Retry-After`. Same pattern as plan
  export (pull request #26); to be shared once one of them is merged.
