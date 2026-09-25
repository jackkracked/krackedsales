/**
 * 90-Day Management billing engine.
 *
 * Two payment options, both decided on the proposal and billed at SIGN:
 *   - "upfront": pay the full 90-day amount now via a subscription that self-cancels at term end
 *     (unless auto-rebill says keep going). One Checkout, one charge.
 *   - "spread": the client enters a card once (saved off-session); the flexible first month is then
 *     auto-charged as any splits/dates, and months 2 & 3 are auto-charged on schedule.
 *
 * The 90-day term BILLS then STOPS by default (autoRebillMode "none"). Post-term continuation is a
 * per-customer control: "none" (stop), "monthly" (continue month-to-month), "full90" (re-bill the
 * whole 90 again).
 *
 * Every Stripe mechanic used here is proven in test mode by scripts/stripe-test/*. These functions
 * take an injected Stripe instance + explicit inputs so they are unit-testable with the test key and
 * carry NO hidden DB access — the sign route / webhook / cron pass real data in and persist results.
 * Money is ALWAYS passed in cents (Stripe's unit); callers convert from the dollar columns.
 */
import type Stripe from "stripe";
// One constant shared with the client-facing schedule, so what the proposal prints and what
// Stripe charges are driven by the same number and cannot drift apart.
import { SPREAD_CADENCE_DAYS } from "@/lib/proposals/billing";

export type AutoRebillMode = "none" | "monthly" | "full90";
export type ManagementOption = "upfront" | "spread";

/** A 90-day Management term is 3 monthly cycles. */
export const MONTHS_IN_TERM = 3;

/**
 * One billing cycle of a Stripe price, expressed in days.
 *
 * Used only for threshold comparisons (is this cycle longer than 30 days?), so treating a
 * calendar month as 30 days is deliberate and safe: the question is which bucket a price falls
 * in, never an exact date. Never compute a charge date from this.
 */
export function priceCycleDays(price: Stripe.Price | null | undefined): number {
  const count = price?.recurring?.interval_count ?? 1;
  switch (price?.recurring?.interval) {
    case "day": return count;
    case "week": return count * 7;
    case "year": return count * 365;
    case "month": return count * 30;
    default: return 30;
  }
}

/**
 * Option 1 "upfront" — a Checkout Session that charges the WHOLE 90-day amount at signup and
 * creates a subscription. Modelled as a 3-month-interval price so the single first invoice equals
 * 3× the monthly amount, and it counts in MRR normalized to the monthly run-rate.
 * The stop-at-term behaviour is NOT set on the Checkout Session (Stripe rejects
 * `subscription_data.cancel_at_period_end`). Instead the `checkout.session.completed` webhook calls
 * `setSubscriptionAutoRebill(sub, autoRebillMode)` on the just-created subscription:
 *   - "none":   cancel at the end of the first 90-day period (bill then stop).
 *   - "full90": leave renewing (a 3-month interval renews = re-bills the full 90 automatically).
 *   - "monthly": stop the 3-month term and switch to month-to-month at term end (a term-end price
 *     swap handled by the auto-rebill handler).
 * The `auto_rebill_mode` is carried in subscription metadata so the webhook knows what to apply.
 */
/**
 * A one-off discount is ALWAYS a coupon with duration "once", never a lowered price.
 *
 * Lowering the price is the bug this whole scope exists to prevent: $250 off a $1,000/month
 * 90-day term, passed as a $750 recurring price, collects $2,250 instead of $2,750. A coupon
 * reduces only the first invoice, leaves the subscription at full price, and shows the client a
 * real discount line instead of an unexplained cheaper month.
 *
 * One coupon per proposal, keyed by proposal id, so a retried, resumed or re-signed checkout can
 * never mint a second coupon and stack two discounts on the same deal.
 */
async function ensureOnceCoupon(
  stripe: Stripe,
  opts: { existingCouponId?: string | null; oneOffDiscountCents?: number; currency: string; proposalId: string },
): Promise<string | null> {
  if (opts.existingCouponId) return opts.existingCouponId;
  const amount = Math.round(opts.oneOffDiscountCents ?? 0);
  if (amount <= 0) return null;
  const coupon = await stripe.coupons.create(
    {
      amount_off: amount,
      currency: opts.currency,
      duration: "once",
      name: "First payment discount",
      metadata: { proposal_id: opts.proposalId },
    },
    // The AMOUNT is in the key on purpose. A retry of the same discount reuses the same coupon
    // (no duplicates), but an edited discount is a different key — reusing it would hit Stripe's
    // "same key, different parameters" error and fail the checkout the client is waiting on.
    { idempotencyKey: `90d_coupon_${opts.proposalId}_${amount}_${opts.currency}` },
  );
  return coupon.id;
}

