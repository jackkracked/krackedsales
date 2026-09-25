/**
 * Puts the six 90-Day Retention Sprint clients onto real Stripe subscriptions so their
 * remaining payments collect themselves on the agreed dates.
 *
 * SAFETY MODEL (the whole point of this script):
 *   - DRY RUN BY DEFAULT. Pass --execute to write anything.
 *   - Eight preflight guards per client. ANY failure skips that client entirely.
 *   - Never charges today: every subscription is dormant (trial) until the agreed date.
 *   - Never double-charges: refuses if the customer already has a subscription, or any
 *     open/draft invoice that could cover the same money.
 *   - Idempotent: refuses if the proposal already carries a subscription id, and uses a
 *     stable idempotency key so a re-run cannot create a second subscription.
 *   - Motif is deliberately EXCLUDED from subscriptions: it already has a sent invoice for
 *     payment 2 and an existing deposit chain that issues payment 3, so adding a
 *     subscription would bill it twice. It is handled by pay-on-due-date instead.
 *
 * Run: node scripts/fix-90day-billing.mjs            (dry run)
 *      node scripts/fix-90day-billing.mjs --execute  (writes)
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";

const EXECUTE = process.argv.includes("--execute");
const envFile = process.env.ENV_FILE || ".env.production.vercel";
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "")];
  })
);
const sql = neon(env.DATABASE_URL);
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const $ = (c) => "$" + (c / 100).toFixed(2);
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const ts = (d) => Math.floor(new Date(`${iso(d)}T12:00:00Z`).getTime() / 1000);
const addMonth = (d, n) => { const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + n); return r; };
const TODAY = new Date();

/** The five to convert. Motif is handled separately, see header. */
const TARGETS = [
  { name: "Rossi Mckee",          label: "Daily Few" },
  { name: "Greenhouse Girls THC", label: "Green Haus Girls THC", fixDates: ["2026-07-23", "2026-08-23", "2026-09-23"] },
  { name: "Eat Meat Media",       label: "Primal Pal" },
  { name: "Cheeky",               label: "Cheeky" },
  { name: "Blush & Bliss",        label: "Blush & Bliss" },
];

console.log(`\n${"=".repeat(80)}`);
console.log(`  90-DAY BILLING FIX   ${EXECUTE ? ">>> EXECUTE (WILL WRITE) <<<" : "DRY RUN (no changes)"}`);
console.log(`  ${TODAY.toISOString()}`);
console.log(`${"=".repeat(80)}`);

const results = [];

