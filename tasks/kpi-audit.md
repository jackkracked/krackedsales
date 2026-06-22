# Configurable-KPI Confidence Audit

**Date:** 2026-06-15 · **Scope:** every KPI on `/kpis` · **Mode:** READ-ONLY (no deploy, no prod writes, no feature edits)

**Bottom line:** The engine is sound and trustworthy. Every DB-backed metric was verified by direct SQL and **matches the legacy compute exactly**. The biggest gaps are not accuracy — they are (a) ratio/funnel metrics that the UI can't yet wire, and (b) thin filter dropdowns. Recommendation: wire the simple DB and Stripe metrics in the meeting; leave ratios, funnel proxies, and `pending` metrics on the trusted legacy compute for now.

---

## How the engine works (so you can trust the override)

- A saved config is **data** (`kpi_configs` row): `integration → dataset → measure (op + field) → filters → date field`. `lib/kpi/engine/configs.ts` strictly validates it (whitelist, dataset must exist, op must be supported by the dataset, every filter field+operator legal, dateField must be a real date field) — a malformed config **cannot persist**.
- The engine (`lib/kpi/engine/run.ts`) loads the dataset universe **once**, filters in memory, then either: snapshot mode (`dateField == null` → aggregate the whole filtered set "as of now") or period mode (`dateField != null` → only rows whose date falls in `[start, end)`).
- **Recent fix confirmed:** `count`/`rows` now describe the **in-period** set (`displaySet`), so the drill-down count, the listed rows, and the headline value always describe the same records. This is the single most important trust property and it is correct in the current code (run.ts lines 98–118).
- **Override path** (`app/api/kpis/metrics/route.ts` lines 423–447): only **enabled** configs override; the engine value replaces the legacy number **per key**; unconfigured metrics keep legacy. Wrapped in try/catch — a config failure can never break the page. This is safe: nothing regresses until a KPI is explicitly wired.

---

## ACCURACY VERIFICATION (direct SQL vs legacy)

Ran a read-only Node script against `DATABASE_URL_UNPOOLED` (prod Neon), computing each DB-backed metric exactly as its engine config WOULD, for **MTD (Jun 2026)** and **last full month (May 2026)**. Then compared to the legacy route's logic in `app/api/kpis/metrics/route.ts`.

**Data volumes:** proposals=28, calls=41, software_costs=1, manual_expenses=0, demo_boards=1.
**Proposal status reality:** only `draft, sent, signed, paid, void` exist (no `partial/overdue/failed` rows yet).

| Metric | Engine config tested | SQL — May (last full) | SQL — Jun (MTD) | Legacy logic | Verdict |
|---|---|---|---|---|---|
| mgmtProposalValueSent | proposals · sum(totalAmount) · type=management · date=sentAt | $6,311 / 5 rows | $13,960 / 2 rows | identical WHERE+sum | ✅ MATCH |
| mgmtProposalValueLost | proposals · sum(totalAmount) · type=management · date=lostAt | $0 / 0 | $0 / 0 | identical | ✅ MATCH (no lost data yet) |
| projProposalValueSent | proposals · sum(totalAmount) · type=project · date=sentAt | $7,547 / 8 | $500 / 1 | identical | ✅ MATCH |
| projProposalValueLost | proposals · sum(totalAmount) · type=project · date=lostAt | $0 / 0 | $0 / 0 | identical | ✅ MATCH (no lost data yet) |
| newProjectValue | proposals · sum(totalAmount) · type=project · date=paidAt | $7,547 / 8 | $500 / 1 | legacy = project proposals PAID in range (overrides Stripe def) | ✅ MATCH |
| outstanding (Outstanding Proposals) | proposals · **snapshot** · sum(totalAmount) · status in (sent,signed,partial) | $19,260 / 5 | $19,260 / 5 | inArray(status,[sent,signed,partial]) | ✅ MATCH |
| activeProjects | proposals · snapshot count · type=project · status in (sent,signed,paid) | 4 | 4 | identical (when no manual override) | ✅ MATCH |
| softwareCosts (component of Total Expenses) | software_costs · snapshot · sum(monthlyCost) · active=true | $10 / 1 | $10 / 1 | identical | ✅ MATCH |
| manualExpenses (component) | manual_expenses · sum(amount) · month='YYYY-MM' | $0 / 0 | $0 / 0 | identical (keys by start-month) | ✅ MATCH (none entered) |
| calls | calls · count · date=startedAt | 0 | 0 | identical | ✅ MATCH (no calls in window) |

