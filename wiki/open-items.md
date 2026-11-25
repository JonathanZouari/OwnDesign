# Open items

Remove an item when it is resolved and note the resolution in [log.md](log.md).

## Needs a product decision

- **Deleting a client account** also deletes their projects, including versions a designer saved. The PRD leaves retention open.
- **Invites** never expire and are not bound to the invited email address.
- **Product name.** "ATELIER" comes from Stitch; the PRD says undecided.
- **PRD 9.1 and Groq.** Groq's free tier is not a paid API, so the advisor fits "no paid third-party API integrations". It is still a hosted third-party service, while the PRD (9.5) prefers open-source or self-hosted AI. If the free tier is outgrown, a paid plan would conflict with 9.1 again; that needs a decision then.
- **Advisor conversations.** Whether they may be kept, for how long, and consent for AI processing before launch (PRD 5.4 and section 9). Today nothing is kept.
- **Project data sent to Groq.** The advisor sends the project name and type, each room's name and type, counts of walls, openings and furniture, up to 10 earlier messages and the question. The page says so (every item except the counts) and that OwnDesign does not save the conversation. Whether this needs explicit consent is undecided.
- **Overlap with the "AI cost budget" team.** The advisor's 50-questions-per-user-per-day quota (`MAX_QUESTIONS_PER_DAY` in `backend/app/routes/advisor.py`) is a stopgap. It must be reconciled with their budget before the advisor ships beyond dev.
- **Overlap with the "Hebrew RTL" team.** The advisor's RTL rules are local to `frontend/css/advisor.css`. When their global RTL work lands, check the advisor page against it and decide whether those rules move.

## Phase 2 gaps

- **Consultant retention and consent.** Conversations are kept without an expiry or a delete action; the brief and plan text go to OpenAI. A privacy notice and a retention rule are needed before production.
- **Spend and storage budgets.** The message cap is per user only; there is no per-studio or global ceiling, no per-studio storage quota (20 projects x 30 images x 5 MB per account), and nothing limits studios per user beyond one owned studio.
- **Thread pool.** The consultant call is synchronous and holds a worker for up to 30 s; many parallel requests could starve other routes. Move to an async client and an in-flight limit.
- **Orphaned image files.** Files of a deleted project or user are queued in `storage_deletions` and removed only the next time an asset is deleted. Needs a scheduled drain.
- **Delete-then-insert saves** of finishes and the moodboard are not atomic.
- **Studio dashboard** does not link project cards to the brief, finishes or moodboard; designers reach them through the editor.
- The editor has no link to the Phase 2 pages at 767 px and below.

## Later phases with a Stitch screen waiting

Studio branding, project dossier and export, 3D renderings: designs are in
`design/stitch/` ([design.md](design.md)). Each is built as a real feature in its own phase. The AI
consultant screen is built twice, as the advisor ([advisor.md](advisor.md)) and as the consultant
(`consultant.html`), both without its sample-data panels.

## Before production

- Turn email confirmation on and configure SMTP. While it is off, someone can register with another person's address and it is shown to the designer as the client's email.
- Rate limiting on the API (the advisor has its own daily quota and one open reply per user).
- The advisor's one-reply lock is held in memory per server process, so with several workers or replicas it is not shared. The quota is shared (it is counted in the database).
- The quota query filters `audit_events` by actor and action; the only index is on `(studio_id, created_at)`, so it scans. Add an index when the table grows.
- **More live testing of the advisor.** One call to `openai/gpt-oss-120b` worked on 2026-11-25 (streaming, `reasoning_effort: "low"` accepted, a short Hebrew reply with two small wording slips; details in [advisor.md](advisor.md)). The first model, `llama-3.3-70b-versatile`, got a 404 because it is not available to this account. Still to confirm: a long answer against the 4000-token limit, the 429 path, and the Hebrew over more questions. Groq's docs do not say whether reasoning tokens count toward that limit, nor whether a larger requested maximum counts against the shared per-minute token limit; check the console's limits page for this model. Also confirm a closed browser tab stops the reply on a real server, and that Railway's proxy does not buffer SSE.
- Groq's free-tier limits are per organisation, so one user's heavy use can make the advisor answer "busy" to everyone. The numbers for the chosen model are not recorded here; read them from the console's limits page.
- If Groq ever reports a rate limit as an error event inside an open stream (not seen; unknown whether it does), the client gets the generic failure message instead of the "busy" one, because the SDK raises a plain `APIError` for it. Decide after the live check whether to read the event's error code.
- A question that Groq refuses with 429 still counts against the user's 50 a day, because the `advisor.asked` row is written before the stream opens.
- `connect-src` in the content security policy, per environment.
- Railway deployment files and environments.
- Sign-out does not invalidate an already issued token before it expires.

## Smaller

- Below 1200 px the sidebar is hidden, so the dashboard's in-page section links are not reachable there.
- The wizard replaces an unsaved draft after a notice only; the portal's blank canvas asks first.
- The dashboard lists every project of the studio on one page; there is no paging yet.
- The dashboard's "no match" message is shown by un-hiding it, which some screen readers announce unreliably.
- `.area`, `.version` and `.wide` are global classes in `app.css` and are easy to collide with.
- Audit event ids are one sequence across all studios, so a member can infer overall event volume.
- Fonts load from Google, which exposes the visitor's IP address to Google.
- The editor's sign in/out button is hidden on phones.
- The editor's tabs are hidden below 768 px, so on a phone the "AI Consultant" tab cannot be reached from the editor; `advisor.html?project=<id>` itself fits a phone.
- The wording of the advisor page (notices, errors, buttons) has not had a copywriting review, and its layout has not had a design review against the Stitch screen.
- The tests import `httpx2` directly, but it is only a dependency of `openai`, not of this project. If a later `openai` release changes its HTTP library, `backend/tests/test_advisor.py` needs updating.
- The `Settings` class holds `groq_api_key` as a plain string, like the Supabase keys. Consider `SecretStr` for all of them together.
- If a reasoning model ever put its reasoning inside `content` (for example in think tags), the advisor would show it to the user, because only `delta.content` is displayed. `openai/gpt-oss-120b` sends reasoning in a separate `reasoning` field, so this is hypothetical today. The reasoning guard's reviewer raised it; accepted as open (2026-11-25).
- A leftover `OPENAI_ORG_ID` or `OPENAI_PROJECT_ID` in the server's environment could in theory be sent by the SDK to Groq as a header. Environment values are trusted and there is no known exploit; accepted as open (2026-11-25).
- `backend/tests/e2e_app.py` keeps the attempt count of each question in a module-level dict (`_attempts`), so re-running a journey against the same server would see its first-attempt failure only once. The journeys use unique questions today.
- `backend/tests/e2e_app.py` builds one fake error with `httpx` and another with `httpx2`; harmless, and the other test modules do the same.
- Test modules import error factories from each other (`tests/test_api.py` from `tests/test_advisor.py`). They could move to `tests/fake_llm.py`.
- The coordinate limit is enforced in the editor only by clamping the view.
- Two adjacent rooms from the wizard produce two overlapping walls.
- Commit author address in the published history is the user's personal one (published by the user's choice).
