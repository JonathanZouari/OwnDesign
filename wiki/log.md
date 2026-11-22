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

## [2026-11-19] build | Forgot password, and opening a studio from an existing account
A user who signed up as a client had no way to open a studio, so "New project" led nowhere. `projects.html`
now offers "Open your studio" to accounts with no membership (`POST /v1/studios`, 409 goes to the studio
page). `auth.html` gained forgot (`resetPasswordForEmail`, same message for any address) and reset
(`updateUser`) modes; reset URLs added to the auth redirect allowlist and pushed. Planned on Opus,
implemented by a Sonnet subagent. Tests: backend 48 passed (7 new E2E/edge), frontend 13 passed.
Security review: no findings; two items recorded in open-items.
Pages: [architecture](architecture.md), [open-items](open-items.md).

## [2026-11-19] build | Homeowner projects without a studio; studio UI hidden
User decision: Phase 1 focuses on a homeowner designing alone. Migration `20261119143225` makes
`projects.studio_id` nullable (pushed to dev). Backend creates and saves studio-less projects (quota per
user, author `client`); home page goes straight to the wizard; studio card, column and dashboard link
removed from the UI (code kept). The wizard only uses a remembered studio when reached via
`wizard.html?via=studio`, so an old studio link cannot attach a homeowner's project to that studio.
Planned on Opus, implemented by a Sonnet subagent, stale-studio fix and its test by the main session.
Tests: backend 52 passed, frontend 13 passed. Security review: no findings.
Pages: [overview](overview.md), [decisions](decisions.md), [architecture](architecture.md).

## [2026-11-19] build | Hebrew right-to-left interface
User decision: Hebrew only. All pages `lang="he" dir="rtl"`, JS strings in `frontend/js/strings.js`, Hebrew
API and auth error messages chosen by status/code (server English text never shown), Heebo font, logical CSS
properties, canvas kept LTR, editor shortcuts by physical key so they work on a Hebrew layout. "Studio
palette" label renamed "Tools". `CLAUDE.md` updated. Planned on Opus, implemented by a Sonnet subagent.
Tests: backend 57 passed (new: lang/dir, leftover-English scan, canvas LTR, Hebrew errors, mixed names),
frontend 16 passed. Security review: no findings.
Pages: [design](design.md), [decisions](decisions.md).

## [2026-11-19] build | PDF import, step 1: vendored pdf.js and wall detection
Vendored `pdfjs-dist@5.7.284` (`frontend/vendor/pdfjs-5.7.284/`, files byte-identical to the npm tarball,
whose sha512 matched the registry). `frontend/js/import/pdf.js` reads a local PDF in the browser
(`isEvalSupported: false`, `enableXfa: false`, no URL fetch, 20 MB and `%PDF-` checks) and
`frontend/js/import/walls.js` detects the scale (1:10–1:500, prefers the one near "קנ״מ", lists all
candidates) and walls in cm from dark fills and parallel line pairs. Not wired to a page yet.
Planned on Opus, implemented by a Sonnet subagent. Tests: frontend 40 passed, 1 skipped (pdf.js needs a
browser; step 2 E2E covers it). Security review: no findings.
Pages: this log.

## [2026-11-19] build | PDF import, step 2: review page, background drawing in the editor
`import.html`: file → page → review on the drawing (switch walls off, scale candidates, two-click
calibration that re-runs detection), then a draft with walls and an underlay placement. The page image is
kept in IndexedDB and drawn in the editor ("שרטוט רקע": show/hide, opacity), re-keyed to the project on
first save. Entry points in the wizard and on the home page. Synthetic PDFs (reportlab, dev dependency)
drive 12 import E2E tests. Real drawing (local only): full apartment at 1:20 with outlined scale text;
about 40–50 % of walls found and much noise from the title block and legend table → step 2b.
Planned on Opus, implemented by a Sonnet subagent; a test bug in the Hebrew scan fixed by the main session.
Security review: no findings. Pages: [architecture](architecture.md), [open-items](open-items.md).

