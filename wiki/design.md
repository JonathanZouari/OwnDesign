# Design

Sources: Stitch project "AI Interior Design Platform" (reached through the Stitch MCP server),
`frontend/css/app.css`.

- Design system: "Architectural Atelier". Terracotta primary (`#9f3c16`, `#bf542c`), moss secondary,
  warm off-white surfaces. Plus Jakarta Sans, Inter, JetBrains Mono. Material Symbols icons.
  4 px radius on controls, 8 px on cards.
- The tokens are CSS variables at the top of `frontend/css/app.css`. New UI uses them, not new colours.
- The wizard and the 2D editor follow the two matching Stitch screens. Other pages follow the design system.
- Brand in the UI: "ATELIER" with a green studio chip.
- Stitch screens for later phases (AI advisor, credits, budget, renders) are the reference when those phases are built.
- Breakpoints: 1199 px and 767 px.
- Fonts load from Google Fonts ([open-items.md](open-items.md)).
