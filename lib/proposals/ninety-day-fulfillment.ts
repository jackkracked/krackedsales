/**
 * 90-Day Management fulfillment — the DB-stateful layer that sits between Stripe events and the
 * pure engine (lib/proposals/ninety-day-billing.ts):
 *   - fulfillNinetyDayCheckout: runs on `checkout.session.completed`. Upfront → apply the auto-rebill
 *     stop + mark paid. Spread → store the saved card + schedule months 2 & 3 in the ledger.
 *   - chargeDueNinetyDaySplits: the daily cron. Reconciles-then-charges every due ledger row exactly
 *     once, flags billing issues, and marks the proposal paid when the term completes.
 *
 * Stripe hygiene (the North Star): spread never creates invoices (PaymentIntents only, nothing to
 * void); upfront is one subscription stopped via cancel_at_period_end (no voiding). Every charge is
 * idempotency-keyed to its ledger row AND reconciled against Stripe first, so no path double-charges
 * or leaves orphaned objects.
 */
import type Stripe from "stripe";
import { and, eq, lte, inArray, ne, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, ninetyDaySplits, users } from "@/lib/db/schema";
import { postToSalesChannel, sendSlackDM } from "@/lib/proposals/slack-notify";
import { dispatchWorkflowEvent, buildProposalPayload } from "@/lib/workflows/triggers";
import {
  setSubscriptionAutoRebill,
  stopAfterTerm,
  chargeOffSession,
  findSucceededChargeForSplit,
  MONTHS_IN_TERM,
  type AutoRebillMode,
} from "@/lib/proposals/ninety-day-billing";
import { SPREAD_CADENCE_DAYS, managementSchedule, type BillingTerms } from "@/lib/proposals/billing";
import { routeToCloser } from "@/lib/proposals/credit";

/** Add whole months, clamping to the last valid day so Jan 31 + 1mo = Feb 28/29, not Mar 3.
 *  (Plain setMonth overflows end-of-month dates, which would drift the 90-day cadence.) */
function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const r = new Date(d);
  r.setDate(1); // avoid overflow while shifting the month
  r.setMonth(r.getMonth() + n);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}

type Session = Stripe.Checkout.Session;

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

type SplitPortion = { amount: number; offsetDays: number };
const readSplit = (v: unknown): SplitPortion[] | null =>
  Array.isArray(v) && v.length > 1 ? (v as SplitPortion[]) : null;

/** Idempotently schedule months 2..N of the term from a base date (no-op if MONTH rows exist). */
async function scheduleMonthsFrom(proposalId: string, monthlyCents: number, currency: string, base: Date): Promise<number> {
  const existing = await db()
    .select({ id: ninetyDaySplits.id })
    .from(ninetyDaySplits)
    .where(and(eq(ninetyDaySplits.proposalId, proposalId), eq(ninetyDaySplits.kind, "month")));
  if (existing.length > 0) return 0;
  const rows = [];
  for (let n = 2; n <= MONTHS_IN_TERM; n++) {
    rows.push({
      proposalId, chargeNumber: n, kind: "month", label: `Month ${n} of ${MONTHS_IN_TERM}`,
      amountCents: monthlyCents, currency, dueDate: addMonths(base, n - 1), idempotencyKey: `split_${proposalId}_m${n}`,
    });
  }
  if (rows.length) await db().insert(ninetyDaySplits).values(rows);
  return rows.length;
}

/** Create the first-month split ledger: portion 1 (already charged by the Checkout → paid) + portions
 *  2..N (pending, due base + offsetDays). Idempotent (skips if first_portion rows already exist). */
async function createFirstPortionRows(proposalId: string, split: SplitPortion[], base: Date, currency: string): Promise<void> {
  const existing = await db()
    .select({ id: ninetyDaySplits.id })
    .from(ninetyDaySplits)
    .where(and(eq(ninetyDaySplits.proposalId, proposalId), eq(ninetyDaySplits.kind, "first_portion")));
  if (existing.length > 0) return;
  const rows = split.map((p, i) => ({
    proposalId,
    chargeNumber: i + 1,
    kind: "first_portion",
    label: `First payment ${i + 1} of ${split.length}`,
    amountCents: Math.round((p.amount ?? 0) * 100),
    currency,
    dueDate: addDays(base, p.offsetDays || 0),
    status: i === 0 ? "paid" : "pending", // portion 1 cleared at Checkout
    chargedAt: i === 0 ? base : null,
    idempotencyKey: `fp_${proposalId}_${i + 1}`,
  }));
  await db().insert(ninetyDaySplits).values(rows);
}

