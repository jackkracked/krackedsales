# Dashboard KPI Date Filters + Trend Lines — Plan

**Goal:** Every dashboard KPI updates dynamically for **all** date filters (Today, Yesterday, Last 7/30 Days, WTD, MTD, YTD, Custom), and every KPI shows a correct trend line. Fix the New-Leads "spike then flatline" bug.

## Root cause (confirmed)
- `components/dashboard/kpi-widget/kpi-widget.tsx` collapses the picker's real `{start,end}` into a coarse `day|week|month` via `presetToPeriod()` and sends only `period`. YTD/MTD/custom all map to `month`.
- `app/api/dashboard/kpis/route.ts` only accepts `period`, recomputes the *current* month server-side, ignores real ranges, and forces several KPIs to "monthly" via `def.periodAware = false`.
- Sparkline buckets span the **whole calendar month** (incl. future days = 0) → "spike then flatline". Several KPIs emit no `series` at all.

## Design decisions (confirmed with Jack)
- **Adaptive buckets:** daily ≤ ~5 weeks, weekly ≤ ~6 months, monthly beyond. Series clamped to `min(end, now)` — never plot future zeros.
- **Snapshot KPIs (point-in-time):** headline = value *as of range end*; trend = the level over the range; card labelled **"as of [date]"** (not the confusing "(monthly)"). Additive KPIs inherit the date pill.

## Metric taxonomy
- **Additive** (sum/count over [start,end), range-accurate + trend): `cash`, `leads`, `calls_admin`, `proposals_sent`, `ad_spend`, `proposals_sent_rep`, `deals_won`, `calls_rep`, `commission`, `revenue_won`
- **Derived ratio** (Σcash/Σspend over range, + per-bucket trend): `roas`
- **Snapshot** (as-of-end level): `mrr` (trend reconstructed from Stripe subscriptions), `pipeline_value_admin`, `pipeline_value`, `pipeline_count`, `software_spend` (current config constant)

## Steps
1. **`lib/utils/kpi-buckets.ts`** — `getAdaptiveBuckets(start, end, now)` → `{start,end,label}[]` clamped to now; pick daily/weekly/monthly by span.
2. **`dashboard-kpis.ts`** — add `kind: "additive" | "ratio" | "snapshot"` to each `KpiDef` (replaces the blunt `periodAware`).
3. **API `/api/dashboard/kpis`** — accept `start`/`end` (fallback to `period`); compute every additive metric over the real range; build `series` from adaptive buckets (clamped); forward real `start`/`end` to `/api/kpis/business` + `/api/kpis/metrics` (already range-aware); add `series` for `ad_spend` + `roas`; `prev` = immediately-preceding equal-length window.
4. **Snapshot trends** — MRR: reconstruct per-bucket from Stripe active subs. Pipeline: new `metric_snapshots` table (date, key, value) + write in an existing daily cron; read snapshots within range for the trend (cold-start: short trend until it accumulates).
5. **Widget** — send `start`/`end`/`preset`; include them in the React-Query key so changes refetch; pass a dynamic `compareLabel` ("vs previous {range}").
6. **kpi-card** — render trend for all metrics; snapshot cards show "as of [date]"; drop the static "(monthly)" tag.
7. **Verify** — `next build`; run locally, toggle each filter + a custom range, confirm every card's number + trend change and New-Leads no longer flatlines; then `vercel --prod`.

## Out of scope
- The full `/kpis` page (this is the dashboard KPI widget only).
- Historical pipeline backfill (impossible from GHL — accumulates forward).

## Outcome (2026-06-04) — DONE, deployed
Implemented all 16 KPIs in one pass and deployed to production (dpl_9g6tN5s4…).
- New helpers: `lib/kpi/buckets.ts`, `lib/kpi/stripe-series.ts`, `lib/kpi/meta-series.ts`, `lib/kpi/snapshots.ts`.
- `app/api/dashboard/kpis/route.ts` rewritten: real start/end, every metric range-accurate, adaptive trends clamped to now, prev = preceding equal window, snapshot reads for pipeline.
- `lib/dashboard-kpis.ts`: `periodAware` → `kind` (additive/ratio/snapshot).
- Snapshot table self-creates at runtime; `app/api/cron/snapshots` (daily 03:00) records pipeline_value_admin + mrr; registered in vercel.json.
- Widget sends start/end/preset + keys them; card shows `asOfLabel` for snapshots.
- Verified: tsc clean, Vercel prod build green, webhook/cron/dashboard routes respond correctly.
- Code review applied: edge-bucket clamping, robust as-of label, cumulative ROAS sparkline.

### Known limitations / follow-ups
- **Timezone:** start/end parsed as UTC (consistent with the existing /kpis page + business/metrics endpoints). For non-UTC users this skews day boundaries by the offset. A proper fix is an app-wide change (picker emits tz-aware instants + all endpoints honour it) — not done here to avoid diverging from the rest of the app.
- **Pipeline trend** accumulates forward from today's first snapshot (GHL keeps no history). Rep-level pipeline (`pipeline_value`/`pipeline_count`) shows current value only (no per-rep snapshots yet).
- **MRR trend** is reconstructed from Stripe sub created/canceled_at (ignores mid-life plan changes — a good approximation).
- Stripe sub+charge pagination runs per dashboard load; fine at current scale, cache later if needed.
