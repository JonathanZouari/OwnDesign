# Security

Sources: `supabase/migrations/`, `backend/app/main.py`, `backend/tests/test_api.py`, commit `f4ed029`.

## Tenant isolation

- A studio member sees the studio's projects. A client sees only their own. Enforced by RLS policies.
- Proven by tests through the API and directly against the Supabase Data API: no reading another
  studio's data, no direct writes, nothing visible to an anonymous caller.

## Controls in place

- JWT checked on every protected route; anonymous sign-ins are rejected.
- Strict input schemas: unknown fields rejected, numbers bounded, ids unique, openings must fit their wall.
- Request bodies capped at 2 MB by counting received bytes, so chunked uploads are capped too.
- Per-account quotas on projects and versions.
- Suspended studios cannot be written to.
- Invite tokens are random; the public invite lookup never returns the email.
- supabase-js is served from `frontend/vendor/`; every page has `script-src 'self'`.
- The DOM builder writes text nodes only, so plan and project names cannot inject markup.
- Secrets only in git-ignored files. History was scanned before the repository was published.

## Review of Phase 1

Independent security review and code review. No critical or high security finding. Fixed: CDN script
without integrity, chunked-body bypass of the size cap, account flooding, a race allowing two owned
studios, writes to suspended studios, sequence grants.

Not fixed, by decision: see [open-items.md](open-items.md).

## Review of the client portal and studio dashboard

No finding. The studio activity endpoint answers 403 to anyone who is not a member of an active
studio with that id, whether or not the studio exists, and returns no actor ids, tokens or emails.
A client's plan is drawn as SVG in the designer's browser from values the backend schema bounds as
finite numbers and fixed literals.

## Review of the AI advisor

Four `security-review` runs on the local commits before any push:

- the backend (`baa3fa9`, `2490bec`): no finding;
- the page with `apiStream` (`e3d03d3`): no finding;
- the whole branch against `origin/dev`: no vulnerability. It raised five LOW candidates (designer-written
  room names in the client's prompt; a notice that understated what is sent; the new dependency set; log
  pins aimed at the wrong logger names; the key held as a plain string). Each went to its own
  false-positive check and none held (1 to 2 out of 10);
- the hardening commit `b259ea8`: no vulnerability; seven candidates, all non-findings.

Hardening applied anyway (`b259ea8`): the `httpx2` and `httpcore2` loggers pinned to WARNING next to
`openai` and `httpx` (the installed SDK sends requests through `httpx2`, so the old pin named the wrong
logger), the stale comment corrected, a system-prompt rule that room and project names are data and not
instructions, and a notice that lists everything sent to OpenAI.

Controls, all tested ([advisor.md](advisor.md)):

- Only the client who owns the project reaches Groq: 401, 404 (not visible), 403 (studio member or
  inactive studio) and 422 are answered before the stream opens, and Groq is not called for them.
  The "not configured" answer (503) comes after those checks.
- The system prompt is a constant; user text never enters it. It says that project and room names are
  data, not instructions. The model has no tools. This reduces prompt injection, including text a
  designer saved in a room name, but cannot rule it out.
- The project data sent to Groq is read with the caller's JWT and limited to the name, property type,
  room names and types, and counts.
- The provider's address is the constant `GROQ_BASE_URL`; no setting or user input can point the API key
  at another host. A test checks the URL, the key header and the request body that the real SDK sends.
- Groq's 429 is answered with a fixed message under the code `rate_limited`; a test seeds the provider's
  error body with a marker and checks that it appears in no event and no log (only the exception type name
  is logged).
- No question, history or reply text in logs or audit rows; provider error text is never returned. The
  `openai`, `httpx`, `httpx2` and `httpcore2` loggers are pinned to WARNING. A test runs the real SDK over
  a canned network with every logger at DEBUG and fails if any logger outside `app.*` speaks; a control
  test shows it does fail when a pin is lifted. The `httpcore2` pin is checked by level only, because the
  canned network never reaches it.
