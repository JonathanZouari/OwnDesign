# Log

Append-only. Newest at the bottom. Format: `## [YYYY-MM-DD] <type> | <title>`.

## [2026-11-19] plan | Phase 1 scope and approach approved
Read the PRD. The user chose: Phase 1 first, AI later through the OpenAI API, English-only UI, a new
cloud Supabase project. Plan approved: FastAPI + static frontend + Supabase with RLS.
Pages: [overview](overview.md), [decisions](decisions.md).

## [2026-11-19] infra | Supabase dev project created
New organisation `interior-design-platform` with project `interior-design-dev` (eu-central-1),
created with the Supabase CLI. Email confirmation switched off for development.
Pages: [architecture](architecture.md), [open-items](open-items.md).

## [2026-11-19] build | Phase 1 scaffold
Backend routes and geometry schemas, database schema with RLS, 2D plan editor, wizard and pages.
Commit `dd2cb52`. Pages: [architecture](architecture.md).

## [2026-11-19] design | UI aligned to the Stitch design system
The user asked mid-build to use the Stitch project "AI Interior Design Platform". Wizard and editor
follow its two matching screens; other pages follow its design system. Later-phase widgets left out.
Pages: [design](design.md).

## [2026-11-19] build | Dev Supabase wired, shared HTTP pool, E2E journeys, README
Integration tests against the real dev project, two browser journeys, run instructions.
Commit `c592463`. Pages: [testing](testing.md).

## [2026-11-19] security | Code review and security review, findings fixed
Independent code-review and security-review agents. No critical or high security finding. Fixed:
save-dialog bugs, keyboard placement, undo no-ops, vendored supabase-js with CSP, body-size cap for
chunked uploads, per-account quotas, one-owner unique index, suspended-studio writes, sequence grants.
Commit `f4ed029`. Pages: [security](security.md), [open-items](open-items.md).

## [2026-11-19] test | Phase 1 verified
Backend 41 passed (unit, integration, 2 browser E2E). Frontend 13 passed. Dev project left with no
test users or rows. Not tested: real touch devices, browsers other than Chromium.
Pages: [testing](testing.md).

## [2026-11-19] infra | GitHub repository created and made public
`main` and `dev` pushed to `github.com/JonathanZouari/OwnDesign`, default branch `main`. History
scanned for keys before pushing: none. Made public at the user's request.
Pages: [decisions](decisions.md).

## [2026-11-19] docs | CLAUDE.md and this wiki added
Working rules (plan first, Fable 5.2, E2E + regression + edge tests, security review at every stage,
commit per finished piece of code, subagents for specialist work) and the wiki seeded from Phase 1.
Model pinned in `.claude/settings.json`.
Pages: all.

## [2026-11-19] infra | Local connection to the dev Supabase project, database migrated
Linked the CLI to the dev project and wrote `backend/.env` and `frontend/js/config.js` (git-ignored)
from the project's publishable and secret keys. The remote database had no tables: applied both
migrations with `supabase db push` and the declared auth settings with `supabase config push` (user
approved). Verified: all six tables reachable with the secret key; the publishable key alone gets
`42501` on every table. E2E failed at first because `ALLOWED_ORIGINS` listed only `localhost:5500`
while the tests use `127.0.0.1:5500`; `backend/.env.example` now lists both.
Tests: backend 41 passed, frontend 13 passed.
Pages: this log.

## [2026-11-19] decision | Plan on Opus 5.5, execute on Sonnet 5.5
User decision: the main session plans on Opus 5.5 (pinned in `.claude/settings.json`); subagents run on
Sonnet 5.5 (`model: "sonnet"`) and do the implementation. Replaces "everything on Fable 5.2".
Pages: [decisions](decisions.md); `CLAUDE.md` Model section.

## [2026-11-19] design | Stitch connection checked, design system name updated
Stitch MCP server connected (user scope, key outside the repo). The project lists 9 screens and one
design system, now named "Architectural Drafting & Spatial Intelligence"; README, the `app.css` header
comment and the design page renamed from "Architectural Atelier". UI brand "ATELIER" unchanged.
Pages: [design](design.md).
