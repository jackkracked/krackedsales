/**
 * END-TO-END test-mode proof of the REAL fulfillment + cron code:
 *   fulfillNinetyDayCheckout (webhook) + chargeDueNinetyDaySplits (cron).
 * Inserts a throwaway proposal into the DB, drives the real functions with the Stripe TEST key,
 * asserts the money outcome, then DELETES everything it created. No live charges.
 * Run: npx tsx scripts/stripe-test/prove-integration.ts
 */
import { readFileSync } from "node:fs";
// Load .env.verify into process.env BEFORE the app modules call db()/stripe() at runtime.
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v as string;

import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, ninetyDaySplits } from "@/lib/db/schema";
import { fulfillNinetyDayCheckout, chargeDueNinetyDaySplits } from "@/lib/proposals/ninety-day-fulfillment";

const stripe = new Stripe(env.STRIPE_TEST_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" });
if (!env.STRIPE_TEST_SECRET_KEY?.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, extra = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`); };

async function savedCard(name: string) {
  const c = await stripe.customers.create({ name });
  const si = await stripe.setupIntents.create({ customer: c.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"] });
  await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: si.payment_method as string } });
  return { customerId: c.id, pm: si.payment_method as string };
}

async function insertTestProposal(fields: Record<string, unknown>): Promise<string> {
  const [u] = await db().select({ id: proposals.createdBy }).from(proposals).limit(1); // any existing createdBy uuid
  const [row] = await db().insert(proposals).values({
    token: `test90d_${Math.round(Math.random() * 1e9)}`,
    title: "__TEST_90D__ integration",
    type: "management",
    ghlContactId: "test-90d",
    contactName: "__TEST_90D__",
    contactEmail: "test90d@example.com",
    createdBy: (u?.id as string) ?? null,
    currency: "usd",
    paymentStructure: "subscription",
    status: "signed",
    // Pre-set the at-most-once paid guard so a test completion never posts a real Slack celebration.
    slackPaidNotifiedAt: new Date(),
    ...fields,
  } as typeof proposals.$inferInsert).returning({ id: proposals.id });
  return row.id;
}

async function cleanup(proposalId: string) {
  await db().delete(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, proposalId)).catch(() => {});
  await db().delete(proposals).where(eq(proposals.id, proposalId)).catch(() => {});
}

async function main(): Promise<number> {
  // ══ SPREAD flow ══════════════════════════════════════════════════════════════
  console.log("\n═══ SPREAD: webhook fulfillment → cron charges months 2 & 3 ═══");
  const { customerId, pm } = await savedCard("__TEST_90D__ spread");
  let spreadId = "";
  try {
    spreadId = await insertTestProposal({ totalAmount: 30, managementOption: "spread", autoRebillMode: "none", stripeCustomerId: customerId });
    // The "first payment" PI (what Checkout would have created), so fulfill can read the saved card.
    const firstPi = await stripe.paymentIntents.create({ amount: 3000, currency: "usd", customer: customerId, payment_method: pm, off_session: true, confirm: true });
    const session = { metadata: { ninety_day: "spread", proposal_id: spreadId }, payment_intent: firstPi.id, customer: customerId, mode: "payment" } as unknown as Stripe.Checkout.Session;

    const f = await fulfillNinetyDayCheckout(stripe, session);
    ok("fulfill handled spread", f.handled && f.kind === "spread");
    const [p1] = await db().select().from(proposals).where(eq(proposals.id, spreadId));
    ok("saved card stored on proposal", !!p1.stripePaymentMethodId, p1.stripePaymentMethodId ?? "none");
    ok("status = partial (not paid — months 2&3 owed)", p1.status === "partial", p1.status);
    let splits = await db().select().from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, spreadId));
    ok("2 ledger rows scheduled (months 2 & 3)", splits.length === 2, `${splits.length} rows`);

    // Make them due now, then run the real cron.
    for (const s of splits) await db().update(ninetyDaySplits).set({ dueDate: new Date(Date.now() - 86400000) }).where(eq(ninetyDaySplits.id, s.id));
    const sum1 = await chargeDueNinetyDaySplits(stripe);
    ok("cron charged both due rows", sum1.charged === 2, JSON.stringify(sum1));
    splits = await db().select().from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, spreadId));
    ok("both rows now paid with a PI", splits.every((s) => s.status === "paid" && s.stripePaymentIntentId), splits.map((s) => s.status).join(","));
    const [p2] = await db().select().from(proposals).where(eq(proposals.id, spreadId));
    ok("proposal completed → status paid", p2.status === "paid", p2.status);

    // Idempotency: second cron run must NOT re-charge (rows already paid → 0 due).
    const sum2 = await chargeDueNinetyDaySplits(stripe);
    ok("re-run cron: no double charge", sum2.due === 0 && sum2.charged === 0, JSON.stringify(sum2));
  } finally {
    if (spreadId) await cleanup(spreadId);
  }

  // ══ SPREAD + SPLIT first payment ══════════════════════════════════════════════
  console.log("\n═══ SPREAD + SPLIT: portion 1 at checkout → portion 2 off-session → months anchor to contract start ═══");
  const sc = await savedCard("__TEST_90D__ split");
  let splitId = "";
  try {
    // $4,500 monthly, split $2,000 now + $2,500 in 14 days.
    splitId = await insertTestProposal({ totalAmount: 4500, managementOption: "spread", autoRebillMode: "none", stripeCustomerId: sc.customerId, firstPaymentSplit: [{ amount: 2000, offsetDays: 0 }, { amount: 2500, offsetDays: 14 }] });
    const p1pi = await stripe.paymentIntents.create({ amount: 200000, currency: "usd", customer: sc.customerId, payment_method: sc.pm, off_session: true, confirm: true });
    const session = { metadata: { ninety_day: "spread", proposal_id: splitId }, payment_intent: p1pi.id, customer: sc.customerId, mode: "payment" } as unknown as Stripe.Checkout.Session;
    await fulfillNinetyDayCheckout(stripe, session);
    let rows = await db().select().from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, splitId));
    let fp = rows.filter((r) => r.kind === "first_portion");
    ok("2 first-portion rows (p1 paid, p2 pending), NO months yet", fp.length === 2 && rows.filter((r) => r.kind === "month").length === 0 && fp.filter((r) => r.status === "paid").length === 1, `fp=${fp.length} months=${rows.filter((r) => r.kind === "month").length}`);
    const [pa] = await db().select().from(proposals).where(eq(proposals.id, splitId));
    ok("contract not started yet", !pa.firstMonthComplete && !pa.contractStartAt);

    // Portion 2 due now → cron charges it → contract starts → months 2 & 3 scheduled off that date.
    const p2row = fp.find((r) => r.status === "pending")!;
    await db().update(ninetyDaySplits).set({ dueDate: new Date(Date.now() - 86400000) }).where(eq(ninetyDaySplits.id, p2row.id));
    const s1 = await chargeDueNinetyDaySplits(stripe);
    ok("cron charged portion 2", s1.charged === 1, JSON.stringify(s1));
    rows = await db().select().from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, splitId));
    const months = rows.filter((r) => r.kind === "month");
    ok("months 2 & 3 scheduled only after last portion cleared", months.length === 2, `months=${months.length}`);
    const [pb] = await db().select().from(proposals).where(eq(proposals.id, splitId));
    ok("contract start now set", !!pb.contractStartAt && pb.firstMonthComplete === true);

    // Months due now → cron → term completes.
    for (const m of months) await db().update(ninetyDaySplits).set({ dueDate: new Date(Date.now() - 86400000) }).where(eq(ninetyDaySplits.id, m.id));
    const s2 = await chargeDueNinetyDaySplits(stripe);
    ok("cron charged both months", s2.charged === 2, JSON.stringify(s2));
    const [pc] = await db().select().from(proposals).where(eq(proposals.id, splitId));
    ok("term complete → paid", pc.status === "paid", pc.status);
    const s3 = await chargeDueNinetyDaySplits(stripe);
    ok("re-run: no double charge", s3.charged === 0 && s3.due === 0, JSON.stringify(s3));
  } finally {
    if (splitId) await cleanup(splitId);
  }

  // ══ UPFRONT flow ═════════════════════════════════════════════════════════════
  console.log("\n═══ UPFRONT: webhook fulfillment applies stop + marks paid ═══");
  const { customerId: upCust, pm: upPm } = await savedCard("__TEST_90D__ upfront");
  let upId = "";
  try {
    upId = await insertTestProposal({ totalAmount: 30, managementOption: "upfront", autoRebillMode: "none", stripeCustomerId: upCust });
    const product = await stripe.products.create({ name: "__TEST_90D__ upfront retainer" });
    const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 9000, recurring: { interval: "month", interval_count: 3 } });
    const sub = await stripe.subscriptions.create({ customer: upCust, items: [{ price: price.id }], default_payment_method: upPm, off_session: true, payment_behavior: "error_if_incomplete" });
    const session = { metadata: { ninety_day: "upfront", proposal_id: upId }, subscription: sub.id, customer: upCust, mode: "subscription" } as unknown as Stripe.Checkout.Session;

    const f = await fulfillNinetyDayCheckout(stripe, session);
    ok("fulfill handled upfront", f.handled && f.kind === "upfront");
    const [p] = await db().select().from(proposals).where(eq(proposals.id, upId));
    ok("status = paid (full 90 collected)", p.status === "paid", p.status);
    ok("subscription id stored", p.stripeSubscriptionId === sub.id);
    const freshSub = await stripe.subscriptions.retrieve(sub.id);
    ok("auto-rebill 'none' applied → stops at term end", freshSub.cancel_at_period_end === true, `cancel_at_period_end=${freshSub.cancel_at_period_end}`);
  } finally {
    if (upId) await cleanup(upId);
  }

  console.log(`\n═══ RESULT: ${pass.length} passed, ${fail.length} failed ═══`);
  return fail.length;
}

main().then((n) => process.exit(n ? 1 : 0)).catch((e) => { console.error("CRASH:", e?.stack || e?.message || e); process.exit(1); });
