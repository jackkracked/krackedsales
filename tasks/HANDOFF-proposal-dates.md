# HANDOFF — proposal dates + 30-day billing + status model

**Written 2026-08-13. Read this FIRST, before touching anything in this area.**
Companions: `tasks/proposal-date-integrity-plan.md` (what was fixed and what is open),
`tasks/proposal-status-model-plan.md` (the status redesign and its decisions).

---

## 0. Read this before you type

This work touches LIVE STRIPE BILLING. The owner (Jack) has had prior invoicing bugs and has said
repeatedly he cannot afford another. Non-negotiables, in his words:

1. **Never re-clone this repo.** The live working copy is `/Users/jackpointer/Projects/kracked-sales`
   and it runs dozens of commits ahead of GitHub with ~200 uncommitted files. A fresh clone
   silently destroys all of it. The folder at
   `~/Documents/Agentic Workflows/Kracked Sales System/kracked-sales` is a dead April scaffold with
   no `.git` — it is NOT the project. See `tasks/lessons.md`.
2. **Do not modify existing subscriptions, invoices, or anything a client has already seen.**
   Fixes apply from now onwards. Existing rows may be RECLASSIFIED in the DB (Jack approved that
   specifically for the status model) but no live Stripe object may be written to.
3. **Confirm before any prod migration, backfill --commit, or deploy.** Dry run and show output first.
4. Skills live in `.claude/skills/` IN THIS REPO. Start Claude Code from this directory or they
   will not load. Impeccable is v4.0.4 (also installed globally at `~/.claude/skills/`).

---

## 1. State of the world

### Deployed to production
**NOTHING.** No `vercel --prod` has been run. All code changes below are working-tree only.

### Changed in the production DATABASE (already done, verified)
- Migration `0049` APPLIED: `proposals.schedule_snapshot` (jsonb) + `schedule_snapshot_at` (timestamptz).
  Additive, nullable, metadata-only. NULL means "compute the schedule", which is the old behaviour.
- Backfill COMMITTED: 4 spread proposals frozen to the dates their clients actually saw
  (Dan Bruxer 11 Aug / 9 Sep / 9 Oct, Mind Balanced, No Cap Soda, Tofu Go). 54 rows correctly
  skipped as having no spread schedule.

Verify both with:
```sql
SELECT contact_name, status, schedule_snapshot->0->>'when' AS first_row, schedule_snapshot_at
FROM proposals WHERE schedule_snapshot IS NOT NULL ORDER BY contact_name;
-- expect 4 rows, Dan Bruxer first_row = "11 Aug 2026"
```

### Stripe
No live subscription was created, modified, or cancelled. All Stripe exercise was on
`STRIPE_TEST_SECRET_KEY` (in `.env.verify`) with Test Clocks.

---

## 2. File manifest — EXACTLY what was changed

The working tree has ~200 files modified by Jack independently of this work. These are the only
files this effort touched. Do not assume any other diff is related.

### New files (untracked)
| File | Purpose |
|---|---|
| `db/migrations/0049_proposal_schedule_snapshot.sql` | the snapshot columns (APPLIED) |
| `scripts/apply-0049-schedule-snapshot.mjs` | migration runner (ALREADY RUN) |
| `scripts/backfill-schedule-snapshots.mjs` | freezes sent/signed proposals to their OLD dates (ALREADY RUN --commit) |
| `scripts/prove-proposal-dates.ts` | 134-assertion date regression suite |
| `scripts/stripe-test/prove-spread-30day.ts` | Test Clock proof of the 30-day cadence |
| `lib/stripe/cycle.ts` | single MRR normaliser shared by 9 call sites |
| `tasks/proposal-date-integrity-plan.md` | detailed findings |
| `tasks/proposal-status-model-plan.md` | status redesign |

