// Cleanup for migration 0020: drops the transitional comment_leads view.
// Run ONLY after the social_leads deploy is verified healthy on prod.
// Guarded: refuses to drop if comment_leads is somehow a BASE TABLE (never drops real data).
//   node --env-file=.env.production.vercel scripts/drop-comment-leads-view.mjs
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL (or DATABASE_URL_UNPOOLED) env var is required");
  process.exit(1);
}
const sql = neon(DATABASE_URL);
const rows = (r) => (Array.isArray(r) ? r : r?.rows ?? []);

const r = await sql`SELECT table_type FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'comment_leads'`;
const kind = rows(r)[0]?.table_type ?? null;

if (kind === null) {
  console.log("comment_leads does not exist — nothing to drop.");
  process.exit(0);
}
if (kind === "BASE TABLE") {
  console.error("REFUSING: comment_leads is a BASE TABLE, not a view. Aborting (will not drop data).");
  process.exit(1);
}
await sql.query("DROP VIEW IF EXISTS comment_leads");
console.log("✓ dropped transitional view comment_leads");
process.exit(0);
