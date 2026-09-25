// Fold the manual Management-MRR adjustments into New + Churned Management MRR (they already flow
// into the Management MRR level). New = manual entries whose effectiveFrom is in the period; Churned
// = manual entries whose effectiveTo is in the period. Idempotent. DB config only, no Stripe.
// Rollback: set newManagementMrr/churnedManagementMrr back to dataset 'stripe.subscriptions' with
// their original agg/filters/date_field (created / canceled_at) and delete the 4 stripe*/manual* rows.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const J = (o) => JSON.stringify(o);
const sumMonthly = J({ op: "sum", field: "monthly_amount" });
const sumAmount = J({ op: "sum", field: "amount" });

async function upsert(key, dataset, agg, filters, dateField) {
  await sql`INSERT INTO kpi_configs (metric_key, dataset, aggregation, filters, date_field, unit, enabled)
    VALUES (${key}, ${dataset}, ${agg}::jsonb, ${filters}::jsonb, ${dateField}, 'currency', true)
    ON CONFLICT (metric_key) DO UPDATE SET dataset=EXCLUDED.dataset, aggregation=EXCLUDED.aggregation,
      filters=EXCLUDED.filters, date_field=EXCLUDED.date_field, enabled=true, updated_at=now()`;
}
async function combine(key, terms) {
  await sql`UPDATE kpi_configs SET dataset='combine', aggregation=${J({ op: "combine", terms })}::jsonb, date_field=NULL, updated_at=now() WHERE metric_key=${key}`;
}

// ── New Management MRR = Stripe (subs created in period) + manual (started in period) ──
await upsert("stripeNewManagementMrr", "stripe.subscriptions", sumMonthly, J([{ op: "neq", field: "status", value: "canceled" }]), "created");
await upsert("manualNewManagementMrr", "manual_management_mrr_flow", sumAmount, J([]), "effectiveFrom");
await combine("newManagementMrr", [{ sign: 1, metricKey: "stripeNewManagementMrr" }, { sign: 1, metricKey: "manualNewManagementMrr" }]);
console.log("✓ newManagementMrr → Stripe-new + manual-started");

// ── Churned Management MRR = Stripe (subs canceled in period) + manual (ended in period) ──
await upsert("stripeChurnedManagementMrr", "stripe.subscriptions", sumMonthly, J([{ op: "eq", field: "status", value: "canceled" }]), "canceled_at");
await upsert("manualChurnedManagementMrr", "manual_management_mrr_flow", sumAmount, J([]), "effectiveTo");
await combine("churnedManagementMrr", [{ sign: 1, metricKey: "stripeChurnedManagementMrr" }, { sign: 1, metricKey: "manualChurnedManagementMrr" }]);
console.log("✓ churnedManagementMrr → Stripe-canceled + manual-ended");

const cfg = await sql`SELECT metric_key, dataset FROM kpi_configs WHERE metric_key IN ('newManagementMrr','churnedManagementMrr','manualNewManagementMrr','manualChurnedManagementMrr','stripeNewManagementMrr','stripeChurnedManagementMrr') ORDER BY metric_key`;
cfg.forEach((x) => console.log(`  ${x.metric_key} → ${x.dataset}`));
console.log("\nDONE (config only, no Stripe).\n");
