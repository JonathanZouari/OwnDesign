# Decisions

Each line: the decision, who made it, why. Dates are in [log.md](log.md).

## By the user

- **Phase 1 first**, later phases afterwards.
- **AI through OpenAI API calls.** This overrides the PRD's "no paid API" constraint. The PRD text has not been updated.
- **English-only UI** (left to right).
- **Cloud Supabase**, in a new organisation created for this product.
- **UI follows the Stitch project** "AI Interior Design Platform" ([design.md](design.md)).
- **GitHub repository is public.** The user chose to publish with the existing commit author address.
- **Stitch screens for later phases stay as references** in `design/stitch/`; the two that match Phase 1 (client portal, studio dashboard) are built with real data only.
- **Working rules** in `CLAUDE.md`: plan first, Fable 5.2, three kinds of tests, security review at every stage, commit per finished piece of code, subagents for specialist work, memory in `wiki/`.
- **Tests run in GitHub Actions**, the Supabase-backed ones included. The three Supabase values are kept as secrets of the GitHub environment `ci`; this is the one approved exception to "secrets only in git-ignored files".
- **A separate Supabase secret key for CI**, created and entered by the user, so it can be revoked without breaking local work.
- **The CI check reports only.** No branch protection for now.


## By Claude (open to change)

- **FastAPI**, managed with `uv`; **no-build frontend** with plain ES modules. Smallest stack that meets the PRD's "Python backend, HTML/CSS frontend".
- **All writes go through the backend with the service key; users have SELECT only.** The approved plan limited the service key to three operations. Widened so geometry validation and the audit trail cannot be bypassed through the Supabase Data API ([architecture.md](architecture.md)).
- **One JSON document per plan version**, in centimetres. The current plan is the latest version; no separate floor-plan table.
- **supabase-js is vendored**, not loaded from a CDN, with a `script-src 'self'` policy. Came out of the security review.
- **Product name "ATELIER"** in the UI, taken from Stitch. The PRD leaves the name undecided.
- **Phase 2 data model:** the brief is one JSON document per project; finishes and the moodboard are saved as a whole set (delete then insert, not atomic, saving again recovers).
- **Consultant memory policy** (PRD 5.4 leaves it open): messages are stored per project and user, private to that user, capped at 30 a day per user. A failed OpenAI call still uses a slot because it may have been billed.
- **Images go through the backend**, not directly to storage, so type, size, count and access are checked in one place.
- **Later-phase widgets shown in Stitch are left out** (AI advisor, credits, budget, compliance badges) so the UI shows no fake data.
- **Pull requests never get secrets**; the full suite runs on push to `dev`/`main` only ([testing.md](testing.md)). Came out of the security review of the CI plan.

## From merged pull requests

Made by outside contributors in their own forks and accepted when the owner had the pull request merged.
A pull request's wiki text may say "the user": that is the contributor's own user, never this project's owner.
Such lines are moved here and reworded when the pull request is merged.

- **A 3D walkthrough in the plan editor** (pull request #14), first person rather than a rotating or isometric
  view. It goes against PRD 3.3, which excluded interactive 3D navigation; the PRD text has not been updated.
- **three.js, vendored**, for the walkthrough, with controls written here (pull request #14). Its ready-made
  controls need an import map, which the `script-src 'self'` policy would block as an inline script.
- **Room scan with YOLOv8n in the backend (ONNX, CPU).** The user asked for YOLOv8. ONNX keeps PyTorch out of
  production; the server keeps the existing upload checks in one place. Detections are only suggestions: the
  person confirms each item before it is listed. Items are a structured table, not the brief's free-text field.
- **Inspiration images will be characterised with YOLOv8 plus a colour palette** (user's choice, 2026-11-26),
  after the room scan ships; no style name from the model.
- **Inspiration analysis in the upload request**, best effort. Simpler than a job queue; the cost is about 0.2 s
  per upload and a shared 2-slot limit with room scans. An image left without an analysis gets an "Analyse"
  button.
