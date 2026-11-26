# Design

Sources: Stitch project "AI Interior Design Platform" (reached through the Stitch MCP server),
`design/stitch/` (the pulled files), `frontend/css/app.css`.

## Design system

- "Architectural Atelier". Terracotta primary (`#9f3c16`, `#bf542c`), moss secondary, warm off-white
  surfaces. Plus Jakarta Sans, Inter, JetBrains Mono. Material Symbols icons. 4 px radius on
  controls, 8 px on cards.
- The tokens are CSS variables at the top of `frontend/css/app.css`. New UI uses them, not new colours.
- Brand in the UI: "ATELIER" with a green studio chip.
- Breakpoints: 1199 px (sidebar and header tabs hidden, navigation drawer shown) and 767 px (phone).
  See [Phones](#phones).
- Fonts load from Google Fonts ([open-items.md](open-items.md)).

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
| Client AI Consultant & Spatial Advisor | `frontend/consultant.html` | Built (real data only; no credits, sample suggestions or action buttons) |
| 3D Render Views & Photorealistic Gallery | none | Reference for the renderings phase |

`index.html`, `auth.html`, `projects.html` and `design.html` (brief, materials, moodboard) have no Stitch screen; they follow the design system.

## Phones

Adapted from the desktop Stitch screens; there are no separate mobile screens (user decision,
[decisions.md](decisions.md)). Sources: `frontend/css/app.css` (the phone section at the end),
`frontend/js/nav-drawer.js`, `frontend/js/editor/sheet.js`, `frontend/js/editor/tools.js`.

- **Phone** = `(max-width: 767px)`. Under `(pointer: coarse)`, controls get a hit area of at least 44 × 44 px. On phones,
  inputs use a 16 px font so iOS does not zoom in. Every page has `viewport-fit=cover`, and the bars pad for
  `env(safe-area-inset-*)`. No page scrolls sideways from 320 to 767 px.
- **Navigation drawer** (≤1199 px): a menu button (`#nav-menu`) in the app bar opens a `<dialog>`. Each time it
  opens it copies the page's live navigation: links from elements marked `data-drawer-links`, and proxies for buttons
  marked `data-drawer-action` (sign in/out). The page's own nav therefore stays the single source of truth. The copies are removed
  on close, so the page never holds two links with the same name (Playwright matches names by substring).
  Esc, the backdrop and the close button close it, and focus returns to the menu button. Widening past 1199 px closes it.
  Pages: editor, wizard, studio, design, consultant. Index, auth, entry and projects need none, because their bars fit at 320 px.
- **Editor on a phone:** view and light edits only (`frontend/js/editor/tools.js`). The rail (a bottom bar) offers Select and Furniture.
  - Furniture can be placed, moved, rotated, resized, duplicated and deleted.
  - Rooms can be renamed and retyped, but not dragged, nudged or deleted, because moving a room moves its walls (`plan.js` `translate`).
  - Walls and openings are read-only: the inspector fields are disabled, with a note, and there are no end handles.
  - A drag on anything that cannot move pans the view.
  - A dismissible notice (`#phone-notice`) says this. The dismissal is remembered for the browser session.
  - Below 1200 px, the editor's header tabs and its `#account` button live in the drawer, not in the app bar.
  - Opening the furniture catalog on a phone closes the inspector sheet, and the action bar hides when none of its buttons applies. Crossing the breakpoint, for example by rotating a tablet, rebuilds the rail. A
  drawing tool falls back to Select, and a wall being drawn is dropped. The inspector is a bottom sheet
  (`#inspector.sheet-open`, toggled by `#sheet-toggle`). It opens when something becomes selected and closes when
  the selection clears, and only on that change, so a sheet closed by hand stays closed during edits.

## Rules for turning a Stitch screen into a page

- Stitch HTML uses the Tailwind CDN and inline scripts. The app uses neither: plain CSS, ES modules,
  and a `script-src 'self'` policy on every page.
- Stitch screens are filled with sample data (credits, budgets, render queues, sign-off queues,
  compliance badges, people). A page shows only what the API returns; anything without a real source
  is left out until the phase that builds it ([decisions.md](decisions.md)).
- Entries for later phases may appear in navigation as disabled items titled "Coming in a later phase".
- Check whether a screen changed in Stitch before building from the stored copy: re-pull and compare.
