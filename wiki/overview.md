# Overview

Source: `Interior_Design_AI_PRD_EN.md`, `README.md`.

A multi-tenant web platform where an interior design studio invites clients, and the client and
designer work on the same floor plan. AI assistance comes in later phases.

## Built: Phase 1

- A designer signs up and opens a studio. One studio per owner.
- A client enters through the studio link, a personal invite link, or as a guest. The client portal
  (`entry.html`) offers guest or account access, and the wizard or a blank canvas as a starting point.
- A guided wizard builds the apartment from rooms and dimensions.
- A 2D editor (SVG): walls, partitions, doors, windows, generic furniture, undo/redo, pan/zoom, keyboard use.
- Every save adds an immutable version tagged `client` or `designer`.
- A guest's plan stays in the browser until they register and save.
- The studio dashboard (`studio.html`) shows metrics, project cards with a plan thumbnail, search,
  the studio link, invites and recent activity.
- One studio cannot see another studio's data ([security.md](security.md)).

## Built: Phase 2

- Design brief per project: styles (up to 5), colours, budget range and currency, household, lifestyle,
  needs, fixed constraints, existing items to accommodate (`design.html`).
- Finish selections per room and surface (floor, walls, ceiling, cabinets) from a fixed catalog of styles
  and materials.
- Inspiration and existing-item images (JPEG, PNG, WebP, 5 MB, 30 per project) in private storage, shown
  through short-lived signed URLs, and a moodboard of images, styles and materials with notes and order.
- AI consultant (`consultant.html`): OpenAI `gpt-5-mini`, answers from the project's brief, finishes and
  plan summary, recommends only and never edits the plan. One private conversation per user and project,
  30 messages per user per day.
- The client and the studio's designers see the same brief, finishes and moodboard; the conversation is
  private to the user who held it.

## Built: client tasks

- The studio's designer asks the client for something ("Measure the bedroom"), with optional details
  (`tasks.html`). The client marks it done with an optional note ("3.40 x 2.90 m") or undoes it; the designer
  sees the note, can reopen or delete. The projects list shows how many tasks are open per project.
  Built on the local branch `client-tasks`.

## Not built yet

Renderings, budget, dossier,
messaging, task deadlines and notifications, studio branding, invitation emails, per-project team permissions, deployment,
rate limiting, subscriptions and credits.

## Next

Per the PRD: renderings, version comparison, budget and shopping list, dossier and handoff, messaging, studio branding ([open-items.md](open-items.md) lists what must be settled before production).
