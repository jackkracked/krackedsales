/**
 * FINAL PROOF for the new management "spread" path — running the REAL production functions,
 * not a hand-written equivalent. Imports createSpreadSubscriptionCheckout and stopAfterTerm
 * straight out of lib/proposals/ninety-day-billing.ts.
 *
 * Covers the full lifecycle against a Stripe Test Clock:
 *   Checkout session accepted -> subscription created -> stopAfterTerm applied by the webhook
 *   -> 3 monthly charges with invoices -> stops itself -> no 4th charge, ever.
 *
 * STRIPE_TEST_SECRET_KEY ONLY. Run: npx tsx scripts/stripe-test/prove-spread-real-code.ts
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
// The repo is CJS, so pull the REAL module in dynamically and unwrap either interop shape.
const billingMod: any = await import("../../lib/proposals/ninety-day-billing");
const { createSpreadSubscriptionCheckout, stopAfterTerm } = billingMod.default ?? billingMod;
const MONTHS_IN_TERM = 3;

const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const key = env.STRIPE_TEST_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const stripe = new Stripe(key);

const $ = (c: number) => "$" + (c / 100).toFixed(2);
const day = (t?: number | null) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "-");
const ts = (iso: string) => Math.floor(new Date(iso + "T12:00:00Z").getTime() / 1000);
const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const SIGN = "2026-08-07";
const MONTHLY = 150000;
const PROPOSAL_ID = "test-proposal-" + SIGN;

console.log("\n=== REAL production code: management 'spread' = $1,500/mo x3 then stop ===\n");

const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(SIGN), name: "spread-real" });
const cust = await stripe.customers.create({ name: "TEST Spread Real Code", email: "t@example.com", test_clock: clock.id });
const si = await stripe.setupIntents.create({
  customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
});
await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method as string } });

// ---- 1. The REAL sign-route call ----
const checkout = await createSpreadSubscriptionCheckout(stripe, {
  customerId: cust.id,
  monthlyAmountCents: MONTHLY,
  currency: "usd",
  proposalId: PROPOSAL_ID,
  productName: "90 Day Retention Sprint — TEST",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
  autoRebillMode: "none",
});
ok("createSpreadSubscriptionCheckout produced a live Checkout URL", !!checkout.url && checkout.url.startsWith("https://"));
ok("it created a MONTHLY price (not a 3-month one)", (await stripe.prices.retrieve(checkout.priceId)).recurring?.interval === "month");
ok("the monthly price is the agreed figure", (await stripe.prices.retrieve(checkout.priceId)).unit_amount === MONTHLY, $(MONTHLY));

// ---- 2. The client completes Checkout. Stripe creates the subscription and charges cycle 1.
// A Checkout session cannot be completed via the API, so create the subscription exactly as
// Checkout does from that session: same price, same metadata, charge_automatically.
const sub = await stripe.subscriptions.create({
  customer: cust.id,
  items: [{ price: checkout.priceId }],
  collection_method: "charge_automatically",
  default_payment_method: si.payment_method as string,
  metadata: { proposal_id: PROPOSAL_ID, ninety_day: "spread_sub", auto_rebill_mode: "none" },
});
ok("payment 1 taken at signup", sub.status === "active", `status=${sub.status}`);
ok("subscription does NOT yet stop (Checkout cannot set it)", !sub.cancel_at, sub.cancel_at ? day(sub.cancel_at) : "no cancel_at");

// ---- 3. The REAL webhook call that applies the stop date ----
const stopped = await stopAfterTerm(stripe, sub.id, "none");
ok("stopAfterTerm set an end date", !!stopped.cancel_at, day(stopped.cancel_at));
const expectedEnd = (() => { const d = new Date(SIGN + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + MONTHS_IN_TERM); return d.toISOString().slice(0, 10); })();
ok(`it stops exactly ${MONTHS_IN_TERM} months after the start`, day(stopped.cancel_at) === expectedEnd, `${day(stopped.cancel_at)} (expected ${expectedEnd})`);

const paidInvoices = async (expected: number) => {
  for (let i = 0; i < 30; i++) {
    const all = (await stripe.invoices.list({ customer: cust.id, limit: 30 })).data;
    const p = all.filter((x) => x.status === "paid" && x.amount_paid > 0).sort((a, b) => a.created - b.created);
    if (p.length >= expected) return p;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return (await stripe.invoices.list({ customer: cust.id, limit: 30 })).data
    .filter((x) => x.status === "paid" && x.amount_paid > 0).sort((a, b) => a.created - b.created);
};
const advance = async (iso: string, label: string) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (c.status === "advancing") { await new Promise((r) => setTimeout(r, 2000)); c = await stripe.testHelpers.testClocks.retrieve(clock.id); }
  console.log(`\n--- ${iso} (${label}) ---`);
};

let paid = await paidInvoices(1);
ok("payment 1 produced a real INVOICE with a PDF", !!paid[0]?.invoice_pdf);

await advance("2026-09-08", "payment 2, unattended");
paid = await paidInvoices(2);
ok("payment 2 charged automatically", paid.length === 2, `${paid.length} paid`);
ok("payment 2 has its own invoice", !!paid[1]?.invoice_pdf);

await advance("2026-10-08", "payment 3");
paid = await paidInvoices(3);
ok("payment 3 charged automatically", paid.length === 3, `${paid.length} paid`);

await advance("2026-11-20", "past term end");
const after = await stripe.subscriptions.retrieve(sub.id);
paid = await paidInvoices(3);
ok("subscription stopped itself", after.status === "canceled", `status=${after.status}`);
ok("NO 4th charge", paid.length === 3, `${paid.length} charges`);
ok("collected exactly 3 x $1,500", paid.reduce((s, i) => s + i.amount_paid, 0) === MONTHLY * 3, $(paid.reduce((s, i) => s + i.amount_paid, 0)));

await advance("2027-01-15", "two months after the term, belt and braces");
paid = await paidInvoices(3);
ok("still exactly 3 charges months later", paid.length === 3, `${paid.length} charges`);

console.log("\n--- Invoices the client received ---");
for (const i of paid) console.log(`  ${day(i.created)}  ${$(i.amount_paid)}  pdf=${i.invoice_pdf ? "yes" : "NO"}`);

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) console.log("FAILED: " + fail.join("; "));
await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