- The page builds the reply with a text node and `textContent`; the bearer token only goes to the
  configured API host, and the project id is encoded into the request path.
- Audit rows `advisor.asked` have no studio, so members never read them.

Known limits are in [open-items.md](open-items.md): the one-reply lock is per process, project data goes
to a third party (Groq), and the daily quota overlaps another team's cost budget. The notice names what
is sent, but whether that is enough consent is still undecided. Groq's free-tier limit is shared by all
users, so one user can make the advisor answer "busy" to the others (availability, not a data exposure).

Looked at and left alone, because they are not vulnerabilities today: the Groq key is a plain string in
`Settings` like the Supabase keys (nothing logs or returns the settings); `hpack` and `h2` would log
headers at DEBUG only if HTTP/2 were switched on for the SDK client, which it is not.

Process note: in the second review the sub-task was told to use read-only file tools and also ran two
read-only shell commands. Nothing was changed.

### Switch from OpenAI to Groq (2026-11-25)

Both reviews covered `git diff dev...HEAD` only (the owner's choice). The `security-review` skill itself
diffs against `origin/main`, which also contains the earlier advisor work; its base cannot be changed, so
its analysis was run on a saved copy of the `dev...HEAD` diff instead.

- A `general-purpose` reviewer with a security brief (read-only, no `.env`): no vulnerability, nothing at
  or above low. It examined and rejected: the log of a `RateLimitError`, an information difference between
  `rate_limited` and `upstream` (both come after the access checks), the base URL being overridden (it is
  a constant passed explicitly), leftover `OPENAI_*` variables (the advisor does not read them, tested; after the upstream merge they belong to the consultant), a whitespace-only key,
  retry amplification (`max_retries=0`), the key's `repr`.
- The `security-review` skill (identification step, read-only file tools): no finding at the 8-of-10
  bar, so no false-positive checks were needed. It did not re-read `frontend/js/pages/advisor.js`; the first
  reviewer did, and found the error text goes in as a text node.
- What the change adds: Groq's shared free-tier limit lets any user make the advisor answer "busy" to
  the others (availability only; the daily 50 and the one-open-reply lock still apply per user).

Reasoning guard for gpt-oss models (`git diff e0b4063..HEAD`, one `general-purpose` reviewer, read-only, told
never to touch any `.env` file; it reports it did not): no vulnerability. Checked and rejected: reasoning
text reaching events or logs (only `delta.content` is read; a test with a marker at DEBUG), user input
reaching the extra request parameters (they come from a constant and the trusted model ID), a bypass of the
per-user quota or lock by the larger token budget (bounded: 50 questions of up to 4000 tokens a day, up
from 1000 each), a look-alike model ID matching the prefix (the model ID is a trusted setting). It was
unsure about two things, neither a vulnerability: reasoning text placed inside `content` (for example in
think tags) would be shown to the user, and whether Groq counts the requested maximum against the shared
per-minute limit (an open item).

## Review of Phase 2 (backend)

`security-review` and a security-reviewer agent on the local commits. Fixed: a suspended studio could still
write design data; parallel uploads could pass the 30-image limit (now a database trigger); the consultant's
daily cap could be bypassed (empty answers, parallel calls, many projects) and is now reserved atomically per
user before the paid call; project text sent to OpenAI could pose as instructions (now an escaped,
untrusted input item). Checked, no finding: tenant isolation of every new table and route, upload byte
checks, signed URLs, no IDOR through asset or room ids. Not fixed: see the Phase 2 gaps in
[open-items.md](open-items.md). The Phase 2 frontend had a code review (fixed: expiring image links,
duplicate chat message after a failed answer, unvalidated `?project=`); a security review of the frontend
commits is still to do.

## Merge of upstream/dev (2026-11-26)

The streaming Groq advisor now lives next to upstream's saved-chat OpenAI consultant ([advisor.md](advisor.md)).

- **Database review** of upstream's four Phase 2 migrations (one reviewer, read-only, before they were applied as
  written): no critical or high finding; the two medium and six low findings are in [open-items.md](open-items.md).
  RLS on all new tables with SELECT-only policies, tenant isolation inherited from `projects`, `ai_conversations`
  own-only, definer functions with a pinned `search_path` and service-role-only, a private bucket, nothing destructive.
