# Product Requirements Document (PRD)
## AI-Assisted Interior Design Platform for Clients and Interior Designers

**Version:** 1.1  
**Date:** November 19, 2026  
**Status:** Product requirements derived from 15 approved discovery decisions, with a subsequently requested repository and Railway deployment requirement.  
**Product name:** Not decided.  
**Decision policy:** Explicitly approved scope is distinguished from proposed implementation and unresolved decisions throughout this document.

## 1. Executive Summary

Build a responsive, multi-tenant SaaS platform enabling clients to plan and visualize residential properties before meeting an interior designer. The client can create a two-dimensional floor plan, change internal layouts and openings, arrange generic furniture, explore styles and materials, consult a conversational AI assistant, generate photorealistic visualizations, compare concepts, estimate costs, and hand over a structured design dossier. Interior designers receive branded workspaces in which they manage projects, edit plans, communicate with clients, add feedback and tasks, and manage revisions.

**Approved target clients:** (1) owners of existing homes planning renovations or redesigns; and (2) purchasers of new-build apartments who want to plan before moving in. Interior designers are the professional users and subscription customers; a public designer marketplace was not approved.

**Core business value:** Clients arrive with a meaningful design brief and a concrete initial proposal. Designers start from structured preferences and an editable project rather than an unstructured first meeting.

**Professional boundary:** Floor plans and renderings are conceptual. Client acceptance or AI output must never be represented as structural, architectural, engineering, regulatory, or construction authorization.

## 2. Approved Discovery Decisions: Questions 1–15

| Question | Approved choice | Resulting requirement |
|---|---|---|
| 1 — Target audience | A + B | Existing residential properties and new-build apartments. |
| 2 — Client capabilities | B + D + E + F + G | Editable 2D plan; style/material/furniture decisions; AI design options and visualizations; AI chat; handoff dossier. |
| 3 — Plan input | B + C | Manual interactive drawing and a guided room/dimension wizard. No approved automatic plan ingestion. |
| 4 — Editing scope | A + B + C + D | Furniture, partitions/layout, doors/windows and preliminary kitchens/bathrooms. |
| 5 — Full-product AI | A + B + C + D + F + G | Advice, alternative concepts, conversational edits, full-design proposals, approval before changes, preference adaptation. Automated design-rule checking was not selected. |
| 6 — Visualization | A + B + D + F + G | Photorealistic renderings, user-selected views, regeneration after 2D changes, moodboards and comparison. No interactive 3D walkthrough or 360° tour approved. |
| 7 — Design brief | A + B + C + D + E + F + G + H | Styles, colors/materials, budget, functional needs, household/lifestyle, physical constraints, inspiration images and existing items to accommodate. |
| 8 — Designer collaboration | A + B + C + E + F + G + H | Dossier, dashboard, plan editing, comments/approvals, messaging, tasks and versioning. No simultaneous real-time co-editing. |
| 9 — Products and costs | A + D + E + F + G | Generic furniture, finishes, AI product recommendations, estimated cost totals, shopping/product lists. No real-time commercial supplier catalog approved. |
| 10 — Entry | A + B + E | Personal invite, public designer link and guest trial (account required to save). |
| 11 — White label | A + B + C + F + G | Studio identity, visual customization, studio-specific URL, branded dossiers and templates. Custom domain not approved. |
| 12 — Business model | A + B + C + F | Designer monthly subscriptions, tiers, additional AI credits, trial period. Prices and payment workflow unresolved. |
| 13 — Governance | A + B + C + D + E + F | Tenant isolation, role permissions, project access control, professional review markings, audit trail, privacy/security. |
| 14 — Technology | A + F + G; written specification | Responsive web; Python; HTML/CSS; Supabase; Railway; no paid external AI/API integrations; build internally or leverage open source. No specific Python web framework or JS framework selected. |
| 15 — MVP | A + B + C + E + F + G + H | 2D/editor, design selection, AI consultant, AI rendering, designer workspace, budgets and white-label. Conversational geometric edits and in-app payment processing deferred. |

