# Grill: Dashboard Completion
Date: 2026-05-23

## Intent
Finish all 7 role dashboards so they match the HTML design files exactly and use real API data throughout. No mock/hardcoded data in any dashboard. No new features — strict design parity only.

## Constraints
- Every stat, table, and list must read from the backend API (Express + Prisma + PostgreSQL)
- No hardcoded `useState` arrays acting as fake data
- Empty database → empty tables with zero stats is correct behavior (not a bug to paper over)
- Revenue Models section in MasterDashboard stays as static frontend config (no DB table needed)
- No new buttons or features beyond what the HTML designs show
- Work order: top-down by role hierarchy (Master → State → Industry State → District → Regional → Manufacturer → Distributor)

## Key decisions
- Decision: Start with MasterDashboard. Reason: top of hierarchy, most complex, sets the pattern for all others. Alternative considered: simple-first (Regional/District) — rejected because the user explicitly chose top-down.
- Decision: Revenue Models = static frontend constants file. Reason: platform-level config, rarely changes, no `RevenueModel` table in schema. Alternative considered: persist to DB with full CRUD — rejected as new feature scope.
- Decision: Build missing backend endpoints (States overview, Districts overview aggregations) for Master. Reason: those sections exist in the HTML design — building the API to serve them is implementing the design, not adding features.

## Surfaced assumptions
- The user had not compared the React app to the HTML designs recently — actual gap unknown until runtime comparison
- Most dashboards (Master, Manufacturer, Distributor, etc.) use 100% hardcoded mock data despite a real backend existing
- StateDashboard is the only page already wired to real API calls
- The Prisma schema + backend exists and is functional; the gap is purely frontend wiring + a few missing backend aggregation endpoints

## Open questions
- Does the PostgreSQL database have any seeded records, or is it fully empty?
- After MasterDashboard, confirm visual parity before moving to the next dashboard

## Out of scope
- New features or UI elements not in the HTML designs
- Mobile/responsive layout changes
- Authentication flow changes
- Persisting Revenue Models to the database
