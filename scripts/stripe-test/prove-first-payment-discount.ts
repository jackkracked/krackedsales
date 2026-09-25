/**
 * Prove a FIRST-PAYMENT discount comes off ONCE, with a Stripe Test Clock.
 *
 * THE BUG THIS GUARDS
 * A discount used to be baked into `proposals.total_amount`, and for a management proposal that
 * column IS the monthly price. So "$250 off" a $1,000/month 90-day term was handed to Stripe as a
 * $750 recurring price and charged three times — a $750 discount. Gage caught it on the Kamil
 * Broz proposal, where the 90-day total read $2,250 instead of $2,750.
 *
 * The fix is a coupon with duration "once": the subscription runs at FULL price and Stripe
 * reduces only invoice 1. This asserts exactly that, against the real API.
 *
 * STRIPE_TEST_SECRET_KEY ONLY.
 *   ./node_modules/.bin/tsx scripts/stripe-test/prove-first-payment-discount.ts
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { SPREAD_CADENCE_DAYS } from "../../lib/proposals/billing";

const MONTHS_IN_TERM = 3;

const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
const key = env.STRIPE_TEST_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const stripe = new Stripe(key);

const $ = (c: number) => "$" + (c / 100).toFixed(2);
const ts = (d: string) => Math.floor(new Date(d + "T12:00:00Z").getTime() / 1000);
const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const SIGN = "2026-08-15";
const MONTHLY = 100000;   // $1,000/month — full price, NOT discounted
const DISCOUNT = 25000;   // $250 off, once

console.log("\n=== First-payment discount: $1,000/mo x3, $250 off ONCE ===\n");

void (async () => {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(SIGN), name: "first-payment-discount" });
  const cust = await stripe.customers.create({ name: "TEST Discount Once", email: "disc@example.com", test_clock: clock.id });
  const si = await stripe.setupIntents.create({
    customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
  });
  await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method } });

  // FULL price. The discount must never reach Stripe as a lower unit_amount.
  const price = await stripe.prices.create({
    currency: "usd", unit_amount: MONTHLY,
    recurring: { interval: "day", interval_count: SPREAD_CADENCE_DAYS },
    product_data: { name: "90 Day Retention Sprint" },
  });
  const coupon = await stripe.coupons.create({
    amount_off: DISCOUNT, currency: "usd", duration: "once", name: "First payment discount",
  });
  ok("coupon is duration=once (not forever)", coupon.duration === "once", coupon.duration);
  ok("price carries the FULL monthly amount", price.unit_amount === MONTHLY, $(price.unit_amount ?? 0));

  const cancelAt = (() => {
    const d = new Date(SIGN + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + SPREAD_CADENCE_DAYS * MONTHS_IN_TERM);
    return Math.floor(d.getTime() / 1000);
  })();
  const sub = await stripe.subscriptions.create({
    customer: cust.id,
    items: [{ price: price.id }],
    discounts: [{ coupon: coupon.id }],
    cancel_at: cancelAt,
    collection_method: "charge_automatically",
    default_payment_method: si.payment_method as string,
    proration_behavior: "none",
  });
  ok("subscription created at full price", sub.items.data[0]?.price?.unit_amount === MONTHLY);

  const paidInvoices = async (expected: number) => {
    for (let i = 0; i < 45; i++) {
      const all = (await stripe.invoices.list({ customer: cust.id, limit: 30 })).data;
      const p = all.filter((x) => x.status === "paid" && (x.amount_paid ?? 0) > 0).sort((a, b) => a.created - b.created);
      if (p.length >= expected) return p;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return (await stripe.invoices.list({ customer: cust.id, limit: 30 })).data
      .filter((x) => x.status === "paid" && (x.amount_paid ?? 0) > 0).sort((a, b) => a.created - b.created);
  };
  const advance = async (d: string, label: string) => {
    console.log(`\n  > advance to ${d} — ${label}`);
    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(d) });
    for (let i = 0; i < 90; i++) {
      const c = await stripe.testHelpers.testClocks.retrieve(clock.id);
      if (c.status === "ready") { await new Promise((r) => setTimeout(r, 3000)); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  let inv = await paidInvoices(1);
  ok("payment 1 is DISCOUNTED ($750, not $1,000)", inv[0]?.amount_paid === MONTHLY - DISCOUNT, $(inv[0]?.amount_paid ?? 0));

  await advance("2026-09-16", "just past day 30 — payment 2 must be FULL price");
  inv = await paidInvoices(2);
  ok("payment 2 is FULL price ($1,000)", inv[1]?.amount_paid === MONTHLY, $(inv[1]?.amount_paid ?? 0));

  await advance("2026-10-16", "just past day 60 — payment 3 must be FULL price");
  inv = await paidInvoices(3);
  ok("payment 3 is FULL price ($1,000)", inv[2]?.amount_paid === MONTHLY, $(inv[2]?.amount_paid ?? 0));

  await advance("2026-11-25", "past day 90 — no 4th charge");
  inv = await paidInvoices(4);
  ok("NO 4th charge", inv.length === 3, `${inv.length} paid`);

  const total = inv.reduce((s, x) => s + (x.amount_paid ?? 0), 0);
  console.log(`\n  collected: ${inv.map((x) => $(x.amount_paid ?? 0)).join(" + ")} = ${$(total)}`);
  // The whole point: $2,750, not the $2,250 a recurring discount would have produced.
  ok("term total is $2,750 (discount applied ONCE)", total === MONTHLY * MONTHS_IN_TERM - DISCOUNT, $(total));
  ok("NOT $2,250 (which would mean it discounted every month)", total !== (MONTHLY - DISCOUNT) * MONTHS_IN_TERM);

  console.log(`\n  ${pass.length} passed, ${fail.length} failed`);
  if (fail.length) { console.log("  FAILED: " + fail.join("; ")); process.exit(1); }
  console.log("  ALL GREEN\n");
})();