### 2.1 Additional Approved Implementation Requirement (Post-Discovery)

The repository must have **two separate top-level application directories: `frontend/` and `backend/`**. The architecture must be deployment-ready for **Railway** with **one Railway project** containing exactly **two named environments, `dev` and `production`, and two application services within each environment: `frontend` and `backend`**. The `dev` environment's services must be linked to Git branch **`dev`**; the `production` environment's services must be linked to Git branch **`main`**. This is a **specification for eventual provisioning**, not a claim that any Railway resource or Git branch has already been created. The user explicitly requested **PRD updates only**: no deployment configuration files, scaffolding, repository modifications, or live Railway setup are part of this deliverable.

## 3. MVP Scope and Phasing

### 3.1 Required in MVP

**MVP-01 — 2D planning.** Manual floor-plan editing and a guided wizard for rooms and dimensions, including walls, openings, rooms and furniture. Enable rearrangement and preliminary space planning, with persistence and reviewable plan versions.

**MVP-02 — Self-service design.** Style, color, finishes, generic furniture and moodboard selection, including comparison of design choices.

**MVP-03 — Conversational AI consultant.** Collect preferences, answer design questions, present alternative concepts and suggest furniture/material choices. In the MVP, the AI does not silently or automatically mutate the 2D plan through chat.

**MVP-04 — Visualizations.** Photorealistic images, selectable views, regeneration based on revised 2D designs, and alternative comparison. Render accuracy is an explicit feasibility gate; visual plausibility is not sufficient evidence of dimensional accuracy.

**MVP-05 — Designer workspace.** Tenant-scoped dashboard, project access, plan editing, comments and reviews, client messaging, task assignments, version history and dossier handoff.

**MVP-06 — Cost and products.** Generic item library, finishes library, AI suggestions, editable estimated costs, shopping list and product dossier. Do not imply live supplier prices or availability.

**MVP-07 — White-label workspace.** Designer/studio logo, names, fonts, colors, branded documents, templates and studio-specific URL.

**MVP-08 — Mandatory platform foundation.** Invitation and studio-link access, guest trial, tenant segmentation, RBAC, project authorization, audit events, privacy controls and professional-review labeling.

### 3.2 Approved for the Full Product but Deferred Beyond MVP

- AI-driven modifications of actual 2D geometry through chat, always requiring explicit user confirmation.
- Fully automated design proposals when they imply programmatic geometric plan changes rather than advisory concepts.
- Automated subscription and credit checkout. The subscription/credit business model is approved; the collection mechanism for launch is an unresolved decision.

### 3.3 Not Approved; Exclude Unless Reconsidered

Interactive 3D model navigation, 360° walkthroughs, public designer marketplace, simultaneous shared editing, automatic PDF/image floor-plan conversion, camera/LiDAR scanning, CAD/BIM imports, custom designer domains, vendor-maintained live product catalogs, designer-private supplier catalogs, and a separate AI automated planning-code compliance engine.

## 4. Personas, Roles and Access

**End client:** Uses a designer invitation or designer public link, optionally trials as guest, prepares a design brief, creates and edits a 2D property, explores concepts, receives AI guidance, requests images, manages a budget and communicates with the designer.

**Interior designer:** Manages assigned projects, inspects submitted dossiers, edits layouts, leaves comments, responds to the client, allocates tasks and publishes revisions.

**Studio owner/administrator:** Configures studio branding and studio-level membership and may administer subscriptions and permissions, subject to a final access matrix.

**Studio team member:** Access is limited according to a defined role and assigned projects. Exact role-permission combinations require specification before implementation.

**Guest:** May trial without registering; an account is required to persist a project. How long a guest session remains available and whether temporary browser storage is used remain undecided.

**Access invariant:** Authorization must be validated on the server and at the database/data-access layer, not inferred from a client-supplied URL or tenant identifier.

## 5. Primary User Journeys

### 5.1 Studio onboarding and branding

