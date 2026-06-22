# KPI Configurable Engine — Architecture & Implementation Plan

> Status: **BUILT + DEPLOYED (2026-06-15).** Core shipped via 4 parallel agents + integration. Inert until a KPI is configured (legacy fallback preserved — nothing regressed).
>
> ## BUILD STATUS
> - ✅ `kpi_configs` table (migration 0014, applied to prod). Engine: `lib/kpi/engine/{types,run,configs,index}.ts` + `datasets/` (12 datasets: stripe charges/invoices/subscriptions, meta.spend, proposals, calls, software_costs, manual_expenses, demo_boards, ghl opportunities/appointments, clickup.tasks). Typed registry; no free-text.
> - ✅ Routes (admin-gated): `GET /api/kpis/registry`, `POST /api/kpis/preview` (live preview, no persist), `GET/POST /api/kpis/configs`, `GET/DELETE /api/kpis/configs/[metricKey]`.
> - ✅ UI: `components/kpis/kpi-configurator.tsx` (drawer: integration→dataset→measure→filters→live preview→save), `metric-cell.tsx` (gear + ghost states), `kpis-client.tsx` wiring (admin-only).
> - ✅ Overlays (the override layer): `/api/kpis/metrics` (card values), `/api/kpis/detail` (drill-down rows for configured metrics), `/api/dashboard/kpis` (dashboard mirror; key map cash→cashCollected, mrr→totalMrr, ad_spend→adSpend, others 1:1). All non-fatal; skip entirely when 0 configs.
> - ⏳ KNOWN LIMITS: (1) enum filter fields backed by users/GHL-pipelines/clickup-status ship with empty dropdowns (need async hydration) — status/type/boolean enums work fully, so money KPIs (Stripe/proposals) configure cleanly; (2) dashboard mirror covers tiles whose key maps or matches — unmapped tiles keep legacy; (3) NOT yet verified by an authenticated end-to-end run (no session in the build env) — the live preview is the per-metric verification path.
>
> _Original plan below._

> Status: DRAFT FOR SIGN-OFF (Jack + Gage). No code written. No deploy. Analysis + design only.
> Author: staff product-engineer pass. Reviewed against the live codebase at `~/Projects/kracked-sales`.
> Goal: make **every KPI on `/kpis` admin-configurable** with **provably-correct numbers**, a **live preview**, a **drill-down**, and make the **dashboard a pure snapshot of these configs**.

---

## A. Executive Summary

### A.1 What exists today (the honest baseline)

There are **three separate, hand-coded KPI engines** that don't share a single source of truth, despite a comment claiming `metric-catalog.ts` is "the single source of truth":

| Surface | Compute path | File |
|---|---|---|
| `/kpis` page cards | `GET /api/kpis/metrics` — one giant 425-line handler that hardcodes every metric (Stripe charges, subs, proposals SQL, Meta spend, expenses) | `app/api/kpis/metrics/route.ts` |
| `/kpis` drill-down drawer | `GET /api/kpis/detail` — a `buildSource()` switch over a fixed `DetailSource` union | `app/api/kpis/detail/route.ts` + `lib/kpi/metric-catalog.ts` |
| Dashboard KPI widget + admin strip | `GET /api/dashboard/kpis` (pinnable pool) and `GET /api/kpi/admin-metrics` (the 4-up strip) — a **third** switch over `KPI_POOL` keys | `app/api/dashboard/kpis/route.ts`, `lib/dashboard-kpis.ts`, `components/dashboard/admin/admin-kpi-strip.tsx` |

The same metric (`cash`) is computed in **three different places** with three different Stripe fetches. They already drift (e.g. `/kpis` "Total MRR" = mgmt MRR + software costs; dashboard `mrr` = reconstructed active-sub MRR — **different numbers for the same word**). This is exactly the confidence problem Jack wants to kill.

What is genuinely good and must be **reused, not rebuilt**:
- `lib/kpi/metric-catalog.ts` — the `DetailSource` / `DetailConfig` concept is already a primitive "typed source" idea. The configurator extends it.
- `lib/kpi/buckets.ts` — `getAdaptiveBuckets` / `bucketSum` / `bucketCount` is a clean, correct trend engine. **The query engine will reuse it verbatim.**
- `lib/kpi/stripe-series.ts`, `meta-series.ts`, `rep-proposal-commission.ts` — these are already "load once, slice by range" loaders. They become the **fetch layer** under datasets.
- `lib/kpi/snapshots.ts` (`metric_snapshots` table) — already the as-of trend mechanism for level metrics. Configs plug straight into it.
- `lib/kpi/last-good.ts` (`kpi_last_values` table) — flash-to-zero guard. Keep.
- `KpiDetailSheet.tsx` — the drawer UI is good; we extend its data contract, not its chrome.

