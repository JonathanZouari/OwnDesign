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

- Only the client who owns the project reaches OpenAI: 401, 404 (not visible), 403 (studio member or
  inactive studio) and 422 are answered before the stream opens, and OpenAI is not called for them.
  The "not configured" answer (503) comes after those checks.
- The system prompt is a constant; user text never enters it. It says that project and room names are
  data, not instructions. The model has no tools. This reduces prompt injection, including text a
  designer saved in a room name, but cannot rule it out.
- The project data sent to OpenAI is read with the caller's JWT and limited to the name, property type,
  room names and types, and counts.
- No question, history or reply text in logs or audit rows; provider error text is never returned. The
  `openai`, `httpx`, `httpx2` and `httpcore2` loggers are pinned to WARNING. A test runs the real SDK over
  a canned network with every logger at DEBUG and fails if any logger outside `app.*` speaks; a control
  test shows it does fail when a pin is lifted. The `httpcore2` pin is checked by level only, because the
  canned network never reaches it.
- The page builds the reply with a text node and `textContent`; the bearer token only goes to the
  configured API host, and the project id is encoded into the request path.
- Audit rows `advisor.asked` have no studio, so members never read them.

Known limits are in [open-items.md](open-items.md): the one-reply lock is per process, project data goes
to a third party (OpenAI), and the daily quota overlaps another team's cost budget. The notice names what
is sent, but whether that is enough consent is still undecided.

Looked at and left alone, because they are not vulnerabilities today: the OpenAI key is a plain string in
`Settings` like the Supabase keys (nothing logs or returns the settings); `hpack` and `h2` would log
headers at DEBUG only if HTTP/2 were switched on for the OpenAI client, which it is not.

Process note: in the second review the sub-task was told to use read-only file tools and also ran two
read-only shell commands. Nothing was changed.

## Every stage

Run the `security-review` skill on the branch's local commits before pushing (`CLAUDE.md`, step 7), and add
the outcome here and to [log.md](log.md).