### Modified files
| File | Change |
|---|---|
| `lib/proposals/billing.ts` | `addPeriod` zero fix; `SPREAD_CADENCE_DAYS`; `billingAnchor()`; chained 30-day `managementSchedule` + snapshot gate; `spreadTermDays()`; `termWindow` spread branch; `clientSentence` anchor |
| `lib/proposals/ninety-day-billing.ts` | price `day x30`; `priceCycleDays()`; `stopAfterTerm` day-branch + month clamp; `isTermPrice` by cycle length |
| `lib/proposals/ninety-day-fulfillment.ts` | `spread_rest` price `day x30`; `stopAt` in days; **sets `contractStartAt` from `sub.start_date` and freezes the snapshot on first payment** |
| `lib/db/schema.ts` | `scheduleSnapshot`, `scheduleSnapshotAt` |
| `lib/pdf/agreement-pdf.tsx` | invoice date uses `fmtDay` + `billingAnchor`; snapshot on the type |
| `components/proposals/public/proposal-signing-page.tsx` | invoice date x2 + deposit line use `billingAnchor` |
| `components/proposals/proposal-detail-slide-over.tsx` | "from" date uses `billingAnchor` |
| `app/api/proposals/[id]/send/route.ts` | freeze REMOVED (moved to first payment); `let`→`const` lint |
| `app/api/proposals/route.ts`, `public/[token]/route.ts`, `[id]/pdf/route.ts`, `[id]/sign/route.ts` | select `scheduleSnapshot` |
| `app/api/cron/reconcile-prepaid-terms/route.ts` | SKIPS spread subs (never modifies them), reports via `skippedSpread` |
| 9 MRR sites | delegate to `lib/stripe/cycle.ts`: `stripe/sync.ts`, `stripe/watchdog.ts`, `kpis/{metrics,business,detail}/route.ts`, `customers/sync.ts`, `kpi/stripe-series.ts`, `kpi/engine/datasets/stripe.ts`, `kpi/engine/datasets/stripe-local.ts` |

---

## 3. The rules the code now implements

**The 90-day clock starts when the client PAYS the first payment.** Not sent, not signed.
`billingAnchor()` = `contractStartAt ?? startDate`; `contractStartAt` is written from Stripe's
`sub.start_date` on `checkout.session.completed`, and the schedule is frozen at that same moment.
Before payment the printed dates are an estimate off `startDate`.

**Every payment is 30 days after the PREVIOUS one, not a fixed offset from signup.** With a split
first payment, month 2 is 30 days after the LAST split portion. Jack's worked example:

```
pay 10 Sep $2,000 (portion 1) -> 24 Sep $2,500 (portion 2, +14d)
                              -> 24 Oct (+30d)  -> 23 Nov (+30d)
```
2, 3 and 4 splits all verified.

**Stripe bills `interval: "day", interval_count: 30`,** so the charge dates equal the printed
dates. `cancel_at` is day 90 exactly; three calendar months (~92 days) would admit a 4th charge.

---

## 4. How to re-verify everything (run these, do not trust this document)

```bash
cd ~/Projects/kracked-sales
./node_modules/.bin/tsc --noEmit -p tsconfig.json        # expect 0 errors

# Date logic: 134 assertions. Run under several timezones; output must be identical.
for T in UTC America/Chicago Asia/Tokyo Pacific/Kiritimati Pacific/Midway; do
  TZ=$T ./node_modules/.bin/tsx scripts/prove-proposal-dates.ts | tail -1
done                                                      # expect FAILURES: 0 each

# Stripe Test Clock (test key only, ~4 min). Proves quoted-date != pay-date parity,
# 3 charges, $4,500, no 4th charge, self-cancel.
./node_modules/.bin/tsx scripts/stripe-test/prove-spread-30day.ts   # expect 11 passed, 0 failed
```

---

## 4b. MUST VERIFY BEFORE DEPLOY (blocked on network, 2026-08-13)

The `invoice.paid` guard in `app/api/stripe/webhook/route.ts` uses two signals to decide that an
invoice is a MID-TERM spread payment (2 or 3) rather than the first:
  1. `proposals.firstMonthComplete = true`, and
  2. `invoice.billing_reason !== "subscription_create"`.

**`billing_reason` was NOT verified against a live day x 30 subscription.** Outbound HTTPS to
api.stripe.com was timing out (`HTTP 000`), so the Test Clock run that would have confirmed it
could not complete.