### A.2 Do I agree with the owner's model? Yes — with three refinements.

**Agree:**
1. Every KPI becomes a saved config; **unconfigured → 0** (explicitly, with an "unconfigured" visual state — see §E).
2. Configs are the **single source of truth**; dashboard reflects them.
3. The configurator = **integration → dataset/scope → filters → preview → save**.

**Refinement 1 — Typed registry over free-text (this is the architectural spine).**
Jack's instinct "property equals / not-equals / contains a value" is right for *power*, but raw free-text property names against live integrations destroys confidence (typo = silent wrong number; a renamed Stripe field = silent zero). Instead: a **typed Source Registry**. Each integration exposes a **fixed catalog of datasets**, each dataset declares its **filterable fields** (with value type + allowed operators), its **aggregations**, and its **date field**. The admin picks from dropdowns of *known-good* fields. You literally cannot build an invalid query. This is the difference between "configurable" and "trustworthy."

**Refinement 2 — Configs are an *override layer*, not a *rewrite*.** We do NOT rip out the three engines on day one (that's a multi-week rewrite touching LIVE Stripe — too risky for a Hobby/prod-only setup). Instead: a config, **if present**, takes over a metric key; **if absent**, the existing hardcoded path still runs (or reads 0, Jack's choice per-metric — see Open Question Q1). This lets Jack & Gage configure metrics **one at a time, verifying each against the old number**, and flip the source of truth gradually. Maximum confidence, minimum blast radius.

**Refinement 3 — A config is "compiled" to a typed plan, then executed.** A saved config is data (`{dataset, aggregation, filters, dateField}`). At read time a single **Query Engine** (`lib/kpi/engine/`) compiles it into a real query against the right dataset loader and returns `{value, prev, series, rows}`. **One engine. One number per metric. Drawer + card + dashboard all call it.** This is what finally collapses three engines into one.

### A.3 The shape of the win
- One config row drives: the card value, the comparison delta, the sparkline, the drill-down rows, the live preview, **and** the dashboard tile. They can never disagree because they're one function call.
- Jack & Gage sit down, click each KPI, pick "Stripe → Charges → sum(amount) → status = succeeded → date = created", watch the live preview say **"$48,210 from 96 charges"**, click "View 96 rows", eyeball them, hit Save. Confidence = earned, not assumed.

---

## B. The Data Model (Drizzle / Neon Postgres)

### B.1 New table: `kpi_configs`

One row per metric key. `filters` is JSONB (typed at the app layer, validated on write). Additive-by-design so it lands straight in prod with no preview env (per memory: no preview/staging; migrations must be additive + idempotent).

```ts
// lib/db/schema.ts — append near kpiOverrides / kpiVisibility

/**
 * KPI configurations — the SOURCE OF TRUTH for what each KPI on /kpis reads.
 * One row per metric key. Unconfigured metrics (no row, or enabled=false) read 0.
 * filters is a typed FilterClause[] (see lib/kpi/engine/types.ts), validated on write
 * against the dataset's field registry so a stored config can never be malformed.
 */
export const kpiConfigs = pgTable("kpi_configs", {
  id:          uuid("id").primaryKey().defaultRandom(),
  // The metric this config drives. Matches a key in METRIC_REGISTRY (the rebuilt catalog).
  metricKey:   text("metric_key").notNull().unique(),
  // Which dataset in the Source Registry this reads from, e.g. "stripe.charges".
  dataset:     text("dataset").notNull(),
  // Aggregation spec: { op: "sum"|"count"|"avg"|"ratio", field?: string, ratio?: {...} }
  aggregation: jsonb("aggregation").notNull(),
  // Typed filter clauses: [{ field, op, value }]. ANDed together. Validated on write.
  filters:     jsonb("filters").notNull().default([]),
  // Which date field on the dataset scopes the metric to the selected period.
  // null => snapshot (level as-of period end, not summed over the range).
  dateField:   text("date_field"),
  // Display
  unit:        text("unit").notNull().default("currency"), // "currency"|"count"|"percent"|"ratio"
  // false => treated as unconfigured (reads 0) without deleting the row (lets you stage a config).
  enabled:     boolean("enabled").notNull().default(true),
  // Audit — who last touched this (confidence + accountability for the founders).
  updatedBy:   uuid("updated_by").references(() => users.id),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});
```

**Why `metricKey` is `unique`:** exactly one config per KPI = no ambiguity about which config a card reads.

