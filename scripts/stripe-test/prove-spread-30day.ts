/**
 * Prove the 30-day "spread" retainer end to end with a Stripe Test Clock.
 *
 * THE ASSERTION THAT MATTERS: the proposal is QUOTED for one date and PAID on a different one,
 * which is the normal case. The document must show the dates Stripe actually charges, computed
 * from the real anchor (`sub.start_date`, the moment payment 1 was taken), not from the quoted
 * `startDate`. Before the anchor fix this scenario was four days out for the whole term.
 *
 * Also guards the interval hazard: at a 30-day cadence charges land on days 0/30/60, but three
 * calendar months is ~92 days, so a calendar cancel_at would admit a FOURTH charge on day 90.
 *
 * STRIPE_TEST_SECRET_KEY ONLY. Run: ./node_modules/.bin/tsx scripts/stripe-test/prove-spread-30day.ts
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { managementSchedule, SPREAD_CADENCE_DAYS, type BillingTerms } from "../../lib/proposals/billing";
// Mirrors MONTHS_IN_TERM in lib/proposals/ninety-day-billing.ts (not imported: that module uses a
// "@/" alias, which Next resolves but tsx does not). Asserted by behaviour below.
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
const iso = (t: number | null | undefined) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "-");
const ts = (d: string) => Math.floor(new Date(d + "T12:00:00Z").getTime() / 1000);
const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const whenToIso = (w: string) => {
  const [d, mon, y] = w.split(" ");
  return `${y}-${String(MONTHS.indexOf(mon) + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
};

const QUOTED = "2026-08-03"; // startDate on the proposal when it was sent
const PAID   = "2026-08-07"; // when the client actually pays payment 1
const MONTHLY = 150000;      // $1,500

console.log("\n=== 90-day 'spread': quoted 3 Aug, PAID 7 Aug, every 30 days x3 ===\n");

void (async () => {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(PAID), name: "spread-30day" });
  const cust = await stripe.customers.create({ name: "TEST Spread 30day", email: "t30@example.com", test_clock: clock.id });
  const si = await stripe.setupIntents.create({
    customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
  });
  await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: si.payment_method } });

  // EXACTLY what lib/proposals/ninety-day-billing.ts now creates.
  const price = await stripe.prices.create({
    currency: "usd", unit_amount: MONTHLY,
    recurring: { interval: "day", interval_count: SPREAD_CADENCE_DAYS },
    product_data: { name: "90 Day Retention Sprint" },
  });
  const cancelAt = (() => {
    const d = new Date(PAID + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + SPREAD_CADENCE_DAYS * MONTHS_IN_TERM);
    return Math.floor(d.getTime() / 1000);
  })();
  const sub = await stripe.subscriptions.create({
    customer: cust.id,
    items: [{ price: price.id }],
    cancel_at: cancelAt,
    collection_method: "charge_automatically",
    default_payment_method: si.payment_method as string,
    proration_behavior: "none",
    metadata: { ninety_day: "spread_sub" },
  });

  // This is what ninety-day-fulfillment.ts now does on checkout.session.completed: anchor the
  // document to sub.start_date, then freeze. NOTE it uses the PAID date, not the quoted one.
  const anchor = new Date(sub.start_date * 1000);
  const terms = {
    type: "management", paymentStructure: "subscription", totalAmount: 1500, currency: "usd",
    billingInterval: "month", billingIntervalCount: 1, autoRenew: true,
    managementOption: "spread", autoRebillMode: "none",
    startDate: new Date(QUOTED + "T12:00:00Z"), // the stale quote, deliberately different
    contractStartAt: anchor,
  } as BillingTerms;
  const printed = managementSchedule(terms)!;
  console.log(`  quoted startDate : ${QUOTED}   (deliberately NOT the pay date)`);
  console.log(`  sub.start_date   : ${iso(sub.start_date)}\n  Proposal prints:`);
  printed.forEach((r) => console.log(`    ${r.label.padEnd(16)} ${r.when.padEnd(13)} $${r.amount}`));
  const expectedDates = printed.map((r) => whenToIso(r.when));

  ok("document anchors to the PAYMENT, not the quoted startDate",
    expectedDates[0] === PAID, `${expectedDates[0]} vs paid ${PAID}`);
  ok("price bills every 30 days (not a calendar month)",
    price.recurring?.interval === "day" && price.recurring?.interval_count === 30,
    `${price.recurring?.interval} x${price.recurring?.interval_count}`);
  ok("cancel_at is day 90 exactly, not 3 calendar months", iso(sub.cancel_at) === "2026-11-05", iso(sub.cancel_at));

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
  ok("payment 1 charged at signup", inv.length === 1 && inv[0].amount_paid === MONTHLY, `${inv.length} paid, ${$(inv[0]?.amount_paid ?? 0)}`);

  await advance("2026-09-08", "just past day 30 — payment 2 unattended (test-clock invoices finalize shortly AFTER the billing instant, so land past it)");
  inv = await paidInvoices(2);
  ok("payment 2 taken at day 30", inv.length === 2, `${inv.length} paid`);

  await advance("2026-10-08", "just past day 60 — payment 3");
  inv = await paidInvoices(3);
  ok("payment 3 taken at day 60", inv.length === 3, `${inv.length} paid`);

  await advance("2026-11-20", "past day 90 — THE 4TH-CHARGE TRAP");
  inv = await paidInvoices(4);
  ok("NO 4th charge after the term", inv.length === 3, `${inv.length} paid`);

  await advance("2026-12-25", "a further month on, belt and braces");
  inv = await paidInvoices(4);
  ok("still no 4th charge", inv.length === 3, `${inv.length} paid`);

  const total = inv.reduce((s, x) => s + (x.amount_paid ?? 0), 0);
  ok("collected exactly $4,500", total === MONTHLY * MONTHS_IN_TERM, $(total));

  // The invoice.paid webhook guard keys on billing_reason to tell payment 1 from payments 2/3.
  // Verify Stripe actually sets what that guard assumes, rather than trusting the docs.
  const reasons = inv.map((x) => x.billing_reason);
  console.log(`\n  billing_reason per invoice: ${reasons.join(", ")}`);
  ok("invoice 1 is subscription_create (webhook must NOT skip it)", reasons[0] === "subscription_create", String(reasons[0]));
  ok("invoices 2 and 3 are subscription_cycle (webhook MUST skip them)",
    reasons.slice(1).every((r) => r === "subscription_cycle"), reasons.slice(1).join(","));

  const actualDates = inv.map((x) => iso(x.created));
  console.log(`\n  proposal printed : ${expectedDates.join("  ")}`);
  console.log(`  stripe charged   : ${actualDates.join("  ")}`);
  ok("CHARGE DATES EQUAL THE DATES THE CLIENT WAS SHOWN",
    JSON.stringify(actualDates) === JSON.stringify(expectedDates));

  const final = await stripe.subscriptions.retrieve(sub.id);
  ok("subscription ended by itself", final.status === "canceled", final.status);

  console.log(`\n  ${pass.length} passed, ${fail.length} failed`);
  if (fail.length) { console.log("  FAILED: " + fail.join("; ")); process.exit(1); }
  console.log("  ALL GREEN\n");
})();