/**
 * The first month is fully collected (all split portions cleared) → the contract officially
 * starts, and the REMAINING months become a real Stripe subscription anchored to this moment.
 *
 * Proven in scripts/stripe-test/prove-split-first-payment.mjs (17/17, uneven portions):
 *   $600 at signing, $900 fourteen days later, then $1,500 at +30 days and $1,500 at +60,
 *   then it stops. Exactly 4 charges, exactly $4,500, with an invoice + PDF for each
 *   subscription payment.
 *
 * A subscription rather than more ledger rows because it gives the client an invoice per
 * payment, counts toward Management MRR and churn automatically, and lets Stripe do the
 * charging, retrying and chasing. Falls back to the old ledger only if we have no card or no
 * customer, so a missing card can never mean "collect nothing".
 */
async function onFirstMonthCollected(
  stripe: Stripe,
  proposalId: string,
  contractStart: Date,
  currency: string,
  monthlyCents: number,
): Promise<void> {
  await db()
    .update(proposals)
    .set({ contractStartAt: contractStart, firstMonthComplete: true, updatedAt: new Date() })
    .where(eq(proposals.id, proposalId));

  const [p] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!p) return;
  if (p.stripeSubscriptionId) return; // already running, never create a second one

  const customerId = p.stripeCustomerId;
  const pmId = p.stripePaymentMethodId;
  if (!customerId || !pmId) {
    // No saved card: fall back to the ledger so the money is still collected, and say so.
    await scheduleMonthsFrom(proposalId, monthlyCents, currency, contractStart);
    await postToSalesChannel(
      `:warning: ${p.contactName}: first month collected but no saved card, so months 2 & 3 fall back to the legacy charge ledger (no invoices, no MRR).`,
    ).catch(() => {});
    return;
  }

  // Month 2 lands 30 days after the first month completed, month 3 thirty days after that,
  // then it stops. cancel_at sits one cycle past the final charge.
  const firstCharge = addDays(contractStart, SPREAD_CADENCE_DAYS);
  // cancel_at sits ONE CYCLE past the final charge, and the cycle is 30 days, not a calendar
  // month. addMonths here gave ~61 days for 2 cycles, so once the price became day x30 the
  // charges (day 30, day 60) would have been followed by a THIRD at day 90, inside a cancel_at
  // of ~day 91. Counting in the same unit the price bills in keeps it at exactly 2 charges.
  const stopAt = addDays(firstCharge, SPREAD_CADENCE_DAYS * (MONTHS_IN_TERM - 1));
  try {
    const price = await stripe.prices.create(
      {
        currency,
        unit_amount: monthlyCents,
        // Every 30 days, matching the schedule the client signed. See the note on stopAt above.
        recurring: { interval: "day", interval_count: SPREAD_CADENCE_DAYS },
        product_data: { name: `90 Day Retention Sprint — ${p.contactName}` },
      },
      { idempotencyKey: `90d_rest_price_${proposalId}` },
    );
    const sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: price.id }],
        trial_end: Math.floor(firstCharge.getTime() / 1000),
        cancel_at: Math.floor(stopAt.getTime() / 1000),
        collection_method: "charge_automatically",
        default_payment_method: pmId,
        proration_behavior: "none",
        description: `90 Day Retention Sprint — remaining ${MONTHS_IN_TERM - 1} payment(s)`,
        metadata: { proposal_id: proposalId, ninety_day: "spread_rest" },
      },
      { idempotencyKey: `90d_rest_sub_${proposalId}` },
    );
    await db()
      .update(proposals)
      .set({ stripeSubscriptionId: sub.id, updatedAt: new Date() })
      .where(eq(proposals.id, proposalId));
  } catch (e) {
    console.error(`[90d] could not start the remaining-months subscription for ${proposalId}:`, e);
    // Never leave the rest of the contract uncollectable: fall back to the ledger.
    await scheduleMonthsFrom(proposalId, monthlyCents, currency, contractStart);
    await postToSalesChannel(
      `:rotating_light: ${p.contactName}: could not start the subscription for months 2 & 3, fell back to the charge ledger. Money will still collect, but with no invoices and no MRR.`,
    ).catch(() => {});
  }
}

