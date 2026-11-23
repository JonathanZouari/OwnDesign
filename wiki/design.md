# Design

Sources: Stitch project "AI Interior Design Platform" (reached through the Stitch MCP server),
`design/stitch/` (the pulled files), `frontend/css/app.css`.

## Design system

- Design system: "Architectural Drafting & Spatial Intelligence" (earlier called "Architectural Atelier"). Terracotta primary (`#9f3c16`, `#bf542c`), moss secondary,
  warm off-white surfaces. Plus Jakarta Sans, Inter, JetBrains Mono. Material Symbols icons.
  4 px radius on controls, 8 px on cards.
- The tokens are CSS variables at the top of `frontend/css/app.css`. New UI uses them, not new colours.
- Brand in the UI: "ATELIER" with a green studio chip.
- Breakpoints: 1199 px and 767 px.
- Fonts load from Google Fonts ([open-items.md](open-items.md)).
- **Hebrew, right to left** (since 2026-11-19): every page is `lang="he" dir="rtl"`; Heebo comes first in the
  font tokens (Latin fonts as fallback, JetBrains Mono keeps digits). CSS uses logical properties
  (`inline-start/end`). The plan canvas and its rulers stay `direction: ltr`, because they are geometry;
  units read מ׳ / מ״ר. Number runs inside Hebrew text are isolated with `ltr()` from `frontend/js/strings.js`.
  Directional icons carry `.icon.mirror`. Keycap hints (ESC, V, W…) stay in Latin letters.


## Screens

All eight Stitch screens are stored in `design/stitch/` (HTML plus a preview image each); the table
there lists the Stitch screen ids. Pulled 2026-11-19.

| Stitch screen | App page | State |
|---|---|---|
| Guided Room & Dimension Wizard | `frontend/wizard.html` | Built |
| 2D Floor Plan Canvas & Space Planner | `frontend/editor.html` | Built |
| Client Invitation & Guest Onboarding Portal | `frontend/entry.html` | Built |
| Studio Overview & Project Directory | `frontend/studio.html` | Built |
| Studio White-Label Branding & Atelier Settings | none | Reference for the branding phase |
| Client & Designer Project Dossier & Specs Export | none | Reference for the dossier and budget phase |
| Client AI Consultant & Spatial Advisor | none | Reference for the AI consultant phase |
| 3D Render Views & Photorealistic Gallery | none | Reference for the renderings phase |

`index.html`, `auth.html` and `projects.html` have no Stitch screen; they follow the design system.

## Rules for turning a Stitch screen into a page

- Stitch HTML uses the Tailwind CDN and inline scripts. The app uses neither: plain CSS, ES modules,
  and a `script-src 'self'` policy on every page.
- Stitch screens are filled with sample data (credits, budgets, render queues, sign-off queues,
  compliance badges, people). A page shows only what the API returns; anything without a real source
  is left out until the phase that builds it ([decisions.md](decisions.md)).
- Entries for later phases may appear in navigation as disabled items titled "Coming in a later phase" (in Hebrew in the app).
- Check whether a screen changed in Stitch before building from the stored copy: re-pull and compare.
- Stitch screens are built in Hebrew: static text in the HTML, text set from JS in `frontend/js/strings.js`, directional icons mirrored (the strings of the studio dashboard and the client portal included).
- Stitch access: the Stitch MCP server (`stitch.googleapis.com/mcp`) is registered in Claude Code at user scope; its API key lives in the user's Claude config, never in this repository. Project screens: client 2D floor plan editor, client design dossier, designer review workspace, studio and project settings, visualizations and moodboards.
