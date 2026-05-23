# Grill: Dashboard Layout Gaps — Left & Right White Space
Date: 2026-05-23

## Intent
Remove the visible gap between the left sidebar and the content area, and the gap on the right side of every dashboard overview page. The dashboards should fill the full viewport width exactly like the HTML design files do.

## Constraints
- No new features, no layout redesign — fix only must match the HTML mockups exactly
- All 7 dashboards affected identically (same root cause)
- Build must stay clean

## Key decisions
- Decision: Wipe `src/index.css` and replace with a 9-line minimal reset. Reason: the file was untouched Vite starter boilerplate containing `#root { width: 1126px; margin: 0 auto }` which capped the app at 1126px and centred it, creating equal left/right gaps. Alternative considered: adding `width: 100%` overrides in DashboardLayout — rejected because patching downstream is wrong when the upstream cause is clear.
- Decision: Clear `src/App.css`. Reason: pure Vite boilerplate (`.hero`, `.counter`, `#next-steps`), not imported by App.jsx or any dashboard, zero risk.

## Surfaced assumptions
- The user assumed the layout CSS was correct and the issue was in individual card sizes or component padding.
- The actual issue was one level above — the root container itself was constrained.
- `global.css` and `variables.css` were correct all along; they just couldn't express themselves because `#root` was being boxed in by `index.css`.

## Out of scope
- Card padding or internal stat-card sizing changes (not needed — those already match the HTML design once the root constraint is removed)
- Any per-dashboard layout edits
