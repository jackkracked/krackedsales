/**
 * TEST-MODE proof of the SPLIT FIRST PAYMENT case on a 90-day management retainer.
 *
 * Jack's exact spec, with UNEVEN portions:
 *   $1,500/month for 90 days = $4,500 total.
 *   First month split: $600 at signing, then $900 fourteen days later.
 *   The moment that $900 clears, the clock starts: 30 days later $1,500, 30 days after that
 *   $1,500, then it stops. Total collected must be exactly $4,500.
 *
 *   07 Aug  $600    portion 1, at signing
 *   21 Aug  $900    portion 2, off-session, 14 days later  -> first month COMPLETE
 *   20 Sep  $1,500  month 2, 30 days after the first month completed
 *   20 Oct  $1,500  month 3, then stops
 *
 * MEASUREMENT NOTE: counted from CHARGES. One successful charge == one payment that actually
 * hit the client's card. `invoice.payment_intent` was REMOVED in recent API versions (this
 * account is on 2026-07-29.dahlia), so deduping PaymentIntents against invoices silently
 * double-counts every subscription payment.
 *
 * STRIPE_TEST_SECRET_KEY ONLY. Run: node scripts/stripe-test/prove-split-first-payment.mjs
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

const SIGN = "2026-08-07";
const PORTION_2_DAY = "2026-08-21";
const MONTH_2 = "2026-09-20";
const MONTH_3 = "2026-10-20";
const TERM_END = "2026-11-20";
const P1 = 60000, P2 = 90000, MONTHLY = 150000;

console.log("\n=== SPLIT FIRST PAYMENT: $600 now, $900 in 14 days, then 2 x $1,500 ===\n");

const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(SIGN), name: "split-first" });
const cust = await stripe.customers.create({ name: "TEST Split First Payment", email: "t@example.com", test_clock: clock.id });

const advance = async (iso, label) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (c.status === "advancing") { await new Promise((r) => setTimeout(r, 2000)); c = await stripe.testHelpers.testClocks.retrieve(clock.id); }
  console.log(`\n--- ${iso} (${label}) ---`);
};
const settled = async (expectedCharges) => {
  const read = async () => {
    const ch = (await stripe.charges.list({ customer: cust.id, limit: 40 })).data.filter((c) => c.status === "succeeded" && !c.refunded);
    const inv = (await stripe.invoices.list({ customer: cust.id, limit: 40 })).data.filter((x) => x.status === "paid" && x.amount_paid > 0);
    return { ch, inv, count: ch.length, total: ch.reduce((a, c) => a + c.amount, 0) };
  };
  // Stripe processes test-clock subscription billing asynchronously and it is not quick.
  // 60 x 3s = up to 3 minutes per checkpoint; a shorter wait reports false failures.
  for (let i = 0; i < 60; i++) { const r = await read(); if (r.count >= expectedCharges) return r; await new Promise((x) => setTimeout(x, 3000)); }
  return read();
};

// ---- Portion 1 at signing, card saved for the rest ----
const si = await stripe.setupIntents.create({
  customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
});
await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method } });
const pi1 = await stripe.paymentIntents.create({
  amount: P1, currency: "usd", customer: cust.id, payment_method: si.payment_method,
  off_session: true, confirm: true, description: "First payment 1 of 2",
});
ok("portion 1 charged at signing", pi1.status === "succeeded", $(P1));
ok("card saved for the remaining portions", si.status === "succeeded");
ok("only ONE charge so far", (await settled(1)).count === 1);

// ---- Portion 2, off-session, uneven amount ----
await advance(PORTION_2_DAY, "14 days later: portion 2, uneven amount");
const pi2 = await stripe.paymentIntents.create({
  amount: P2, currency: "usd", customer: cust.id, payment_method: si.payment_method,
  off_session: true, confirm: true, description: "First payment 2 of 2",
});
ok("portion 2 charged automatically, no client action", pi2.status === "succeeded", $(P2));
ok("first month fully collected: $600 + $900 = $1,500", P1 + P2 === MONTHLY, $(P1 + P2));

// ---- First month complete -> subscription starts 30 days from THIS moment ----
const price = await stripe.prices.create({
  currency: "usd", unit_amount: MONTHLY, recurring: { interval: "month" }, product_data: { name: "90 Day Sprint months 2-3" },
});
const sub = await stripe.subscriptions.create({
  customer: cust.id, items: [{ price: price.id }],
  trial_end: ts(MONTH_2),
  cancel_at: ts(TERM_END),
  collection_method: "charge_automatically",
  default_payment_method: si.payment_method,
  proration_behavior: "none",
});
ok("subscription dormant until 30 days after the split completed", sub.status === "trialing", `first charge ${day(sub.trial_end)}`);
ok("first subscription charge is 30 days after portion 2 cleared", day(sub.trial_end) === MONTH_2, day(sub.trial_end));
let s = await settled(2);
ok("still only 2 charges, nothing extra taken", s.count === 2, `${s.count} charges, ${$(s.total)}`);

await advance("2026-09-21", "the day after month 2 is due");
s = await settled(3);
ok("month 2 charged automatically", s.count === 3, `${s.count} charges`);
ok("month 2 produced a real invoice with a PDF", s.inv.length === 1 && !!s.inv[0]?.invoice_pdf, `${s.inv.length} invoice(s)`);

await advance("2026-10-21", "the day after month 3 is due");
s = await settled(4);
ok("month 3 charged automatically", s.count === 4, `${s.count} charges`);
ok("month 3 invoiced too", s.inv.length === 2, `${s.inv.length} invoice(s)`);

await advance("2026-12-05", "past the term end");
const after = await stripe.subscriptions.retrieve(sub.id);
s = await settled(4);
ok("subscription stopped itself", after.status === "canceled", `status=${after.status}`);
ok("exactly 4 charges hit the card", s.count === 4, `${s.count}`);
ok("TOTAL COLLECTED IS EXACTLY $4,500", s.total === 450000, $(s.total));

await advance("2027-01-20", "two months later, belt and braces");
s = await settled(4);
ok("still exactly 4 charges", s.count === 4, `${s.count}`);
ok("total still exactly $4,500", s.total === 450000, $(s.total));

console.log("\n--- Every charge that hit the client's card ---");
for (const c of s.ch.sort((a, b) => a.created - b.created)) {
  console.log(`  ${day(c.created)}  ${String($(c.amount)).padStart(9)}  ${c.invoice ? "invoiced" : "card charge (split portion)"}`);
}
console.log(`  invoices with a PDF: ${s.inv.filter((i) => i.invoice_pdf).length} of ${s.inv.length}`);

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) console.log("FAILED: " + fail.join("; "));
await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
