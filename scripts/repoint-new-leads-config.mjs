import { neon } from "@neondatabase/serverless";

/**
 * Re-points the "New Leads" KPI from Meta's per-campaign aggregate (meta.leads,
 * campaign names, no individual leads) to the real individual Facebook leads
 * (meta.leadForms), so the card counts real leads and the drawer shows names.
 *
 * ORDER MATTERS, run this LAST, only AFTER: 0027 migration applied + deploy live
 * + Facebook connected + pages subscribed + backfill run (so facebook_leads has
 * rows). Otherwise the card would briefly read 0.
 *
 * Idempotent upsert. Run: node scripts/repoint-new-leads-config.mjs
 */
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const aggregation = JSON.stringify({ op: "count" });
const filters = JSON.stringify([]);

const rows = await sql.query(
  `INSERT INTO kpi_configs (metric_key, dataset, aggregation, filters, date_field, unit, enabled)
   VALUES ('leads', 'meta.leadForms', $1::jsonb, $2::jsonb, 'createdTime', 'count', true)
   ON CONFLICT (metric_key) DO UPDATE SET
     dataset = EXCLUDED.dataset,
     aggregation = EXCLUDED.aggregation,
     filters = EXCLUDED.filters,
     date_field = EXCLUDED.date_field,
     unit = EXCLUDED.unit,
     enabled = true,
     updated_at = now()
   RETURNING metric_key, dataset, date_field, unit, enabled;`,
  [aggregation, filters],
);

console.log("Re-pointed New Leads config:", rows[0] ?? rows);
console.log("Done.");
