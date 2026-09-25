import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL_UNPOOLED);
const $ = (c) => "$" + Number(c || 0).toLocaleString("en-US");

const man = await sql`SELECT client_name, amount_cents, effective_from, effective_to FROM manual_mrr_adjustments WHERE active=true ORDER BY amount_cents DESC`;
console.log(`\n1) manual_mrr_adjustments (active): ${man.length} rows, total ${$(man.reduce((s, r) => s + r.amount_cents, 0) / 100)}/mo`);
man.forEach((r) => console.log(`   ${r.client_name.padEnd(22)} ${$(r.amount_cents / 100).padStart(7)}/mo  ${new Date(r.effective_from).toISOString().slice(0, 10)} → ${new Date(r.effective_to).toISOString().slice(0, 10)}`));

const cfg = await sql`SELECT metric_key, dataset, enabled, aggregation FROM kpi_configs WHERE metric_key IN ('managementMrr','stripeManagementMrr','manualManagementMrr','totalMrr') ORDER BY metric_key`;
console.log(`\n2) kpi_configs:`);
cfg.forEach((x) => console.log(`   ${x.metric_key.padEnd(20)} ${String(x.enabled).padEnd(5)} ${x.dataset.padEnd(22)} ${JSON.stringify(x.aggregation)}`));

const props = await sql`SELECT contact_name, type, is_legacy_manual, management_option FROM proposals WHERE id = ANY(ARRAY['99ff4b11-3e09-4632-a2ed-8a9abdcd42cc','f9ca98e6-d3e7-409c-a9d7-306cfd86fe21','ca9448f8-9cfa-4d61-a428-429b3d4a9a0b','9c1d5f9a-a382-41b2-8d94-49916b5cf8e2']::uuid[])`;
console.log(`\n3) relabeled proposals:`);
props.forEach((r) => console.log(`   ${r.contact_name.padEnd(22)} type=${r.type} legacy=${r.is_legacy_manual} opt=${r.management_option}`));

const subs = await sql`SELECT COALESCE(SUM(monthly_amount),0) AS mrr FROM local_stripe_subscriptions WHERE status='active'`;
console.log(`\n4) expected Management MRR = Stripe-active ${$(subs[0].mrr)} + manual ${$(man.reduce((s, r) => s + r.amount_cents, 0) / 100)} = ${$(Number(subs[0].mrr) + man.reduce((s, r) => s + r.amount_cents, 0) / 100)}\n`);