1. A designer creates a studio account.
2. The designer selects a branding template and enters company name, logo, palette and fonts.
3. The system makes a studio-specific entry URL available.
4. The designer invites an existing client or publishes the studio link.
5. The studio dashboard presents authorized projects and design dossiers.

### 5.2 Client self-design

1. The client follows a designer invite/studio link or starts a guest trial.
2. The client chooses the guided wizard or manual floor-plan editing.
3. The client enters rooms/dimensions and creates a coherent 2D property layout.
4. The client specifies style, finishes, budget, lifestyle, needs, fixed restrictions, inspiration images and existing items.
5. The client places furniture and experiments with internal partitions, doors/windows, kitchens and bathrooms.
6. The AI consultant explains options and generates conceptual alternatives without automatically altering plan geometry in the MVP.
7. The client requests rendering views, creates moodboards, compares versions and inspects estimated costs.
8. The client saves (registration required after guest trial) and submits a dossier for designer review.

### 5.3 Designer review loop

1. The designer opens the submitted dossier and corresponding editable plan.
2. The designer compares alternatives, edits the plan and posts comments and task requests.
3. The client receives project messages and completes assigned tasks.
4. New versions preserve history and distinguish client proposals from designer revisions.
5. Changes involving structural elements, openings, wet areas or critical building systems are labeled as provisional until reviewed by an appropriately qualified professional.

### 5.4 AI personalization

The consultant references project preferences and prior decisions within the authorized project context. Rejected concepts and selected alternatives inform subsequent recommendations. The precise persistence, consent and retention policy for conversation memory is open.

## 6. Functional Requirements and Acceptance Criteria

| ID | Requirement | Minimum acceptance criterion |
|---|---|---|
| FR-01 | Guided layout creation | User can add rooms with entered dimensions and review the resulting editable 2D plan. |
| FR-02 | Manual 2D editing | User can add/move/edit walls, partitions, openings and furniture; plan can be saved and restored. |
| FR-03 | Interior layouts | User can make conceptual changes to kitchens and bathrooms, with professional caveats. |
| FR-04 | Design brief | All approved question-7 categories can be captured, updated and associated with a project. |
| FR-05 | Materials and furniture | User can select finishes and generic furniture with editable attributes and dimensions. |
| FR-06 | AI advisor | AI can answer within the project context, propose options, and clearly distinguish recommendations from executed edits. |
| FR-07 | Render request | A rendering job records the related plan version, chosen view, status, result and any failure. |
| FR-08 | Version comparisons | User can inspect named/dated options and compare alternative visualizations and plans. |
| FR-09 | Moodboards | User can assemble and save an inspiration board per project. |
| FR-10 | Budget | User can associate estimates with items/materials and view a total; estimates are marked non-binding. |
| FR-11 | Shopping dossier | User can export or present a structured list of selected generic furniture/materials and estimated costs. |
| FR-12 | Designer dashboard | Designer can access only projects authorized for the relevant studio and user. |
| FR-13 | Review and tasks | Designer and client can exchange messages, annotations, decisions and task statuses. |
| FR-14 | Handoff | System packages the saved plan, client brief, selected concepts, renderings, cost summary and revision metadata into a dossier. |
| FR-15 | White label | Studio-specific branding appears in relevant client screens and generated dossier outputs. |
| FR-16 | Trial and invitations | Studio invite and public studio link are supported; guest cannot persist a project without registration. |
| FR-17 | Audit and tenant isolation | Access and major changes are attributable and one studio cannot query another studio's protected records. |
| FR-18 | Subscription/credit model | Domain entities and usage accounting support plan tiers, free trial and credit grants/consumption without presupposing in-app checkout for the MVP. |
| FR-19 | Professional safety | Major changes are visibly flagged as conceptual and cannot be mistaken for approval to construct. |

**Deferred functional acceptance:** A conversational command that moves a wall or sofa and commits geometric changes to the plan belongs to post-MVP scope and must require explicit user confirmation.

## 7. Screens and UX Inventory

