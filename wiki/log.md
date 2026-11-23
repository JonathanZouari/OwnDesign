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

## [2026-11-24] plan | AI advisor with live replies
The user asked to add streaming to the AI advisor. There was none: no OpenAI call, endpoint or screen.
Plan approved after four changes: the notice says questions are sent to OpenAI, no question, history or
reply text in any log (with a test), the pull request goes to the user's fork with base `dev`, and the
advisor's RTL styles stay on the advisor page because another team owns Hebrew RTL; the daily quota's
overlap with the "AI cost budget" team goes in open-items. User choices: nothing is saved, only the
owning client, a new page `advisor.html`.
Pages: [advisor](advisor.md), [decisions](decisions.md), [open-items](open-items.md).

## [2026-11-24] build | Advisor core and endpoint
`openai` 3.57.0 added (its signatures checked: `max_completion_tokens`, `AsyncStream.close()`).
`POST /v1/projects/{id}/advisor` streams SSE; owner-only access, a constant system prompt, timeouts, a
length cap, a daily quota, one open reply per user, no conversation text in logs. 32 unit and 22
integration tests, OpenAI faked. Commits `baa3fa9`, `2490bec`. Pages: [advisor](advisor.md),
[architecture](architecture.md).

## [2026-11-24] security | Review of the advisor backend
`security-review` on the two local commits. No finding. Checked: authorization order and RLS, the
service-key uses, prompt construction, SSE framing, logging, the new dependencies.
Pages: [security](security.md).

## [2026-11-24] build | Advisor page and apiStream
`advisor.html`, `js/pages/advisor.js`, `js/sse.js`, `css/advisor.css` (all selectors under `body.advisor`,
`app.css` unchanged) and an "AI Consultant" tab in the editor for the client. `apiStream` was added to
`js/api.js`, which the plan had not listed; the user approved it. A parser bug found by its own test (a
final bare CR was never flushed) was fixed. 17 new frontend tests. Commit `e3d03d3`.
Pages: [advisor](advisor.md), [decisions](decisions.md).

## [2026-11-24] security | Review of the advisor page and apiStream
`security-review` on the page commit. No finding. Checked: where the token is sent, every place reply,
error and project text reaches the DOM, the `?project=` parameter, the CSS and HTML. Process note: the
review sub-task ran two read-only shell commands although told to use file tools only.
Pages: [security](security.md).

## [2026-11-24] test | Advisor browser journeys and regression
First run: all seven new journeys and the three existing ones failed. Cause: the browser opens the site
at `127.0.0.1:5500`, which the backend's default allowed origin (`localhost`) rejects, so every API call
was blocked by CORS. Fixed in the test fixture only (`ALLOWED_ORIGINS` set for the backend it starts;
`.env` not touched). Two further failures were bugs in the new tests (a `.last` locator that follows the
newest element; a text that also sits in a live region). Result: backend 104 passed, frontend 34 passed,
none failed or skipped (baseline 43 and 17). No real OpenAI call was made at any point.
Commit `e9b2c9a`. Pages: [testing](testing.md).

## [2026-11-24] docs | Advisor documented
New page [advisor](advisor.md); updated index, overview, decisions, open-items, architecture, security,
testing, design, `README.md` and `design/stitch/README.md`. Open items added: conversation retention and
consent, project data sent to OpenAI, overlap with the "AI cost budget" and "Hebrew RTL" teams, the
per-process lock, an index for the quota query, running against the real OpenAI API, the tab hidden on
phones, no copywriting or design review of the page, `.env.example` lacking the new variables.
The commit that adds this entry.

## [2026-11-24] lint | Wiki checked after the advisor
Fixed claims the code no longer supports: "AI consultant" under Not built (overview, README, open-items),
"AI advisor left out" (decisions), the Stitch screen's state (design, `design/stitch/README.md`), and the
test counts (testing). Every page is in the index; links checked by reading. Nothing contradicting left.
