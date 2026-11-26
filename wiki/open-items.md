# Open items

Remove an item when it is resolved and note the resolution in [log.md](log.md).

## Needs a product decision

- **Deleting a client account** also deletes their projects, including versions a designer saved. The PRD leaves retention open.
- **Invites** never expire and are not bound to the invited email address.
- **Product name.** "ATELIER" comes from Stitch; the PRD says undecided.
- **PRD text** still says "no paid API", which the OpenAI decision overrides.
- **PRD 3.3** still excludes interactive 3D navigation, which the walkthrough decision overrides.

## Phase 2 gaps

- **Consultant retention and consent.** Conversations are kept without an expiry or a delete action; the brief and plan text go to OpenAI. A privacy notice and a retention rule are needed before production.
- **Spend and storage budgets.** The message cap is per user only; there is no per-studio or global ceiling, no per-studio storage quota (20 projects x 30 images x 5 MB per account), and nothing limits studios per user beyond one owned studio.
- **Thread pool.** The consultant call is synchronous and holds a worker for up to 30 s; many parallel requests could starve other routes. Move to an async client and an in-flight limit.
- **Orphaned image files.** Files of a deleted project or user are queued in `storage_deletions` and removed only the next time an asset is deleted. Needs a scheduled drain.
- **Delete-then-insert saves** of finishes and the moodboard are not atomic.
- **Studio dashboard** does not link project cards to the brief, finishes or moodboard; designers reach them through the editor.
- The editor has no link to the Phase 2 pages at 767 px and below.

## Studio branding

`branding.html` is a browser-only preview. Still needed: storage and a table for the logo and colours,
owner-only write endpoints with server-side image and colour validation, a tenant-isolation test, applying
the theme on the pages that show the studio, a link from the dashboard, and browser journeys.

From the review of pull request #8, not fixed: the contrast check accepts colours whose derived tokens fail
4.5:1 (text `#747474` on white passes, but the muted text it produces is 3.19:1), which matters once the check
decides what may be saved; the preview holds a second `h1` and a button and link that do nothing; the status
line is rewritten on every colour-picker move; a chosen logo has no pixel-size limit.

## 3D walkthrough gaps

- No collision with furniture, no ceiling, no catalog materials or colours.
- Each box is its own draw call; the largest plans the server accepts may be slow, especially on phones.
  Instancing would fix it. Frame rate on real phones is unmeasured.
- A lost WebGL context is not handled: leave the view and open it again.
- Possibly stuck walking on macOS if a key is released while Cmd is held (unverified).
- From the review of pull request #14, not fixed: holding W or D while leaving the 3D view can pick the wall or
  door tool (key repeat reaches the editor's shortcuts); the oversized-plan guard counts wall cuts, not boxes,
  so the largest legal plan is slow; a failure after the WebGL renderer is created leaks its context and is
  reported as "no WebGL"; if closing the view throws, the editor behind it stays inert; a furniture type named
  `constructor` gives a broken box (`Object.hasOwn` fixes it).

## Later phases with a Stitch screen waiting

Studio branding, project dossier and export, 3D renderings: designs are in
`design/stitch/` ([design.md](design.md)). Each is built as a real feature in its own phase.

## How we move

- **YOLOv8 is AGPL-3.0** (code and weights). Fine for this public course repository; a closed commercial
  product needs an Ultralytics Enterprise licence or another model.
- **Speed on phones is not measured.** One-thread WebAssembly; a 30-second video is 150 model runs. WebGPU or
  a smaller input size are the options if it is slow.
- **First trace downloads about 25 MB** (model and runtime), cached by the browser afterwards.
- **Not tested on a real video of a person**: the browser test stubs the runtime for the journey and runs the
  real model only on a drawn video with nobody in it.
- **Videos longer than 30 seconds** are refused in the browser; this branch of the code has no automated test.
- **The note limit (50 per path)** is checked in the API only; parallel requests can pass it by a few.
- Signed picture links expire after 10 minutes; reload the page to renew them.

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
