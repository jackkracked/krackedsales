// Full reversal of migrate-13-apply.mjs. DB + KPI-config only. No Stripe calls.
// Run: node scripts/migrate-13-rollback.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const ids = [
  "99ff4b11-3e09-4632-a2ed-8a9abdcd42cc", "f9ca98e6-d3e7-409c-a9d7-306cfd86fe21",
  "ca9448f8-9cfa-4d61-a428-429b3d4a9a0b", "9c1d5f9a-a382-41b2-8d94-49916b5cf8e2",
];
// managementMrr back to its original direct Stripe sum.
await sql`UPDATE kpi_configs SET dataset='stripe.subscriptions',
  aggregation=${JSON.stringify({ op: "sum", field: "monthly_amount" })}::jsonb, updated_at=now()
  WHERE metric_key='managementMrr'`;
await sql`DELETE FROM kpi_configs WHERE metric_key IN ('stripeManagementMrr','manualManagementMrr')`;
await sql`DELETE FROM manual_mrr_adjustments WHERE proposal_id = ANY(${ids}::uuid[])`;
await sql`UPDATE proposals SET type='project', is_legacy_manual=false, management_option=NULL, updated_at=now()
  WHERE id = ANY(${ids}::uuid[])`;
console.log("Rolled back: managementMrr restored, 2 configs removed, 4 manual rows deleted, 4 proposals back to project.");
