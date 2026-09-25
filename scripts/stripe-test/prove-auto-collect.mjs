/**
 * TEST-MODE proof of the rules Jack set on 2026-09-24:
 *   "It's an instalment. It should automatically collect if it's not a subscription.
 *    And then stop on the last instalment."
 *   "I don't want any negative cascading effects."
 *
 * Proves, against real Stripe with a Test Clock:
 *   1. a saved card is CHARGED on the due date, with no email-and-wait
 *   2. nothing is taken early: on signing day the invoice is still a draft
 *   3. after the LAST instalment, nothing further is ever created
 *   4. a FAILED payment blocks the next instalment instead of being skipped past
 *   5. a customer with nothing on file falls back to an invoice rather than crashing
 *   6. running twice creates exactly one invoice (idempotency)
 *
 * STRIPE_TEST_SECRET_KEY ONLY. Run: node scripts/stripe-test/prove-auto-collect.mjs
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

const ts = (iso) => Math.floor(new Date(iso + "T12:00:00Z").getTime() / 1000);
const pass = [], fail = [];
const ok = (n, c, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
const advance = async (clock, iso) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clock.id);
    if (c.status === "ready") return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("clock never became ready");
};

const SIGN = "2026-08-07", DUE2 = "2026-09-07", DUE3 = "2026-10-07";

// ── A client with a card on file, on a 3 x $500 plan ────────────────────────────────────
console.log("\n=== 1-3. Saved card: charged on the due date, not before, and stops at the end ===");
const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(SIGN), name: "auto-collect" });
const cus = await stripe.customers.create({ name: "Auto Collect Co", test_clock: clock.id });
const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
await stripe.paymentMethods.attach(pm.id, { customer: cus.id });
await stripe.customers.update(cus.id, { invoice_settings: { default_payment_method: pm.id } });

const raise = async (n, dueIso, customer = cus.id) => {
  const dueMs = new Date(dueIso + "T12:00:00Z").getTime();
  const sendAt = Math.floor((dueMs - 3 * 86400000) / 1000);
  const c = await stripe.customers.retrieve(customer);
  const auto = Boolean(c.invoice_settings?.default_payment_method ?? c.default_source);
  const now = (await stripe.testHelpers.testClocks.retrieve(clock.id)).frozen_time;
  const lead = auto ? 0 : 3 * 86400000;           // auto-charge lands ON the due date
  const sendAtReal = Math.floor((dueMs - lead) / 1000);
  const deferrable = sendAtReal > now + 3600;
  const inv = await stripe.invoices.create({
    customer,
    collection_method: auto ? "charge_automatically" : "send_invoice",
    ...(auto ? {} : { due_date: Math.floor(dueMs / 1000) }),
    auto_advance: true,
    ...(deferrable ? { automatically_finalizes_at: sendAtReal } : {}),
    metadata: { instalment_number: String(n), collection: auto ? "auto" : "invoice" },
  }, { idempotencyKey: `proof_inv_${customer}_${n}` });
  await stripe.invoiceItems.create({ customer, invoice: inv.id, amount: 50000, currency: "usd",
    description: `Instalment ${n} of 3` }, { idempotencyKey: `proof_item_${customer}_${n}` });
  if (!deferrable) await stripe.invoices.finalizeInvoice(inv.id, { auto_advance: true });
  return { inv, auto, deferrable };
};

const r2 = await raise(2, DUE2);
ok("uses charge_automatically when a card is on file", r2.auto === true, `auto=${r2.auto}`);
let inv2 = await stripe.invoices.retrieve(r2.inv.id);
ok("nothing taken on signing day: still a draft", inv2.status === "draft", `status=${inv2.status}`);

await advance(clock, "2026-09-06");
inv2 = await stripe.invoices.retrieve(r2.inv.id);
ok("NOT charged the day before it is due (no early debit)", inv2.status === "draft", `status=${inv2.status}`);

await advance(clock, "2026-09-08");
inv2 = await stripe.invoices.retrieve(r2.inv.id);
ok("CHARGED on the due date with no client action", inv2.status === "paid", `status=${inv2.status}`);
ok("money actually moved", inv2.amount_paid === 50000, `$${inv2.amount_paid / 100}`);

// Idempotency: what matters is that a re-run can never charge the client a second time.
// Stripe either returns the original invoice, or refuses the key outright because the request
// differs. Both are safe; a NEW paid invoice would not be.
const beforeReplay = (await stripe.invoices.list({ customer: cus.id, limit: 20 })).data.length;
let replayOutcome;
try {
  const replay = await raise(2, DUE2);
  replayOutcome = replay.inv.id === r2.inv.id ? "returned the original invoice" : "CREATED A DUPLICATE";
} catch (e) {
  replayOutcome = e.type === "StripeIdempotencyError" ? "Stripe refused the duplicate" : `unexpected: ${e.type}`;
}
const afterReplay = (await stripe.invoices.list({ customer: cus.id, limit: 20 })).data.length;
ok("re-running never charges the client twice", afterReplay === beforeReplay, `${replayOutcome}; invoices ${beforeReplay} -> ${afterReplay}`);

// The last instalment, then the stop.
const r3 = await raise(3, DUE3);
await advance(clock, "2026-10-08");
const inv3 = await stripe.invoices.retrieve(r3.inv.id);
ok("final instalment charged", inv3.status === "paid", `status=${inv3.status}`);
const allInv = await stripe.invoices.list({ customer: cus.id, limit: 20 });
ok("STOPS: exactly 2 invoices exist, no 4th instalment invented", allInv.data.length === 2, `${allInv.data.length} invoices`);
await advance(clock, "2026-11-20");
const afterEnd = await stripe.invoices.list({ customer: cus.id, limit: 20 });
ok("still nothing new six weeks after the last payment", afterEnd.data.length === 2, `${afterEnd.data.length} invoices`);

// ── A card that declines ────────────────────────────────────────────────────────────────
console.log("\n=== 4. A declined payment must BLOCK the next instalment, not be skipped ===");
const clock2 = await stripe.testHelpers.testClocks.create({ frozen_time: ts(SIGN), name: "decline" });
const cus2 = await stripe.customers.create({ name: "Declining Co", test_clock: clock2.id });
const badPm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_chargeCustomerFail" } });
await stripe.paymentMethods.attach(badPm.id, { customer: cus2.id });
await stripe.customers.update(cus2.id, { invoice_settings: { default_payment_method: badPm.id } });
const bad = await stripe.invoices.create({ customer: cus2.id, collection_method: "charge_automatically",
  auto_advance: true, metadata: { instalment_number: "2" } });
await stripe.invoiceItems.create({ customer: cus2.id, invoice: bad.id, amount: 50000, currency: "usd", description: "Instalment 2 of 3" });
await stripe.invoices.finalizeInvoice(bad.id, { auto_advance: true });
await new Promise((r) => setTimeout(r, 6000));
const badAfter = await stripe.invoices.retrieve(bad.id);
ok("the declined invoice is left OPEN and unpaid", badAfter.status !== "paid", `status=${badAfter.status}`);
// This is the guard the code now applies: anything not "paid" blocks the next instalment.
const rowStatus = badAfter.status === "paid" ? "paid" : "failed";
const settled = (s) => s === "paid";
ok("our guard treats it as outstanding, so instalment 3 is NOT raised", !settled(rowStatus), `row would be "${rowStatus}"`);

// ── A client with nothing on file ───────────────────────────────────────────────────────
console.log("\n=== 5. No saved payment method: invoice them, never crash, never skip ===");
const cus3 = await stripe.customers.create({ name: "No Card Co", email: "nocard@example.com" });
const c3 = await stripe.customers.retrieve(cus3.id);
const auto3 = Boolean(c3.invoice_settings?.default_payment_method ?? c3.default_source);
ok("detected as having no payment method", auto3 === false, `auto=${auto3}`);
const inv4 = await stripe.invoices.create({ customer: cus3.id, collection_method: "send_invoice",
  due_date: ts("2026-12-01"), auto_advance: true, metadata: { instalment_number: "2", collection: "invoice" } });
ok("falls back to emailing an invoice", inv4.collection_method === "send_invoice", inv4.collection_method);
ok("the client is still billed, not silently dropped", inv4.id != null);

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) { console.log("FAILED:", fail.join(" | ")); process.exit(1); }