## [2026-11-19] build | PDF import, step 2b: detection on real drawings
Plan-area rectangle in review (drag, numeric inputs, reset) with an automatic guess (largest wall cluster,
tables, title blocks and dense text excluded). Hatched parallel pairs read as strong walls; table rows,
over-thick bars and stray lines rejected; closed rectangles with a repeated closing point now read whole.
Honest confidence (joined ends, enclosed area, length outside the area). Switched-off walls survive
recalibration. Scale suggestion (1:20/1:50/1:100) when no ratio text exists, confirmed by the user.
Real drawing (local only, numbers only): junk outside the plan from about 77 m to 0, plan walls found from
about 40–50 % to about 80 %, scale suggestion 1:20 correct, confidence "poor" (conservative).
Planned on Opus, implemented by a Sonnet subagent. Tests: backend 72 passed, frontend 63 passed + 1 skipped.
Security and privacy review: no findings, nothing from the real drawing in the repo.
Pages: [open-items](open-items.md).

## [2026-11-19] design | All Stitch screens pulled and compared with the app
The Stitch project had grown to eight screens; only two had been pulled. All eight (HTML and a
preview each) and two generated images are now in `design/stitch/`. Wizard and canvas were unchanged
in Stitch. The Stitch PRD document is a shortened copy of the repository PRD with nothing new.
Commit `c01e476`. Pages: [design](design.md).

## [2026-11-19] plan | Integrate the two Phase 1 screens, keep four as reference
Approved by the user: build the client portal and the studio dashboard now with real data only; keep
branding, dossier, AI consultant and renderings as design references until their phases.
Pages: [decisions](decisions.md), [open-items](open-items.md).

## [2026-11-19] build | Studio activity endpoint
`GET /v1/studios/{id}/audit`: latest 10 audit events, members only, read under RLS, metadata limited
to `version_no` and `author_role`. Test written first. Commit `faec162`.
Pages: [architecture](architecture.md).

## [2026-11-19] build | Client portal and studio dashboard rebuilt from Stitch
Built by the `ux-ui-designer` subagent. Portal: guest or account access, wizard or blank canvas,
invite greeting. Dashboard: metrics, project cards with plan thumbnails, search, invites, recent
activity. Code review (no critical or high) led to: a confirmation before a blank canvas replaces a
draft, previews loaded as cards come into view instead of for the first 12 only, invites shown from
the create response, and a fix for sidebar icons clipped by a descendant selector (wizard and editor
were affected too). Commit `173e359`. Pages: [design](design.md), [overview](overview.md).

## [2026-11-19] test | Portal and dashboard verified
Backend 43 passed, including 3 browser journeys; frontend 17 passed. New edge tests found a real
bug before commit: a long unbroken studio name widened the portal on a phone. Fixed in CSS.
Pages: [testing](testing.md).

## [2026-11-19] security | Review of the portal, dashboard and activity endpoint
`security-review` run on the three local commits before pushing. No finding. Checked: endpoint
authorization and RLS, response contents, plan geometry drawn as SVG in another user's browser,
text-only DOM building, the blank-canvas flow, the content security policy on both pages.
Noted, not fixed: audit event ids are sequential across studios.
Pages: [security](security.md), [open-items](open-items.md).

## [2026-11-19] docs | Workflow order corrected in CLAUDE.md
The `security-review` skill reviews local commits against `origin/main`, so the rule is now: commit,
review, then push. Pages: [security](security.md).
## [2026-11-20] build | PDF import, step 3: furniture from the drawing
`frontend/js/import/furniture.js` finds closed thin-stroke shapes inside the plan area (nested shapes merged),
scores them against the catalog by size and shape cues, and fits the item to the measured size and rotation.
Review: furniture in a second colour, click to switch off, type list per item; unidentified shapes show
"בחרו סוג" and are added only once a type is chosen. Shapes that step 2b took as thick walls are handed back.
Real drawing (local only, numbers only): 24 candidates, 16 identified, 8 unidentified, roughly a quarter to a
third correct; 3 of about 5 furniture-as-walls fixed. The sheet is really 1:50 (dimension labels), while the
scale suggestion proposes 1:20. Rooms are not detected yet (the editor shows 0 rooms after import).
Planned on Opus, implemented by a Sonnet subagent. Tests: backend 72 passed, frontend 63 passed + 1 skipped.
Security and privacy review: no findings. Pages: [open-items](open-items.md).