/**
 * Self-heal: if the webhook ever crashed before scheduling a spread term (e.g. the payment_intent
 * retrieve timed out), the client paid the first month but months 2 & 3 would never charge. Every
 * cron pass, find spread proposals that have paid their first month but have no ledger rows, recover
 * the saved card from Stripe if needed, and schedule the remaining months. Idempotent.
 */
async function backfillMissingSpreadSchedules(stripe: Stripe): Promise<number> {
  const candidates = await db()
    .select({
      id: proposals.id,
      totalAmount: proposals.totalAmount,
      currency: proposals.currency,
      signedAt: proposals.signedAt,
      updatedAt: proposals.updatedAt,
      pm: proposals.stripePaymentMethodId,
      firstPaymentSplit: proposals.firstPaymentSplit,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.managementOption, "spread"),
        // "active" and "completed" are included so this sweep keeps seeing spread deals once the
        // status model lands. Without them a deal in "active" would be INVISIBLE here, and if the
        // sign/webhook path ever crashed before writing the ledger, months 2 and 3 would never be
        // scheduled and never charged — silently, forever. This is the exact failure this sweep
        // exists to catch. No-op today: no proposal currently holds either value.
        inArray(proposals.status, ["signed", "partial", "active", "completed"]),
        // CRITICAL: never touch a proposal that already has a subscription. Since the spread
        // option became a real monthly subscription, a signed spread deal carries BOTH
        // managementOption 'spread' AND a live subscription. Without this guard, this nightly
        // sweep would see "spread with no ledger rows", build a ledger, and the charge cron
        // would then bill the client a SECOND time every month on top of their subscription.
        isNull(proposals.stripeSubscriptionId),
      ),
    );

  let healed = 0;
  for (const p of candidates) {
    const rows = await db().select({ id: ninetyDaySplits.id }).from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, p.id));
    if (rows.length > 0) continue; // already scheduled

    // Recover the saved card. Normally on the proposal; if the webhook crashed before storing it,
    // look up the client's successful first payment (metadata carries proposal_id).
    let pmId = p.pm;
    if (!pmId) {
      try {
        const res = await stripe.paymentIntents.search({ query: `metadata['proposal_id']:'${p.id}' AND status:'succeeded'`, limit: 1 });
        const pi = res.data[0];
        if (pi) {
          const full = await stripe.paymentIntents.retrieve(pi.id, { expand: ["payment_method"] });
          pmId = typeof full.payment_method === "string" ? full.payment_method : full.payment_method?.id ?? null;
        }
      } catch (e) {
        console.error(`[90d backfill] first-payment lookup failed for ${p.id}:`, e);
      }
    }
    if (!pmId) continue; // client hasn't paid the first month yet → nothing to schedule

    const base = p.signedAt ?? p.updatedAt ?? new Date();
    const monthlyCents = Math.round(p.totalAmount * 100);
    const split = readSplit(p.firstPaymentSplit);
    if (split) {
      // Split first payment: recreate the portion ledger; months follow when the last portion clears.
      await createFirstPortionRows(p.id, split, base, p.currency);
      await db().update(proposals).set({ stripePaymentMethodId: pmId, status: "partial", updatedAt: new Date() }).where(eq(proposals.id, p.id));
    } else {
      // No split: the whole first month cleared at checkout → term starts, schedule months.
      await db().update(proposals).set({ stripePaymentMethodId: pmId, status: "partial", updatedAt: new Date() }).where(eq(proposals.id, p.id));
      await onFirstMonthCollected(stripe, p.id, base, p.currency, monthlyCents);
    }
    healed++;
  }
  return healed;
}