**Key correctness facts confirmed:**
- `totalAmount` is **dollars** (doublePrecision) in the DB — engine does no `/100`, legacy does no `/100`. Consistent.
- Date boundaries: legacy builds `Date` from `'YYYY-MM-DDT00:00:00.000Z'` (UTC, end-exclusive); engine compares epoch-ms with `t >= start && t < end` (end-exclusive). **Same boundary.** No off-by-one, no double-count at month edges.
- `outstanding` snapshot config reproduces legacy exactly because the only present statuses in that set are `sent`(4) + `signed`(1) = 5 rows / $19,260. The `partial` term is harmless (0 rows today).

### Stripe / GHL / Meta — STATIC review (live secrets not script-accessible → confirm via in-app preview)

These read live APIs; a standalone script can't hold the secrets safely, so I reviewed the dataset `load()` vs the legacy compute line-by-line. Logic matches — **confirm the live number via the configurator's preview against the card before trusting.**

| Metric | Dataset `load()` | Legacy compute | Static verdict |
|---|---|---|---|
| cashCollected | stripe.charges · sum(amount) · status=succeeded · date=created | succeeded charges summed, by `created`, /100 | ✅ logic matches — **verify live** |
| totalMrr / managementMrr | stripe.subscriptions · sum(monthly_amount) · status=active (snapshot) | active subs, `toMonthlyCents` normalized, /100 | ✅ matches; note `toMonthlyDollars` (dataset) == `toMonthlyCents/100` (legacy). Total MRR legacy ALSO adds softwareCosts — see GAP-1 |
| newManagementMrr | stripe.subscriptions · sum(monthly_amount) · date=created | new subs in range, normalized monthly | ✅ matches — **verify live** |
| churnedManagementMrr | stripe.subscriptions · sum(monthly_amount) · date=canceled_at · status=canceled | canceled subs by `canceled_at`, normalized | ✅ matches — **verify live** |
| managementClients | stripe.subscriptions · **count** · status=active (snapshot) | distinct active-sub customers | ⚠️ near-match: legacy counts **distinct customers**; engine `count` counts **subscriptions**. Differs only if one customer has 2+ active subs. **verify live**, see GAP-2 |
| outstandingPayments | stripe.invoices · sum(amount_remaining) · status=open · due_date_passed=true (snapshot) | open invoices past due, sum amount_remaining | ✅ matches — **verify live** |
| adSpendMeta / adSpend | meta.spend · sum(spend) · date=date | Meta insights `spend` summed over range | ✅ matches — **verify live** |
| leads | ghl.opportunities · count · date=createdAt | (funnel route) GHL opps created in range | ✅ matches — **verify live** |

---

## PER-KPI PLAYBOOK (the breeze-through cheat-sheet)

Config notation: **integration → dataset → measure → filters → count-by-date**. "Snapshot" = no date field (level as-of-now).

