# Decisions

Each line: the decision, who made it, why. Dates are in [log.md](log.md).

## By the user

- **Phase 1 first**, later phases afterwards.
- **AI through Groq's free tier** (decided 2026-11-25; it replaces the first choice, OpenAI). PRD 9.1 says "no paid third-party API integrations"; OpenAI was paid and overrode it, Groq's free tier does not. It is still a hosted third-party service, not an open-source model run by the project. The consultant that upstream added (merged in on 2026-11-26) still uses paid OpenAI, so the product as a whole does not yet follow PRD 9.1 ([open-items.md](open-items.md)). If the free tier is outgrown, a paid plan would bring the conflict back, so that is a decision to take then ([open-items.md](open-items.md)). The advisor's model is `openai/gpt-oss-120b`, chosen by the user from the models in the Groq console for this account (the first choice, `llama-3.3-70b-versatile`, is not available to it: HTTP 404). If its Hebrew proves poor in the live check, the user decides on a change; Claude does not switch models.
- **Reasoning guard for gpt-oss models** (decided 2026-11-25 by the user): `reasoning_effort="low"`, sent only to models whose ID starts with `openai/gpt-oss`, and `MAX_REPLY_TOKENS` raised from 1000 to 4000, so reasoning cannot use up the reply ([advisor.md](advisor.md)).
- **English-only UI** (left to right).
- **Cloud Supabase**, in a new organisation created for this product.
- **UI follows the Stitch project** "AI Interior Design Platform" ([design.md](design.md)).
- **GitHub repository is public.** The user chose to publish with the existing commit author address.
- **Stitch screens for later phases stay as references** in `design/stitch/`; the two that match Phase 1 (client portal, studio dashboard) are built with real data only.
- **Working rules** in `CLAUDE.md`: plan first, Fable 5.2, three kinds of tests, security review at every stage, commit per finished piece of code, subagents for specialist work, memory in `wiki/`.
- **Advisor: the conversation is not saved** in the database for now. Retention and consent stay open ([advisor.md](advisor.md)).
- **Advisor: only the client who owns the project** can use it; the studio's designers cannot.
- **Advisor: its own page** `advisor.html`, reached from a tab in the editor.
- **Advisor notice says what goes to Groq:** each question, the earlier messages, and the project's name, type, room names and room types. It also says OwnDesign does not save the conversation.
- **Advisor: no question, history or reply text in any log or audit row**, enforced by a test.
- **Advisor RTL styles stay on the advisor page** (`frontend/css/advisor.css`, all under `body.advisor`; `app.css` unchanged), because another team owns Hebrew RTL.
- **`apiStream` in `frontend/js/api.js`** carries the advisor's streaming request, so token handling and error envelopes stay in one place. It was not in the first plan; the user approved it.
- **Advisor pull requests** first went to the user's own fork, base branch `dev` (PRs #1 and #2), and `main` is untouched. The pull request to the upstream repository (`JonathanZouari/OwnDesign`, base `dev`, where all its open pull requests go) is opened as a **draft** (decided 2026-11-26) and only after the owner approves the text.
- **Keep both AI features** (decided 2026-11-26): the streaming Groq advisor and upstream's saved-chat OpenAI consultant stay side by side. The draft pull request states the overlap so its author decides whether to merge, replace or fold one into the other. The advisor's page, tab and messages are named "AI Advisor" so the two do not share a name ([advisor.md](advisor.md)).
- **Upstream's four Phase 2 migrations were applied as written** (decided 2026-11-26) to the project linked to the Supabase CLI, after a database review with no critical or high finding. The reviewer's suggested edits were not made, because they are upstream's files; they are in [open-items.md](open-items.md). Before applying, the owner checked in the dashboard that the project has no storage policies.
- **The editor header overflow is accepted** (decided 2026-11-26): the "AI Advisor" tab makes the header overflow sideways by 38 px at about 900 px wide. The owner chose to record it as an open item and not to edit the shared stylesheet.
- **Keep the `openai` Python package** as the client, pointed at Groq's OpenAI-compatible endpoint. Only the setting names changed (`GROQ_API_KEY`, `GROQ_MODEL`); no new dependency.

## By Claude (open to change)

- **FastAPI**, managed with `uv`; **no-build frontend** with plain ES modules. Smallest stack that meets the PRD's "Python backend, HTML/CSS frontend".
- **All writes go through the backend with the service key; users have SELECT only.** The approved plan limited the service key to three operations. Widened so geometry validation and the audit trail cannot be bypassed through the Supabase Data API ([architecture.md](architecture.md)).
- **One JSON document per plan version**, in centimetres. The current plan is the latest version; no separate floor-plan table.
- **supabase-js is vendored**, not loaded from a CDN, with a `script-src 'self'` policy. Came out of the security review.
- **Product name "ATELIER"** in the UI, taken from Stitch. The PRD leaves the name undecided.
- **Later-phase widgets shown in Stitch are left out** (credits, budget, compliance badges, cost and floor-plan panels in the AI consultant screen) so the UI shows no fake data. The advisor and the consultant are both built with real data only.
- **Advisor is streaming only.** No separate non-streaming endpoint: it would duplicate the logic.
- **The page sends its own recent turns** (up to 10) with each question, because the server stores nothing.
- **Groq's rate limit (429) is shown as a friendly "busy" message** with its own error code `rate_limited`, not as the generic failure, because it is a wait-and-retry condition. The provider's error text is never forwarded. No automatic retry (`max_retries=0`), as before.
- **Daily advisor quota of 50 questions per user** is a stopgap cost guard that overlaps the "AI cost budget" team's work ([open-items.md](open-items.md)).
- **Phase 2 data model:** the brief is one JSON document per project; finishes and the moodboard are saved as a whole set (delete then insert, not atomic, saving again recovers).
- **Consultant memory policy** (PRD 5.4 leaves it open): messages are stored per project and user, private to that user, capped at 30 a day per user. A failed OpenAI call still uses a slot because it may have been billed.
- **Images go through the backend**, not directly to storage, so type, size, count and access are checked in one place.