/**
 * Handle a completed 90-day Checkout. Idempotent: safe to run again on a webhook redelivery.
 * Returns whether it handled the session so the webhook knows to skip the legacy path.
 */
export async function fulfillNinetyDayCheckout(
  stripe: Stripe,
  session: Session,
): Promise<{ handled: boolean; kind?: "upfront" | "spread" | "spread_sub" }> {
  const meta = session.metadata ?? {};
  const kind = meta.ninety_day as "upfront" | "spread" | "spread_sub" | undefined;
  const proposalId = meta.proposal_id;
  if (!kind || !proposalId) return { handled: false };

  const [proposal] = await db().select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!proposal) return { handled: false };

  // ── spread_sub: pay every 30 days, as a real monthly subscription ────────────────────────
  // Checkout has already charged payment 1 and created the subscription. The ONLY thing left is
  // the stop date, which Stripe refuses to accept on a Checkout Session (verified: "Received
  // unknown parameter: subscription_data[cancel_at]"). So it MUST be applied here. If it is not,
  // the client is billed monthly forever, so this retries and then shouts rather than failing
  // quietly.
  //
  // ⚠️ CORRECTION: an earlier comment here claimed "a twice-daily sweep also re-checks it, see
  // sweepMissingTermEnds()". NO SUCH FUNCTION EXISTS anywhere in the repo. The Slack alert below
  // is the ONLY backstop, and reconcile-prepaid-terms now deliberately skips spread subs (setting
  // cancel_at_period_end on one would truncate a $4,500 term to $1,500), reporting them under
  // `skippedSpread` in its JSON response, which nothing currently reads. If stopAfterTerm fails
  // all three attempts a 4th charge is possible with no automated recovery.
  if (kind === "spread_sub") {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    const payingCustomer = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const mode = (proposal.autoRebillMode ?? "none") as AutoRebillMode;
    let stopped = false;
    if (subId) {
      for (let a = 1; a <= 3 && !stopped; a++) {
        try { await stopAfterTerm(stripe, subId, mode); stopped = true; }
        catch (e) { console.error(`[90d spread_sub] stopAfterTerm attempt ${a}/3 for ${subId} failed:`, e); }
      }
      if (!stopped) {
        await postToSalesChannel(
          `:rotating_light: 90-day spread ${proposal.contactName}: the subscription ${subId} was created but its END DATE could not be set. ` +
            `It will keep billing monthly beyond the 90-day term until someone sets cancel_at in Stripe.`,
        ).catch(() => {});
      }
    }
    // THE ANCHOR. The 90-day clock starts when the client PAYS, not when the proposal was sent
    // or signed, and `sub.start_date` is the exact moment Stripe took payment 1. Stripe computes
    // every later charge from that same timestamp, so anchoring the document to it is what makes
    // the printed dates and the charge dates identical. Without this, `billingAnchor()` falls
    // back to `startDate` (the quoted estimate) and a proposal sent on the 3rd but paid on the
    // 7th is four days out for the entire term.
    let contractStart: Date | null = null;
    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        if (sub.start_date) contractStart = new Date(sub.start_date * 1000);
      } catch (e) {
        console.error(`[90d spread_sub] could not read start_date for ${subId}:`, e);
      }
    }
    // Fall back to now: this handler runs on checkout.session.completed, i.e. moments after the
    // charge, so it is accurate to the minute and far closer than the quoted startDate.
    const anchor = contractStart ?? new Date();

    // Freeze the schedule NOW, against the real anchor. From here the client can reopen the
    // proposal any number of times and always see the dates they are actually charged on.
    const frozenSchedule = managementSchedule({ ...proposal, contractStartAt: anchor } as BillingTerms);

    await db()
      .update(proposals)
      .set({
        status: "partial",
        firstMonthComplete: true,
        billingIssue: !stopped,
        stripeSubscriptionId: subId,
        contractStartAt: anchor,
        ...(frozenSchedule && frozenSchedule.length > 0
          ? { scheduleSnapshot: frozenSchedule, scheduleSnapshotAt: new Date() }
          : {}),
        ...(payingCustomer ? { stripeCustomerId: payingCustomer } : {}),
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, proposalId));
    return { handled: true, kind: "spread_sub" };
  }

  const payingCustomer =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  if (kind === "upfront") {
    const subId = typeof session.subscription === "string" ? session.subscription : null;
    // Apply the per-customer auto-rebill choice to the just-created subscription. Retry: this is the
    // "bill then stop" guarantee, so a single fallible call must not decide it.
    if (subId) {
      const mode = (proposal.autoRebillMode ?? "none") as AutoRebillMode;
      let done = false;
      for (let a = 1; a <= 3 && !done; a++) {
        try {
          await setSubscriptionAutoRebill(stripe, subId, mode);
          done = true;
        } catch (e) {
          console.error(`[90d] set auto-rebill attempt ${a}/3 for ${subId} failed:`, e);
        }
      }
      if (!done) {
        await postToSalesChannel(
          `:warning: 90-day upfront ${proposal.contactName}: could not set auto-rebill (${mode}) on subscription ${subId}. Please set it manually in Stripe.`,
        ).catch(() => {});
      }
    }
    // Upfront pays the whole 90-day term at signup → paid in full.
    await db()
      .update(proposals)
      .set({
        status: "paid",
        paidAt: new Date(),
        firstMonthComplete: true,
        billingIssue: false,
        stripeSubscriptionId: subId,
        ...(payingCustomer ? { stripeCustomerId: payingCustomer } : {}),
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, proposalId));
    return { handled: true, kind };
  }

  // ── spread ──────────────────────────────────────────────────────────────────
  // Redelivery guard: if the card is already stored, we've fully processed this session.
  if (proposal.stripePaymentMethodId) return { handled: true, kind };

  // Capture the saved card from the first payment so the cron can charge off-session.
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  let pmId: string | null = null;
  if (piId) {
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
    pmId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id ?? null;
  }

  if (!pmId) {
    // Card failed to save → we cannot auto-charge later. First month is collected, but flag for
    // manual follow-up rather than silently failing months 2 & 3.
    await db()
      .update(proposals)
      .set({
        status: "partial",
        firstMonthComplete: true,
        billingIssue: true,
        ...(payingCustomer ? { stripeCustomerId: payingCustomer } : {}),
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, proposalId));
    await postToSalesChannel(
      `:warning: 90-day spread ${proposal.contactName}: first payment succeeded but the card did not save, so months 2 & 3 can't auto-charge. Please arrange manually.`,
    ).catch(() => {});
    return { handled: true, kind };
  }

  // The first month may be split. Portion 1 cleared at Checkout; portions 2..N are scheduled off-
  // session. With a split, months 2 & 3 do NOT schedule yet — they anchor to when the LAST portion
  // clears (the contract's official start). With no split, the whole first month cleared now, so the
  // term starts today and months 2 & 3 schedule off today.
  const now = new Date();
  const split = readSplit(proposal.firstPaymentSplit);
  await db()
    .update(proposals)
    .set({
      status: "partial",
      billingIssue: false,
      stripePaymentMethodId: pmId,
      ...(payingCustomer ? { stripeCustomerId: payingCustomer } : {}),
      updatedAt: now,
    })
    .where(eq(proposals.id, proposalId));
  if (split) {
    await createFirstPortionRows(proposalId, split, now, proposal.currency);
  } else {
    await onFirstMonthCollected(stripe, proposalId, now, proposal.currency, Math.round(proposal.totalAmount * 100));
  }
  return { handled: true, kind };
}