- **Code reviews** (four runs): the real defects were naming and documentation after the merge, test weaknesses and
  an editor header overflow; all fixed or accepted by the owner ([log.md](log.md)).
- **Security review** of the merge resolution and follow-ups, by a reviewer and by the `security-review` skill's
  analysis: no vulnerability. Checked: each client carries only its own key to its own host (the advisor passes the
  Groq URL explicitly, and the installed SDK falls back to `OPENAI_BASE_URL` only when no URL is given; a test pins
  each client's key and host); the advisor's access checks and their order are unchanged and run before the stream
  opens; the advisor's audit row still has no studio, so members cannot read it; CORS origins unchanged (upstream
  added PUT and DELETE, which the POST-only advisor route does not use); the 6 MB body limit applies only to
  `POST .../assets`; no test fake is reachable from the app (`e2e_app.py` is only started as a test subprocess,
  and it also switches the consultant off).
- Not changed, recorded as open items: the OpenAI organisation, project and custom-header environment variables would
  also be sent to Groq by the advisor's client; the consultant's audit event carries the studio id.

## Second merge of upstream/dev (2026-11-27)

Merge `27cdc3f` brought in upstream's studio branding preview, 3D walkthrough, plan-export specification and CI
workflow; no new migration. Two reviews of the resolution (a code review and the `security-review` analysis, both
on saved diffs of the resolution, not on the whole of upstream's code): no vulnerability, nothing at medium or high.
The security analysis was a short, read-only static pass: the walkthrough receives the plan only as numbers and
writes none of it to the page as HTML; the editor page's content security policy is unchanged; the new CI file keeps
its secrets in a job that runs only on pushes to `dev` and `main`, and this branch's test change keeps the
secret-free pull-request job from importing the app at collection time. Not a substitute for upstream's own review
of its code ([walkthrough review below](#review-of-the-3d-walkthrough-pull-request-14)).

## CI (GitHub Actions)

Source: `.github/workflows/ci.yml`. The plan and the file were each reviewed by a security-reviewer agent, and
`security-review` ran on the commits. No critical finding. Two high findings on the plan, both built in:

- Secrets live in the environment `ci`, limited to `dev` and `main`, not at repository level. A fork, another
  branch or an edited workflow cannot get them (tried: refused).
- CI uses its own Supabase secret key, not the one from `backend/.env`.

Also in place: pull requests run in jobs with no secrets and never with `pull_request_target`; secrets reach
single steps, not the job; actions pinned to commit hashes and uv to a version; no cache, no artifacts
(Playwright traces hold tokens and the repository is public); read-only token.

**Before merging a pull request from a fork, read its diff of `backend/tests/`, `uv.lock`, `pyproject.toml`,
`frontend/package.json` and `.github/`.** Its green check ran without secrets; after the merge, the push run
executes that code with the service key.

What remains: the CI key is still a service key on the dev project; logs are public and GitHub masks exact
secret strings only, so a failing test's traceback is visible to everyone. See [open-items.md](open-items.md).

## Review of the 3D walkthrough (pull request #14)

Reviewed again here before merging, by reading and by a security-reviewer agent: no critical or high finding.
Plan values reach only three.js geometry as numbers, the content security policy is unchanged, and three.js is
served locally. The three vendored files are byte for byte the published npm package `three@0.180.0` (SHA-256
compared at merge time). The guard against oversized plans counts wall cuts, not boxes: the largest plan the
server accepts still makes the viewer's own tab sluggish ([open-items.md](open-items.md)).

## Every stage

Run the `security-review` skill on the branch's local commits before pushing (`CLAUDE.md`, step 7), and add
the outcome here and to [log.md](log.md).
