# KPI Cross-Reference Drawer — Plan & Outcome

**Goal:** Clicking ANY KPI card (on /kpis AND the dashboard widget) opens a side
drawer listing every line item for that metric, with the items inside the
selected date range highlighted, the in-period total, and a plain-English
explanation of how the metric is read. Paginated (infinite scroll) so it opens fast.

## Architecture
- `lib/kpi/metric-catalog.ts` — single registry: every card key (both pages) →
  `{ label, explanation, detail:{source,params} | pending }`. Drives explanations + routing.
- `app/api/kpis/detail/route.ts` — paginated detail API. `buildSource()` builds the
  full ordered row list per source, computes the exact in-period sum+count over the
  whole set, flags each row `inPeriod`; route slices by `offset`/50 → `nextOffset`.
  60s in-memory cache so scroll pages reuse the full fetch. Ratio metrics → breakdown.
- `components/kpis/KpiDetailSheet.tsx` — useInfiniteQuery + IntersectionObserver;
  in-period rows accent-highlighted, out-of-period dimmed; explanation + in-period total header.
- Dashboard `kpi-card.tsx` made clickable; `kpi-widget.tsx` opens the shared drawer
  with rep context (userId/ghlUserId/email). `/kpis` passes the period label.

## Coverage
**Full line items (paginated, in-period highlighted):** Cash, Outstanding Payments,
Outstanding Proposals, MRR/Total/Management MRR, Management Clients, New/Churned
Management MRR, New Project Value, Proposals Sent/Lost (mgmt+project, admin+rep),
Calls (admin+rep), Software Spend, Leads, Deals Won, Revenue Won, Commission
(rate-applied), Pipeline Value/Count, Ad Spend (Meta, daily).

**Breakdown (explanation + formula/components):** Net P/L, ROAS, CPL, Booking Rate,
Cost/Booked Call, Cost/Demo, Client Retention Rate, Total Expenses.

**Explanation only — line-item source not wired yet (flagged honestly, not "No data"):**
Booked Calls, Demos Submitted/Completed, Audits Requested/Completed, Active Projects,
TikTok Ad Spend. These need GHL-stage / ClickUp / demo-tracker source work — next pass.

## Code review applied
- Commission drawer now applies the rep's rate (was showing raw won value).
- `ghlUserId` falls back to the session user (was a scope-leak risk).
- `fetchAllOpps` pages until a short page (was dropping data when GHL omits meta.total).
- 60s server cache so infinite-scroll doesn't re-paginate Stripe/GHL each page.

## Known limitations / follow-ups
- Funnel sub-metrics above need their line-item sources wired.
- Totals/UTC date boundaries follow the existing app-wide convention (see dashboard-date-filters-plan.md).
- `expenses_breakdown` uses the range-start month for manual expenses (parity with /api/kpis/metrics).