export type CronSummary = {
  healed: number;
  due: number;
  charged: number;
  reconciled: number;
  declined: number;
  actionRequired: number;
  skipped: number;
  errors: number;
};

/**
 * Daily cron: charge every due, still-pending ledger row exactly once. Reconciles against Stripe
 * before charging (covers a crash between charge + DB write, and the 24h idempotency-key expiry).
 */
export async function chargeDueNinetyDaySplits(stripe: Stripe, now: Date = new Date()): Promise<CronSummary> {
  const s: CronSummary = { healed: 0, due: 0, charged: 0, reconciled: 0, declined: 0, actionRequired: 0, skipped: 0, errors: 0 };
  // Self-heal any spread term whose schedule never got created (webhook crash), before charging.
  try {
    s.healed = await backfillMissingSpreadSchedules(stripe);
  } catch (e) {
    console.error("[90d cron] backfill failed:", e);
  }
  const rows = await db()
    .select()
    .from(ninetyDaySplits)
    .where(and(eq(ninetyDaySplits.status, "pending"), lte(ninetyDaySplits.dueDate, now)));
  s.due = rows.length;

  for (const row of rows) {
    const [proposal] = await db().select().from(proposals).where(eq(proposals.id, row.proposalId)).limit(1);
    const customerId = proposal?.stripeCustomerId ?? null;
    const pmId = proposal?.stripePaymentMethodId ?? null;

    if (!proposal || !customerId || !pmId) {
      await db()
        .update(ninetyDaySplits)
        .set({ status: "failed", lastError: "missing customer or saved card", updatedAt: new Date() })
        .where(eq(ninetyDaySplits.id, row.id));
      if (proposal) await flagBillingIssue(row.proposalId);
      s.skipped++;
      continue;
    }

    // Reconcile: has this exact row already been charged? If so, never charge again.
    let reconciledPi: string | null = null;
    try {
      reconciledPi = await findSucceededChargeForSplit(stripe, row.id);
    } catch (e) {
      console.error(`[90d cron] reconcile lookup failed for split ${row.id}:`, e);
    }
    if (reconciledPi) {
      await markSplitPaid(row.id, reconciledPi);
      await onSplitPaid(stripe, row, proposal);
      s.reconciled++;
      continue;
    }

    const res = await chargeOffSession(stripe, {
      customerId,
      paymentMethodId: pmId,
      amountCents: row.amountCents,
      currency: row.currency,
      idempotencyKey: row.idempotencyKey,
      proposalId: row.proposalId,
      splitId: row.id,
      description: row.label ?? undefined,
    });

    if (res.status === "succeeded") {
      await markSplitPaid(row.id, res.paymentIntentId);
      await onSplitPaid(stripe, row, proposal);
      s.charged++;
    } else if (res.status === "declined") {
      await db()
        .update(ninetyDaySplits)
        .set({ status: "failed", lastError: `declined: ${res.error}`, attempts: row.attempts + 1, updatedAt: new Date() })
        .where(eq(ninetyDaySplits.id, row.id));
      await flagBillingIssue(row.proposalId);
      await alertDeclineToGageAndRep(proposal, `:x: 90-day charge declined for *${proposal.contactName}* (${row.label}): ${res.error}. Their card needs updating.`);
      s.declined++;
    } else if (res.status === "requires_action") {
      await db()
        .update(ninetyDaySplits)
        .set({ status: "action_required", lastError: "authentication_required", attempts: row.attempts + 1, updatedAt: new Date() })
        .where(eq(ninetyDaySplits.id, row.id));
      await flagBillingIssue(row.proposalId);
      await alertDeclineToGageAndRep(proposal, `:warning: 90-day charge for *${proposal.contactName}* (${row.label}) needs card authentication (SCA). The client must confirm the payment.`);
      s.actionRequired++;
    } else {
      // Transient/unknown error — leave pending for the next run, cap at 3 attempts then fail.
      const attempts = row.attempts + 1;
      const giveUp = attempts >= 3;
      await db()
        .update(ninetyDaySplits)
        .set({ status: giveUp ? "failed" : "pending", lastError: res.error, attempts, updatedAt: new Date() })
        .where(eq(ninetyDaySplits.id, row.id));
      if (giveUp) await flagBillingIssue(row.proposalId);
      s.errors++;
    }
  }
  return s;
}

