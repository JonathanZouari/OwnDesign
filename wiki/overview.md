# Overview

Source: `Interior_Design_AI_PRD_EN.md`, `README.md`.

A multi-tenant web platform where an interior design studio invites clients, and the client and
designer work on the same floor plan. AI assistance comes in later phases.

**Current focus (user decision, 2026-11-19):** a homeowner or new-build buyer designs on their own,
without a studio. The studio features below are built but hidden from the UI for now
([decisions.md](decisions.md)).

## Built: Phase 1

- A designer signs up and opens a studio. One studio per owner.
- A client enters through the studio link, a personal invite link, or as a guest.
- A guided wizard builds the apartment from rooms and dimensions.
- A 2D editor (SVG): walls, partitions, doors, windows, generic furniture, undo/redo, pan/zoom, keyboard use.
- Every save adds an immutable version tagged `client` or `designer`.
- A guest's plan stays in the browser until they register and save.
- One studio cannot see another studio's data ([security.md](security.md)).

## Not built yet

Design brief, styles and materials, moodboard, AI consultant, renderings, budget, dossier,
messaging and tasks, studio branding, invitation emails, per-project team permissions, deployment,
rate limiting, subscriptions and credits.

## Next

Phase 2 per the PRD: design brief, styles and materials, moodboard, AI consultant through the
OpenAI API ([decisions.md](decisions.md)).