Diagnosed as a HOST-LEVEL restriction, not a Stripe outage and not a code fault: from the agent
environment `registry.npmjs.org` returned 200 and the Neon database was reachable, while
`api.stripe.com` and `api.github.com` both returned `HTTP 000`. Earlier Test Clock runs in the
same session succeeded, so it tightened part-way through. If Stripe is unreachable again, run the
proof from a normal terminal (or via `! <command>` in Claude Code) rather than assuming the
script is broken. The assertions are already written into
`scripts/stripe-test/prove-spread-30day.ts` — just run it when the network is back:

```bash
./node_modules/.bin/tsx scripts/stripe-test/prove-spread-30day.ts   # expect 13 passed, 0 failed
```
It asserts invoice 1 is `subscription_create` and invoices 2 and 3 are `subscription_cycle`.

The guard is deliberately built so NEITHER signal alone can cause harm: skipping requires BOTH, so
a wrong `billing_reason` cannot skip payment 1 (firstMonthComplete is false then), and a race on
firstMonthComplete cannot skip it either (billing_reason still identifies the opening invoice).
Do not simplify it to a single condition without running the proof first.

## 4c. LATE CHANGES (2026-08-13, after the second staff review)

- **`issueNextInstalmentInvoice` is DISABLED** in `app/api/stripe/webhook/route.ts` (invoice.paid,
  instalment branch). NOT broken, NOT rejected. It creates a Stripe invoice with
  `collection_method: "send_invoice"` + `auto_advance: true`, so STRIPE EMAILS THE CLIENT. The
  dates deploy had to be silent. It is armed on real clients (Gymkhana Fine Foods, instalment due
  2026-09-10; also Handmade By Meg, Maria Tsismentzoglou, Roots Apothecary). Re-enable it as its
  OWN watched deploy — it collects the ~$21.8k the old code never billed. One-line uncomment; the
  import is retained with an eslint-disable so nothing else has to change.
- **Term completion now has an owner** (it did not — the mid-term guard removed the only mechanism,
  accidental though it was). TWO paths, because the primary one could not be confirmed:
  1. a new `customer.subscription.deleted` case in the webhook, and
  2. a READ-ONLY backstop in `reconcile-prepaid-terms` (spread + `sub.status === 'canceled'` +
     >= 3 mirrored paid invoices → `completed`).
  **`customer.subscription.deleted` has NEVER been delivered to this endpoint** (checked
  `stripe_events`: 10 other types present). Could not confirm whether it is unsubscribed or simply
  has not happened yet, because the Stripe API was unreachable. **ACTION: check the Stripe
  dashboard that this event is enabled on the webhook endpoint.** The cron covers it either way.
  Neither path dispatches `proposal.paid` (that already fired at first payment), writes to Stripe,
  or sends anything. Completion requires >= 3 collected payments, so an early cancellation cannot
  be laundered into a win. `paidAt` is preserved, never re-stamped. `lost`/`void` are never
  overwritten.
- **Snapshot no longer short-circuits after payment** (`lib/proposals/billing.ts`). It used to
  return unconditionally, which made the re-freeze at first payment a NO-OP: a proposal frozen
  pre-payment kept its estimated dates forever. Mind Balanced would have shown a first payment 13
  days BEFORE its own signature. Now the snapshot wins only while `contractStartAt` is null.
  Covered by 3 new assertions in `scripts/prove-proposal-dates.ts`.
- **Two comments corrected.** The `Invoice.subscription` note (I claimed the legacy field was dead
  under the pinned API version — WRONG, both fields are present in every stored webhook payload;
  the pinned apiVersion governs OUTBOUND calls, not webhook delivery versions, so step 2 has been
  live all along and the legacy fallback is LOAD-BEARING) and the `sweepMissingTermEnds` note
  (that function does not exist).

## 5. OPEN WORK, in dependency order

### 5a. `invoice.paid` webhook + status model — DO THESE TOGETHER
`app/api/stripe/webhook/route.ts` ~line 338.

Two bugs, and **fixing either one alone makes things worse**:
- Correlation path 2 reads `Invoice.subscription`, removed from the pinned API version
  (`lib/stripe/client.ts` pins `2026-04-22.dahlia`). It is dead code. The correct read is
  `inv.parent.subscription_details.subscription` — `lib/stripe/sync.ts:115` already does this.
