// Fold the manual management clients (the 4 legacy retainers we added to Management MRR) into the
// "# of Management Clients" count, so the figure is accurate. Idempotent. DB config only, no Stripe.
// Rollback: set managementClients back to dataset 'stripe.subscriptions' agg {op:count} filters
// [{eq,status,active}] and delete stripeManagementClients + manualManagementClients.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const J = (o) => JSON.stringify(o);

async function upsert(key, dataset, agg, filters) {
  await sql`INSERT INTO kpi_configs (metric_key, dataset, aggregation, filters, unit, enabled)
    VALUES (${key}, ${dataset}, ${agg}::jsonb, ${filters}::jsonb, 'count', true)
    ON CONFLICT (metric_key) DO UPDATE SET dataset=EXCLUDED.dataset, aggregation=EXCLUDED.aggregation, filters=EXCLUDED.filters, unit='count', enabled=true, updated_at=now()`;
}

await upsert("stripeManagementClients", "stripe.subscriptions", J({ op: "count" }), J([{ op: "eq", field: "status", value: "active" }]));
await upsert("manualManagementClients", "manual_management_mrr", J({ op: "count" }), J([]));
await sql`UPDATE kpi_configs SET dataset='combine', aggregation=${J({ op: "combine", terms: [{ sign: 1, metricKey: "stripeManagementClients" }, { sign: 1, metricKey: "manualManagementClients" }] })}::jsonb, date_field=NULL, unit='count', updated_at=now() WHERE metric_key='managementClients'`;

const cfg = await sql`SELECT metric_key, dataset FROM kpi_configs WHERE metric_key IN ('managementClients','stripeManagementClients','manualManagementClients') ORDER BY metric_key`;
cfg.forEach((x) => console.log(`  ${x.metric_key} → ${x.dataset}`));
console.log("✓ managementClients = Stripe active + manual clients. DONE (config only, no Stripe).");
