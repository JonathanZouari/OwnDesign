# Decisions

Each line: the decision, who made it, why. Dates are in [log.md](log.md).

## By the user

- **Phase 1 first**, later phases afterwards.
- **AI through OpenAI API calls.** This overrides the PRD's "no paid API" constraint. The PRD text has not been updated.
- **Homeowner first** (2026-11-19): Phase 1 serves a homeowner or new-build buyer designing on their own, without a studio. Studio features stay in the code but are hidden from the UI until a later phase. Guests can start without an account and sign up to save.
- **Hebrew-only UI, right to left** (2026-11-19, replaces "English-only UI"). Strings set from JS live in one module so another language can be added later.
- **Cloud Supabase**, in a new organisation created for this product.
- **UI follows the Stitch project** "AI Interior Design Platform" ([design.md](design.md)).
- **GitHub repository is public.** The user chose to publish with the existing commit author address.
- **Stitch screens for later phases stay as references** in `design/stitch/`; the two that match Phase 1 (client portal, studio dashboard) are built with real data only.
- **Working rules** in `CLAUDE.md`: plan first, plan on Opus 5.5 and execute with Sonnet 5.5 subagents (replaced Fable 5.2 on 2026-11-19), three kinds of tests, security review at every stage, commit per finished piece of code, subagents for specialist work, memory in `wiki/`.

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
- **No automatic room detection from PDF plans** (2026-11-20). It did not work well enough on real drawings; the user cancelled it. Walls and furniture import stay; the room outline schema and editor kind buttons are kept.
- **Shopping list is synthetic** (user, 2026-11-26): the course task assumes the list is received ready; no
  supplier catalog and no AI pricing. Prices are shown as non-binding. Also chosen by the user: editable prices
  and quantities, comparison with the brief budget, CSV and print export, then CSV import.
- **The whole UI is Hebrew** (user, 2026-11-26), catalog labels included; ids stay English.
- **Budget goes upstream as its own pull request, in English** (user, 2026-11-26); `dev` is pushed as usual.
