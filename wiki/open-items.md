# Open items

Remove an item when it is resolved and note the resolution in [log.md](log.md).

## Needs a product decision

- **Deleting a client account** also deletes their projects, including versions a designer saved. The PRD leaves retention open.
- **Invites** never expire and are not bound to the invited email address.
- **Product name.** "ATELIER" comes from Stitch; the PRD says undecided.
- **PRD text** still says "no paid API", which the OpenAI decision overrides.
- **Advisor conversations.** Whether they may be kept, for how long, and consent for AI processing before launch (PRD 5.4 and section 9). Today nothing is kept.
- **Project data sent to OpenAI.** The advisor sends the project name, property type and room names with each question. The client is told that questions go to OpenAI; whether this needs explicit consent is undecided.
- **Overlap with the "AI cost budget" team.** The advisor's 50-questions-per-user-per-day quota (`MAX_QUESTIONS_PER_DAY` in `backend/app/routes/advisor.py`) is a stopgap. It must be reconciled with their budget before the advisor ships beyond dev.
- **Overlap with the "Hebrew RTL" team.** The advisor's RTL rules are local to `frontend/css/advisor.css`. When their global RTL work lands, check the advisor page against it and decide whether those rules move.

## Later phases with a Stitch screen waiting

Studio branding, project dossier and export, 3D renderings: designs are in `design/stitch/`
([design.md](design.md)). Each is built as a real feature in its own phase. The AI consultant screen
is built as the advisor ([advisor.md](advisor.md)) without its sample-data panels.

## Before production

- Turn email confirmation on and configure SMTP. While it is off, someone can register with another person's address and it is shown to the designer as the client's email.
- Rate limiting on the API (the advisor has its own daily quota and one open reply per user).
- The advisor's one-reply lock is held in memory per server process, so with several workers or replicas it is not shared. The quota is shared (it is counted in the database).
- The quota query filters `audit_events` by actor and action; the only index is on `(studio_id, created_at)`, so it scans. Add an index when the table grows.
- Run the advisor against the real OpenAI API (none of it has been run live): choose `OPENAI_MODEL`, confirm a closed browser tab stops the reply on a real server, and check that Railway's proxy does not buffer SSE.
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
- `backend/.env.example` does not list `OPENAI_API_KEY` and `OPENAI_MODEL`; they are documented in `README.md`.
- The coordinate limit is enforced in the editor only by clamping the view.
- Two adjacent rooms from the wizard produce two overlapping walls.
- Commit author address in the published history is the user's personal one (published by the user's choice).
