# Proposal date integrity (management retainers)

Goal: every date a human sees on a management proposal agrees with every other date,
and with what Stripe actually charges. Scope is the 90-day "spread" plan.

## Done (2026-08-13), display side only. No Stripe or live subscription touched.

- [x] **Root cause: `addPeriod` swallowed an explicit 0.** `const n = count && count > 0 ? count : 1`
      meant `addPeriod(anchor, "day", 0)` added a day, so Payment 1 printed one day after the
      start date quoted in the sentence above it. This was the 10-Aug-vs-11-Aug mismatch.
      Now only a missing count defaults to 1. Verified against the DB first:
      `billing_interval_count` is only ever 1, 3 or null, so behaviour is identical for
      every existing proposal.
- [x] **30 days from the PREVIOUS payment, not from signup.** Was fixed +30/+60 offsets, which
      ignored split first payments (a split at day 14 still put Month 2 at day 30, a 16-day gap).
      Now chained: split at day 14 gives Month 2 at day 44, Month 3 at day 74.
- [x] **One anchor.** New `billingAnchor()` (= `contractStartAt ?? startDate`) feeds the sentence,
      the schedule, the term window and the invoice date. Previously the schedule used
      `contractStartAt ?? startDate` while the sentence and invoice date used `startDate` alone,
      so the document contradicted itself the moment the first payment cleared.
- [x] **One format.** Invoice date was `MM/DD/YYYY` ("08/10/2026", reads as 8 October day-first).
      Now "10 Aug 2026" everywhere. The PDF also formatted in the *server's* local timezone via
      date-fns; it now uses the same UTC helper as the web page.
- [x] **Term window.** Was 3 calendar months (10 Nov) while the last payment was 9 Oct. Now ends
      30 days after the final payment.
- [x] **Regression proof:** `scripts/prove-proposal-dates.ts`. 128 permutations (4 stored-time
      conventions x 8 boundary start dates incl. month-end, DST and leap year x 4 split shapes)
      plus 3 anchor checks, run under 5 timezones from UTC-11 to UTC+14. 640 assertions, 0 failures.
      Run with: `./node_modules/.bin/tsx scripts/prove-proposal-dates.ts`

## Decisions (Jack, 2026-08-13)
- Keep literal 30-day spacing on the document. Change Stripe to match it, not the reverse.
- Existing invoices, billing dates, and anything a client has already seen must not change.
- The fix applies to every proposal that runs through the system AFTER it lands, not before.

## Done: freeze what clients have already seen

- [x] Migration `db/migrations/0049_proposal_schedule_snapshot.sql` (additive, idempotent:
      two nullable ADD COLUMN IF NOT EXISTS, metadata-only, no table rewrite). NOT YET APPLIED.
- [x] `scripts/apply-0049-schedule-snapshot.mjs`, asserting statement count, comments stripped
      before splitting on ";" per the 0045/0046 lesson.
- [x] `schedule_snapshot` / `schedule_snapshot_at` in `lib/db/schema.ts`.
- [x] `managementSchedule()` returns a frozen snapshot verbatim when present, so all four
      surfaces inherit the freeze from one gate and cannot disagree.
- [x] Snapshot written on first send (`app/api/proposals/[id]/send/route.ts`); a re-send keeps
      the original rows.
- [x] Column threaded through all four read paths (list, public token, PDF, sign).
- [x] `scripts/backfill-schedule-snapshots.mjs` reproduces the OLD BUGGY algorithm on purpose,
      so already-sent proposals freeze to what the client actually saw. Verified it reproduces
      Gage's screenshot exactly: 11 Aug / 9 Sep / 9 Oct. Dry run by default, `--commit` to write.
- [x] Proof extended: snapshot renders verbatim, absent snapshot computes corrected dates, and
      an empty array is not mistaken for a freeze. 134 checks x 4 timezones, 0 failures.

### ORDER OF OPERATIONS (getting this wrong changes what clients see)
1. Apply 0049 (adds the columns; changes nothing at runtime).
2. Run the backfill with `--commit` (freezes every non-draft proposal to its current output).
3. ONLY THEN deploy the corrected date logic.
Deploying before step 2 re-renders already-sent proposals with different dates.

## Open: the document still disagrees with Stripe by up to a day