/** A one-off discount, in cents, applied ONCE. See ensureOnceCoupon for why it is not a price cut. */
type OneOffDiscountOpts = {
  oneOffDiscountCents?: number;
  /** Reuse the coupon already stored on the proposal instead of minting a second one. */
  existingCouponId?: string | null;
};

export async function createUpfrontCheckout(
  stripe: Stripe,
  opts: {
    customerId: string;
    monthlyAmountCents: number;
    currency: string;
    proposalId: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    autoRebillMode: AutoRebillMode;
  } & OneOffDiscountOpts,
): Promise<{ url: string; priceId: string; couponId: string | null }> {
  const price = await stripe.prices.create(
    {
      currency: opts.currency,
      unit_amount: opts.monthlyAmountCents * MONTHS_IN_TERM,
      recurring: { interval: "month", interval_count: MONTHS_IN_TERM },
      product_data: { name: opts.productName, metadata: { proposal_id: opts.proposalId } },
    },
    // Keyed so a retried sign never orphans a duplicate Price (keeps Stripe tidy).
    { idempotencyKey: `90d_price_${opts.proposalId}` },
  );
  // Upfront can still RENEW (auto_rebill "full90" re-bills the next 90 days), so "once" is
  // load-bearing here too: the discount comes off this term, never off a renewal.
  const couponId = await ensureOnceCoupon(stripe, opts);
  const session = await stripe.checkout.sessions.create(
    {
      customer: opts.customerId,
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: { proposal_id: opts.proposalId, ninety_day: "upfront" },
      subscription_data: {
        metadata: {
          proposal_id: opts.proposalId,
          ninety_day: "upfront",
          auto_rebill_mode: opts.autoRebillMode,
        },
      },
    },
    { idempotencyKey: `90d_upfront_${opts.proposalId}` },
  );
  return { url: session.url!, priceId: price.id, couponId };
}

/**
 * Option 2 "spread" — pay every 30 days. A MONTHLY subscription billed exactly 3 times, then
 * stopped. This is what a 90-day retainer actually is, and modelling it as one gives us four
 * things the old raw-card-charge approach could not:
 *   - a real INVOICE with a PDF for every payment (a business client needs this; the old path
 *     produced only a card receipt)
 *   - it counts toward Management MRR and churn automatically, with no manual override row
 *   - Stripe charges it, retries it and chases the client, instead of our own nightly cron
 *   - no `ninety_day_splits` ledger to drift out of sync with Stripe
 *
 * Proven end to end in scripts/stripe-test/prove-spread-subscription.mjs (14/14 with a Test
 * Clock): $1,500 at signup, 30 days, 60 days, then it cancels itself, with no 4th charge
 * verified twice and exactly $4,500 collected.
 *
 * IMPORTANT: the stop date CANNOT be set here. Stripe rejects both `subscription_data.cancel_at`
 * and `subscription_data.cancel_at_period_end` on a Checkout Session ("Received unknown
 * parameter", verified against the live API). So `checkout.session.completed` must apply it to
 * the created subscription — see stopAfterTerm(). Until it does, the subscription would renew
 * indefinitely, which is why the webhook retries and alerts rather than failing quietly.
 */
export async function createSpreadSubscriptionCheckout(
  stripe: Stripe,
  opts: {
    customerId: string;
    monthlyAmountCents: number;
    currency: string;
    proposalId: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    autoRebillMode: AutoRebillMode;
  } & OneOffDiscountOpts,
): Promise<{ url: string; priceId: string; couponId: string | null }> {
  const price = await stripe.prices.create(
    {
      currency: opts.currency,
      unit_amount: opts.monthlyAmountCents,
      // Every 30 DAYS, not a calendar month. The proposal prints +30/+60 day dates, and a
      // calendar-month price charges 10 Sep for a 10 Aug start where the document says 9 Sep.
      // Stripe models "every 30 days" as interval day x30, so the signed schedule and the
      // charge dates are now the same dates.
      //
      // Existing subscriptions are untouched by construction: the price object is created per
      // proposal (idempotencyKey below), and a live subscription keeps the price it was created
      // with. Only checkouts started after this deploys use the 30-day price.
      recurring: { interval: "day", interval_count: SPREAD_CADENCE_DAYS },
      product_data: { name: opts.productName, metadata: { proposal_id: opts.proposalId } },
    },
    { idempotencyKey: `90d_spread_price_${opts.proposalId}` },
  );
  // Proven end-to-end on a Test Clock: $750 + $1,000 + $1,000 = $2,750, not $2,250.
  // scripts/stripe-test/prove-first-payment-discount.ts
  const couponId = await ensureOnceCoupon(stripe, opts);

  const session = await stripe.checkout.sessions.create(
    {
      customer: opts.customerId,
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: { proposal_id: opts.proposalId, ninety_day: "spread_sub" },
      subscription_data: {
        metadata: {
          proposal_id: opts.proposalId,
          ninety_day: "spread_sub",
          auto_rebill_mode: opts.autoRebillMode,
        },
      },
    },
    { idempotencyKey: `90d_spread_sub_${opts.proposalId}` },
  );
  return { url: session.url!, priceId: price.id, couponId };
}