async function markSplitPaid(splitId: string, paymentIntentId: string): Promise<void> {
  await db()
    .update(ninetyDaySplits)
    .set({ status: "paid", stripePaymentIntentId: paymentIntentId, chargedAt: new Date(), updatedAt: new Date() })
    .where(eq(ninetyDaySplits.id, splitId));
}

async function flagBillingIssue(proposalId: string): Promise<void> {
  await db().update(proposals).set({ billingIssue: true, updatedAt: new Date() }).where(eq(proposals.id, proposalId));
}

/** A declined / SCA 90-day charge is DM'd straight to Gage AND the rep who owns the deal, so the
 *  right person chases the card, not a noisy channel. Best-effort — never blocks the cron. */
async function alertDeclineToGageAndRep(
  proposal: { createdBy: string | null; closedBy?: string | null; contactName: string },
  message: string,
): Promise<void> {
  const targets: { email?: string | null; name?: string | null }[] = [{ email: "gage@krackedretention.com", name: "Gage" }];
  // The deal's CLOSER chases the card (creator if the closer has left).
  const repId = await routeToCloser(proposal);
  if (repId) {
    const [rep] = await db().select({ email: users.email, name: users.name }).from(users).where(eq(users.id, repId)).limit(1);
    if (rep?.email && rep.email.toLowerCase() !== "gage@krackedretention.com") targets.push({ email: rep.email, name: rep.name });
  }
  await Promise.all(targets.map((t) => sendSlackDM(t, message).catch(() => {})));
}

