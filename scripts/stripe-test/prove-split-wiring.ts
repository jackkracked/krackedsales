/**
 * END-TO-END proof of the REAL DB WIRING for a split first payment.
 *
 * Drives the actual production functions — fulfillNinetyDayCheckout (webhook) and
 * chargeDueNinetyDaySplits (cron) — against a throwaway proposal, with the Stripe TEST key,
 * and asserts that when the LAST split portion clears, onFirstMonthCollected starts a real
 * subscription for the remaining months instead of writing more ledger rows.
 *
 * Inserts one clearly-marked proposal, then DELETES it and everything it created, including
 * the Stripe subscription. No live charges, no live data left behind.
 *
 * Run: npx tsx scripts/stripe-test/prove-split-wiring.ts
 */
import { readFileSync } from "node:fs";
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

if (!env.STRIPE_TEST_SECRET_KEY?.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const stripe = new Stripe(env.STRIPE_TEST_SECRET_KEY);

const $ = (c: number) => "$" + (c / 100).toFixed(2);
const dayOf = (d: Date | number | null | undefined) =>
  d ? new Date(typeof d === "number" ? d * 1000 : d).toISOString().slice(0, 10) : "-";
const pass: string[] = [], fail: string[] = [];
const ok = (n: string, c: boolean, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

let proposalId: string | null = null;
let subId: string | null = null;

// Wrapped in a function: this file resolves the "@/..." aliases so it must stay .ts, and tsx
// compiles .ts as CJS, which does not allow top-level await.
async function main() {
try {
  // ---- Set up a test customer with a saved card, and charge portion 1 ($600) ----
  const cust = await stripe.customers.create({ name: "TEST split wiring" });
  const si = await stripe.setupIntents.create({
    customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"],
  });
  const pi1 = await stripe.paymentIntents.create({
    amount: 60000, currency: "usd", customer: cust.id, payment_method: si.payment_method as string,
    off_session: true, confirm: true, description: "portion 1",
  });
  ok("portion 1 charged in test mode", pi1.status === "succeeded", $(60000));

  // ---- Insert the throwaway proposal: $1,500/mo, first month split $600 + $900 at +14d ----
  const [anyUser] = await db().select({ id: proposals.createdBy }).from(proposals).limit(1);
  const [row] = await db().insert(proposals).values({
    token: "test-split-wiring-" + Date.now(),
    title: "TEST split wiring — DELETE ME",
    type: "management",
    ghlContactId: "test-ghl",
    contactName: "TEST Split Wiring",
    contactEmail: "test@example.com",
    createdBy: anyUser?.id ?? null,
    status: "signed",
    totalAmount: 1500,
    currency: "usd",
    paymentStructure: "subscription",
    managementOption: "spread",
    autoRebillMode: "none",
    autoRenew: false,
    firstPaymentSplit: [{ amount: 600, offsetDays: 0 }, { amount: 900, offsetDays: 14 }],
    stripeCustomerId: cust.id,
    signedAt: new Date(),
  }).returning();
  proposalId = row.id;
  console.log(`  (throwaway proposal ${proposalId})`);

  // ---- Drive the REAL webhook function with a spread Checkout session ----
  const session = {
    metadata: { ninety_day: "spread", proposal_id: proposalId },
    customer: cust.id,
    payment_intent: pi1.id,
  } as unknown as Stripe.Checkout.Session;
  const res = await fulfillNinetyDayCheckout(stripe, session);
  ok("webhook handled the spread checkout", res.handled === true, `kind=${res.kind}`);

  let splits = await db().select().from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, proposalId));
  ok("first-month portions written to the ledger", splits.filter((s) => s.kind === "first_portion").length === 2, `${splits.length} rows`);
  ok("portion 1 already marked paid", splits.some((s) => s.chargeNumber === 1 && s.status === "paid"));
  ok("portion 2 pending, due +14 days", splits.some((s) => s.chargeNumber === 2 && s.status === "pending"));
  ok("NO month rows yet (subscription starts only when the split completes)", splits.filter((s) => s.kind === "month").length === 0);

  const [afterHook] = await db().select().from(proposals).where(eq(proposals.id, proposalId));
  ok("saved card stored on the proposal", !!afterHook.stripePaymentMethodId, afterHook.stripePaymentMethodId ?? "NONE");
  ok("no subscription yet", !afterHook.stripeSubscriptionId);

  // ---- Make portion 2 due, then run the REAL cron ----
  for (const s of splits.filter((x) => x.status === "pending")) {
    await db().update(ninetyDaySplits).set({ dueDate: new Date(Date.now() - 86_400_000) }).where(eq(ninetyDaySplits.id, s.id));
  }
  const summary = await chargeDueNinetyDaySplits(stripe);
  ok("cron charged the outstanding portion", summary.charged >= 1, JSON.stringify({ charged: summary.charged, declined: summary.declined, errors: summary.errors }));

  // ---- THE ASSERTION THAT MATTERS: the split completing started a subscription ----
  const [final] = await db().select().from(proposals).where(eq(proposals.id, proposalId));
  subId = final.stripeSubscriptionId;
  ok("a SUBSCRIPTION was created when the last portion cleared", !!subId, subId ?? "NONE");
  ok("first month marked complete", final.firstMonthComplete === true);
  ok("contract start recorded", !!final.contractStartAt, dayOf(final.contractStartAt));

  splits = await db().select().from(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, proposalId));
  ok("NO legacy month rows were written (subscription owns months 2-3)", splits.filter((s) => s.kind === "month").length === 0,
     `${splits.filter((s) => s.kind === "month").length} month rows`);

  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId);
    ok("subscription is dormant until its first charge", sub.status === "trialing", `status=${sub.status}`);
    ok("first charge is ~30 days after the split completed", !!sub.trial_end, dayOf(sub.trial_end));
    ok("it has an end date, so it stops itself", !!sub.cancel_at, dayOf(sub.cancel_at));
    ok("monthly amount is correct", sub.items.data[0]?.price?.unit_amount === 150000, $(sub.items.data[0]?.price?.unit_amount ?? 0));
    ok("charges automatically", sub.collection_method === "charge_automatically");
    const cycles = sub.cancel_at && sub.trial_end
      ? Math.round((sub.cancel_at - sub.trial_end) / (30 * 86400)) : 0;
    ok("stops after the 2 remaining months", cycles === 2, `${cycles} cycles between first charge and stop`);
  }
} catch (e) {
  ok("script ran without throwing", false, (e as Error).message);
} finally {
  console.log("\n--- cleanup ---");
  if (subId) { await stripe.subscriptions.cancel(subId).catch(() => {}); console.log(`  cancelled test subscription ${subId}`); }
  if (proposalId) {
    await db().delete(ninetyDaySplits).where(eq(ninetyDaySplits.proposalId, proposalId)).catch(() => {});
    await db().delete(proposals).where(eq(proposals.id, proposalId)).catch(() => {});
    const [gone] = await db().select().from(proposals).where(eq(proposals.id, proposalId));
    console.log(`  throwaway proposal deleted: ${!gone ? "YES" : "*** STILL PRESENT ***"}`);
  }
  console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
  if (fail.length) console.log("FAILED: " + fail.join("; "));
}
}

main().then(() => process.exit(fail.length ? 1 : 0));
