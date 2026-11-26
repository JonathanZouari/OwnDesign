# Open items

Remove an item when it is resolved and note the resolution in [log.md](log.md).

## Needs a product decision

- **Deleting a client account** also deletes their projects, including versions a designer saved. The PRD leaves retention open.
- **Product name.** "ATELIER" comes from Stitch; the PRD says undecided.
- **PRD text** still says "no paid API", which the OpenAI decision overrides.

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
`design/stitch/` ([design.md](design.md)). Each is built as a real feature in its own phase.

## Before production

- **Turn email confirmation on and configure SMTP (Resend: `smtp.resend.com`).** The invite identity check depends on it: while confirmation is off, Supabase marks every new address as confirmed, so someone can register with the invited client's address and accept the invite. `supabase/config.toml` still holds the dev value.
- Rate limiting on the API.
- `connect-src` in the content security policy, per environment.
- Railway deployment files and environments. Each environment needs its own Supabase project, `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL`; dev must not be able to email real clients (a test sender, or a Resend key limited to approved recipients).
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
- The coordinate limit is enforced in the editor only by clamping the view.
- Two adjacent rooms from the wizard produce two overlapping walls.
- Commit author address in the published history is the user's personal one (published by the user's choice).
- Clients who joined through the studio link before 2026-11-26 keep their projects but need a personal invite to start a new one.
- Invite email text includes the studio and client names, which users choose. They are escaped, but a phishing-style studio name would still reach the client from our sender. Consider a subject without the studio name, or reviewing studio names.
- The email hero image (`frontend/img/email-hero.jpg`) bakes in the logo; regenerate it if the logo or photo changes.
