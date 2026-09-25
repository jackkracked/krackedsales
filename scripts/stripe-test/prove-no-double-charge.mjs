/**
 * TEST-MODE proof for the Motif case, the ONLY client with an invoice already sent.
 * Question: how do we auto-collect an invoice the client already has, ON its due date,
 * without (a) charging early and (b) ever charging twice?
 *
 * Tests two candidate approaches and picks the safe one.
 * STRIPE_TEST_SECRET_KEY ONLY. Run: node scripts/stripe-test/prove-no-double-charge.mjs
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
const ts = (iso) => Math.floor(new Date(iso + "T12:00:00Z").getTime() / 1000);
const pass = [], fail = [];
const ok = (n, c, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const TODAY = "2026-08-05", DUE = "2026-08-16", AMOUNT = 100000;

async function setup(label) {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(TODAY), name: label });
  const cust = await stripe.customers.create({ name: `TEST ${label}`, email: "t@example.com", test_clock: clock.id });
  const si = await stripe.setupIntents.create({
    customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
  });
  await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method } });
  // Recreate Motif's exact situation: an OPEN send_invoice invoice, due 16 Aug, already finalised.
  const inv0 = await stripe.invoices.create({
    customer: cust.id, collection_method: "send_invoice", due_date: ts(DUE), auto_advance: false,
  });
  await stripe.invoiceItems.create({ customer: cust.id, invoice: inv0.id, amount: AMOUNT, currency: "usd", description: "Payment 2 of 3" });
  const inv = await stripe.invoices.finalizeInvoice(inv0.id, { auto_advance: false });
  return { clock, cust, pm: si.payment_method, inv };
}
const advance = async (clock, iso) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (c.status === "advancing") { await new Promise((r) => setTimeout(r, 2000)); c = await stripe.testHelpers.testClocks.retrieve(clock.id); }
};

console.log("\n=== APPROACH A: flip the existing invoice to charge_automatically ===");
{
  const { clock, cust, inv } = await setup("A-convert");
  ok("starts as an open, unpaid, send_invoice invoice", inv.status === "open" && inv.collection_method === "send_invoice");
  let converted;
  try {
    converted = await stripe.invoices.update(inv.id, { collection_method: "charge_automatically" });
    ok("Stripe allows the conversion", true, `collection=${converted.collection_method}`);
  } catch (e) {
    ok("Stripe allows the conversion", false, e.message);
  }
  if (converted) {
    await new Promise((r) => setTimeout(r, 4000));
    const now = await stripe.invoices.retrieve(inv.id);
    const chargedEarly = now.status === "paid" || now.amount_paid > 0;
    ok("DID NOT charge early (still unpaid on 5 Aug)", !chargedEarly, `status=${now.status} paid=${$(now.amount_paid)}`);
    await advance(clock, "2026-08-17");
    await new Promise((r) => setTimeout(r, 6000));
    const after = await stripe.invoices.retrieve(inv.id);
    ok("collected itself on the due date", after.status === "paid", `status=${after.status} paid=${$(after.amount_paid)}`);
  }
  await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
}

console.log("\n=== APPROACH B: leave it alone, pay it off-session ON the due date ===");
{
  const { clock, cust, pm, inv } = await setup("B-payondate");
  await advance(clock, DUE);
  const paid = await stripe.invoices.pay(inv.id, { payment_method: pm, off_session: true });
  ok("invoice paid off-session on its due date", paid.status === "paid", `status=${paid.status} paid=${$(paid.amount_paid)}`);
  ok("client keeps the SAME invoice number they already have", paid.number === inv.number, paid.number);

  // The double-charge question: what happens if the job runs twice, or the client
  // also pays the link manually at the same time?
  let second = null, err = null;
  try { second = await stripe.invoices.pay(inv.id, { payment_method: pm, off_session: true }); }
  catch (e) { err = e; }
  ok("a SECOND payment attempt cannot double-charge", !!err || second?.amount_paid === AMOUNT,
     err ? `Stripe refused: ${err.code}` : `amount_paid still ${$(second.amount_paid)}`);
  const all = (await stripe.invoices.list({ customer: cust.id, limit: 10 })).data;
  const total = all.reduce((s, i) => s + i.amount_paid, 0);
  ok("exactly one payment was taken in total", total === AMOUNT, $(total));
  await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
}

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) console.log("FAILED: " + fail.join("; "));