**Client-facing:** Designer-branded entry page; guest session; sign-in/registration for save; project setup; guided dimensions wizard; manual 2D editor; design brief; styles and finishes; furniture library; AI consultant; rendering generation/status/gallery; moodboard; version comparison; cost estimator/shopping list; task inbox; messaging; dossier preview and handoff.

**Designer-facing:** Studio onboarding; branding editor/templates; dashboard; project list; client/project details; editable 2D plan and variants; annotations and approvals; messages; task board; dossier review; account and subscription/credit usage overview.

**Platform/admin:** Tenant configuration, service health, logging and access oversight as needed. Specific platform operator screens and admin powers remain to be designed, and are not presumed approved product features.

**Accessibility and responsiveness:** Web use on desktop, tablet and phone is approved. Full precision-editing behavior on small mobile screens remains a UX decision; avoid promising parity without user testing.

## 8. Conceptual Data Model (Proposed, Not an Approved Schema)

| Entity | Responsibility / key fields |
|---|---|
| `studios` | Tenant identity, display name, URL slug, status. |
| `studio_branding` | Studio branding template, logo reference, colors, typography settings. |
| `users` | Auth identity and profile reference. |
| `studio_memberships` | Studio-user relation, role, membership state. |
| `projects` | Studio-scoped project, client link, lifecycle state. |
| `project_permissions` | Explicit user/project role and permission grants. |
| `project_briefs` | Style, household, constraints, budget and needs. |
| `floor_plans` | Canonical structured 2D geometric representation. |
| `plan_versions` | Immutable or versioned geometry snapshots, authors and change labels. |
| `rooms` / `walls` / `openings` | Geometric primitives or normalized projections as selected by design. |
| `furniture_instances` | Generic furniture type, dimensions, transform and attributes. |
| `finish_selections` | Room/surface material selections. |
| `inspiration_assets` | User-provided inspiration and moodboard media. |
| `design_alternatives` | Named design concepts and associated version IDs. |
| `ai_conversations` / `ai_messages` | Project-bounded AI discussions, approvals and context. |
| `render_jobs` / `render_assets` | Input version, view settings, processing status, outputs and provenance. |
| `estimate_items` | Quantity, basis, unit estimates, amount and estimation status. |
| `shopping_lists` | Organized product and material selections. |
| `project_messages` | Designer–client communication. |
| `review_comments` / `review_decisions` | Comments and professional statuses. |
| `project_tasks` | Assignments, assignees, deadlines if later defined, states. |
| `design_dossiers` | Snapshot and exported report artifacts. |
| `subscriptions` / `plans` | Tier, active period and entitlements. |
| `credit_ledgers` | Credit allocations, debits, audit and correlation to AI jobs. |
| `audit_events` | Actor, tenant/project, action, timestamp and relevant metadata. |

**Data architecture recommendations:** Every tenant-owned record must be linked to the relevant `studio_id` directly or via an enforceable ownership chain. Use Supabase/PostgreSQL authorization policies and server-side checks; ensure object storage also respects tenant boundaries. Design the canonical plan representation so 2D geometry, plan versions and render inputs refer to the same project state.

**Unresolved schema choices:** JSON vs normalized geometry, coordinate system and measurement units, exact foreign keys/indexes, plan synchronization strategy, retention/deletion timelines, and full RLS policies.

## 9. Architecture and Technical Constraints

### 9.1 Approved stack and restrictions

- Responsive web application.
- Python server-side application code.
- HTML and CSS presentation stack (supporting browser scripting requirements to be resolved during technical design).
- Supabase for storage/database/auth capabilities as applicable.
- Railway for web/service hosting and deployment.
- No paid third-party API integrations. Build internally or use eligible open-source components; verify commercial licensing before adoption.

**Not selected:** FastAPI, Flask, Django, React, Next.js, a specific 2D engine, image generator, language model, GPU provider, CI service, payment processor or hosting arrangement for inference.

### 9.2 Required monorepo separation

