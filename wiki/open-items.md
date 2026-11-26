# Open items

Remove an item when it is resolved and note the resolution in [log.md](log.md).

## Needs a product decision

- **Deleting a client account** also deletes their projects, including versions a designer saved. The PRD leaves retention open.
- **Invites** never expire and are not bound to the invited email address.
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

## Plan export

- **The spec's product decisions are a proposal** until the owner accepts them ([decisions.md](decisions.md)).
- **DXF not yet opened in a CAD program.** The Homebrew LibreCAD cask is disabled (Gatekeeper); the automated tests read the file back with ezdxf only.
- **Activity can be flooded.** Every export adds an audit row and there is no rate limit, so a client can push other events out of the dashboard's latest ten.
- **Export limits are per process.** With several workers, the two-slot and one-per-user limits multiply. An A3 PNG peaks at a few hundred MB.
- **The event is written before the download finishes**, so a client that disconnects mid-download is still recorded.
- **A Hebrew project name gives the file name `plan-vN`**; `filename*=UTF-8''…` would keep it.
- **Scripts other than Hebrew and Latin** (Arabic, Cyrillic) show as empty boxes: Heebo does not cover them.
- **Opening within 1 cm of a wall end** drops the square cap there, so a corner can show a small notch.
- **Room label position** is the room's centre, not the editor's `min(h/2, 60)` from the top.
- **Flaky browser tests**: see [testing.md](testing.md).

## Later phases with a Stitch screen waiting

Studio branding, project dossier and export, 3D renderings: designs are in
`design/stitch/` ([design.md](design.md)). Each is built as a real feature in its own phase.

## Before production

- Turn email confirmation on and configure SMTP. While it is off, someone can register with another person's address and it is shown to the designer as the client's email.
- Rate limiting on the API.
- `connect-src` in the content security policy, per environment.
- Railway deployment files and environments.
- Sign-out does not invalidate an already issued token before it expires.

## CI

- **The CI secret key is not set yet**, so `backend` fails in its first step. The user creates a secret key named `ci` in Supabase and stores it as `SUPABASE_SECRET_KEY` in the environment `ci`.
- Make the check required on `main` after some stable runs.
- A separate Supabase project for CI: today CI and local runs share the dev project and delete each other's test accounts.
- Repository settings: allow-list the three actions and require pinning by hash.
- Smaller review notes, not done: the guard step reads the secret values where a presence flag would do; a failed assertion can print a test account's email or part of a token; lint, type check and coverage are not in CI.

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
