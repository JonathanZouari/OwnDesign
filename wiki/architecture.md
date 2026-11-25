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
`audit_events` also holds the advisor's `advisor.asked` rows, written with no studio so members never
see them; they are what the daily quota counts ([advisor.md](advisor.md)).

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

The advisor, `POST /v1/projects/{id}/advisor`: `backend/app/routes/advisor.py` (access, quota, lock)
and `backend/app/advisor.py` (prompt, Groq call through `get_llm`, SSE). It is the one route that
answers with a stream (`text/event-stream`) instead of the JSON envelope, and the one place the backend
calls an external AI service (Groq, through the OpenAI SDK pointed at `https://api.groq.com/openai/v1`,
a constant in the code). Settings `GROQ_API_KEY` and `GROQ_MODEL` are read from `backend/.env`;
the advisor answers 503 until both are set. The browser reads the stream with `apiStream`
(`frontend/js/api.js`) and `frontend/js/sse.js`, because `EventSource` cannot send a bearer token.
Full description: [advisor.md](advisor.md).
