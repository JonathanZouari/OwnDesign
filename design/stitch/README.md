# Stitch design sources

Pulled from the Stitch project "AI Interior Design Platform" (`projects/2033516096237862010`) on
2026-11-19. Design system: "Architectural Atelier". These files are reference material: read them,
do not edit them. Re-pull when the Stitch project changes.

Each screen has its Stitch HTML and a 1000 px wide preview of its screenshot.

| Screen in Stitch | Files | Stitch screen id | In the app |
|---|---|---|---|
| Guided Room & Dimension Wizard | `wizard.*` | `633521bc796d4fd589f46e08e3b780a5` | `frontend/wizard.html` |
| 2D Floor Plan Canvas & Space Planner | `canvas.*` | `ce33ac388da5423cb3d6974d5f645847` | `frontend/editor.html` |
| Client Invitation & Guest Onboarding Portal | `portal.*` | `9e55c51e1f534fc7a9ad33c231ef30a4` | `frontend/entry.html` |
| Studio Overview & Project Directory | `studio-overview.*` | `9b6d7113841b46e3b1c34c01f784a110` | `frontend/studio.html` |
| Studio White-Label Branding & Atelier Settings | `branding.*` | `bc995470b8674b049a69d9ff7118c2de` | Not built. Reference for studio branding. |
| Client & Designer Project Dossier & Specs Export | `dossier.*` | `2b2c8e525cff4315b6e1299e739538b0` | Not built. Reference for dossier and budget. |
| Client AI Consultant & Spatial Advisor | `ai-consultant.*` | `f25a1641c4b64ec9946293d53f5a26fd` | `frontend/advisor.html` (conversation, composer and notices only; the sample-data panels are not built) |
| 3D Render Views & Photorealistic Gallery | `renders.*` | `e1f415546ba3446d80be70a71b57bbd8` | Not built. Reference for renderings. |

Images generated in Stitch: `render-concept-a.jpg` (used as the illustration on the client portal,
copied to `frontend/img/interior-concept.jpg`) and `render-concept-b.jpg`.

The Stitch project also holds a shortened copy of the PRD. The full PRD is
`Interior_Design_AI_PRD_EN.md` at the repository root and is the one to follow.

## Using a screen

The Stitch HTML uses the Tailwind CDN and sample data (a studio, clients, budgets, credits). The app
does not: it is plain CSS with the tokens in `frontend/css/app.css`, and it shows only data that
exists. Take layout, hierarchy and components from a screen; leave out anything with no real source.
