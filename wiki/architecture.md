# Architecture

Sources: `backend/app/`, `frontend/js/`, `supabase/migrations/`.

```
frontend/   static HTML + ES modules, no build step
backend/    FastAPI, Python 3.13, uv
supabase/   migrations and managed auth settings
```

## Request path

1. The browser signs in with supabase-js (`frontend/js/api.js`). That is its only direct use of Supabase:
   sign-in, sign-up, and password recovery (`auth.html?mode=forgot` sends the reset email with
   `resetPasswordForEmail`; the link returns to `auth.html?mode=reset`, which must be in the auth redirect
   allowlist in `supabase/config.toml`, and sets the new password with `updateUser`). The forgot page shows
   the same message whether or not the address has an account.
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

`projects.studio_id` is nullable (migration `20261119143225`): a homeowner's project has no studio and is
visible only to its `client_user_id`. Quotas count per studio, and separately per user for studio-less
projects. The wizard attaches a remembered studio only when reached from a studio link
(`wizard.html?via=studio`), so an old link never silently shares a homeowner's project with that studio.

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

Studios, invites: `backend/app/routes/studios.py`. Projects, versions: `backend/app/routes/projects.py`.
Quotas: 20 projects per client per studio, 500 versions per project.

## PDF import (browser only)

`import.html` reads a local PDF with vendored pdf.js (`frontend/js/import/pdf.js`), detects the scale and walls
(`walls.js`), and lets the user review on top of the drawing: switch walls off, pick a scale candidate, or
calibrate by clicking two points and typing the real length (detection re-runs at the new scale). It then
writes a normal draft (`plan.walls`) plus `underlay` placement in cm. The page image is kept in IndexedDB
(`underlay.js`, key `draft:<random>`, re-keyed to `project:<id>` on first save; placement in
`od.underlay.<projectId>`), and the editor draws it as an `<image>` above the grid. Nothing is uploaded: the
geometry sent to the server never contains the underlay. Guests can import. The user's real PDF is used only
locally for tuning and is never committed; tests generate synthetic PDFs with reportlab (dev dependency).
