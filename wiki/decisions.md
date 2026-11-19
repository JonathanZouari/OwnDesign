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
- **Working rules** in `CLAUDE.md`: plan first, plan on Opus 5.5 and execute with Sonnet 5.5 subagents (replaced Fable 5.2 on 2026-11-19), three kinds of tests, security review at every stage, commit per finished piece of code, subagents for specialist work, memory in `wiki/`.

## By Claude (open to change)

- **FastAPI**, managed with `uv`; **no-build frontend** with plain ES modules. Smallest stack that meets the PRD's "Python backend, HTML/CSS frontend".
- **All writes go through the backend with the service key; users have SELECT only.** The approved plan limited the service key to three operations. Widened so geometry validation and the audit trail cannot be bypassed through the Supabase Data API ([architecture.md](architecture.md)).
- **One JSON document per plan version**, in centimetres. The current plan is the latest version; no separate floor-plan table.
- **supabase-js is vendored**, not loaded from a CDN, with a `script-src 'self'` policy. Came out of the security review.
- **Product name "ATELIER"** in the UI, taken from Stitch. The PRD leaves the name undecided.
- **Later-phase widgets shown in Stitch are left out** (AI advisor, credits, budget, compliance badges) so the UI shows no fake data.
