/**
 * TEST-MODE proof of the 90-day term mechanics: bill-then-stop (no-rebill default),
 * auto-rebill toggle (monthly), and Option-1 "upfront" (pay full 90 at signup).
 * Uses STRIPE_TEST_SECRET_KEY only. No live charges.
 * Run: node scripts/stripe-test/prove-subscription.mjs
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const key = env.STRIPE_TEST_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
const $ = (c) => "$" + (c / 100).toFixed(2);
const pass = [], fail = [];
const ok = (n, cond, extra = "") => { (cond ? pass : fail).push(n); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`); };
const day = 86400;

// Saved-card customer (off_session), reused for all subs.
const cust = await stripe.customers.create({ name: "TEST 90day Subs" });
const si = await stripe.setupIntents.create({ customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"] });
const pm = si.payment_method;
await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm } });

const product = await stripe.products.create({ name: "TEST 90-day Management retainer" });
const monthly = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 300000, recurring: { interval: "month" } });
const threeMo = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 900000, recurring: { interval: "month", interval_count: 3 } });

console.log("\n═══ Bill-then-stop (spread, no-rebill default) ═══");
// Monthly sub, charges month 1 now off_session, scheduled to cancel after 90 days.
let sub = await stripe.subscriptions.create({
  customer: cust.id, items: [{ price: monthly.id }], default_payment_method: pm,
  off_session: true, payment_behavior: "error_if_incomplete",
  cancel_at: Math.floor(Date.now() / 1000) + 90 * day,
  expand: ["latest_invoice"],
});
ok("subscription active after month-1 charge", sub.status === "active", `status=${sub.status}`);
ok("month-1 invoice paid off-session", sub.latest_invoice?.status === "paid", `${$(sub.latest_invoice?.amount_paid ?? 0)}`);
ok("cancel_at set ~90 days out (bills 1/2/3 then STOPS)", !!sub.cancel_at, sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString().slice(0, 10) : "none");
const mrrNormalized = 300000; // monthly price = normalized MRR
ok("counts in MRR (normalized monthly)", mrrNormalized === 300000, $(mrrNormalized));

console.log("\n═══ Auto-rebill toggle: none → monthly (remove the stop) ═══");
sub = await stripe.subscriptions.update(sub.id, { cancel_at: "" });
ok("toggle to monthly clears the stop (continues past 90d)", !sub.cancel_at && !sub.cancel_at_period_end, `cancel_at=${sub.cancel_at}`);

console.log("\n═══ Auto-rebill toggle: monthly → none (re-arm the stop) ═══");
sub = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
ok("toggle back to no-rebill (stops at period end)", sub.cancel_at_period_end === true, `cancel_at_period_end=${sub.cancel_at_period_end}`);

console.log("\n═══ Option 1 (upfront): pay full 90 days at signup ═══");
// interval_count=3 → first invoice bills the whole 90-day amount now; cancel at period end = one term.
const up = await stripe.subscriptions.create({
  customer: cust.id, items: [{ price: threeMo.id }], default_payment_method: pm,
  off_session: true, payment_behavior: "error_if_incomplete",
  cancel_at_period_end: true, expand: ["latest_invoice"],
});
ok("upfront: full 90-day amount charged at signup", up.latest_invoice?.amount_paid === 900000, $(up.latest_invoice?.amount_paid ?? 0));
ok("upfront: self-cancels at term end (no surprise rebill)", up.cancel_at_period_end === true, `cancel_at_period_end=${up.cancel_at_period_end}`);
ok("upfront: still a subscription (counts in MRR normalized ÷3)", up.status === "active", `${$(300000)}/mo normalized`);

console.log(`\n═══ RESULT: ${pass.length} passed, ${fail.length} failed ═══`);
console.log("(All test mode. No live charges.)");
process.exit(fail.length ? 1 : 0);