A single Git repository should be organized around **two distinct application roots**, so client-facing and backend services can be developed, tested and deployed independently:

```text
repository-root/
├── frontend/        # Client web UI, browser-based 2D editing, assets
├── backend/         # Python application, application APIs, orchestration
└── [shared repository-level documentation/configuration as needed]
```

This tree is **normative at the application-root level only**. It does **not** mandate a particular framework, exact filenames, source layout, deployment manifest or Dockerfile. The frontend–backend interaction boundary should be explicit, versioned and contract-tested. Secrets and service-role credentials must never be embedded into frontend bundles.

### 9.3 Railway project and environment topology — explicit requirement

**Target Railway topology:** exactly one project with two environments named **`dev`** and **`production`**. Each environment must contain **two separately deployable application services** named **`frontend`** and **`backend`**. Target deployments are therefore:

| Railway environment | Service | Repository source directory | Tracking Git branch |
|---|---|---|---|
| `dev` | `frontend` | `/frontend` | `dev` |
| `dev` | `backend` | `/backend` | `dev` |
| `production` | `frontend` | `/frontend` | `main` |
| `production` | `backend` | `/backend` | `main` |

**Railway provisioning acceptance conditions:**

1. There is one Railway project, not separate projects per environment.
2. The Railway environments are named exactly `dev` and `production`.
3. Each environment has exactly one application service named `frontend` and one named `backend` (four application-service instances across the two environments).
4. Both `dev` services deploy from the GitHub `dev` branch; both `production` services deploy from `main`.
5. `frontend` and `backend` services use their respective repository root directories for build/deploy context, with configuration appropriate for the chosen implementation.
6. Each environment has its own runtime configuration and secret values. Production secrets and data must not be reused for development by default.
7. Each frontend routes API traffic to its matching environment backend; cross-environment coupling is prohibited.
8. Only production services are exposed through approved public production URLs. Exact hostnames and any desired development exposure remain to be decided.
9. Deployments must expose appropriate readiness/health mechanisms and observable failures; exact endpoints and commands depend on the eventual frameworks.
10. A documented rollback mechanism is required before production use. The method remains a technical decision.

**Branch mapping is a deployment requirement:** it is not enough to create matching branch names. Each of the four Railway services must actually have the correct repository, source path and branch/deployment configuration. Verify deploy behavior on pushes to `dev` and `main`, including that pushes do not accidentally update the other environment.

**No execution claim:** Railway project creation, service provisioning, environment setup, GitHub linking and branch mapping are **not performed by this PRD**. No Railway deployment files or source folders are being generated in this document-delivery step.

### 9.4 Environment variables and secrets (Specification only)

Plan for environment-specific variables for database connectivity, authentication, allowed origins, storage configuration, inference endpoints/model references, message/job processing, credit accounting and observability. Final variable names and values must be derived from selected frameworks and security design. Avoid putting server secrets in the frontend, logs or repository. Determine whether `dev` and `production` use separate Supabase projects or another demonstrably isolated arrangement; this has **not** yet been approved.

### 9.5 Open-source AI execution

Separate AI responsibilities into a **text consultation pipeline** and **render generation pipeline**. The Python backend authenticates and authorizes requests, reads the applicable project snapshot, assembles constrained context, dispatches inference work, records result provenance and enforces quotas/credit usage. Rendering jobs should be queued or handled asynchronously so interactive requests are not blocked by long image generation.

**Critical feasibility constraints:** License, model size, latency, quality, safety, GPU/CPU availability, per-render cost and data-processing location must be validated before selecting models. “No paid API” does not mean that GPU compute, bandwidth, storage or Railway capacity will be free. A specific self-hosted GPU/runtime strategy has not been selected.

**Geometric truth:** The saved 2D plan—not a free-form generative image—must be the canonical source for dimensions and relative placement. Every rendering should record its input plan version and viewpoint. Evaluate generated outputs against a geometry/consistency test set; do not promise exact geometric fidelity without verification.