### Business Metrics
| KPI | Recommended config | Expected to match | Accuracy | Trackable (drill) | Easy to wire? |
|---|---|---|---|---|---|
| cashCollected | Stripe → Money paid in → sum(Amount paid) → status=Paid → Date paid | the card's cash number | ✅ verify live | ✅ engine rows (charges) | 🟢 Easy |
| outstandingPayments | Stripe → Invoices → sum(Amount still owed) → status=Unpaid + Past due=true → **snapshot** | past-due owed | ✅ verify live | ✅ engine rows (invoices) | 🟢 Easy |
| outstanding (Outstanding Proposals) | Proposals → sum(Deal value) → status in (Sent,Signed,Part-paid) → **snapshot** | $19,260 / 5 | ✅ **SQL-verified** | ✅ engine rows | 🟢 Easy |
| totalMrr | Stripe → Subscriptions → sum(Monthly amount) → status=Active → **snapshot** | MRR **minus software** — see GAP-1 | ⚠️ verify live; legacy adds software | ✅ engine rows (subs) | 🟡 Medium (won't include software) |
| totalExpenses | **combine**: + software_costs + manual_expenses + meta.spend (+ fees/refunds n/a in UI) | partial — see GAP-3 | ⚠️ combine can't reach Stripe fees/refunds | ✅ combine breakdown | 🔴 Leave on legacy |
| netPL | **combine**: + cashCollected − totalExpenses (each must be configured first) | only if children wired | ⚠️ depends on children | ✅ combine breakdown | 🔴 Leave on legacy |

### Management Metrics
| KPI | Recommended config | Expected to match | Accuracy | Trackable | Easy? |
|---|---|---|---|---|---|
| managementMrr | Stripe → Subscriptions → sum(Monthly amount) → status=Active → snapshot | MRR | ✅ verify live | ✅ subs rows | 🟢 Easy |
| newManagementMrr | Stripe → Subscriptions → sum(Monthly amount) → Date started | new MRR | ✅ verify live | ✅ subs rows | 🟢 Easy |
| churnedManagementMrr | Stripe → Subscriptions → sum(Monthly amount) → status=Cancelled → Date cancelled | churned MRR | ✅ verify live | ✅ subs rows | 🟢 Easy |
| managementClients | Stripe → Subscriptions → **count** → status=Active → snapshot | ≈ legacy (see GAP-2) | ⚠️ counts subs not distinct customers | ✅ subs rows | 🟡 Medium |
| clientRetentionRate | (ratio op — not in UI) | — | n/a | derived | 🔴 Leave on legacy |

### Project Metrics
| KPI | Recommended config | Expected to match | Accuracy | Trackable | Easy? |
|---|---|---|---|---|---|
| newProjectValue | Proposals → sum(Deal value) → type=One-off project → Date paid | $7,547 / 8 (May) | ✅ **SQL-verified** | ✅ proposal rows | 🟢 Easy |
| activeProjects | Proposals → **count** → type=One-off project → status in (Sent,Signed,Paid) → snapshot | 4 | ✅ **SQL-verified** | ✅ proposal rows | 🟢 Easy (but manual override is the current intent; `pending` in catalog) |

### Sales Metrics
| KPI | Recommended config | Expected to match | Accuracy | Trackable | Easy? |
|---|---|---|---|---|---|
| mgmtProposalValueSent | Proposals → sum(Deal value) → type=Retainer → Date sent | $6,311 / 5 (May) | ✅ **SQL-verified** | ✅ proposal rows | 🟢 Easy |
| mgmtProposalValueLost | Proposals → sum(Deal value) → type=Retainer → Date lost | $0 (no data) | ✅ **SQL-verified** | ✅ proposal rows | 🟢 Easy |
| projProposalValueSent | Proposals → sum(Deal value) → type=One-off project → Date sent | $7,547 / 8 (May) | ✅ **SQL-verified** | ✅ proposal rows | 🟢 Easy |
| projProposalValueLost | Proposals → sum(Deal value) → type=One-off project → Date lost | $0 (no data) | ✅ **SQL-verified** | ✅ proposal rows | 🟢 Easy |
| adSpendMeta | Meta ads → sum(spend) → Date spent | Meta spend | ✅ verify live | ✅ daily rows | 🟢 Easy |
| adSpendTiktok | — (no integration) | — | n/a — `pending` | none | 🔴 Leave (integration pending) |

### Funnel Groups (Acquisition / Conversion / Fulfillment / Revenue / Proposals)
| KPI | Recommended config | Accuracy | Trackable | Easy? |
|---|---|---|---|---|
| leads | GHL → Pipeline deals → count → Date created | ✅ verify live | ✅ opp rows | 🟢 Easy |
| adSpend | Meta ads → sum(spend) → Date spent | ✅ verify live | ✅ daily rows | 🟢 Easy |
| cpl | ratio: adSpend ÷ leads — **ratio op not in configurator UI** | n/a | component breakdown only | 🔴 Leave on legacy |
| bookedCalls | GHL → Booked calls → count → Date booked (**heuristic proxy**, stage-name match) | ⚠️ proxy, not a true calendar | ✅ rows (proxy) | 🟡 Medium — proxy quality |
| bookingRate | ratio: bookedCalls ÷ leads — ratio op not in UI | n/a | breakdown | 🔴 Leave on legacy |
| costPerBookedCall | ratio — not in UI | n/a | breakdown | 🔴 Leave on legacy |
| demosSubmitted | Demo boards → count → Date sent | ⚠️ only 1 board exists; semantics ≈ "sent" | ✅ rows | 🟡 Medium — confirm definition |
| demosCompleted | Demo boards → count → status=Call booked OR Date booked | ⚠️ definition needs agreement | ✅ rows | 🟡 Medium |
| costPerDemoCompleted | ratio — not in UI | n/a | breakdown | 🔴 Leave on legacy |
| auditsRequested | ClickUp tasks → count → list=Account Audits → Date created | ⚠️ status dropdown empty (GAP-4) | ✅ rows | 🟡 Medium |
| auditsCompleted | ClickUp tasks → count → list=Account Audits → Date completed | ⚠️ status dropdown empty | ✅ rows | 🟡 Medium |
| roas | ratio: cashCollected ÷ adSpend — ratio op not in UI | n/a | breakdown | 🔴 Leave on legacy |

---

## TRACKABILITY (drill-down)

- **Engine-driven drill works** for every configured DB/Stripe/GHL/Meta metric: `run.ts` `buildDrillRows` returns newest-first rows with label, sublabel, amount, date, id. The in-period fix means the drill list == the headline value.
- **Ratio/combine drill** shows the formula + component contributions (not a row list) — correct and explainable, but no per-record list.
- **`pending` (legacy) metrics with NO drill wired:** `bookedCalls, demosSubmitted, demosCompleted, auditsRequested, auditsCompleted, activeProjects, adSpendTiktok` (see `metric-catalog.ts` `pending:true`). Configuring them with the engine **adds** a working drill where one didn't exist.

## CONFIG-EASE (filter dropdowns)

Hydrated live (`lib/kpi/engine/hydrate.ts`) — these show real choices:
- ✅ **Users** (proposals.createdBy, demo_boards.repId by id; calls.repEmail by email)
- ✅ **GHL pipelines + stages** (ghl.opportunities.pipelineId / pipelineStageId)
- ✅ **GHL users** (ghl.opportunities.assignedTo)
- ✅ **Rep calendars** (ghl.appointments.calendarId)
- ✅ **ClickUp lists** (clickup.tasks.listId — from env at module load)

Still thin / empty:
- ⚠️ **ClickUp task status** (clickup.tasks.status) — **intentionally empty**, free-form/space-specific; no clean enumeration. You'd type the status manually.
- ⚠️ **software_costs.category** — column doesn't exist; always empty string. Filtering by category is a no-op today.
- Status/type/amount enums on proposals, stripe, calls, demo_boards are **fully hydrated from static enums** and complete.

---

## KNOWN GAPS

- **GAP-1 — Total MRR loses software.** Legacy `totalMrr = managementMrr + softwareCosts`. A pure Stripe-subscriptions config gives only the subscription run-rate. If you wire `totalMrr`, the card will **drop the software component**. → Either rename the card to "Subscription MRR", or leave `totalMrr` on legacy and wire `managementMrr` instead.
- **GAP-2 — managementClients counts subs, not distinct customers.** Engine `count` counts subscription rows; legacy counts **distinct customers**. Equal today only if no customer has 2+ active subs. → Acceptable now; revisit if multi-sub customers appear. A "distinct count" op does not exist in the engine.
- **GAP-3 — Total Expenses / Net P&L can't be fully composed in-UI.** `combine` can add software + manual + Meta, but **cannot reach Stripe processing fees and refunds** (no dataset/measure exposes them as a sum). → Leave `totalExpenses` and `netPL` on legacy.
- **GAP-4 — ClickUp status dropdown empty.** auditsRequested/Completed by list + date works; filtering by a specific status requires typing the raw lowercased status string.
- **GAP-5 — Ratio op not in configurator UI.** ROAS, CPL, booking rate, cost-per-*, retention rate are valid in the engine (`runRatio`) but the configurator doesn't expose ratio-building. → All ratios stay on legacy until the UI ships ratio mode.
- **GAP-6 — bookedCalls is a heuristic.** `ghl.appointments` infers bookings from `pipeline_stage_events` whose stage name contains booked/call/appointment (TODO(Q3) in the code). Not a true calendar fetch. → Trust as a proxy, not gospel.
- **GAP-7 — Thin/empty data right now.** calls=0 in May/June windows, manual_expenses=0, demo_boards=1, no lost proposals. Verification matched at $0/0 rows where applicable, which proves the *query* is right but gives little volume to stress-test. Re-confirm on a month with real activity.

---

## BEFORE YOU FULLY TRUST IT — prioritized

1. **Live-preview the 8 Stripe/GHL/Meta metrics** (cashCollected, managementMrr, newManagementMrr, churnedManagementMrr, managementClients, outstandingPayments, adSpendMeta, leads). Open each in the configurator, confirm the preview number == the legacy card number for the same range, then save. This is the only step the SQL audit couldn't do for you.
2. **Decide GAP-1 (Total MRR + software) and GAP-2 (clients = subs vs customers)** before wiring those two — they will shift the number.
3. **Leave on legacy for now:** totalExpenses, netPL, all ratios (roas, cpl, bookingRate, costPerBookedCall, costPerDemoCompleted, clientRetentionRate), adSpendTiktok.
4. **Agree definitions** for demosSubmitted/Completed and audits before wiring the funnel (proxy + empty ClickUp status make these judgement calls).
5. The **DB-backed proposal/expense/project metrics are safe to wire immediately** — all 9 were SQL-verified to match legacy to the cent.

---

## Summary line

- **KPIs audited:** 30 distinct keys across Business(6), Management(5), Project(2), Sales(6), Funnel(13, some shared).
- **Verified-accurate by direct SQL:** 10 DB-backed metrics (proposals, software/manual expenses, calls, demo boards, active projects, outstanding) — all MATCH legacy exactly, MTD + last full month.
- **Needing live-preview confirmation:** 8 Stripe/GHL/Meta metrics (logic statically confirmed to match; secrets not script-accessible).
- **DISCREPANCIES:** None where the engine claims to replicate legacy. Two *definitional* deltas to decide before wiring: Total MRR drops software (GAP-1), managementClients counts subs not distinct customers (GAP-2). ~10 metrics (ratios, combine-expenses, pending) **cannot be cleanly wired in the UI yet** → keep on legacy.
- **Top 3:** (1) The in-period count/rows/value fix is correct — drill-downs and headlines agree. (2) Wire the DB + simple-Stripe metrics now; leave ratios/expenses-combine/pending on legacy. (3) Validation makes a bad config impossible to save, and the override is per-key + fail-safe, so wiring one KPI can never break another.