**How an unconfigured KPI reads 0:** the engine's entry point is
```
getMetricValue(metricKey, range) →
  config = SELECT * FROM kpi_configs WHERE metric_key = $1 AND enabled = true
  if (!config) return { value: 0, prev: 0, series: zeros, unconfigured: true }
  else return engine.run(config, range)
```
The `unconfigured: true` flag drives the card's empty/ghost state (§E). It is a **real, intentional 0** — not an error.

### B.2 Reused tables (no change)
- `metric_snapshots` — snapshot (level) metrics whose source keeps no history write a daily value here; the engine reads the as-of series via existing `readSnapshotSeries`. The snapshots cron just iterates over enabled snapshot-type configs instead of a hardcoded list.
- `kpi_last_values` — flash-to-zero guard, unchanged.
- `kpi_overrides` — manual-entry metrics (e.g. Active Projects). A config can declare `dataset: "manual"` so manual overrides become *just another dataset* (see §C.4). Keeps one mental model.

### B.3 Migration / deploy safety (Gate 6)
- `CREATE TABLE IF NOT EXISTS kpi_configs (...)` is additive and idempotent — safe for prod-only deploy.
- Follow the existing pattern (`lib/kpi/snapshots.ts` self-creates its table). Either a Drizzle migration **or** a runtime `ensureTable()` is acceptable; **recommend a real Drizzle migration** here because this table is user-data-bearing and we want it in the schema history, not invisible.
- No existing column is altered. No data is migrated or destroyed. Reversible = `DROP TABLE kpi_configs` (config data only; no business data lost).

---

## C. The Source Registry & Query Engine

### C.1 Core types (`lib/kpi/engine/types.ts`)

```ts
export type FieldType = "money" | "count" | "date" | "string" | "enum" | "boolean";
export type Operator =
  | "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte" | "in" | "between" | "is_set" | "is_not_set";

export interface FieldDef {
  key: string;                 // stable id, e.g. "status"
  label: string;               // "Status"
  type: FieldType;
  operators: Operator[];       // operators legal for THIS field
  enumValues?: { value: string; label: string }[]; // for type:"enum" — drives a dropdown, never free text
}

export interface DateFieldDef { key: string; label: string; } // e.g. {created, "Created date"}

export type Aggregation =
  | { op: "count" }
  | { op: "sum"; field: string }     // field must be a money/count field on the dataset
  | { op: "avg"; field: string }
  | { op: "ratio"; numerator: string; denominator: string }; // two OTHER metricKeys

export interface FilterClause { field: string; op: Operator; value: string | string[] | number | [number, number] }

export interface DatasetDef {
  key: string;                 // "stripe.charges"
  integration: IntegrationKey; // "stripe" | "ghl" | "meta" | "clickup" | "proposals" | "calls" | "manual" | "internal"
  label: string;               // "Stripe — Charges"
  description: string;         // shown in the configurator
  fields: FieldDef[];
  dateFields: DateFieldDef[];  // selectable period-scoping date fields
  aggregations: Aggregation["op"][]; // which agg ops make sense here
  rowLabel: (row: RawRow) => { label: string; sublabel?: string }; // for drill-down rows
  rowAmount?: (row: RawRow) => number; // for currency drill-downs
  load: (ctx: LoadCtx) => Promise<RawRow[]>; // fetch the universe once; engine filters/aggregates
}
```

**Key design choice:** datasets `load()` a **normalized array of rows once** for the widest window, then the engine does **filter → date-bucket → aggregate** in memory using the existing `buckets.ts` helpers. This mirrors what `stripe-series.ts` / `meta-series.ts` / the detail route already do, so it's a known-good pattern — not a new risk.

### C.2 The dataset catalog (`lib/kpi/engine/datasets/`)

Each integration maps to a small set of datasets. Enumerated below from what is **realistically queryable today** given the existing clients (`lib/stripe/client.ts`, `lib/ghl/client.ts`, `lib/clickup/client.ts`, `lib/meta/client.ts`, and `lib/db/schema.ts`).

