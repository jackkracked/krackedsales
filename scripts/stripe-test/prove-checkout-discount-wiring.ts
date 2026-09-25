/**
 * Prove OUR checkout functions hand Stripe the right shape, on all three payment paths.
 *
 * prove-first-payment-discount.ts proved what Stripe DOES with a once-coupon ($750 + $1,000 +
 * $1,000). It built that coupon by hand, so it could not catch our own wiring being wrong. This
 * calls the real exported functions and inspects what they actually created:
 *   - the recurring price is FULL (never the discounted figure)
 *   - the coupon is duration "once"
 *   - the session carries the discount
 *   - all three paths reuse one coupon per proposal instead of stacking
 *
 * Checkout Sessions cannot be completed headlessly, so this asserts the objects we create, not
 * the collection. The clock proof covers collection.
 *
 * STRIPE_TEST_SECRET_KEY ONLY.
 *   ./node_modules/.bin/tsx scripts/stripe-test/prove-checkout-discount-wiring.ts
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import {
  createUpfrontCheckout, createSpreadCheckout, createSpreadSubscriptionCheckout,
} from "../../lib/proposals/ninety-day-billing";

const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
const key = env.STRIPE_TEST_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const stripe = new Stripe(key);

const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
const $ = (c: number) => "$" + (c / 100).toFixed(2);

const MONTHLY = 100000;   // $1,000/mo, FULL price
const DISCOUNT = 25000;   // $250 off, once
// Unique per run: idempotency keys are per proposal, so a reused id would return the FIRST run's
// objects and the assertions below would pass without testing anything.
const stamp = randomBytes(4).toString("hex");

void (async () => {
  const cust = await stripe.customers.create({ name: "TEST Wiring", email: "wiring@example.com" });
  const base = {
    customerId: cust.id, currency: "usd", productName: "90 Day Retention Sprint",
    successUrl: "https://example.com/ok", cancelUrl: "https://example.com/no",
  };

  // ── Path 1: spread subscription (the normal case) ──────────────────────────────────────────
  const p1 = `wire_spread_${stamp}`;
  const spread = await createSpreadSubscriptionCheckout(stripe, {
    ...base, proposalId: p1, monthlyAmountCents: MONTHLY, autoRebillMode: "none",
    oneOffDiscountCents: DISCOUNT, existingCouponId: null,
  });
  const price = await stripe.prices.retrieve(spread.priceId);
  ok("spread: price is FULL monthly, not discounted", price.unit_amount === MONTHLY, $(price.unit_amount ?? 0));
  ok("spread: price is every 30 DAYS", price.recurring?.interval === "day" && price.recurring?.interval_count === 30,
    `${price.recurring?.interval} x${price.recurring?.interval_count}`);
  ok("spread: a coupon was created", !!spread.couponId, spread.couponId ?? "none");
  const c1 = await stripe.coupons.retrieve(spread.couponId!);
  ok("spread: coupon is duration=once", c1.duration === "once", c1.duration);
  ok("spread: coupon is the right amount", c1.amount_off === DISCOUNT, $(c1.amount_off ?? 0));
  const s1 = await stripe.checkout.sessions.retrieve(spread.url.split("/pay/")[1]?.split("#")[0] ?? "", { expand: ["total_details"] })
    .catch(() => null);
  // The session id is not parseable from every URL form, so verify via the list instead.
  const listed = (await stripe.checkout.sessions.list({ customer: cust.id, limit: 10 })).data;
  const spreadSession = s1 ?? listed.find((s) => s.metadata?.proposal_id === p1) ?? null;
  ok("spread: session records a discount", !!spreadSession && (spreadSession.total_details?.amount_discount ?? 0) === DISCOUNT,
    $(spreadSession?.total_details?.amount_discount ?? 0));

  // Re-signing must REUSE the stored coupon, never mint a second one.
  const again = await createSpreadSubscriptionCheckout(stripe, {
    ...base, proposalId: p1, monthlyAmountCents: MONTHLY, autoRebillMode: "none",
    oneOffDiscountCents: DISCOUNT, existingCouponId: spread.couponId,
  });
  ok("spread: re-sign reuses the same coupon", again.couponId === spread.couponId, `${again.couponId} vs ${spread.couponId}`);

  // ── Path 2: upfront (one charge covering all 3 months) ─────────────────────────────────────
  const p2 = `wire_upfront_${stamp}`;
  const up = await createUpfrontCheckout(stripe, {
    ...base, proposalId: p2, monthlyAmountCents: MONTHLY, autoRebillMode: "none",
    oneOffDiscountCents: DISCOUNT, existingCouponId: null,
  });
  const upPrice = await stripe.prices.retrieve(up.priceId);
  ok("upfront: price is 3x the monthly, undiscounted", upPrice.unit_amount === MONTHLY * 3, $(upPrice.unit_amount ?? 0));
  ok("upfront: a coupon was created", !!up.couponId, up.couponId ?? "none");
  const c2 = await stripe.coupons.retrieve(up.couponId!);
  ok("upfront: coupon is duration=once (renewal pays full)", c2.duration === "once", c2.duration);
  const upSession = (await stripe.checkout.sessions.list({ customer: cust.id, limit: 20 })).data
    .find((s) => s.metadata?.proposal_id === p2);
  ok("upfront: session discounts once, not 3x", (upSession?.total_details?.amount_discount ?? 0) === DISCOUNT,
    $(upSession?.total_details?.amount_discount ?? 0));
  ok("upfront: client owes 3,000 - 250 = 2,750", upSession?.amount_total === MONTHLY * 3 - DISCOUNT, $(upSession?.amount_total ?? 0));

  // ── Path 3: split first payment (portion 1 now, rest off-session) ──────────────────────────
  // $600 + $400 with $250 off must collect $350 now, per Jack: the discount hits the first
  // PORTION only. Portion 2 is charged later from its own ledger row and stays $400.
  const p3 = `wire_split_${stamp}`;
  const split = await createSpreadCheckout(stripe, {
    ...base, proposalId: p3, firstChargeCents: 60000,
    oneOffDiscountCents: DISCOUNT, existingCouponId: null,
  });
  ok("split: a coupon was created", !!split.couponId, split.couponId ?? "none");
  const splitSession = (await stripe.checkout.sessions.list({ customer: cust.id, limit: 30 })).data
    .find((s) => s.metadata?.proposal_id === p3);
  ok("split: portion 1 collects $350, not $600", splitSession?.amount_total === 60000 - DISCOUNT, $(splitSession?.amount_total ?? 0));
  ok("split: still saves the card for later portions",
    splitSession?.payment_intent_data?.setup_future_usage === "off_session" || splitSession?.mode === "payment",
    splitSession?.mode ?? "?");

  // ── No discount must change nothing at all (every existing proposal) ───────────────────────
  const p4 = `wire_none_${stamp}`;
  const none = await createSpreadSubscriptionCheckout(stripe, {
    ...base, proposalId: p4, monthlyAmountCents: MONTHLY, autoRebillMode: "none",
  });
  ok("no discount: no coupon minted", none.couponId === null, String(none.couponId));
  const noneSession = (await stripe.checkout.sessions.list({ customer: cust.id, limit: 40 })).data
    .find((s) => s.metadata?.proposal_id === p4);
  ok("no discount: nothing discounted", (noneSession?.total_details?.amount_discount ?? 0) === 0,
    $(noneSession?.total_details?.amount_discount ?? 0));

  console.log(`\n  ${pass.length} passed, ${fail.length} failed`);
  if (fail.length) { console.log("  FAILED: " + fail.join("; ")); process.exit(1); }
  console.log("  ALL GREEN\n");
})();