/** After a ledger row is paid: a first-month portion may complete the first month (→ start the
 *  contract + schedule months 2 & 3); a month payment may complete the whole term. */
async function onSplitPaid(
  stripe: Stripe,
  row: { proposalId: string; kind: string },
  proposal: { totalAmount: number; currency: string },
): Promise<void> {
  if (row.kind === "first_portion") {
    const remaining = await db()
      .select({ id: ninetyDaySplits.id })
      .from(ninetyDaySplits)
      .where(and(eq(ninetyDaySplits.proposalId, row.proposalId), eq(ninetyDaySplits.kind, "first_portion"), ne(ninetyDaySplits.status, "paid")));
    if (remaining.length === 0) {
      // Last portion of the first month cleared → the contract starts now; schedule months 2 & 3.
      await onFirstMonthCollected(stripe, row.proposalId, new Date(), proposal.currency, Math.round(proposal.totalAmount * 100));
    }
  } else {
    await maybeCompleteProposal(row.proposalId);
  }
}

/** When the recurring months are scheduled AND every ledger row is paid, the term is fully collected
 *  → mark paid and fire the paid business event ONCE (parity with upfront: commission, workflows). */
async function maybeCompleteProposal(proposalId: string): Promise<void> {
  const rows = await db().select({ status: ninetyDaySplits.status, kind: ninetyDaySplits.kind }).from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, proposalId));
  // Never "complete" before months 2 & 3 exist (a split's first portions can all be paid first).
  const hasMonth = rows.some((r) => r.kind === "month");
  if (!hasMonth || !rows.every((r) => r.status === "paid")) return;

  // Only fire side-effects on the transition into paid (guard against re-firing on later cron runs).
  // "completed" is treated as terminal alongside "paid". Once the status model lands, a finished
  // term will read "completed", and a guard that only recognised "paid" would stop matching and
  // re-fire proposal.paid on EVERY cron tick. Verified today that such a re-fire cannot reach a
  // customer (dispatchWorkflowEvent only runs workflows WHERE enabled=true, and both existing
  // workflows are disabled; the Slack notify is deduped by an atomic isNull(slackPaidNotifiedAt)
  // update; no receipt email is sent from this function). Belt and braces regardless.
  const [before] = await db().select({ status: proposals.status }).from(proposals).where(eq(proposals.id, proposalId));
  if (before?.status === "paid" || before?.status === "completed") return;

  await db()
    .update(proposals)
    .set({ status: "paid", paidAt: new Date(), billingIssue: false, updatedAt: new Date() })
    .where(eq(proposals.id, proposalId));

  buildProposalPayload(proposalId)
    .then((payload) => dispatchWorkflowEvent("proposal.paid", payload))
    .catch((e) => console.error("[90d] proposal.paid dispatch on completion failed:", e));
}
