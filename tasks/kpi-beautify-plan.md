# KPI Dashboard — Beautify + Stabilise + Validate

Three threads, one goal: the KPI cards are perfectly balanced at any count, never flash to zero, and every number is trustworthy. Shared component, KPIs-page look, flexible card.

## Decisions (locked with Jack, 2026-06-09)
- **Layout:** balanced rows where the last row stretches to equal widths. On the **customisable dashboard widget**, render `N metrics + 1 "Add KPI" ghost cell` so the grid is always full & balanced and the one gap is a beautiful add affordance (hidden at the 8 max). The **/kpis report page** balance-reflows only (no ghost — fixed sections).
  - Distribution (metrics + ghost on widget): ≤4 slots → one row; ≥5 → two rows `ceil/floor`. So 4 metrics → 3+2 (ghost bottom-right), 5→3+3, 6→4+3, 7→4+4, 8→4+4 (no ghost).
- **Anti-zero:** keep the last good value (stored server-side); never return 0 on a source error. Add a small per-card **status cue**: live / refreshing / failed-stale. Distinguish a genuine 0 (real no-data) from a failed fetch.
- **Validation:** audit each metric's calculation vs its definition + spot-check headline values against the live source; per-metric pass/flag report; note the 7 `pending` funnel metrics.

---

## Phase 1 — Balanced grid + "Add KPI" ghost cell
- [x] 1.1 New shared `BalancedMetricGrid` (in components/kpis/) — splits cells into balanced rows; each row is a flex row with children `flex-1 basis-0` (equal width within row, last row stretches). Keeps the divide borders between cells (`divide-x`) and rows (`border-t`). Replaces both the `MetricSection` `MetricGrid` colsClass and the dashboard widget's `colsClass`.
- [x] 1.2 Responsive: full balanced rows on desktop; collapse to 2-up (tablet) / 1-up (mobile) within breakpoints. Test heading/overflow at each breakpoint.
- [x] 1.3 `MetricSection` uses `BalancedMetricGrid` (no ghost) — /kpis page sections reflow balanced.
- [x] 1.4 Dashboard widget (`kpi-widget.tsx`) uses `BalancedMetricGrid` with an **Add-KPI ghost cell** appended while `selectedKeys.length < 8`. Ghost = dashed muted border, centered "+" in faint circle + "Add KPI", hover warms to brand + 2px lift, click → opens the existing Customise sheet scrolled to unpinned metrics. `prefers-reduced-motion`: color only, no lift.
- [x] 1.5 Keep the `shrink-0` fix on the widget card. Verify height/visibility at 1–8 KPIs in a real browser.

## Phase 2 — Last-good-value cache + status cue
- [ ] 2.1 Migration: `kpi_last_values` (metric_key, scope_key, range_key, value, prev, series jsonb, status, captured_at). `scope_key` = role+userId (or "admin"); `range_key` = start|end|preset so the cache matches the requested window.
- [ ] 2.2 `/api/dashboard/kpis` + `/api/kpis/metrics` + `/api/kpis/funnel`: on a successful metric compute → upsert last-good. On a source **error** (the catch blocks that currently return `{value:0}`) → return the stored last-good value + `status:"stale"` instead of 0. Genuine successful 0 stays 0 with `status:"ok"`.
- [ ] 2.3 Add `status` per metric to the API response: `"ok" | "stale"` (served from cache after error). Client also derives `"refreshing"` from React Query `isFetching`.
- [ ] 2.4 Client: React Query `placeholderData: keepPreviousData` on the kpi queries (widget + kpis page + funnel) so a refetch never blanks to skeleton/0.
- [ ] 2.5 `MetricCell` gets a subtle status cue: a tiny dot — muted pulse while refreshing, amber when stale/failed (with an "as of …" / "couldn't refresh" tooltip). Never loud; data stays the hero.
- [ ] 2.6 Fix the genuine metric bug surfaced: ROAS shows `0.00x` when ad spend is 0 but cash is positive (divide-by-zero) — should read `—`/`N/A`, not `0.00x`. (Folds into Phase 3 findings.)

## Phase 3 — Metric validation (audit + spot-check)
- [ ] 3.1 For each of the ~34 metrics: confirm the calculation matches its intended definition (code audit), and spot-check the current headline value against the live source (Stripe/GHL/Meta/ClickUp/DB) where feasible.
- [ ] 3.2 Produce a per-metric report: metric · source · definition · verdict (✓ correct / ⚠ suspicious / ✗ wrong / ⏳ pending) · note/fix. Use parallel subagents per source group for speed.
- [ ] 3.3 Fix anything found wrong (e.g. ROAS div-by-zero, any date-window or attribution bugs). Re-validate.
- [ ] 3.4 Surface the 7 `pending` metrics (booked calls, demos submitted/completed, audits requested/completed, active projects, TikTok ad spend) — flag as "not wired" rather than silently 0.

## Verify & ship
- [ ] tsc on each phase · code-review (multi-file) · deploy `vercel --prod` · browser-verify the widget at several KPI counts (incl. the ghost cell + status cue) via the temp-admin + Playwright method.

## Notes / risks
- The balanced flex-row layout must keep the exact MetricCell look + divide borders so it still reads as "the KPIs-page component, globally."
- Last-good cache keyed by range — different date ranges cache separately; first-ever load of a range (no cache) on a source error still shows 0 (acceptable; rare).
- Validation may reclassify some "0"s as genuine (e.g. Ad Spend/Calls 0 for MTD) vs broken — the report makes that explicit.
