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

## [2026-11-23] build | Phase 2: brief, finishes, images, moodboard, AI consultant
Backend: three-plus migrations (tables, asset quota trigger, atomic consultant reservation), endpoints for
brief, finishes, assets, moodboard and consultant, tests first. Frontend: `design.html`, `consultant.html`
built by a general-purpose agent from the design system. Commits `90763ab`, `2c7278f`, `8a5bcc2`, `797dcec`,
`5466898`, `f50c0bb`. Pages: [overview](overview.md), [architecture](architecture.md), [decisions](decisions.md),
[design](design.md), [open-items](open-items.md).

## [2026-11-23] security | Review of the Phase 2 backend
Several findings fixed (suspended studios, upload race, consultant cap and context injection); see
[security](security.md).

## [2026-11-23] test | Phase 2 verified
Backend 94 passed, frontend 31 passed. Pages: [testing](testing.md).

The entries from here to the lint entry come with pull request #24 and describe work in the contributor's fork.
"The user" in them is the contributor's own user, and the Supabase project is the contributor's.

## [2026-11-26] decision | Mobile web version scoped
The user chose view and light edits for the editor on phones, layouts adapted from the existing Stitch screens, and a
fork plus pull request because they have no write access to the original repository. Pages: [decisions](decisions.md).

## [2026-11-26] infra | Separate Supabase project for development
The CLI created a new project. `supabase db push --remote` applied the six migrations and `supabase config push` set the auth settings.
The local `.env` and `config.js` were filled in; both are git-ignored. Pages: [testing](testing.md), [decisions](decisions.md).

## [2026-11-26] build | Mobile web version
Editor phone mode (9e90834), navigation drawer and phone layouts for every page (89e0e14), inspector bottom sheet
(0c8b959), mobile browser tests (321fd81). A code review found that on a phone walls and openings could still be edited
through the inspector, and dragging a room moved its walls. Fixed in 2992a42, together with a dismissible notice, the
sheet height on short phones, the editor menu before and after a failed load, the drawer copying links from hidden
sections, and 768 px overflow. The review's remaining low items were moved to [open-items](open-items.md). Pages:
[design](design.md), [overview](overview.md).

## [2026-11-26] test | Mobile web version verified
Backend 119 passed (19 of them in `test_e2e_mobile.py`), frontend 41 passed; the mobile suite passed 3 times in a row. Pages:
[testing](testing.md).

## [2026-11-26] security | Review of the mobile web version
`security-review` on 9e90834, 89e0e14..321fd81 and 2992a42: no findings. Pages: [security](security.md).

## [2026-11-26] test | Visual check in Chromium
Screenshots of every page at 390, 320, 768 and 1440 px (touch context for phones), viewed one by one. Found and fixed in
b164d45:
- at 768–1199 px the tabs pushed the menu button and the brand out of the app bar (the tabs now live in the drawer);
- a selected wall on a phone showed an empty action bar;
- the catalog was squeezed beside an open inspector sheet;
- disabled fields did not look read-only.

The overflow test had missed the first one because the bar clips instead of scrolling. New tests cover all of them.
Backend 123 passed, frontend 41 passed. Pages: [design](design.md), [testing](testing.md).

## [2026-11-26] lint | End of the mobile web phase
Removed open items that were resolved: the editor had no Phase 2 links at 767 px and below, its sign in/out button was hidden on phones, and the
dashboard's section links could not be reached below 1200 px. All three are now reachable through the drawer. Updated the breakpoint line in design.md.
No new pages, so the index is unchanged. The subagents named in `CLAUDE.md` (ux-ui-designer, code-reviewer, e2e-runner) are not installed
in this environment; `general-purpose` with a narrow brief stood in for them.

## [2026-11-26] plan | Tests in GitHub Actions
Plan approved by the user: everything runs in CI, a separate Supabase key for CI, report only.
Pages: [decisions](decisions.md).

## [2026-11-26] security | Review of the CI plan and workflow
Security-reviewer agent on the plan (2 high: branch-limited environment, separate key; both adopted), then
security-reviewer and code-reviewer agents on the file (no critical, high or medium security finding; four small
fixes applied), then `security-review` on the commits: no finding. Pages: [security](security.md),
[open-items](open-items.md).

## [2026-11-26] infra | CI workflow and the `ci` environment
`.github/workflows/ci.yml` with jobs `frontend`, `backend`, `backend-unit`; GitHub environment `ci` limited to
`dev` and `main`, holding the Supabase URL and publishable key. Found on the way: `test_consultant.py` imported
`app.main` at module level, so the suite crashed instead of skipping without settings; fixed. Commits `0150113`,
`dff701b`. Pages: [testing](testing.md), [security](security.md), [decisions](decisions.md).

## [2026-11-26] test | CI verified, except the full backend run
Local: backend 100 passed, frontend 31 passed. Clean clone without settings: 22 passed, 78 skipped. On GitHub:
red check on a pull request with a failing test, refusal of a branch outside the environment's rule, failure on a
missing secret, all as intended. The temporary pull request #25 was closed and its branch deleted. Open: a
green `backend` run, waiting for the CI secret key. Pages: [testing](testing.md), [open-items](open-items.md).

## [2026-11-26] docs | Plan export specification added
The plan export feature specification (PNG, PDF and DXF downloads of a saved plan version, with a
conceptual-plan notice and a studio activity event) added as a raw source at `specs/plan-export.md`.
Technical validation (section 10 of the spec) comes before implementation. Pages: [index](index.md).

## [2026-11-26] docs | Pull request #9 merged: plan export specification
A document only (`specs/plan-export.md`, 145 lines), read in full: no code, no secrets. Its "confirmed product
decisions" are the contributor's; the index line now says so. Conflict in this log resolved by keeping both
sides. Frontend 31 passed; the backend suite was not run for a document. Commits `3a7a741`, `b63440f`.
Pages: [index](index.md).

