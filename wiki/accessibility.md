# Accessibility

Sources: `frontend/accessibility.html`, `frontend/css/app.css` (end of file), `backend/tests/test_a11y.py`.

## Target
WCAG 2.2 AA. Israeli standard ת"י 5568 part 1 is based on WCAG 2.0 (Kol Zchut; sources disagree on the
level, 2.0 AA is the usual reading), so 2.2 AA covers it. Legal text of the 2013 accessibility regulations
was not read: confirm with a lawyer before publishing.

## Done
- Skip link and `<main id="main">` on every page; labelled buttons; AA contrast (`--outline`, input borders);
  `prefers-reduced-motion`; disabled nav items shown in italics, not faded.
- Hebrew statement `accessibility.html` (contact details are fictional, labelled on the page) (`lang="he" dir="rtl"`), linked from every page.
- `test_a11y.py`: axe-core (WCAG 2.2 A/AA) on all 10 pages, skip link, 320 px reflow, statement links.
  Needs no Supabase; signed-in states are not covered by axe.

## Done: options widget

`frontend/js/a11y-widget.js` (loaded on every page): floating button, panel with text size (4 steps, CSS `zoom`), high contrast, highlight links, readable font, wider spacing, stop animations, bold focus; stored in `localStorage` key `atelier-a11y`, validated on load; English or Hebrew by `<html lang>`. Rules at the end of `app.css`, plus `forced-colors`. Tests in `test_a11y.py` (axe with each option on, persistence, corrupt storage, Escape, 320 px at largest text).

## Done: responsive navigation (section links below 1200 px, tabs row and account button on phones)

## Not done
See [open-items.md](open-items.md): coordinator details in the statement, responsive navigation,
screen-reader testing, target size audit, signed-in axe runs.
