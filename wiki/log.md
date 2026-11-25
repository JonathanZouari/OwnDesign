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

## [2026-11-24] docs | OpenAI settings listed in .env.example
`backend/.env.example` now lists `OPENAI_API_KEY=` and `OPENAI_MODEL=` (names only). The open item that
said they were missing is removed. Commit `70c17a2`; the wiki fix is the commit that adds this entry.
Pages: [open-items](open-items.md).

## [2026-11-24] security | Branch-wide review of the advisor
`security-review` on all seven local commits. No vulnerability. Five LOW candidates, each checked by its own
false-positive review and none held (1 to 2 out of 10): designer-written room names in the client's prompt,
a notice that understated what is sent, the new dependency set (`httpx2` is the SDK's official HTTP layer),
log pins aimed at the wrong logger names, the key held as a plain string. Two real, non-security findings
came out of the checks: the log pin named `httpx` while the SDK uses `httpx2`, and a stale comment.
Pages: [security](security.md), [open-items](open-items.md).

## [2026-11-24] build | Advisor hardening before push
The user asked for three fixes. Loggers `httpx2` and `httpcore2` pinned to WARNING and the stale comment
corrected, with a test that runs the real SDK over a canned network at DEBUG and fails if a logger outside
`app.*` speaks (and a control that lifts a pin). The notice now lists everything sent to OpenAI (room types
included, since they are sent too). The system prompt says room and project names are data, not
instructions. Backend 109 passed (was 104), frontend 34 passed, none failed or skipped.
Commit `b259ea8`. Pages: [advisor](advisor.md), [testing](testing.md), [decisions](decisions.md).

## [2026-11-24] security | Review of the hardening commit
`security-review` on `b259ea8` only. No vulnerability; seven candidates, all non-findings (the prompt rule
is additive, the pins only reduce logging, the notice is static text and matches what the code sends, the
test key is a dummy). Not reachable and not introduced here: `hpack`/`h2` would log headers at DEBUG only
with HTTP/2 enabled. Open items added: the tests import `httpx2` directly; `SecretStr` for the keys.
Pages: [security](security.md), [open-items](open-items.md).

## [2026-11-24] docs | Advisor wiki updated after the hardening
`security.md`, `open-items.md`, `advisor.md`, `decisions.md`, `testing.md` and this log updated to match
`b259ea8` (notice text, logger pins, prompt rule, test counts, review results). The commit that adds this entry.

## [2026-11-25] plan | Switch the advisor from OpenAI to Groq
The user asked to move the advisor to Groq's free tier because PRD 9.1 says no paid APIs, and to open the
work as a pull request to the fork's `dev` (nothing to the upstream repository). Groq's docs read: base URL
`https://api.groq.com/openai/v1`, OpenAI SDK compatible, `max_completion_tokens` and streaming supported,
production models that stream listed. The user chose `llama-3.3-70b-versatile`, to keep the `openai`
package, and that a poor Hebrew result in the live check means stop and report, not switch. Plan approved.
Pages: [decisions](decisions.md).

## [2026-11-25] test | Baseline before the Groq switch
Before any change: backend 109 passed (10 browser journeys), frontend 34 passed. None failed or skipped.
Pages: [testing](testing.md).

## [2026-11-25] build | Advisor now calls Groq, with a friendly rate-limit message
Settings `GROQ_API_KEY` and `GROQ_MODEL` replace the OpenAI ones; `GroqLlm` uses the SDK with the fixed base
URL; Groq's 429 (`RateLimitError`) becomes the error code `rate_limited` with a fixed "busy" message; the
page notice, `.env.example` and README say Groq. Tests first: the Groq settings, the request the SDK
sends, chunks without text, the token limit, Hebrew split byte by byte, 429 before and after text, wider
input limits at the API, two new browser journeys (English and Hebrew, with retry), the notice, and an SSE
test for a Hebrew error message. Backend 142 passed (12 browser journeys), frontend 36 passed, none
failed or skipped. Commits `d1608be`, `13d81bf`. No real Groq call has been made yet.
Pages: [advisor](advisor.md), [architecture](architecture.md), [overview](overview.md),
[testing](testing.md), [security](security.md), [open-items](open-items.md).

## [2026-11-25] decision | Groq replaces OpenAI as the advisor's provider
Groq's free tier fits PRD 9.1 ("no paid third-party API integrations"); OpenAI did not. Recorded in
[decisions](decisions.md): the provider, the model, keeping the `openai` package, the friendly 429
message. Open items updated: PRD 9.1 and the free tier's limit, per-organisation limits, a 429 still
counting against the daily 50, the live check of the model and its Hebrew.

## [2026-11-25] lint | Code review of the Groq switch, and fixes
One `general-purpose` reviewer (Sonnet, read-only, `git diff dev...HEAD`). No high finding. Verified against
the code and fixed: (1) the SDK raises a plain `APIError` for an error event inside an open stream, so
"rate limit after some text" exists only in the fake; the wiki claimed otherwise and now says so, a test
pins the generic message for that case, and an open item records it; (2) the message said "in a minute"
but Groq also answers 429 for a daily quota, so it now says "in a little while"; (3) a duplicate line in
`tests/e2e_app.py` removed; (4) the old-settings test now uses the real `Settings` class; (5) a vacuous
assertion dropped. Not changed: the shared `_attempts` dict in `tests/e2e_app.py` is fragile if a journey is
re-run against the same server (unique questions today), and the test modules import error factories from
each other. Process note: the reviewer ran `grep -c` on `backend/.env` against the instruction not to open
it; the output was a line count only. Backend 144 passed, frontend 36 passed, none failed or skipped.
Pages: [advisor](advisor.md), [open-items](open-items.md), [testing](testing.md).

## [2026-11-25] security | Reviews of the Groq switch (`dev...HEAD`)
Two reviews, one at a time, both on `git diff dev...HEAD` as the owner asked. (1) `general-purpose` reviewer
with a security brief, finished in about a minute: no vulnerability; candidates rejected (provider text in
logs, `rate_limited` versus `upstream`, base URL override, leftover `OPENAI_*` variables, whitespace key,
retries, key `repr`). It did not touch `.env`. (2) `security-review` skill: it diffs against `origin/main`
and the base cannot be changed, so its analysis ran on a saved copy of the `dev...HEAD` diff; nothing at the
8-of-10 bar, so no false-positive sub-tasks. That sub-task made only three tool calls and did not re-read
`advisor.js`; the first reviewer had. No critical or high finding, nothing to fix before the push.
Pages: [security](security.md).

## [2026-11-25] test | Live check against Groq failed with 404
With the owner's approval, one streaming call through `get_llm()` and `stream_reply` (short Hebrew question,
empty project data, model `llama-3.3-70b-versatile`). Result: Groq answered HTTP 404 (`NotFoundError`) in
0.27 s, no text; the advisor sent the generic error. Nothing secret was printed. Groq's docs (summarised by
a small model) list the model as production and not deprecated, but mark both Llama production models
"Enterprise" / "ContactSales"; this is a possible cause, not confirmed. The Hebrew quality could not be
judged. No second call was made and the model was not changed. Waiting for the owner's decision.
Pages: [advisor](advisor.md), [open-items](open-items.md).
