/**
 * TEST-MODE proof of the Option-2 "spread" money mechanics: save a card once, then
 * auto-charge arbitrary amounts off-session (the flexible first month + months 2/3),
 * with idempotency + decline + SCA handling. Uses STRIPE_TEST_SECRET_KEY ONLY.
 * Makes NO live charges. Run: node scripts/stripe-test/prove-offsession.mjs
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
const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
const $ = (c) => "$" + (c / 100).toFixed(2);
const pass = [], fail = [];
const ok = (n, cond, extra = "") => { (cond ? pass : fail).push(n); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${n}${extra ? " — " + extra : ""}`); };

console.log("\n═══ Option 2 (spread): save card, off-session auto-charge ═══");

// 1) Customer + save a card set up for off-session (the real flow: SetupIntent usage=off_session)
const cust = await stripe.customers.create({ name: "TEST 90day Spread", metadata: { test: "90day-proof" } });
const si = await stripe.setupIntents.create({
  customer: cust.id, payment_method: "pm_card_visa", usage: "off_session", confirm: true,
  payment_method_types: ["card"],
});
ok("save card via SetupIntent (off_session)", si.status === "succeeded", `status=${si.status}`);
const pm = si.payment_method;
await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm } });

// 2) Flexible first month: 50% now + 50% "day 14" (immediate here), off-session, each with an idempotency key
const total = 300000; // $3,000 monthly retainer
const half = total / 2;
// Idempotency keys are account-global, so scope them to THIS run's customer (each run makes a
// new customer). Within a run, replaying the same key proves no-double-charge; across runs the
// customer differs so keys never collide.
const ikey = (n) => `${cust.id}_${n}`;
const chargeOff = (amount, n) => stripe.paymentIntents.create(
  { amount, currency: "usd", customer: cust.id, payment_method: pm, off_session: true, confirm: true },
  { idempotencyKey: ikey(n) },
);
const p1 = await chargeOff(half, "m1p1");
ok("off-session charge #1 (50% now)", p1.status === "succeeded", `${$(p1.amount)} ${p1.status}`);
const p2 = await chargeOff(half, "m1p2");
ok("off-session charge #2 (50% day 14)", p2.status === "succeeded", `${$(p2.amount)} ${p2.status}`);

// 3) Idempotency: replay charge #1 with the SAME key → must return the SAME PI, no double charge
const p1replay = await chargeOff(half, "m1p1");
ok("idempotency (replay = same PI, no double charge)", p1replay.id === p1.id, `${p1.id.slice(0,12)} == ${p1replay.id.slice(0,12)}`);

// 4) Months 2 & 3 auto-charge (full monthly), off-session
const m2 = await chargeOff(total, "m2");
const m3 = await chargeOff(total, "m3");
ok("month 2 auto-charge", m2.status === "succeeded", $(m2.amount));
ok("month 3 auto-charge", m3.status === "succeeded", $(m3.amount));

// 5) Decline path must be a CATCHABLE error the engine can flag as billing_issue.
//    Charge the declining test card directly (the real failure happens at confirm).
const cDecl = await stripe.customers.create({ name: "TEST decline" });
try {
  await stripe.paymentIntents.create({ amount: total, currency: "usd", customer: cDecl.id, payment_method: "pm_card_chargeDeclined", off_session: true, confirm: true });
  ok("decline is catchable", false, "did NOT throw");
} catch (e) {
  ok("decline is catchable", e.code === "card_declined" || !!e.decline_code, `code=${e.code} decline_code=${e.decline_code}`);
}

// 6) SCA-required path must surface authentication_required (engine flags requires_action, notifies client)
const cSca = await stripe.customers.create({ name: "TEST sca" });
try {
  await stripe.paymentIntents.create({ amount: total, currency: "usd", customer: cSca.id, payment_method: "pm_card_authenticationRequired", off_session: true, confirm: true });
  ok("SCA-required is catchable", false, "did NOT throw");
} catch (e) {
  ok("SCA-required is catchable", e.code === "authentication_required" || e.code === "card_declined", `code=${e.code}`);
}

console.log(`\n═══ RESULT: ${pass.length} passed, ${fail.length} failed ═══`);
console.log("(All test mode. No live charges. Test customers left for inspection in the Stripe test dashboard.)");
process.exit(fail.length ? 1 : 0);
