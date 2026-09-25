/**
 * TEST-MODE proof of the REAL engine code in lib/proposals/ninety-day-billing.ts.
 * Uses STRIPE_TEST_SECRET_KEY only. No live charges. Run: npx tsx scripts/stripe-test/prove-engine.ts
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import {
  createUpfrontCheckout,
  createSpreadCheckout,
  chargeOffSession,
  setSubscriptionAutoRebill,
  MONTHS_IN_TERM,
} from "../../lib/proposals/ninety-day-billing";

const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
const key = env.STRIPE_TEST_SECRET_KEY;
if (!key || !key.startsWith("sk_test_")) { console.log("REFUSING: not a test key"); process.exit(1); }
const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
const $ = (c: number) => "$" + (c / 100).toFixed(2);
const pass: string[] = [], fail: string[] = [];
const ok = (n: string, cond: boolean, extra = "") => { (cond ? pass : fail).push(n); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`); };

async function savedCardCustomer(name: string): Promise<{ customerId: string; pm: string }> {
  const c = await stripe.customers.create({ name });
  const si = await stripe.setupIntents.create({ customer: c.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true, payment_method_types: ["card"] });
  await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: si.payment_method as string } });
  return { customerId: c.id, pm: si.payment_method as string };
}

async function chargeWith(pmToken: string, ikSuffix: string) {
  const c = await stripe.customers.create({ name: "TEST engine " + pmToken });
  try { await stripe.paymentMethods.attach(pmToken, { customer: c.id }); } catch { /* attach may 402; charge still exercises the mapping */ }
  return chargeOffSession(stripe, { customerId: c.id, paymentMethodId: pmToken, amountCents: 300000, currency: "usd", idempotencyKey: `eng_${c.id}_${ikSuffix}`, proposalId: "test-prop" });
}

async function main(): Promise<number> {
console.log("\n═══ chargeOffSession (real engine fn) ═══");
const { customerId, pm } = await savedCardCustomer("TEST engine spread");
const r1 = await chargeOffSession(stripe, { customerId, paymentMethodId: pm, amountCents: 150000, currency: "usd", idempotencyKey: `eng_${customerId}_1`, proposalId: "test-prop" });
ok("charge succeeds → {succeeded}", r1.status === "succeeded", r1.status);
const r1b = await chargeOffSession(stripe, { customerId, paymentMethodId: pm, amountCents: 150000, currency: "usd", idempotencyKey: `eng_${customerId}_1`, proposalId: "test-prop" });
ok("idempotent replay → same PI", r1.status === "succeeded" && r1b.status === "succeeded" && r1.paymentIntentId === r1b.paymentIntentId, r1.status === "succeeded" ? r1.paymentIntentId.slice(0, 12) : "");

// decline + SCA: attach the failing test cards, then charge through the engine fn
const rDecl = await chargeWith("pm_card_chargeDeclined", "d");
ok("decline → {declined} (never throws)", rDecl.status === "declined", `status=${rDecl.status}` + ("error" in rDecl ? ` ${rDecl.error}` : ""));
const rSca = await chargeWith("pm_card_authenticationRequired", "s");
ok("SCA → {requires_action} (never throws)", rSca.status === "requires_action", `status=${rSca.status}`);

console.log("\n═══ setSubscriptionAutoRebill (real engine fn) ═══");
const { customerId: subCust, pm: subPm } = await savedCardCustomer("TEST engine sub");
const product = await stripe.products.create({ name: "TEST engine retainer" });
const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 300000, recurring: { interval: "month" } });
const sub = await stripe.subscriptions.create({ customer: subCust, items: [{ price: price.id }], default_payment_method: subPm, off_session: true, payment_behavior: "error_if_incomplete" });
const none = await setSubscriptionAutoRebill(stripe, sub.id, "none");
ok("mode 'none' → cancel_at_period_end=true", none.cancel_at_period_end === true);
const monthly = await setSubscriptionAutoRebill(stripe, sub.id, "monthly");
ok("mode 'monthly' → cancel_at_period_end=false", monthly.cancel_at_period_end === false);
const full = await setSubscriptionAutoRebill(stripe, sub.id, "full90");
ok("mode 'full90' → keeps billing", full.cancel_at_period_end === false);
// SAFETY: 'monthly' on an UPFRONT (3-month-interval) sub must fail closed, not re-bill full 90.
const termPrice = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 900000, recurring: { interval: "month", interval_count: 3 } });
const upSub = await stripe.subscriptions.create({ customer: subCust, items: [{ price: termPrice.id }], default_payment_method: subPm, off_session: true, payment_behavior: "error_if_incomplete" });
const guarded = await setSubscriptionAutoRebill(stripe, upSub.id, "monthly");
ok("'monthly' on term-price sub FAILS CLOSED (stops + flags, no 3× over-charge)", guarded.cancel_at_period_end === true && guarded.metadata?.needs_monthly_resubscribe === "true", `cancel=${guarded.cancel_at_period_end} flag=${guarded.metadata?.needs_monthly_resubscribe}`);

console.log("\n═══ Checkout builders (real engine fns, config accepted by Stripe) ═══");
const cCust = await stripe.customers.create({ name: "TEST engine checkout" });
const up = await createUpfrontCheckout(stripe, { customerId: cCust.id, monthlyAmountCents: 300000, currency: "usd", proposalId: `up-${cCust.id}`, productName: "90d Upfront", successUrl: "https://example.com/s", cancelUrl: "https://example.com/c", autoRebillMode: "none" });
const upPrice = await stripe.prices.retrieve(up.priceId);
ok("upfront: URL returned + price = 3× monthly", up.url.startsWith("https://") && upPrice.unit_amount === 300000 * MONTHS_IN_TERM, `${$(upPrice.unit_amount ?? 0)} interval_count=${upPrice.recurring?.interval_count}`);
ok("upfront: price billed every 3 months", upPrice.recurring?.interval_count === MONTHS_IN_TERM);
const sp = await createSpreadCheckout(stripe, { customerId: cCust.id, firstChargeCents: 150000, currency: "usd", proposalId: `sp-${cCust.id}`, productName: "90d Spread", successUrl: "https://example.com/s", cancelUrl: "https://example.com/c" });
ok("spread: Stripe accepted save-card checkout config", sp.url.startsWith("https://"), sp.url.slice(0, 34));

console.log(`\n═══ RESULT: ${pass.length} passed, ${fail.length} failed ═══`);
return fail.length;
}

main().then((n) => process.exit(n ? 1 : 0)).catch((e) => { console.error("CRASH:", e?.message || e); process.exit(1); });