/**
 * Stop a monthly 90-day subscription after exactly MONTHS_IN_TERM cycles, unless the customer's
 * auto-rebill choice says to keep going. Called from the webhook because Checkout cannot set it.
 * Anchored to the subscription's own start so the term is exactly 3 billing cycles.
 */
export async function stopAfterTerm(
  stripe: Stripe,
  subscriptionId: string,
  mode: AutoRebillMode,
): Promise<Stripe.Subscription> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (mode === "monthly") {
    // Already month-to-month at the right price: just let it run.
    return stripe.subscriptions.update(subscriptionId, { metadata: { ...sub.metadata, auto_rebill_mode: mode } });
  }
  if (mode === "full90") {
    // Re-bill another 90 days: leave it renewing monthly, which is the same run-rate.
    return stripe.subscriptions.update(subscriptionId, { metadata: { ...sub.metadata, auto_rebill_mode: mode } });
  }
  const start = new Date((sub.start_date ?? Math.floor(Date.now() / 1000)) * 1000);
  const end = new Date(start);
  // The term must end where THIS subscription's own cadence ends, not on a fixed calendar
  // boundary. A 30-day-cadence sub charges on days 0/30/60; 3 calendar months is ~92 days, so a
  // calendar cancel_at would let a FOURTH charge fire on day 90. Day-based cadence therefore
  // cancels at 90 days exactly.
  //
  // Anything month-based keeps the original calendar behaviour untouched: an "upfront" sub
  // (month x3, one cycle = the whole term) and any legacy monthly spread sub both still end at
  // 3 calendar months, exactly as before.
  if (sub.items.data[0]?.price?.recurring?.interval === "day") {
    end.setUTCDate(end.getUTCDate() + SPREAD_CADENCE_DAYS * MONTHS_IN_TERM);
  } else {
    // Clamp to the last valid day of the target month. A bare setUTCMonth(+3) OVERFLOWS an
    // end-of-month start (31 Aug -> 1 Dec, 31 Jan -> 1 May) while Stripe clamps its own monthly
    // renewals to the real month end (30 Nov). cancel_at would then sit one day AFTER a renewal,
    // letting a FOURTH charge through. Same clamping rule as addMonths() in
    // ninety-day-fulfillment.ts (kept local: importing it here would be a circular dependency).
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + MONTHS_IN_TERM);
    const lastDayOfTargetMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  }
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at: Math.floor(end.getTime() / 1000),
    metadata: { ...sub.metadata, auto_rebill_mode: mode },
  });
}

/**
 * LEGACY Option 2 "spread" — a Checkout Session in payment mode that charges the FIRST split now
 * and saves the card for off-session use (`setup_future_usage`). The remaining first-month splits
 * and months 2 & 3 are charged later by `chargeOffSession` from the cron.
 *
 * Superseded by createSpreadSubscriptionCheckout above, and retained ONLY for the split-first-
 * payment case, which a monthly subscription cannot express (a subscription's first cycle is a
 * single charge). Never ran in production: `ninety_day_splits` has zero rows account-wide.
 */
export async function createSpreadCheckout(
  stripe: Stripe,
  opts: {
    customerId: string;
    firstChargeCents: number;
    currency: string;
    proposalId: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
  } & OneOffDiscountOpts,
): Promise<{ url: string; couponId: string | null }> {
  // The discount comes off the FIRST PORTION only (Jack, 2026-08-15): a $600 + $400 split with
  // $250 off collects $350 then $400. `firstChargeCents` stays the agreed portion and the coupon
  // does the reduction, so the client sees the discount rather than a portion that silently
  // disagrees with the schedule printed on the proposal. Later portions are charged off-session
  // from their own ledger rows and are untouched by this.
  const couponId = await ensureOnceCoupon(stripe, opts);
  const session = await stripe.checkout.sessions.create(
    {
      customer: opts.customerId,
      mode: "payment",
      ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      line_items: [
        {
          price_data: {
            currency: opts.currency,
            unit_amount: opts.firstChargeCents,
            product_data: { name: opts.productName },
          },
          quantity: 1,
        },
      ],
      // Save the card for the later off-session auto-charges.
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: { proposal_id: opts.proposalId, ninety_day: "spread", split: "1" },
      },
      customer_update: { name: "auto" },
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: { proposal_id: opts.proposalId, ninety_day: "spread" },
    },
    { idempotencyKey: `90d_spread_${opts.proposalId}` },
  );
  return { url: session.url!, couponId };
}