#### Stripe (LIVE — handle with §F money-data care)
| Dataset | Fields (type, operators) | Date fields | Aggregations | Source |
|---|---|---|---|---|
| `stripe.charges` | `status` (enum: succeeded/failed/pending; eq,neq,in), `amount` (money; gt,lt,between), `currency` (enum), `description` (string; contains) | `created` | count, sum(amount), avg(amount) | `stripe().charges.list` (already paginated in metrics route) |
| `stripe.invoices` | `status` (enum: open/paid/void/uncollectible), `amount_paid` (money), `amount_remaining` (money), `is_subscription` (boolean — `parent.type === "subscription_details"`), `due_date_passed` (boolean) | `created`, `due_date` | count, sum(amount_paid), sum(amount_remaining) | `stripe().invoices.list` |
| `stripe.subscriptions` | `status` (enum: active/canceled/past_due), `monthly_amount` (money, normalized via existing `toMonthlyDollars`), `is_prepaid` (boolean — joins `proposals.autoRenew=false`) | `created`, `canceled_at` | count, sum(monthly_amount) | `stripe().subscriptions.list` + existing MRR normalization |

#### GHL
| Dataset | Fields | Date fields | Aggregations | Source |
|---|---|---|---|---|
| `ghl.opportunities` | `status` (enum: open/won/lost/abandoned), `monetaryValue` (money; gt,lt,between), `pipelineId` (enum — populated from `/api/ghl/pipelines`), `pipelineStageId` (enum), `assignedTo` (enum: users), `source` (string; contains) | `createdAt`, `updatedAt` | count, sum(monetaryValue) | `fetchAllGhlOpps` (exists in dashboard route) |
| `ghl.appointments` | `status` (enum), `calendarId` (enum) | `startTime` | count | GHL calendar API (NOTE: currently only proxied via `pipelineStageEvents` heuristic in funnel route — see Q3) |

#### Internal DB (Drizzle) — the highest-confidence datasets (own data, exact dates)
| Dataset | Fields | Date fields | Aggregations | Source table |
|---|---|---|---|---|
| `proposals` | `type` (enum: management/project), `status` (enum: draft/sent/signed/paid/lost/...), `totalAmount` (money), `createdBy` (enum: users), `autoRenew` (boolean) | `sentAt`, `paidAt`, `lostAt`, `signedAt`, `createdAt` | count, sum(totalAmount), avg(totalAmount) | `proposals` |
| `calls` | `callType` (enum: meet/dialer), `direction` (enum), `repEmail` (enum: users) | `startedAt` | count, sum(durationSeconds) | `calls` |
| `software_costs` | `active` (boolean), `category` (string) | (snapshot — no date) | sum(monthlyCost), count | `softwareCosts` |
| `manual_expenses` | `category` (string), `amount` (money) | `month` (period-keyed) | sum(amount) | `manualExpenses` |
| `demo_boards` | `status` (enum), `repId` (enum) | `sentAt`, `bookedAt`, `firstOpenedAt`, `createdAt` | count | `demoBoards` |

#### Meta
| Dataset | Fields | Date fields | Aggregations | Source |
|---|---|---|---|---|
| `meta.spend` | `campaign` (string; contains — matches `offer_funnels.campaignFilter` model) | `date` | sum(spend) | `loadMetaAdSpend` (exists) |

#### ClickUp
| Dataset | Fields | Date fields | Aggregations | Source |
|---|---|---|---|---|
| `clickup.tasks` | `listId` (enum), `status` (enum), `parent_is_null` (boolean — top-level only) | `date_created`, `date_closed` | count | `clickup.get('/list/{id}/task')` (exists in funnel route) |

#### Manual & Derived
- `manual` dataset — value comes straight from `kpi_overrides` for the period. Aggregation is implicitly "the entered number." This folds Jack's existing manual KPIs (Active Projects) into the same model.
- `ratio` aggregation — references **two other metricKeys** (each itself a config), e.g. ROAS = `cash ÷ ad_spend`. The engine resolves both child metrics through itself, then divides. This is how derived metrics stay consistent: they're built from the same configs, not a parallel formula.

### C.3 The Query Engine (`lib/kpi/engine/run.ts`)

```
run(config, range, ctx):
  ds = REGISTRY[config.dataset]
  rows = await ds.load({ fetchStart: prevStart, fetchEnd: end, ctx })   // widest window once
  filtered = rows.filter(r => config.filters.every(f => applyOperator(r, f, ds.fields)))
  if (config.dateField == null):
     // snapshot/level — value as-of period end; trend from metric_snapshots
     value = aggregate(filtered, config.aggregation)        // over the whole filtered universe
     series = await readSnapshotSeries(config.metricKey, buckets)
     prev = series?.[0] ?? value
  else:
     inRange = filtered.filter(r => dateIn(r[config.dateField], start, end))
     prevRange = filtered.filter(r => dateIn(r[config.dateField], prevStart, prevEnd))
     value = aggregate(inRange, config.aggregation)
     prev  = aggregate(prevRange, config.aggregation)
     series = bucketAggregate(filtered, config.dateField, config.aggregation, buckets)  // reuses buckets.ts
  rows = buildDrillRows(filtered, ds, config, range)  // newest-first, in-period highlighted
  return { value, prev, series, rows, unit: config.unit }
```

