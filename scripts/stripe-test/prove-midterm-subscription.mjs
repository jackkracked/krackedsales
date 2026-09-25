/**
 * TEST-MODE proof: can we put a client who has ALREADY paid month 1 onto a real Stripe
 * subscription that (a) charges nothing today, (b) charges their remaining months on the
 * exact agreed dates, (c) stops by itself, (d) produces a proper invoice each time, and
 * (e) counts as an active subscription for MRR?
 *
 * Modelled on Rossi Mckee: $4,500 over 3 x $1,500. Month 1 paid 17 Jul. Remaining: 16 Aug, 16 Sep.
 * Uses a Stripe Test Clock so real time is simulated, not waited for.
 * STRIPE_TEST_SECRET_KEY ONLY. Makes NO live charges.
 * Run: node scripts/stripe-test/prove-midterm-subscription.mjs
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
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const pass = [], fail = [];
const ok = (n, cond, extra = "") => { (cond ? pass : fail).push(n); console.log(`  ${cond ? "PASS" : "FAIL"}  ${n}${extra ? "  -> " + extra : ""}`); };

const ts = (iso) => Math.floor(new Date(iso + "T12:00:00Z").getTime() / 1000);
const TODAY = "2026-08-05";       // where we are now
const CHARGE_2 = "2026-08-16";    // their agreed payment 2
const CHARGE_3 = "2026-09-16";    // their agreed payment 3
const TERM_END = "2026-10-16";    // one cycle past the last payment: subscription stops here
const MONTHLY = 150000;           // $1,500 in cents

console.log("\n=== PROOF: mid-term subscription for a client who already paid month 1 ===\n");

// A test clock lets us fast-forward time and watch what Stripe really does.
const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(TODAY), name: "midterm-sub-proof" });
console.log(`Test clock created, frozen at ${TODAY}\n`);

const cust = await stripe.customers.create({
  name: "TEST Rossi Mckee (90-day, month 1 already paid)",
  email: "test-rossi@example.com",
  test_clock: clock.id,
});

// Their card is already on file. Save it for off-session use, exactly as we would at signing.
const si = await stripe.setupIntents.create({
  customer: cust.id, payment_method: "pm_card_visa", usage: "off_session",
  confirm: true, payment_method_types: ["card"],
});
ok("card saved for off-session use (the consent mandate)", si.status === "succeeded", `status=${si.status}`);
await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method } });

const price = await stripe.prices.create({
  currency: "usd", unit_amount: MONTHLY, recurring: { interval: "month" },
  product_data: { name: "90 Day Retention Sprint (months 2-3)" },
});

// THE KEY MOVE: trial until their next agreed date so nothing is taken today,
// and cancel_at one cycle after the final payment so it stops on its own.
const sub = await stripe.subscriptions.create({
  customer: cust.id,
  items: [{ price: price.id }],
  trial_end: ts(CHARGE_2),
  cancel_at: ts(TERM_END),
  collection_method: "charge_automatically",
  default_payment_method: si.payment_method,
  proration_behavior: "none",
});

console.log("\n--- Immediately after creation (today, 5 Aug) ---");
ok("nothing charged today", (await stripe.invoices.list({ customer: cust.id, limit: 10 })).data
     .filter((i) => i.amount_paid > 0).length === 0);
ok("subscription exists and is trialing (not charging yet)", sub.status === "trialing", `status=${sub.status}`);
ok(`first charge scheduled for their agreed date ${CHARGE_2}`, day(sub.trial_end) === CHARGE_2, day(sub.trial_end));
ok(`set to stop by itself on ${TERM_END}`, day(sub.cancel_at) === TERM_END, day(sub.cancel_at));
ok("counts as a live subscription for MRR (status active/trialing)", ["active", "trialing"].includes(sub.status));

const advance = async (iso, label) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (c.status === "advancing") { await new Promise((r) => setTimeout(r, 2000)); c = await stripe.testHelpers.testClocks.retrieve(clock.id); }
  console.log(`\n--- Time advanced to ${iso} (${label}) ---`);
};
/** Stripe settles the charge a moment after the clock moves — wait for it rather than race it. */
const paidInvoices = async (expected) => {
  for (let i = 0; i < 30; i++) {
    const all = (await stripe.invoices.list({ customer: cust.id, limit: 20 })).data;
    const p = all.filter((x) => x.status === "paid" && x.amount_paid > 0).sort((a, b) => a.created - b.created);
    if (p.length >= expected) return p;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return (await stripe.invoices.list({ customer: cust.id, limit: 20 })).data
    .filter((x) => x.status === "paid" && x.amount_paid > 0).sort((a, b) => a.created - b.created);
};

await advance("2026-08-17", "the day after their payment 2 date");
let paid = await paidInvoices(1);
ok("payment 2 charged automatically, no human involved", paid.length === 1, `${paid.length} paid invoice(s)`);
ok("payment 2 was the right amount", paid[0]?.amount_paid === MONTHLY, $(paid[0]?.amount_paid ?? 0));
ok("payment 2 landed on the agreed date", day(paid[0]?.created) === CHARGE_2, day(paid[0]?.created));
ok("a real INVOICE was produced for the client's records", !!paid[0]?.hosted_invoice_url && !!paid[0]?.invoice_pdf);

await advance("2026-09-17", "the day after their payment 3 date");
paid = await paidInvoices(2);
ok("payment 3 charged automatically", paid.length === 2, `${paid.length} paid invoice(s)`);
ok("payment 3 was the right amount", paid[1]?.amount_paid === MONTHLY, $(paid[1]?.amount_paid ?? 0));
ok("payment 3 landed on the agreed date", day(paid[1]?.created) === CHARGE_3, day(paid[1]?.created));

await advance("2026-10-20", "past the term end");
const after = await stripe.subscriptions.retrieve(sub.id);
const invs = (await stripe.invoices.list({ customer: cust.id, limit: 20 })).data;
paid = invs.filter((i) => i.status === "paid" && i.amount_paid > 0);
const total = paid.reduce((s, i) => s + i.amount_paid, 0);
ok("subscription stopped by itself after the term", after.status === "canceled", `status=${after.status}`);
ok("NO fourth charge was taken", paid.length === 2, `${paid.length} charges total`);
ok("exactly the 2 remaining payments collected ($3,000)", total === MONTHLY * 2, $(total));

console.log("\n--- Every invoice Stripe produced ---");
for (const i of invs.sort((a, b) => a.created - b.created)) {
  console.log(`  ${day(i.created)} | ${i.status.padEnd(6)} | ${$(i.amount_due)} | pdf=${i.invoice_pdf ? "yes" : "no"}`);
}

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) console.log("FAILED: " + fail.join(", "));
await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
console.log("Test clock deleted. No live objects touched.\n");