The schedule says +30/+60 days. The price is created with `recurring: { interval: "month" }`
(`lib/proposals/ninety-day-billing.ts:121`), which is calendar months, despite the comment at
:85 saying "pay every 30 days". From a 10 Aug start the doc says 9 Sep / 9 Oct; Stripe charges
10 Sep / 10 Oct.

**Constraint: existing subscriptions and charges must not change.** That holds naturally, because
the price object is created per-proposal at checkout time (`idempotencyKey: 90d_spread_price_<id>`).
A live subscription keeps the price it was created with. Only new checkouts pick up a new config.

### Required changes, all conditional on the subscription's ACTUAL interval so live subs are untouched

- [ ] `createSpreadSubscriptionCheckout` → `recurring: { interval: "day", interval_count: 30 }`.
      Affects new checkouts only.
- [ ] **`stopAfterTerm` (`ninety-day-billing.ts:166`) — the dangerous one.** It sets
      `cancel_at = start + 3 calendar months` (~92 days). At a true 30-day cadence, charges fire at
      days 0, 30, 60 **and 90**, two days before the cancel lands: an extra $1,500 to every spread
      client. Must branch on the sub's real interval: `month` keeps calendar months (existing subs
      unchanged), `day`/30 cancels at day 90.
- [ ] `ninety-day-fulfillment.ts:136` (`addMonths(firstCharge, MONTHS_IN_TERM - 1)`) has the same
      calendar assumption. Same conditional treatment.
- [ ] `setSubscriptionAutoRebill` treats `interval_count > 1` as a term price. At 30 that is a false
      positive and every spread sub choosing "monthly" would be wrongly flagged
      `needs_monthly_resubscribe`. Detect term length, not raw count.
- [ ] MRR normalisation treats a `day` interval as `x 365 / 12`, so $1,500 would read as $1,520.83/mo.
      Eight sites: `stripe/sync.ts:50`, `stripe/watchdog.ts:30`, `kpis/metrics:53`, `kpis/business:53`,
      `kpis/detail:73`, `customers/sync:160`, `kpi/stripe-series:36`, `kpi/engine/datasets/stripe:56`.
      Normalise a 30-day cycle to one month so Management MRR does not drift.
- [ ] Prove end to end with a Stripe Test Clock, as `scripts/stripe-test/prove-spread-subscription.mjs`
      already does: exactly 3 charges, exactly $4,500, no 4th charge, on the dates the proposal printed.

## STOP — staff review (2026-08-13) says DO NOT DEPLOY the Stripe half yet

Test clock `scripts/stripe-test/prove-spread-30day.ts` DID pass the money-critical parts for the
day x 30 shape: 3 charges, $4,500 exactly, no 4th charge, sub self-cancelled, and charge dates
equal to the printed dates. But it passed partly because the test signs ON `startDate`. Review
found that is the unrepresentative case.

### Resolved 2026-08-13 (second pass)
- [x] **CRITICAL 1 FIXED.** `contractStartAt` is now set from `sub.start_date` (the exact moment
      Stripe took payment 1) on the `spread_sub` path, and the schedule freezes there rather than
      at send. Test clock proves it: quoted 3 Aug, PAID 7 Aug -> document prints and Stripe charges
      the same 7 Aug / 6 Sep / 6 Oct. 11 passed, 0 failed
      (`scripts/stripe-test/prove-spread-30day.ts`).
- [x] **HIGH 3 FIXED (report-only).** Verified against prod: 4 of 4 spread rows have
      autoRenew=false and 2 hold live subscriptions, so they WERE in the cron's net. The cron now
      SKIPS spread and returns them under `skippedSpread` instead of setting
      `cancel_at_period_end`, which would have truncated a $4,500 term to one $1,500 payment.
      Deliberately does NOT auto-repair: that would mean writing to a live subscription.
- [x] **MEDIUM 6 FIXED.** `stopAfterTerm`'s month branch now clamps to the real month end.
      Verified: across all 65 month-end start dates in a year, zero cancel_at values land after a
      renewal (previously 31 Aug -> 1 Dec and 31 Jan -> 1 May both leaked a 4th charge).
- [ ] **HIGH 4 NOT FIXED — deliberately.** See the note at the end of this section.