`aggregate()` = `count` → length; `sum` → Σ field; `avg` → Σ/n; `ratio` → recursively run numerator & denominator configs and divide. **One function feeds card, drawer, dashboard, and preview.**

### C.4 Three concrete worked examples

**Example 1 — "Cash Collected".**
```json
{ "metricKey": "cashCollected", "dataset": "stripe.charges",
  "aggregation": { "op": "sum", "field": "amount" },
  "filters": [{ "field": "status", "op": "eq", "value": "succeeded" }],
  "dateField": "created", "unit": "currency" }
```
Engine: load all charges in [prevStart,end) once → keep `status=succeeded` → sum `amount/100` where `created ∈ [start,end)`. Drill-down = each charge (customer name, description, $, date). **Exactly reproduces today's `cashCollected`** — so Jack can configure it and confirm the number is identical before trusting it. This is the per-metric verification path.

**Example 2 — "Calls Booked" (GHL appointments count).**
```json
{ "metricKey": "bookedCalls", "dataset": "ghl.appointments",
  "aggregation": { "op": "count" },
  "filters": [{ "field": "status", "op": "neq", "value": "cancelled" }],
  "dateField": "startTime", "unit": "count" }
```
Engine: load appointments once → drop cancelled → count where `startTime ∈ range`. This finally **wires a metric that is `pending: true` today** (`bookedCalls` in metric-catalog) — proving the new model is strictly more capable than the old one.

**Example 3 — a Proposals-based ratio: "Project Win Rate".**
```json
{ "metricKey": "projWinRate", "dataset": "ratio",
  "aggregation": { "op": "ratio", "numerator": "projPaidCount", "denominator": "projSentCount" },
  "unit": "percent" }
```
where `projPaidCount` = `{proposals, count, [type=project], paidAt}` and `projSentCount` = `{proposals, count, [type=project], sentAt}`. Engine runs both child configs through itself and divides. Drill-down shows the two component numbers + formula (reuses the existing `kind:"breakdown"` drawer path).

---

## D. KPIs page + Dashboard both derive from configs

### D.1 The single read path
A new helper `lib/kpi/engine/index.ts` exports:
```ts
getMetricValue(metricKey, range, ctx): Promise<MetricResult>      // one metric
getMetricValues(metricKeys[], range, ctx): Promise<Record<key, MetricResult>>  // batched, shared dataset loads
```
`getMetricValues` is the batching win: if five configured metrics all read `stripe.charges`, the dataset is loaded **once** and shared across them (dedupe by dataset key within the request). This is strictly better than today's three separate Stripe fetches.

### D.2 `/kpis` page
- `GET /api/kpis/metrics` is **reimplemented** to: read all enabled `kpi_configs`, call `getMetricValues(allConfiguredKeys, range)`, return `{ [metricKey]: {value, prev, series, unit, unconfigured} }`. The section layout (Business/Management/Project/Sales/Funnel) stays as-is in `kpis-client.tsx`; only the value source changes. Unconfigured metrics return `unconfigured:true` and the card renders the ghost state.
- `GET /api/kpis/detail` is **reimplemented** to: load the config for `metricKey`, call `getMetricValue` and return its `rows` (paginated). The `KpiDetailSheet` contract (`{title, explanation, kind, rows, periodSum, ...}`) is preserved, so the drawer UI doesn't change.

### D.3 Dashboard = pure snapshot
- The dashboard KPI widget pool (`KPI_POOL` in `lib/dashboard-kpis.ts`) becomes a **selection of metricKeys from the same registry** — it pins *configured* KPIs, it does not define their math.
- `GET /api/dashboard/kpis` is **reimplemented** to delegate to `getMetricValues(pinnedKeys, range, ctx)`. The 200-line metric switch is **deleted**. Rep scoping (Q4) is handled by the engine via `ctx` + a dataset filter on `createdBy`/`repEmail`/`assignedTo`.
- The 4-up admin strip (`/api/kpi/admin-metrics`) likewise delegates to `getMetricValues(["cashCollected","adSpendMeta","calls_admin","leads"], mtdRange)`. **Same numbers as `/kpis`, guaranteed.**

Net effect: the dashboard literally cannot show a different "Cash" than `/kpis`, because both call `getMetricValue("cashCollected", range)`.