## 10. Security, Privacy and Professional Review

- Tenant isolation and least-privilege RBAC for users, teams and projects.
- Protected access to user-provided property information, design images, budgets and chats.
- Audit changes, approvals, render requests, important system operations and credit consumption.
- Apply appropriate encryption in transit/at rest and secret-management practices.
- Define privacy notices, consent for AI processing, data deletion and export, retention policies and backup/recovery before launch.
- Explicitly label consequential geometry/opening/kitchen/bathroom modifications as conceptual pending review by a qualified professional.
- Client approval of an AI-assisted choice is not professional engineering sign-off.
- MFA was **not selected** in discovery; it may be recommended later but should not be silently listed as an approved feature.

## 11. Nonfunctional Requirements: Targets to Validate (Not Yet Approved)

**Performance:** The 2D editor should remain responsive for realistic residential floor plans. Set measurable frame rate and operation latency after representative test-plan profiling.

**Reliability:** Rendering requests must have inspectable queued/running/failed/completed states, retries where safe, and no duplicate credit charges on idempotent retries.

**Scalability:** The application should isolate potentially expensive AI inference from ordinary web/API traffic. Concurrency and infrastructure sizing depend on trial usage metrics.

**Portability:** Open-source/self-hosted AI dependencies and generated outputs should not force reliance on proprietary paid inference APIs.

**Accessibility:** Support keyboard use and accessible forms/navigation where feasible; exact WCAG target to be agreed.

**Localization:** Current approved UX language(s) were not explicitly selected in the 15 questions; do not assume Hebrew/English localization requirements from the language of this PRD.

**Observability:** Service status, application errors, requests, render jobs and user-impacting deployment failures should be auditable without disclosing private user content or secrets.

## 12. Acceptance Tests / QA Scenarios

1. A guest uses a designer-linked entry point, draws a room, but is prompted to register before persisting the project.
2. A client creates a multi-room property via the wizard and can move a door, partition and furniture item; saving/reloading preserves geometry.
3. An AI response suggests a layout but does not automatically edit the MVP plan.
4. A user requests a rendering from a specified plan version and camera view, and receives a result linked to the request.
5. After a plan change, a new rendering references the updated version, while previous versions remain inspectable.
6. A designer receives a dossier and creates a review comment and task; the authorized client can view and respond.
7. A user of Studio A cannot read or mutate Studio B's floor plans, renderings, messages, dossiers or budget records through API or direct data routes.
8. Brand settings from Studio A do not appear in Studio B's client-facing experience.
9. Budget amounts are described as estimates rather than verified retailer prices.
10. A proposed wall/opening change visibly requires appropriate professional review before any construction claim.
11. The `dev/frontend` and `dev/backend` deployments target `dev`; both `production` deployments target `main`, and neither cross-deploys on pushes to the other branch.
12. Each environment's frontend points only to its corresponding backend, and environment-specific secrets remain isolated.

## 13. Major Risks and Mitigations

| Risk | Impact | Mitigation / gate |
|---|---|---|
| Photorealistic AI output ignores floor-plan geometry | High | Early technical proof of concept, plan-version provenance, visual/geometry QA, clearly indicate conceptual imagery. |
| Open-source inference requires expensive or unavailable compute | High | Benchmark candidate models, validate license and realistic costs; decide an inference-hosting strategy before delivery commitment. |
| 2D editor complexity / inaccurate dimensions | High | Canonical coordinate model, deterministic geometry validation, test fixtures, undo/versioning. |
| Tenant data exposure | Critical | Dedicated authorization design, RLS/server authorization, cross-tenant security tests. |
| AI or project outputs are mistaken for construction plans | High | Strong product language, review flags and professional approval process. |
| Budget estimates are inaccurate | Medium | Disclose estimate assumptions, allow edits, avoid claims of live vendor pricing. |
| Branch/environment misconfiguration | High | Four-service deployment topology audit, branch push verification, separate environment variables and rollback tests. |
| Scope creep in MVP | High | Freeze acceptance criteria; defer conversational 2D edits and integrated payments. |
| Undefined payment collection despite approved monetization | Medium | Agree on interim billing and entitlement operations prior to commercial launch. |

