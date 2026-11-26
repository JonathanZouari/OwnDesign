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

## Mobile web gaps

- **Not tested on real devices** or in Safari/WebKit. Pinch zoom and touch drag are covered only by Chromium emulation.
- On a short phone with the inspector sheet open, the canvas keeps only about 200 px, and the zoom buttons are hidden then (pinch still zooms).
- The drawer is on the design and consultant pages, although their project nav and sign-out are already visible there. It adds only the studio name.
- Same-page links in the drawer (`studio.html#clients`) scroll to the section, but focus returns to the menu button, not to the section.
- On phones the editor's visual order (canvas, sheet, rail at the bottom) differs from its focus order (rail first). This matters for keyboard and switch access.
- After crossing the phone breakpoint, focus on a rebuilt rail button is lost, and a wall being drawn keeps its preview line until the pointer lifts (it is then dropped).
- Disabled later-phase items in the drawer are plain spans with a `title`, which touch screens never show.
- Precision editing on phones (walls, doors, windows) is not offered. Revisit after user testing (PRD §155).

## Later phases with a Stitch screen waiting

Studio branding, project dossier and export, 3D renderings: designs are in
`design/stitch/` ([design.md](design.md)). Each is built as a real feature in its own phase.

## Before production

- Turn email confirmation on and configure SMTP. While it is off, someone can register with another person's address and it is shown to the designer as the client's email.
- Rate limiting on the API.
- `connect-src` in the content security policy, per environment.
- Railway deployment files and environments.
- Sign-out does not invalidate an already issued token before it expires.

## Smaller

- The wizard replaces an unsaved draft after a notice only; the portal's blank canvas asks first.
- The dashboard lists every project of the studio on one page; there is no paging yet.
- The dashboard's "no match" message is shown by un-hiding it, which some screen readers announce unreliably.
- `.area`, `.version` and `.wide` are global classes in `app.css` and are easy to collide with.
- Audit event ids are one sequence across all studios, so a member can infer overall event volume.
- Fonts load from Google, which exposes the visitor's IP address to Google.
- The coordinate limit is enforced in the editor only by clamping the view.
- Two adjacent rooms from the wizard produce two overlapping walls.
- Commit author address in the published history is the user's personal one (published by the user's choice).
