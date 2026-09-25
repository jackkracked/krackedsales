/**
 * TEST-MODE proof: an instalment invoice must NOT land in the client's inbox the moment
 * they pay the previous one. It should sit as a draft and be sent a few days before its
 * own due date, so it arrives when it is actually relevant and doesn't get buried.
 *
 * Tests Stripe's `automatically_finalizes_at`. STRIPE_TEST_SECRET_KEY ONLY.
 * Run: node scripts/stripe-test/prove-deferred-invoice.mjs
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
const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "-");
const pass = [], fail = [];
const ok = (n, c, x = "") => { (c ? pass : fail).push(n); console.log(`  ${c ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };

const TODAY = "2026-08-07";   // client pays instalment 1 today
const DUE   = "2026-09-07";   // instalment 2 is due in a month
const SEND  = "2026-09-04";   // it should reach them 3 days before, not today

const clock = await stripe.testHelpers.testClocks.create({ frozen_time: ts(TODAY), name: "deferred-invoice" });
const cust = await stripe.customers.create({ name: "TEST Deferred Instalment", email: "t@example.com", test_clock: clock.id });

console.log(`\n=== Client pays instalment 1 on ${TODAY}. Instalment 2 is due ${DUE}. ===\n`);

let inv = await stripe.invoices.create({
  customer: cust.id,
  collection_method: "send_invoice",
  due_date: ts(DUE),
  automatically_finalizes_at: ts(SEND),   // <-- the fix: Stripe sends it on this date, not now
  auto_advance: true,
});
await stripe.invoiceItems.create({ customer: cust.id, invoice: inv.id, amount: 150000, currency: "usd", description: "Instalment 2 of 3" });
inv = await stripe.invoices.retrieve(inv.id);

ok("Stripe accepted automatically_finalizes_at", !!inv.automatically_finalizes_at, day(inv.automatically_finalizes_at));
ok("invoice is a DRAFT, so nothing was emailed today", inv.status === "draft", `status=${inv.status}`);
ok("scheduled to send 3 days before it is due", day(inv.automatically_finalizes_at) === SEND, day(inv.automatically_finalizes_at));
ok("due date is the agreed date", day(inv.due_date) === DUE, day(inv.due_date));

const advance = async (iso, label) => {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: ts(iso) });
  let c = await stripe.testHelpers.testClocks.retrieve(clock.id);
  while (c.status === "advancing") { await new Promise((r) => setTimeout(r, 2000)); c = await stripe.testHelpers.testClocks.retrieve(clock.id); }
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`\n--- ${iso} (${label}) ---`);
};

await advance("2026-08-20", "13 days later, still well before the due date");
inv = await stripe.invoices.retrieve(inv.id);
ok("STILL a draft — the client has been sent nothing", inv.status === "draft", `status=${inv.status}`);

await advance("2026-09-03", "the day before it should send");
inv = await stripe.invoices.retrieve(inv.id);
ok("still nothing sent the day before", inv.status === "draft", `status=${inv.status}`);

await advance("2026-09-05", "the day after the scheduled send");
inv = await stripe.invoices.retrieve(inv.id);
ok("NOW it is finalised and sent to the client", inv.status === "open", `status=${inv.status}`);
ok("it arrived 3 days before the due date, not a month early", inv.status === "open" && day(inv.due_date) === DUE);

const sent = await stripe.events.list({ type: "invoice.sent", limit: 20 });
ok("Stripe emailed it at the scheduled moment", sent.data.some((e) => e.data.object.id === inv.id));

console.log(`\n=== RESULT: ${pass.length} passed, ${fail.length} failed ===`);
if (fail.length) console.log("FAILED: " + fail.join("; "));
await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
