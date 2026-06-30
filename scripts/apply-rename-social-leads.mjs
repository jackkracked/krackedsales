// Applies migration 0020: rename comment_leads -> social_leads + transitional view.
// Bespoke (not the generic ;-splitter) because the rename is guarded by a DO block and is
// NOT additive. State-checked, row-count-verified, and safe to re-run.
//   node --env-file=.env.production.vercel scripts/apply-rename-social-leads.mjs
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL (or DATABASE_URL_UNPOOLED) env var is required");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const rows = (r) => (Array.isArray(r) ? r : r?.rows ?? []);
async function relType(name) {
  const r = await sql`SELECT table_type FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = ${name}`;
  return rows(r)[0]?.table_type ?? null; // 'BASE TABLE' | 'VIEW' | null
}
async function count(name) {
  // name is a trusted in-source constant, never user input
  const r = await sql.query(`SELECT count(*)::int AS n FROM ${name}`);
  return rows(r)[0]?.n ?? null;
}

console.log("=== PRE ===");
const preComment = await relType("comment_leads");
const preSocial = await relType("social_leads");
console.log(`comment_leads: ${preComment ?? "absent"} | social_leads: ${preSocial ?? "absent"}`);
let before = null;
if (preSocial === "BASE TABLE") before = await count("social_leads");
else if (preComment === "BASE TABLE") before = await count("comment_leads");
console.log(`rows before: ${before}`);

console.log("\n=== APPLY ===");
await sql.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'comment_leads' AND table_type = 'BASE TABLE'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'social_leads' AND table_type = 'BASE TABLE'
    ) THEN
      ALTER TABLE comment_leads RENAME TO social_leads;
    END IF;
  END $$;
`);
console.log("✓ rename guard executed");
await sql.query(`CREATE OR REPLACE VIEW comment_leads AS SELECT * FROM social_leads`);
console.log("✓ transitional view ensured");

console.log("\n=== VERIFY ===");
const postSocial = await relType("social_leads");
const postComment = await relType("comment_leads");
const afterTable = await count("social_leads");
const afterView = await count("comment_leads");
const colsR = await sql`SELECT count(*)::int AS n FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'social_leads'`;
const fksR = await sql`SELECT conname, conrelid::regclass::text AS from_table
                       FROM pg_constraint WHERE confrelid = 'social_leads'::regclass`;
const cols = rows(colsR)[0]?.n;
const fks = rows(fksR);
console.log(`social_leads is: ${postSocial}  (want BASE TABLE)`);
console.log(`comment_leads is: ${postComment}  (want VIEW)`);
console.log(`rows  social_leads=${afterTable}  via view=${afterView}  before=${before}`);
console.log(`columns on social_leads: ${cols}`);
console.log(`FKs referencing social_leads: ${fks.length ? fks.map((f) => `${f.from_table}.${f.conname}`).join(", ") : "none"}`);

const ok =
  postSocial === "BASE TABLE" &&
  postComment === "VIEW" &&
  before !== null &&
  afterTable === before &&
  afterView === before;
console.log(ok
  ? "\nPASS — table renamed, both names resolve, row count preserved. Safe to deploy."
  : "\nFAIL — review the output above; do NOT deploy until resolved.");
process.exit(ok ? 0 : 1);