## 14. Suggested Delivery Sequence (Not an Approved Schedule)

**Phase 0 — Technical validation:** Evaluate a 2D editor approach and the fidelity/cost of self-hosted rendering. Verify model licensing and compute constraints.

**Phase 1 — Core experience:** Set up planned frontend/backend separation, Supabase data model and basic studio/client authentication; deliver editor, wizard and project persistence.

**Phase 2 — Design assistance:** Capture briefs, style and material choices, generic furniture, moodboards and AI design consultation.

**Phase 3 — Rendering and budgeting:** Add rendering jobs, version comparison, cost estimates and dossier generation.

**Phase 4 — Designer operations:** Designer dashboard, editing, comments, messaging, tasks, review/version workflows and white-label settings.

**Phase 5 — Deployment readiness and pilot:** Implement repository branch policy and Railway four-service/two-environment topology, test tenant isolation, operational readiness, demo/pilot projects and acceptance criteria.

**Post-MVP:** Consider confirmed full-product AI geometry edits and automated payments after reliability, safety and business feasibility are validated.

## 15. Suggested Success Metrics (Require Approval)

- Percent of invited clients who create and save a floor plan.
- Percent who complete a design brief and submit a dossier.
- Average time to first usable plan and first acceptable visualization.
- Rendering consistency acceptance rate and rendering cost per completed design.
- Designer reuse across projects and client satisfaction.
- Number of revisions before designer acceptance.
- Cross-tenant access incidents (target zero) and unresolved service incidents.
- Trial-to-paid studio conversion and usage per pricing tier.

No numeric KPI thresholds have been approved.

## 16. Outstanding Decisions

1. Confirm exact frontend technology and Python web framework while honoring HTML/CSS/Python preferences.
2. Select the 2D geometric engine and canonical schema; coordinate units, snapshots and plan export format.
3. Validate open-source LLM and image model choices and their commercial licenses; choose inference hardware/hosting.
4. Define acceptable geometric fidelity between the plan and generated images.
5. Define studio/client RBAC matrix, account registration mechanism and guest-session retention.
6. Define whether development and production use separate Supabase projects, credentials and storage resources.
7. Establish final Railway project name, service domain names, availability constraints, environment-specific variables, healthchecks and deployment/rollback policy.
8. Decide whether GitHub repository and `dev` / `main` branches already exist, or must be created in a separate execution step.
9. Specify backend API contracts and authentication approach between frontend and backend.
10. Determine how AI credits are priced, granted, deducted, refunded on failure and accounted for without integrated MVP checkout.
11. Approve pricing tiers, trial duration and interim invoice/payment collection process.
12. Determine source and update process of generic furniture dimensions, materials and cost benchmarks.
13. Define data retention, data export, consent, incident response and backup policies.
14. Approve UX designs, required localization, accessibility targets and mobile editing constraints.
15. Confirm operational/ownership details for production Railway and GitHub connections when implementation is authorized.

## 17. Definition of Ready / Definition of Done

**Ready to implement first vertical slice:** An agreed technology spike demonstrates geometry save/load, project isolation and workable frontend/backend communication, with documented unresolved AI constraints.

**MVP ready for pilot:** All MVP acceptance criteria pass, core designer/client handoff works, security tests establish tenant isolation, rendering feasibility is demonstrated for representative properties, and professional caveats are visible.

**Deployment requirement complete:** In the actual linked Railway account—not merely in prose—the one project, two environments, four application services and branch mappings have been created and verified; `dev` targets `dev`, `production` targets `main`; production/development secrets are separated. This milestone is for a later implementation task and **has not been performed**.

---

**Document scope note:** This PRD intentionally contains **no created Railway config files, Dockerfiles, code scaffold, or live provisioning changes**. It adds the requested architecture and deployment topology as formal requirements only.
