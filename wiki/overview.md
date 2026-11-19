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

## Not built yet

Design brief, styles and materials, moodboard, AI consultant, renderings, budget, dossier,
messaging and tasks, studio branding, invitation emails, per-project team permissions, deployment,
rate limiting, subscriptions and credits.

## Next

Phase 2 per the PRD: design brief, styles and materials, moodboard, AI consultant through the
OpenAI API ([decisions.md](decisions.md)).