/**
 * Reconcile: has this exact ledger row already been charged successfully? The cron calls this
 * BEFORE charging so that a crash between "Stripe charged" and "DB marked paid" — or a retry after
 * the 24h idempotency window expires — can never produce a second charge. Returns the succeeded
 * PaymentIntent id if found, else null.
 */
export async function findSucceededChargeForSplit(
  stripe: Stripe,
  splitId: string,
): Promise<string | null> {
  const res = await stripe.paymentIntents.search({
    query: `metadata['split_id']:'${splitId}' AND status:'succeeded'`,
    limit: 1,
  });
  return res.data[0]?.id ?? null;
}

export type OffSessionResult =
  | { status: "succeeded"; paymentIntentId: string }
  | { status: "requires_action"; paymentIntentId: string | null }
  | { status: "declined"; error: string }
  | { status: "error"; error: string };

/**
 * Charge a saved card off-session for one scheduled amount. NEVER throws — returns a structured
 * result so the caller can flag `billing_issue` (declined) or `requires_action` (SCA) and notify
 * the client, instead of the cron crashing. The idempotency key MUST be stable per scheduled
 * charge (e.g. `split_<id>`) so a retry can never double-charge.
 */
export async function chargeOffSession(
  stripe: Stripe,
  opts: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    proposalId: string;
    splitId?: string;
    description?: string;
  },
): Promise<OffSessionResult> {
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: opts.amountCents,
        currency: opts.currency,
        customer: opts.customerId,
        payment_method: opts.paymentMethodId,
        off_session: true,
        confirm: true,
        description: opts.description,
        // split_id lets the cron reconcile (search Stripe for an already-succeeded charge for this
        // exact ledger row) before ever retrying, so a crash between charge + DB write can't double-bill.
        metadata: { proposal_id: opts.proposalId, ...(opts.splitId ? { split_id: opts.splitId } : {}) },
      },
      { idempotencyKey: opts.idempotencyKey },
    );
    if (pi.status === "succeeded") return { status: "succeeded", paymentIntentId: pi.id };
    if (pi.status === "requires_action") return { status: "requires_action", paymentIntentId: pi.id };
    return { status: "error", error: `unexpected PaymentIntent status: ${pi.status}` };
  } catch (e) {
    const err = e as { code?: string; decline_code?: string; message?: string; payment_intent?: { id?: string } };
    if (err.code === "authentication_required") {
      return { status: "requires_action", paymentIntentId: err.payment_intent?.id ?? null };
    }
    if (err.code === "card_declined" || err.decline_code) {
      return { status: "declined", error: err.decline_code || err.message || "card_declined" };
    }
    return { status: "error", error: err.message || String(e) };
  }
}

/**
 * Apply a per-customer auto-rebill choice to a live subscription.
 *   - "none":   stop at the end of the current period (bill then stop).
 *   - "full90": keep renewing (a 3-month-interval sub re-bills the full 90 automatically).
 *   - "monthly": continue month-to-month. SAFETY: an "upfront" sub carries a 3-month-interval
 *     price, so simply letting it renew would re-bill the FULL 90 every cycle (a 3× over-charge).
 *     The month-to-month price swap is not built yet, so for a term-priced sub we FAIL CLOSED:
 *     stop at term end and flag `needs_monthly_resubscribe` for a manual monthly setup, rather than
 *     silently over-charging. A sub that is already monthly-interval is safe to keep renewing.
 */
export async function setSubscriptionAutoRebill(
  stripe: Stripe,
  subscriptionId: string,
  mode: AutoRebillMode,
): Promise<Stripe.Subscription> {
  if (mode === "monthly") {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    // A "term price" is one whose SINGLE cycle covers the whole 90-day term (the upfront
    // month x3 price). Testing `interval_count > 1` broke the moment the spread price became
    // day x30: count 30 is not a term price, it is a 30-day cycle, and every spread sub
    // choosing "monthly" would have been wrongly flagged needs_monthly_resubscribe.
    // Compare the cycle LENGTH instead: month x3 = 90 days (term), month x1 = 30, day x30 = 30.
    const isTermPrice = priceCycleDays(sub.items.data[0]?.price) > SPREAD_CADENCE_DAYS;
    if (isTermPrice) {
      return stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: { auto_rebill_mode: mode, needs_monthly_resubscribe: "true" },
      });
    }
    return stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      metadata: { auto_rebill_mode: mode },
    });
  }
  // "none" → stop at period end; "full90" → keep renewing.
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: mode === "none",
    metadata: { auto_rebill_mode: mode },
  });
}