## [2026-11-26] build | Studio branding preview
`branding.html`: logo upload (PNG, JPG, WebP, 2 MB), four colour presets, custom primary, background and
text colours with a contrast check, live preview. Browser only, nothing saved. Frontend 39 passed; manual
check in Chrome. Backend integration and browser journeys not run (Supabase not configured).
Pages: [overview](overview.md), [design](design.md), [open-items](open-items.md).

## [2026-11-26] build | Pull request #8 merged: studio branding preview
Browser-only preview page (`frontend/branding.html`); nothing saved or sent. Static read, then code-reviewer and
security-reviewer agents: no critical or high finding; nine files, no network, storage or dynamic code; CSP as on
the other pages. One medium note on the contrast check and smaller ones are in [open-items](open-items.md); the
contributor's code was not changed. On the merged tree: backend 100 passed, frontend 39 passed. No browser journey
for the page yet. Commits `2552d1d` (merge) and the two that follow it. Pages: [open-items](open-items.md).

The six entries that follow came with pull request #14 and describe work in the contributor's fork. "The user"
in them was the contributor's own user, and the Supabase project and test run were theirs, not this project's.

## [2026-11-26] decision | 3D walkthrough chosen (in the contributor's fork)
The contributor chose a first-person walkthrough, against PRD 3.3. Pages: [decisions](decisions.md),
[open-items](open-items.md).

## [2026-11-26] build | 3D walkthrough in the plan editor
Tests first for the geometry. Commits `5b50e33`, `3a688e3`, `ed51665`. Pages: [overview](overview.md),
[architecture](architecture.md).

## [2026-11-26] security | Review of the walkthrough, and a code review
No security finding. Code review: sharp-angle walls could be crossed, oversized plans froze the tab, Ctrl+S
did not save in 3D. Fixed in `ff3c9bf`, which also fixes the new browser journey (the page's policy blocks
`wait_for_function`). Pages: [security](security.md).

## [2026-11-26] infra | The contributor's own Supabase project
Created by the contributor for their fork, migrations and auth settings applied. Not this project's database.

## [2026-11-26] test | Walkthrough verified (in the contributor's fork)
Backend 100 passed, frontend 49 passed, as reported by the contributor. Pages: [testing](testing.md).

## [2026-11-26] docs | Walkthrough sent as a pull request
No write access to the repository, so the work goes from a fork to `dev` as a pull request. The local
commits were re-authored before publishing, and the hashes above updated. Pages: [log](log.md).

## [2026-11-26] build | Pull request #14 merged: 3D walkthrough in the plan editor
First-person, view-only walkthrough opened from the editor; three.js 0.180.0 vendored. Before any of it ran: the
vendored files compared by SHA-256 with the npm package (identical), the test and editor changes read, then
code-reviewer and security-reviewer agents: no critical or high finding. One medium and four low notes are in
[open-items](open-items.md); the contributor's code was not changed. Six wiki conflicts resolved by keeping both
sides; the contributor's wiki text spoke of "the user", which was re-attributed
([decisions](decisions.md), "From merged pull requests"). On the merged tree: backend 100 passed, frontend 57
passed. Commits `5bb03bf` (merge), `5c86f5b`. Pages: [decisions](decisions.md), [security](security.md),
[testing](testing.md), [open-items](open-items.md).

## [2026-11-26] test | Pull request #19 reviewed, not merged: version comparison
Code-reviewer and security-reviewer agents, then its tests on a trial merge onto `dev`: frontend 63 passed, its
unit and API tests passed, one of its four browser journeys failed (it asserts on text that the stylesheet
uppercases, and a later step cannot pass). Also confirmed in the code: the details panel renders the text "null",
and the comparison and the 3D walkthrough can be open at once. No security finding in the code; the endpoint
reads through RLS. Its wiki recorded "the app is for customers, not internal designers" as the user's decision;
not adopted. A comment on the pull request lists what blocks it; its base was changed from `main` to `dev`.
Nothing of it is on `dev`.

The entries below also come with pull request #24 (contributor's fork), after it caught up with `dev`.

## [2026-11-26] build | Mobile web branch merged with dev
`dev` merged into `mobile-web` (`e5ae64b`). Conflicts in `app.css` and four wiki pages, resolved by keeping both
sides. On the merged tree: backend 123 passed, frontend 67 passed, walkthrough tests included. Pages: [log](log.md).

## [2026-11-26] build | 3D walkthrough on phones, review answers
The phone CSS hid the context-bar group that holds the merged walkthrough's button. It now shows icon-only, and the
3D view takes the whole stage (`2f8c0fb`). From the user's review of the screenshots: the inspector sheet reopens for
each newly selected item, and the studio chip hides below 360 px. A code review then found that the phone catalog
painted over the 3D view and its pad, and that the sheet could reopen beside the open catalog. Both fixed in `81e0726`,
together with safe-area padding that was counted twice and the chip rule, now limited to pages with the drawer.
Pages: [design](design.md), [decisions](decisions.md).

## [2026-11-26] test | Merged mobile branch verified
Backend 131 passed (31 in `test_e2e_mobile.py`), frontend 67 passed. Two full runs were broken partway by another
session's test run on the same Supabase project, whose teardown deleted this run's accounts; rerun when that session
was idle. A visual check found the 2D zoom buttons painted over the phone 3D view and the area wrapping at 320 px, both
fixed in `2148048`. `security-review` on `e5ae64b`, `2f8c0fb`, `81e0726` and `2148048`: no findings. Pages:
[testing](testing.md), [open-items](open-items.md).