- [x] ~~CRITICAL 1 — dates still will not match in the normal case.~~ (superseded, fixed above)
- [ ] ~~original CRITICAL 1 text kept for history:~~ Stripe anchors the sub to
      CHECKOUT COMPLETION; the document anchors to `startDate`. `billingAnchor()` is meant to
      re-anchor via `contractStartAt`, but the `spread_sub` path NEVER SETS IT
      (`ninety-day-fulfillment.ts:290-300`); only `onFirstMonthCollected()` at :116 writes it, and
      spread_sub does not call it. Sent 3 Aug, signed 7 Aug -> doc 3 Aug/2 Sep/2 Oct, Stripe
      7 Aug/6 Sep/6 Oct. FOUR days out, worse than the one-day bug this set out to fix.
      Also: the snapshot is frozen at SEND, before the anchor is knowable. Freezing at SIGN,
      after `contractStartAt` is set, is probably the right shape.
- [ ] **HIGH 3 — `reconcile-prepaid-terms` can truncate a spread term to ONE payment.**
      It selects `management AND autoRenew=false AND stripeSubscriptionId IS NOT NULL` and sets
      `cancel_at_period_end`. Spread defaults to `autoRenew=false`. If `stopAfterTerm` fails its
      retries, the cron cancels at day 30 after ONE $1,500 charge of $4,500 and logs it "fixed".
      Exclude `managementOption='spread'` or gate on `priceCycleDays(price) >= 90`.
- [ ] **HIGH 4 — `invoice.paid` marks a spread proposal fully PAID after payment 1 of 3.**
      `app/api/stripe/webhook/route.ts:338` reads `Invoice.subscription`, removed in the pinned
      2026-04-22 API, so that correlation is dead code and it falls through to customer+amount
      matching. $1,500 invoice matches the $1,500 monthly `totalAmount` -> status "paid", receipt
      emailed, onboarding tasks, commission fired, after 1/3 collected. PRE-EXISTING.
- [x] **HIGH 5 — a NINTH MRR copy was missed.** `lib/kpi/engine/datasets/stripe-local.ts` (live
      whenever `stripeSource=local`). FIXED: now delegates to the shared helper.
- [ ] **MEDIUM 6 — the retained month branch of `stopAfterTerm` overflows end-of-month.**
      `setUTCMonth(+3)` on 31 Aug gives 1 Dec, admitting a 4th charge on 30 Nov. Pre-existing, but
      my new comment wrongly calls that branch safe. Use the clamping `addMonths()` that already
      exists in `ninety-day-fulfillment.ts:32`.
- [ ] **MEDIUM 7 — `autoRebillMode: "monthly"` post-term now bills 12.17x/yr** ($18,250 vs the
      $18,000 quoted) because the sub keeps its 30-day price. Needs a price swap to month x1 at
      term end, or the client sentence must stop saying "monthly".
- [ ] **MEDIUM 8 — customer-visible wording.** Stripe renders the price from the interval, so
      Checkout and every invoice line now read "$1,500.00 / 30 days" while the proposal says
      "3 monthly payments". Also `lib/customers/sync.ts:159` renders "$1,500/day" internally.
- [ ] **LOW 9** — `priceCycleDays` defaults to 30 for an unknown price, failing OPEN on an
      upfront sub. Should fail closed (treat unknown as a term price).
- [ ] **LOW 11** — `scripts/churn-audit.ts:38` has no "day" case (30x MRR understatement);
      `scripts/fix-90day-billing.mjs:127` still creates a month price.
- [ ] **LOW 12** — `sweepMissingTermEnds()` is cited at `ninety-day-fulfillment.ts:272` as the
      backstop for a failed `stopAfterTerm` but DOES NOT EXIST anywhere in the repo.

Review confirmed clean: no proration risk (no live sub ever has its price mutated), requirement A
holds (per-proposal prices + per-proposal idempotency keys), and no stale-snapshot path exists
(every date/pricing edit is gated on `status === 'draft'`).

### Alternative if the billing change is not wanted
Make the display calendar-monthly (10 Aug, 10 Sep, 10 Oct) to match what Stripe already does.
Zero billing risk, every date agrees, but payments are 30-31 days apart rather than exactly 30.