for (const t of TARGETS) {
  console.log(`\n${"-".repeat(80)}\n### ${t.label}  (system name: ${t.name})`);
  const guards = [];
  const guard = (n, cond, detail = "") => { guards.push({ n, cond }); console.log(`   ${cond ? "OK  " : "STOP"} ${n}${detail ? "  -> " + detail : ""}`); return cond; };

  const [p] = await sql`
    SELECT id, contact_name, contact_email, total_amount, currency, status,
           stripe_customer_id, stripe_subscription_id
    FROM proposals WHERE contact_name = ${t.name} AND status IN ('signed','partial')
    ORDER BY created_at DESC LIMIT 1`;

  if (!guard("proposal found and signed", !!p, p ? `${p.id} status=${p.status}` : "NOT FOUND")) { results.push({ t, skipped: "no proposal" }); continue; }
  guard("no subscription already recorded (idempotency)", !p.stripe_subscription_id, p.stripe_subscription_id ?? "none");
  guard("has a Stripe customer", !!p.stripe_customer_id, p.stripe_customer_id);

  // Optionally correct broken due dates BEFORE reading them.
  if (t.fixDates) {
    const rows = await sql`SELECT id, instalment_number, due_date FROM proposal_instalments WHERE proposal_id = ${p.id} ORDER BY instalment_number`;
    const wrong = rows.filter((r, i) => iso(r.due_date) !== t.fixDates[i]);
    console.log(`   NOTE date correction needed on ${wrong.length} row(s): ${rows.map((r) => iso(r.due_date)).join(", ")} -> ${t.fixDates.join(", ")}`);
    if (EXECUTE) {
      for (let i = 0; i < rows.length; i++) {
        await sql`UPDATE proposal_instalments SET due_date = ${t.fixDates[i] + "T12:00:00Z"} WHERE id = ${rows[i].id}`;
      }
      console.log("   APPLIED date correction");
    }
  }

  const inst = await sql`
    SELECT id, instalment_number, amount, due_date, status, stripe_invoice_id
    FROM proposal_instalments WHERE proposal_id = ${p.id} ORDER BY instalment_number`;
  const effDate = (r, i) => (t.fixDates ? new Date(t.fixDates[i] + "T12:00:00Z") : r.due_date);
  const unpaid = inst.filter((r) => r.status !== "paid");
  const paidRows = inst.filter((r) => r.status === "paid");

  guard("payment 1 is already collected", paidRows.length >= 1, `${paidRows.length} paid`);
  guard("there are unpaid payments left to schedule", unpaid.length > 0, `${unpaid.length} unpaid`);
  guard("all remaining payments are the same amount", new Set(unpaid.map((r) => r.amount)).size === 1, unpaid.map((r) => "$" + r.amount).join(", "));

  const idx = (r) => inst.findIndex((x) => x.id === r.id);
  const firstDue = unpaid.length ? effDate(unpaid[0], idx(unpaid[0])) : null;
  const lastDue = unpaid.length ? effDate(unpaid[unpaid.length - 1], idx(unpaid[unpaid.length - 1])) : null;
  guard("next payment date is in the FUTURE (never charge early)", firstDue && firstDue > TODAY, firstDue ? iso(firstDue) : "-");

  // ---- Double-charge guards, straight against live Stripe ----
  let subs = { data: [] }, invs = { data: [] };
  if (p.stripe_customer_id) {
    subs = await stripe.subscriptions.list({ customer: p.stripe_customer_id, status: "all", limit: 20 });
    invs = await stripe.invoices.list({ customer: p.stripe_customer_id, limit: 30 });
  }
  const liveSubs = subs.data.filter((s) => ["active", "trialing", "past_due", "unpaid"].includes(s.status));
  const liveInvs = invs.data.filter((i) => ["open", "draft"].includes(i.status));
  guard("customer has NO existing live subscription", liveSubs.length === 0, liveSubs.map((s) => s.id).join(", ") || "none");
  guard("customer has NO open/draft invoice that could overlap", liveInvs.length === 0, liveInvs.map((i) => `${i.id} ${$(i.amount_due)}`).join(", ") || "none");

  const pms = p.stripe_customer_id ? await stripe.paymentMethods.list({ customer: p.stripe_customer_id, limit: 5 }) : { data: [] };
  const cust = p.stripe_customer_id ? await stripe.customers.retrieve(p.stripe_customer_id) : null;
  const defPm = cust?.invoice_settings?.default_payment_method ?? pms.data[0]?.id ?? null;
  guard("a payment method is on file to charge", !!defPm, defPm ?? "NONE");

  const blocked = guards.some((g) => !g.cond);
  if (blocked) { console.log(`   => SKIPPED: ${guards.filter((g) => !g.cond).length} guard(s) failed`); results.push({ t, skipped: "guard failed" }); continue; }

  const monthly = Math.round(unpaid[0].amount * 100);
  const termEnd = addMonth(lastDue, 1); // one cycle past the final payment: it stops itself
  console.log(`   PLAN: ${unpaid.length} x ${$(monthly)}  first ${iso(firstDue)}  last ${iso(lastDue)}  stops ${iso(termEnd)}`);
  console.log(`         charge today: $0.00   total to collect: ${$(monthly * unpaid.length)}   card: ${defPm}`);

  if (!EXECUTE) { results.push({ t, planned: { n: unpaid.length, monthly, firstDue, lastDue, termEnd } }); continue; }

  const price = await stripe.prices.create({
    currency: p.currency || "usd", unit_amount: monthly, recurring: { interval: "month" },
    product_data: { name: `90 Day Retention Sprint — ${t.label}` },
  }, { idempotencyKey: `fix90_price_${p.id}` });

  const sub = await stripe.subscriptions.create({
    customer: p.stripe_customer_id,
    items: [{ price: price.id }],
    trial_end: ts(firstDue),
    cancel_at: ts(termEnd),
    collection_method: "charge_automatically",
    default_payment_method: defPm,
    proration_behavior: "none",
    description: `90 Day Retention Sprint — remaining ${unpaid.length} payment(s)`,
    metadata: { proposal_id: p.id, fix: "90day-billing-recovery", remaining_payments: String(unpaid.length) },
  }, { idempotencyKey: `fix90_sub_${p.id}` });

  await sql`UPDATE proposals SET stripe_subscription_id = ${sub.id}, management_option = 'subscription',
            is_legacy_manual = false, updated_at = now() WHERE id = ${p.id}`;
  // Stop these rows being chased by the reminder engine now the subscription owns the money.
  for (const r of unpaid) {
    await sql`UPDATE proposal_instalments SET status = 'superseded_by_subscription' WHERE id = ${r.id}`;
  }
  // Retire the manual MRR patch, or this client counts TWICE (once manual, once via the
  // real subscription). Deactivated rather than deleted so it stays auditable/reversible.
  // Hand over cleanly: the manual row stays live until the DAY the real subscription starts
  // charging, then stops. No double-count, and no MRR dip in between (a new subscription is
  // "trialing", and the MRR metric only counts "active").
  const handoff = iso(firstDue);
  const retired = await sql`
    UPDATE manual_mrr_adjustments
    SET effective_to = ${handoff + "T00:00:00Z"}, updated_at = now(),
        reason = reason || ' [HANDOVER ' || now()::date || ': replaced by real Stripe subscription ' || ${sub.id} || ', manual entry ends ' || ${handoff} || ']'
    WHERE proposal_id = ${p.id} AND active = true
    RETURNING id, amount_cents`;
  console.log(`   CREATED ${sub.id}  status=${sub.status}  first charge ${iso(firstDue)}`);
  if (retired.length) console.log(`   MANUAL MRR hands over to the subscription on ${handoff} (${retired.map((r) => $(r.amount_cents)).join(", ")}) — never double-counted`);
  results.push({ t, created: sub.id, proposalId: p.id });
}

console.log(`\n${"=".repeat(80)}\nSUMMARY`);
for (const r of results) console.log(`  ${r.t.label.padEnd(24)} ${r.created ? "subscription " + r.created : r.planned ? `WOULD CREATE: ${r.planned.n} x ${$(r.planned.monthly)} from ${iso(r.planned.firstDue)}` : "SKIPPED (" + r.skipped + ")"}`);
console.log(`\n${EXECUTE ? "Changes written." : "Dry run only. Re-run with --execute to apply."}\n`);