## [2026-11-20] build | PDF import, step 4: rooms from the drawing
Rooms get an optional `outline` (3–200 points in cm, validated in `backend/app/schemas.py`); area comes from the
outline (shoelace) and the label sits at an interior point; rooms with an outline live without walls.
`frontend/js/import/rooms.js` rasterizes the reviewed walls on a 5 cm grid, bridges doorways from free wall
ends (virtual, never saved as walls), flood-fills the outside and keeps enclosed regions (≥ 1 m², ≥ 60 cm
wide), traced and simplified. Names from room words on the drawing, then furniture inside, then corridor by
shape, then "חדר N". Review shows rooms as tinted areas (toggle, name, type); the editor draws them filled.
Real drawing (local only, numbers only, 1:50): 4 rooms, 40 m² of about 136 m², 3 of 4 right; the shortfall is
wall detection missing exterior walls and the open living area, so those regions leak outside.
Planned on Opus, implemented by a Sonnet subagent. Tests: backend 93 passed, frontend 143 passed + 1 skipped.
Security and privacy review: no findings.

## [2026-11-20] build | One-click room kinds
`ROOM_KINDS` (16 kinds, each a name and one of the 7 room types) in `strings.js`; choosing a kind sets name and
type together (`applyKind`/`setRoomKind` in `plan.js`). Import review: clicking a room selects it and opens a card
with kind buttons and an import/skip toggle (no longer click-to-skip); list rows use a kind select. Editor: kind
buttons in the room inspector, one undoable edit. Asked for by the user after detection mislabelled rooms.
Planned on Opus, implemented by a Sonnet subagent. Tests: backend 94 passed, frontend 145 passed + 1 skipped.
Security review: no findings (kinds are static strings, set with text nodes; no backend change).

## [2026-11-20] decision | Room detection from PDF removed
The user decided that automatic room detection from PDF floor plans did not work well enough, and asked to cancel it.
Removed `rooms.js`, its tests and all room UI on the import review; import again produces walls, furniture and the
underlay only. Kept: the `Room.outline` schema and plan support (saved data may contain outlines), editor rendering of
outline rooms, `ROOM_KINDS` and the editor kind buttons. The one-click-kind E2E now uses a wizard-created room.
Pages: [decisions](decisions.md), [open-items](open-items.md).

E2E after the removal: 34 passed (including the editor kind test).

## [2026-11-22] merge | Upstream Stitch screens merged into the homeowner/Hebrew branch
Merged `upstream/main` (Stitch design sources, studio activity endpoint, client portal and studio dashboard rebuilt from Stitch screens, wiki) into `dev` with a normal merge commit. Both sides kept: the new portal (`entry.html`) and dashboard (`studio.html`) with metrics, project cards with plan previews, search and activity feed, and the `GET /v1/studios/{id}/audit` endpoint, together with the Hebrew right-to-left UI, projects without a studio, forgot password and PDF import. Our decisions won where they met: all text from the Stitch screens is Hebrew (static text in the HTML, text set from JS in `frontend/js/strings.js`: `ENTRY`, `STUDIO`, activity sentences in `studio-data.js`), the portal's start links carry `?via=studio` so a studio is attached only through a studio link, and the studio pages stay out of the homeowner navigation. His new tests were kept with their expected text in Hebrew; our E2E tests are unchanged. Wiki pages `decisions.md`, `design.md` and this log merged.
