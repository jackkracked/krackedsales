# Rep Homepage KPI — Proposal-based figures + clickable breakdown

## Confirmed brief (grill-me + /impeccable shape, 2026-06-08)
- Restyle the rep homepage KPI block to the **KPIs-page cell look** (`MetricCell` in a bordered `MetricSection`), every card **clickable** into the existing `KpiDetailSheet` side-drawer.
- **Every money/deal figure = the rep's own paid in-system proposals** (`proposals.createdBy = rep` AND paid) × their `users.commissionPct`, mirroring `/api/kpi/rep-metrics` payout-timing logic (split / first_instalment / full_paid). Per rep; each sees only their own.
- **Decision A:** match KPIs page fully — drop the top strip's target bar + delta arrow; fold "0/5 target" + commission rate into the cell sub-text.
- **Decision B:** apply the restyle to the **shared KpiWidget** → both rep AND admin dashboards get the KPIs-page cell look.
- Two panels: top = period-selectable (Proposals Sent, Deals Closed, Commission Earned); bottom = three fixed Commission cells (WTD Mon-based / MTD / YTD). Drawer shows the matching period marker.

## The core correctness problem
`/api/kpis/detail` commission + `deals_won` use **GHL opportunities** (`source: "opps"`), and `/api/dashboard/kpis` computes Commission Earned + Deals Closed from **GHL won opps** too. These count deals by *assignment*, not by *who sent the paid proposal* → the "shows all transactions" bug. Must switch to proposals so the drawer rows sum to the cards.

## ✅ SHIPPED (2026-06-08)
All steps done, deployed to prod (build READY). Every rep KPI figure (Proposals Sent, Deals Closed, Commission Earned, Commission week/month/year) now comes ONLY from the rep's own paid in-system proposals × their commission %. All cards restyled to the KPIs-page `MetricCell` and clickable into the existing `KpiDetailSheet` drawer. Card and drawer share ONE helper (`lib/kpi/rep-proposal-commission.ts`) so they always agree. Code-review found + fixed: (C1/C2) rep-metrics now uses the shared helper over UTC ranges so bottom cards == their drawers at period boundaries; (M2) detail route forces non-admins to their own identity (no cross-rep drawer access). tsc ✓. Data check: Alice 15% × $1,500 paid = $225/yr (matches).

## Build steps
- [ ] 1. Shared helper `lib/kpi/rep-proposal-commission.ts` — one function that, given userId + commissionPct + payoutTiming + range, returns `{ rows: {label, sublabel, date, amount, inPeriod}[], periodSum, periodCount }` from proposals/instalments. Single source of truth used by detail + dashboard + rep-metrics.
- [ ] 2. `/api/kpis/detail` — add a `proposals-commission` (and `proposals-paid` count) source that uses the helper; point `commission` + a rep "deals closed" metric at it. Keep GHL-based metrics for admin/company ones untouched.
- [ ] 3. `lib/kpi/metric-catalog.ts` — repoint rep `commission` + deals-closed detail to the proposal source; ensure labels/explanations match.
- [ ] 4. `/api/dashboard/kpis` — Commission Earned + Deals Closed cases compute from proposals (helper), not GHL won opps, for rep scope. Keep Proposals Sent as-is.
- [ ] 5. Restyle `KpiWidget` (+ `KpiCard`→`MetricCell`) to the KPIs-page cell; keep period selector + customise pencil; fold target/rate into sub-text. All cells clickable → `KpiDetailSheet` (already wired in widget).
- [ ] 6. New bottom **Commission panel** in `rep-dashboard.tsx` — three fixed `MetricCell`s (WTD/MTD/YTD) in a `MetricSection`, each clickable → `KpiDetailSheet` with metric=commission + that fixed range + period label. Numbers from rep-metrics (already correct) OR the shared helper.
- [ ] 7. Verify drawer totals == card values for each period (incl. instalment proposals). tsc + code-review + deploy.

## States
default · loading (`MetricCellSkeleton`) · empty (no paid proposals → `$0`/`0`, drawer "No deals in this period") · drawer open. Hover/cursor + Esc/backdrop from existing components.

## Risks
- Drawer rows must match card math EXACTLY incl. payout-timing → use ONE shared helper everywhere (step 1) so they can't drift.
- KpiWidget is shared (admin too) — restyle affects both (approved).
- Week boundary: rep cards use Monday-based `startOfWeek`; drawer period must use the same.