- Execution therefore falls to path 3 (customer + amount). A $1,500 spread invoice matches the
  $1,500 monthly `totalAmount`, so the proposal is marked `paid` after 1 payment of 3, firing the
  paid receipt, onboarding tasks and `dispatchWorkflowEvent("proposal.paid")` (commission).

**Why together:** repairing path 2 on its own makes it match spread invoices MORE reliably and
mark them paid MORE often. The guard ("a spread proposal is not `paid` until the term completes")
must land in the same change.

Evidence this is live, from production:
```
paid     | management | spread | firstMonthComplete=true   <- Dan Bruxer
partial  | management | spread | firstMonthComplete=true   <- Tofu Go
```
Identical situation, two different statuses, written by two systems that disagree.

### 5b. The status model
Full design in `tasks/proposal-status-model-plan.md`. Summary:
`sent → signed → partial (first month not fully collected) → active (paid, term running or
extended) → completed (term done AND nothing follows)`, plus `past_due`.
Status is DERIVED FROM THE MIRRORED SUBSCRIPTION (`local_stripe_subscriptions`), not from
`autoRebillMode`, because **Jack renews by extending the subscription directly in Stripe** — a
stored flag would go stale and show `completed` for a client still being billed.
Progress ("Term 1 · 2 of 3 · $3,000 of $4,500") is DERIVED, never a status value.

Jack's decisions: commission out of scope for now (but do not silently move when
`proposal.paid` fires — flag it); renewals happen in Stripe; existing rows ARE to be reclassified.

**A reader audit of `proposals.status` was commissioned to find the blast radius before any
writer changes. If its results are not recorded in `proposal-status-model-plan.md`, RE-RUN IT.**
`active` / `completed` / `past_due` already appear in the codebase (71 / 27 / 5 usages) for other
entities — do not assume those are proposal statuses.

### 5c. Progress badge UI
Gated: `/impeccable shape` → confirm with Jack → `craft` → `polish` → `harden`.
PRODUCT.md register is `product`. Principles that bind here: "earn every pixel" and "data is the
UI" — an inline dense indicator, not another card. Anti-reference: generic SaaS metric cards.

### 5d. Smaller open items (detail in the date-integrity plan)
- `autoRebillMode: "monthly"` post-term bills 12.17x/yr on a 30-day price while the client was
  told "monthly" ($18,250 vs $18,000). Needs a price swap at term end, or reworded copy.
- Stripe renders "$1,500.00 / 30 days" on Checkout and every invoice line, while the proposal says
  "3 monthly payments". Wording decision for Jack.
- `lib/customers/sync.ts:159` renders "$1,500/day" in the customers view for a spread client.
- `priceCycleDays` returns 30 for an unknown/missing price, which fails OPEN on an upfront sub.
  Should fail closed (treat unknown as a term price).
- `scripts/churn-audit.ts:38` has no `"day"` case (30x MRR understatement);
  `scripts/fix-90day-billing.mjs:127` still creates a month price.
- `sweepMissingTermEnds()` is cited at `ninety-day-fulfillment.ts:272` as the backstop for a failed
  `stopAfterTerm` but DOES NOT EXIST. The cron no longer papers over it either (5a/3 above).

---

## 6. Traps that already bit once

- `addPeriod(d, "day", 0)` used to add ONE day (`count && count > 0 ? count : 1`). That was the
  original "10 Aug vs 11 Aug" bug. Verified safe to change: `billing_interval_count` in prod is
  only ever 1, 3, or null.
- The schedule is computed at RENDER time. Any change to the date logic retroactively alters what
  an already-sent proposal displays. That is why `schedule_snapshot` exists.
- `@/` path aliases do NOT resolve under `tsx`. Scripts importing app code must use relative paths
  and avoid modules that use `@/` imports.
- `.ts` scripts run as CJS here (no top-level await): wrap in `void (async () => { ... })()`.
  `.mts` is ESM but cannot read named exports from a `.ts` module.
- Test Clock invoices finalise slightly AFTER the billing instant. Advance a day or two past the
  expected charge or assertions fail spuriously.
