/**
 * TEST-MODE proof for the NEW management "spread" (pay every 30 days) path.
 *
 * Replaces createSpreadCheckout, which took raw card payments with no invoice, no
 * subscription and therefore no Management MRR. The replacement is a monthly subscription
 * billed exactly 3 times then stopped, which is what a 90-day retainer actually is.
 *
 * Must prove ALL of:
 *   1. payment 1 is taken at signup (the client pays immediately, as today)
 *   2. payments 2 and 3 are taken automatically, 30 and 60 days later, unattended
 *   3. a REAL INVOICE with a PDF is produced for every payment (today's path produces none)
 *   4. it STOPS after exactly 3. No 4th charge, ever.
 *   5. it counts as a live Stripe subscription, so Management MRR sees it with no manual patch
 *   6. total collected is exactly 3x the monthly figure, to the cent
 *
 * STRIPE_TEST_SECRET_KEY ONLY. Run: node scripts/stripe-test/prove-spread-subscription.mjs
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
const stripe = new Stripe(key);

const $ = (c) => "$" + (c / 100).toFixed(2);
const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "-");
const ts = (iso) => Math.floor(new Date(iso + "T12:00:00Z").getTime() / 1000);
const pass = [], fail = [];
const ok = (n, c, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const SIGN = "2026-08-07";   // client signs and pays payment 1 today
const MONTHLY = 150000;      // $1,500/month, the real Kracked figure
const MONTHS = 3;

console.log("\n=== NEW management 'spread': $1,500/month x3, then stop ===\n");

const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(SIGN), name: "spread-sub" });
const cust = await stripe.customers.create({ name: "TEST Spread Retainer", email: "t@example.com", test_clock: clock.id });
const si = await stripe.setupIntents.create({
  customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
});
await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method } });

const price = await stripe.prices.create({
  currency: "usd", unit_amount: MONTHLY, recurring: { interval: "month" },
  product_data: { name: "90 Day Retention Sprint" },
});

// Charges cycle 1 immediately, then monthly. cancel_at stops it after exactly MONTHS cycles.
const cancelAt = (() => { const d = new Date(SIGN + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + MONTHS); return Math.floor(d.getTime() / 1000); })();
const sub = await stripe.subscriptions.create({
  customer: cust.id,
  items: [{ price: price.id }],
  cancel_at: cancelAt,
  collection_method: "charge_automatically",
  default_payment_method: si.payment_method,
  proration_behavior: "none",
  metadata: { ninety_day: "spread" },
});

const paidInvoices = async (expected) => {
  for (let i = 0; i < 30; i++) {
    const all = (await stripe.invoices.list({ customer: cust.id, limit: 30 })).data;
    const p = all.filter((x) => x.status === "paid" && x.amount_paid > 0).sort((a, b) => a.created - b.created);
    if (p.length >= expected) return p;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return (await stripe.invoices.list({ customer: cust.id, limit: 30 })).data
    .filter((x) => x.status === "paid" && x.amount_paid > 0).sort((a, b) => a.created - b.created);
};
const advance = async (iso, label) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (c.status === "advancing") { await new Promise((r) => setTimeout(r, 2000)); c = await stripe.testHelpers.testClocks.retrieve(clock.id); }
  console.log(`\n--- ${iso} (${label}) ---`);
};

console.log("--- At signing ---");
let paid = await paidInvoices(1);
ok("payment 1 charged at signup", paid.length === 1, `${paid.length} paid`);
ok("payment 1 was the right amount", paid[0]?.amount_paid === MONTHLY, $(paid[0]?.amount_paid ?? 0));
ok("payment 1 produced a real INVOICE with a PDF", !!paid[0]?.invoice_pdf && !!paid[0]?.hosted_invoice_url);
ok("counts as a live subscription for Management MRR", ["active", "trialing"].includes(sub.status), `status=${sub.status}`);
ok("scheduled to stop by itself after 3 payments", day(sub.cancel_at) === day(cancelAt), day(sub.cancel_at));

await advance("2026-09-08", "30 days on: payment 2 should have been taken unattended");
paid = await paidInvoices(2);
ok("payment 2 charged automatically", paid.length === 2, `${paid.length} paid`);
ok("payment 2 was the right amount", paid[1]?.amount_paid === MONTHLY, $(paid[1]?.amount_paid ?? 0));
ok("payment 2 produced its own invoice", !!paid[1]?.invoice_pdf);

await advance("2026-10-08", "60 days on: payment 3");
paid = await paidInvoices(3);
ok("payment 3 charged automatically", paid.length === 3, `${paid.length} paid`);
ok("payment 3 produced its own invoice", !!paid[2]?.invoice_pdf);

await advance("2026-11-15", "past the end of the 90-day term");
const after = await stripe.subscriptions.retrieve(sub.id);
paid = await paidInvoices(3);
const total = paid.reduce((s, i) => s + i.amount_paid, 0);
ok("subscription stopped by itself", after.status === "canceled", `status=${after.status}`);
ok("NO 4th charge was ever taken", paid.length === 3, `${paid.length} charges`);
ok("collected exactly 3 x $1,500 = $4,500", total === MONTHLY * MONTHS, $(total));

await advance("2026-12-20", "a further month later, belt and braces");
paid = await paidInvoices(3);
ok("still no extra charge a month after the term ended", paid.length === 3, `${paid.length} charges`);

console.log("\n--- Every invoice the client received ---");
for (const i of paid) console.log(`  ${day(i.created)}  ${$(i.amount_paid)}  pdf=${i.invoice_pdf ? "yes" : "NO"}`);

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) console.log("FAILED: " + fail.join("; "));
await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