### D.4 Live preview + drill-down (the confidence surface)
- **Live preview** (inside the configurator, before save): a new `POST /api/kpis/preview` takes an *unsaved* config draft + range, runs `engine.run(draft, range)` **without persisting**, returns `{ value, count, unit, sampleRows: first 5 }`. The drawer shows **"Currently reads $48,210 from 96 records"** and a 5-row sample. This is the moment Jack & Gage trust the wiring.
- **Drill-down** (after save): the existing `KpiDetailSheet` opens on card click and hits `/api/kpis/detail`, which now returns engine rows. Same beautiful drawer, now driven by config.

---

## E. UI Design — the Configurator (impeccable-shape level, OUR design system)

Design tokens in play (from `app/globals.css`): `--primary #0F3A5C` (navy), `--gold #D4A574`, `--card #FFFFFF`, `--border #D9D4CD`, `--accent-green #2D5E3F`, `--destructive #DC2626`, headings `--font-heading` (Plus Jakarta Sans), body Inter. Cream/navy/gold. This matches the existing `SettingsPanel` + `KpiDetailSheet` styling exactly (right-side drawer, `rounded-[7px]`, `bg-primary/5` highlight). The configurator is a **right-side drawer**, same family as the existing two, so it feels native instantly.

### E.1 Entry point
Each metric cell (`components/kpis/metric-cell.tsx`) gains a state:
- **Configured** → shows the value (today's behavior). Hover reveals a small gear in the top-right corner. Click value = drill-down (today); click gear = configurator.
- **Unconfigured** → ghost state: a dashed-border cell, muted `—`, and a tiny "Configure" pill in gold. The whole cell is the click target → opens the configurator.

```
┌──────────────────────────┐    ┌──────────────────────────┐
│ CASH COLLECTED        ⚙  │    │ BOOKED CALLS             │
│ $48,210                  │    │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄    │
│ ▁▂▅▇ +12% vs last mo     │    │  —   [ Configure ▸ ]     │  ← gold pill, dashed border
└──────────────────────────┘    └──────────────────────────┘
        configured                      unconfigured
```

### E.2 The configurator drawer flow (4 steps, one scroll, live preview pinned at bottom)

```
┌─ Configure · Cash Collected ─────────────────── ✕ ─┐
│ DETAIL VIEW · KPI WIRING                            │
│                                                     │
│ ① INTEGRATION                                       │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐         │
│  │Strp│ │GHL │ │Prop│ │Meta│ │Call│ │ClkU│  ...    │  ← chips, selected = navy fill
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘         │
│                                                     │
│ ② SCOPE  (datasets for Stripe)                      │
│  ◉ Charges (income & payments)                      │  ← radio cards w/ 1-line desc
│  ○ Invoices                                         │
│  ○ Subscriptions (MRR)                              │
│                                                     │
│ ③ MEASURE                                           │
│  Aggregation:  [ Sum ▾ ]   Field: [ Amount ▾ ]      │  ← dropdowns from dataset.fields
│  Date field:   [ Created ▾ ]   ( ⊙ period-scoped )  │
│                                                     │
│ ④ FILTERS                              [ + Add ]    │
│  ┌─────────────────────────────────────────────┐   │
│  │ Status   [ is ▾ ]   [ Succeeded ▾ ]      ✕  │   │  ← field/op/value all dropdowns
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │ Amount   [ greater than ▾ ]  [ 0      ]   ✕ │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
├─ LIVE PREVIEW ──────────────────────────────────────┤
│  Currently reads                                    │
│  $48,210   ·   96 records          [ View rows ▸ ]  │  ← bg-primary/5 card, gold accent on $
│  ┌ Sample ──────────────────────────────────────┐  │
│  │ Acme Co · Retainer      $2,400   Jun 12       │  │
│  │ Brightline · Deposit    $1,000   Jun 11   …   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [ Cancel ]                         [ Save config ] │  ← Save = navy, disabled until valid
└─────────────────────────────────────────────────────┘
```

**Interaction & motion notes (consult `emil-design-eng` at craft time for exact easing):**
- Drawer slides in from right, 200ms (matches `KpiDetailSheet`'s `slide-in-from-right duration-200`).
- Steps reveal progressively: ② appears only after ① is picked; ③/④ after ② — a quiet `fade+translate-y-1` so the form never feels like a wall.
- The **live preview debounces ~400ms** after any change and re-hits `/api/kpis/preview`. While computing: the number cross-fades to a shimmer, never a layout jump. On error (source down): a quiet inline `⚠ Couldn't reach Stripe — try again`, never a silent 0.
- Filter rows: field dropdown drives which operators show (from `FieldDef.operators`), which drives the value control (enum→dropdown, money→number, date→date picker, string→text-with-`contains`-only). **You cannot type a property name. Ever.** That's the confidence guarantee, made visual.
- "View rows" expands the same `KpiDetailSheet` content inline (or opens it) so preview and drill-down are visibly the same data.
- Empty/zero preview is a **legitimate, calm** state: "Reads $0 — no records match these filters yet" (not an error).

### E.3 Founder ritual support
A subtle header on `/kpis` when ≥1 metric is unconfigured: *"4 KPIs not yet configured"* with a "Configure all" walkthrough that opens each unconfigured metric's drawer in sequence — built for the Jack-and-Gage sit-down. (Nice-to-have; flag for Q5.)

---

## F. Phased Implementation Plan

Every phase ends at a **verifiable gate**: `tsc --noEmit` passes + deploy to prod (no preview env exists) + manually confirm one number. Money-data phases additionally run **Gate 5 (security)** and **Gate 6 (data integrity)**.

### Phase 0 — Spike & contract lock (no prod write) · ~0.5 day
- Write `lib/kpi/engine/types.ts` (registry + config + result types). No runtime behavior.
- Stub `REGISTRY` with **one** dataset (`stripe.charges`) and the `run()` engine.
- Unit-style check: `run(cashCollectedConfig, mtdRange)` in a script equals today's `/api/kpis/metrics` `cashCollected` to the cent. **Gate: numbers match exactly.** Build `tsc` clean.

### Phase 1 — `kpi_configs` table + read-only engine behind a flag · ~1 day
- Add `kpiConfigs` to schema + Drizzle migration (additive). **Gate 6: confirm migration is additive + idempotent; reversible = drop table.**
- Implement `getMetricValue` / `getMetricValues` with dataset-dedupe batching, reusing `buckets.ts`, `snapshots.ts`, `last-good.ts`.
- No UI yet. Seed 1–2 configs via a script. **Gate: tsc + deploy; engine reachable but nothing user-facing changed.**

### Phase 2 — Full dataset catalog · ~2 days
- Implement all datasets in §C.2 (`datasets/*.ts`), each with `load`, `fields`, `dateFields`, `rowLabel`, `rowAmount`. Reuse existing loaders (`stripe-series`, `meta-series`, `rep-proposal-commission`, `fetchAllGhlOpps`).
- **Gate 5 (Stripe is LIVE):** datasets must never leak secrets/PII into responses — drill rows carry display name/amount/date only (mirror today's `customerName()` which already returns name|email|id). No raw Stripe objects cross the API boundary. Confirm admin-only on every read.
- **Gate:** for each dataset, a script asserts its config reproduces the matching legacy number. tsc + deploy.

### Phase 3 — Configurator UI + preview endpoint · ~2 days (Gates 1–4)
- **Gate 1 `/grill-me`** + **Gate 2 `/impeccable shape`** on the configurator BEFORE any JSX (this plan is the shape input; Jack confirms the brief).
- `POST /api/kpis/preview` (admin-only, runs unsaved draft, no persist).
- `POST /api/kpis/configs` + `PATCH/DELETE` (admin-only writes — see Gate 5 below).
- Build the drawer with **Gate 3 `/impeccable craft`**; finish with **Gate 4 `/impeccable polish` + `harden`** (long names, 1000+ rows, slow Stripe, empty filters, source-down).
- **Gate 5:** config write routes must enforce `getSessionUser().role === "admin"` (reps cannot configure). Validate `filters` against the dataset registry on write — reject unknown field/op (no malformed config can persist). No mass-assignment: whitelist `{metricKey, dataset, aggregation, filters, dateField, unit, enabled}` from the body.
- **Gate:** configure `cashCollected` live, preview matches old card, save, card reads from config. tsc + deploy.

### Phase 4 — Flip `/kpis` to config-as-truth (per metric) · ~1.5 days
- Reimplement `GET /api/kpis/metrics` + `/api/kpis/detail` to read configs; **fallback to legacy compute for any still-unconfigured metric** (Q1 decides: legacy-fallback vs hard-0). This is the gradual cutover — Jack configures + verifies each metric, then it's truly config-driven.
- **Gate:** every Business/Management/Sales metric configured and cross-checked against its frozen legacy value. Requesting-code-review (multi-file). tsc + deploy.

### Phase 5 — Dashboard becomes a snapshot · ~1 day
- Reimplement `GET /api/dashboard/kpis` + `/api/kpi/admin-metrics` to delegate to `getMetricValues`. Delete the duplicate metric switches. Rep scoping via `ctx` + dataset filter.
- **Gate:** dashboard "Cash" === `/kpis` "Cash Collected" byte-for-byte. The snapshots cron iterates enabled snapshot configs. tsc + deploy. Final `requesting-code-review`.

### Phase 6 — Polish & founder ritual · ~0.5 day
- Unconfigured ghost states, "X KPIs not configured" header, optional "Configure all" walkthrough. `/impeccable polish`. tsc + deploy.

**Total: ~8.5 engineering days**, each phase independently shippable and verifiable. Nothing forces a big-bang cutover.

### Risk register
| Risk | Severity | Mitigation |
|---|---|---|
| LIVE Stripe — wrong filter shows wrong money | High | Live preview + per-metric verification vs frozen legacy number before trust; admin-only |
| Secret/PII leak via drill rows | High (Gate 5) | Rows carry display fields only; no raw integration objects cross API; admin-only |
| Malformed config persisted | Med (Gate 6) | Validate filters against registry on write; `unique(metricKey)`; `enabled` staging flag |
| Perf — many datasets per request | Med | Dataset-dedupe batching + existing 60s detail cache + `last-good` guard |
| Prod-only / no preview (deploy breaks active session) | Med | Batch deploys per phase (memory: deploy discipline); each phase tsc-gated |
| GHL appointments not cleanly queryable today | Med | Q3 — ship that dataset in a later sub-phase; everything else proceeds |

---

## G. Open Questions / Decisions for Jack & Gage

1. **Unconfigured = 0, or = legacy value during migration?** Recommend: during Phases 4–5, **fall back to the current hardcoded number** for unconfigured metrics (so the page never regresses while you wire things up), then flip to **hard-0** once every metric has a config. Confirm you want this two-stage behavior vs. immediate hard-0.
2. **Who can configure?** Plan assumes **admins only** (reps can view, not wire). Both you and Gage are admins — confirm Gage's account `role === "admin"`.
3. **GHL "appointments" dataset** — today "booked calls" is *inferred* from `pipeline_stage_events` stage names containing "booked/call/appointment" (a heuristic, see `funnel/route.ts`). Do you want a **true** GHL calendar/appointments dataset (more API wiring, higher confidence) or is the stage-event proxy acceptable for v1?
4. **Rep-scoped dashboard KPIs** — reps see their own numbers via `createdBy`/`repEmail`/`assignedTo` filters injected from session. Confirm the rep-scoping rule per metric is "the rep who *sent* the proposal" (today's `rep-proposal-commission` rule) for all proposal metrics.
5. **"Configure all" founder walkthrough** — build it now (Phase 6) or ship configs-per-card first and add the guided sequence later?
6. **Offer Funnels** — keep the separate `offer_funnels` mechanism (per-funnel pipeline metrics) as-is, or eventually express funnels as just another set of configs (filter `ghl.opportunities` by `pipelineId in [...]`)? Recommend: leave funnels untouched in this project; revisit after the core is config-driven.
7. **Snapshot cron coverage** — snapshot-type configs (MRR, pipeline value) need a daily `metric_snapshots` write to draw trends. Confirm we extend the existing daily snapshots cron to iterate enabled snapshot configs (Hobby = daily-only cron, which is fine for these levels).

---

## Appendix — Exact files touched (for the build agent)

**New:**
`lib/kpi/engine/types.ts`, `lib/kpi/engine/run.ts`, `lib/kpi/engine/index.ts`, `lib/kpi/engine/datasets/{stripe,ghl,proposals,calls,meta,clickup,internal,manual}.ts`, `app/api/kpis/preview/route.ts`, `app/api/kpis/configs/route.ts` (+ `[metricKey]/route.ts`), `components/kpis/kpi-configurator.tsx`, Drizzle migration for `kpi_configs`.

**Modified:**
`lib/db/schema.ts` (+`kpiConfigs`), `app/api/kpis/metrics/route.ts` (delegate to engine), `app/api/kpis/detail/route.ts` (delegate to engine), `app/api/dashboard/kpis/route.ts` (delegate, delete switch), `app/api/kpi/admin-metrics/route.ts` (delegate), `components/kpis/metric-cell.tsx` (gear + ghost state), `components/kpis/kpis-client.tsx` (wire configurator open), `lib/dashboard-kpis.ts` (pool = key selection, not math), snapshots cron route (iterate enabled snapshot configs).

**Reused unchanged:** `lib/kpi/buckets.ts`, `lib/kpi/snapshots.ts`, `lib/kpi/last-good.ts`, `lib/kpi/stripe-series.ts`, `lib/kpi/meta-series.ts`, `lib/kpi/rep-proposal-commission.ts`, `components/kpis/KpiDetailSheet.tsx`, all integration clients.
