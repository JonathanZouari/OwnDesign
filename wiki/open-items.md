# Open items

Remove an item when it is resolved and note the resolution in [log.md](log.md).

## Needs a product decision

- **Deleting a client account** also deletes their projects, including versions a designer saved. The PRD leaves retention open.
- **Invites** never expire and are not bound to the invited email address.
- **Product name.** "ATELIER" comes from Stitch; the PRD says undecided.
- **PRD text** still says "no paid API", which the OpenAI decision overrides.

## Before production

- Turn email confirmation on and configure SMTP. While it is off, someone can register with another person's address and it is shown to the designer as the client's email.
- Rate limiting on the API.
- `connect-src` in the content security policy, per environment.
- Railway deployment files and environments.
- Sign-out does not invalidate an already issued token before it expires.
- A signed-in user can set a new password (`auth.html?mode=reset`) without entering the current one. Consider Supabase's "secure password change" (reauthentication) before production.
- Production `site_url` and redirect allowlist (`auth.html`, `auth.html?mode=reset` on the real https origin) in `supabase/config.toml`.

## Smaller

- Fonts load from Google, which exposes the visitor's IP address to Google.
- The editor's sign in/out button is hidden on phones.
- The coordinate limit is enforced in the editor only by clamping the view.
- Two adjacent rooms from the wizard produce two overlapping walls.
- Commit author address in the published history is the user's personal one (published by the user's choice).

## PDF import

- The drawing stays in this browser only (IndexedDB). Server storage (private Supabase Storage) so it follows the account across devices.
- Imported drawings are not removed from IndexedDB on sign-out or project deletion (shared-computer privacy).
- Detection on real drawings (after step 2b): about 80 % of walls found on a real 1:20 sheet; furniture drawn as long double lines can still read as thick walls (step 3); the scale suggestion is a heuristic the user confirms; a title block with no frame or table needs the manual plan area.
- Curved walls, doors and windows are not detected.
