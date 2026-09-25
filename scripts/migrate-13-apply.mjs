// Applies the approved migration for the 4 real 90-day Management clients mislabeled as projects.
// DB + KPI-config ONLY. Makes NO Stripe calls. Idempotent (safe to re-run). Reversible via
// scripts/migrate-13-rollback.mjs. Run: node scripts/migrate-13-apply.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);

// The 4 approved clients. amountCents = monthly MRR contribution. paidOn = first Stripe payment.
const CLIENTS = [
  { id: "99ff4b11-3e09-4632-a2ed-8a9abdcd42cc", name: "Rossi Mckee",          ghl: "A37s0xqwFDxva9vySATQ", cents: 150000, paidOn: "2026-07-17" },
  { id: "f9ca98e6-d3e7-409c-a9d7-306cfd86fe21", name: "Greenhouse Girls THC", ghl: "4Pgiloglp3qxVjH3qbP1", cents: 100000, paidOn: "2026-07-23" },
  { id: "ca9448f8-9cfa-4d61-a428-429b3d4a9a0b", name: "Cheeky",               ghl: "EJp3Etb1vy1uhCXJNdnu", cents: 120000, paidOn: "2026-07-25" },
  { id: "9c1d5f9a-a382-41b2-8d94-49916b5cf8e2", name: "Eat Meat Media",       ghl: "UxYjunynSNlR6CHuiBZR", cents: 100000, paidOn: "2026-07-24" },
];
const reasonFor = (c) =>
  `Real 90-day Management retainer. Built as a Project with 3 monthly instalments because the 90-day Management retainer product did not exist in the proposal builder yet, so it never created a Stripe subscription and stayed invisible to Stripe-derived Management MRR. ${c.name} signed and paid month 1 on ${c.paidOn}. Added manually so Management MRR reflects this active retainer. Stripe untouched.`;

console.log("\n── STEP 1/3: KPI-config wiring (managementMrr = Stripe + manual) ──");
await sql`INSERT INTO kpi_configs (metric_key, dataset, aggregation, filters, unit, enabled)
  VALUES ('stripeManagementMrr', 'stripe.subscriptions', ${JSON.stringify({ op: "sum", field: "monthly_amount" })}::jsonb,
          ${JSON.stringify([{ op: "eq", field: "status", value: "active" }])}::jsonb, 'currency', true)
  ON CONFLICT (metric_key) DO UPDATE SET dataset=EXCLUDED.dataset, aggregation=EXCLUDED.aggregation, filters=EXCLUDED.filters, enabled=true, updated_at=now()`;
console.log("  ✓ stripeManagementMrr (Stripe subscriptions, status=active)");
await sql`INSERT INTO kpi_configs (metric_key, dataset, aggregation, filters, unit, enabled)
  VALUES ('manualManagementMrr', 'manual_management_mrr', ${JSON.stringify({ op: "sum", field: "amount" })}::jsonb,
          '[]'::jsonb, 'currency', true)
  ON CONFLICT (metric_key) DO UPDATE SET dataset=EXCLUDED.dataset, aggregation=EXCLUDED.aggregation, enabled=true, updated_at=now()`;
console.log("  ✓ manualManagementMrr (manual_management_mrr dataset)");
await sql`UPDATE kpi_configs SET dataset='combine',
  aggregation=${JSON.stringify({ op: "combine", terms: [{ sign: 1, metricKey: "stripeManagementMrr" }, { sign: 1, metricKey: "manualManagementMrr" }] })}::jsonb,
  updated_at=now() WHERE metric_key='managementMrr'`;
console.log("  ✓ managementMrr → combine(stripeManagementMrr + manualManagementMrr)");

console.log("\n── STEP 2/3: manual Management-MRR entries (4 clients, $4,700/mo) ──");
const ids = CLIENTS.map((c) => c.id);
await sql`DELETE FROM manual_mrr_adjustments WHERE proposal_id = ANY(${ids}::uuid[])`; // idempotent
for (const c of CLIENTS) {
  await sql`INSERT INTO manual_mrr_adjustments (amount_cents, reason, client_name, ghl_contact_id, proposal_id, effective_from, effective_to, active)
    VALUES (${c.cents}, ${reasonFor(c)}, ${c.name}, ${c.ghl}, ${c.id}::uuid,
            ${c.paidOn}::timestamptz, (${c.paidOn}::timestamptz + INTERVAL '3 months'), true)`;
  console.log(`  ✓ ${c.name.padEnd(22)} $${(c.cents / 100).toLocaleString()}/mo  (counts ${c.paidOn} → +3mo)`);
}

console.log("\n── STEP 3/3: relabel the 4 proposals project → management (display) ──");
const upd = await sql`UPDATE proposals
  SET type='management', is_legacy_manual=true, management_option='spread', updated_at=now()
  WHERE id = ANY(${ids}::uuid[]) RETURNING contact_name`;
console.log(`  ✓ relabeled ${upd.length}: ${upd.map((r) => r.contact_name).join(", ")}`);

console.log("\n── VERIFY ──");
const check = await sql`SELECT COALESCE(SUM(amount_cents),0) AS c, COUNT(*) AS n FROM manual_mrr_adjustments WHERE active=true`;
console.log(`  manual_mrr_adjustments active: ${check[0].n} rows, $${(Number(check[0].c) / 100).toLocaleString()}/mo total`);
const cfg = await sql`SELECT metric_key, dataset, aggregation FROM kpi_configs WHERE metric_key IN ('managementMrr','stripeManagementMrr','manualManagementMrr') ORDER BY metric_key`;
cfg.forEach((x) => console.log(`  ${x.metric_key} → ${x.dataset} ${JSON.stringify(x.aggregation)}`));
console.log("\nDONE. No Stripe calls were made.\n");
