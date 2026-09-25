/**
 * Applies db/migrations/0045_meta_lead_stage.sql.
 *
 * There is no preview environment, so this lands straight in production. The migration is
 * additive and idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS), so it is
 * safe to re-run and safe to run BEFORE the code deploys — which is the required order.
 * Deploying the code first makes every /api/leads request 500 on a missing column.
 *
 * Run: node scripts/apply-0045-meta-lead-stage.mjs
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = Object.fromEntries(
  readFileSync(".env.production.vercel", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "")];
  }),
);
const sql = neon(env.DATABASE_URL_UNPOOLED || env.DATABASE_URL);
/**
 * Split into statements, stripping the comment block that precedes each one.
 *
 * Every statement in this file is documented, so a naive `.filter(s => !s.startsWith("--"))`
 * discards ALL FOUR of them and the migration silently applies nothing. Strip leading
 * comment-only lines instead, and keep whatever code remains.
 */
const statements = readFileSync("db/migrations/0045_meta_lead_stage.sql", "utf8")
  .split(";")
  .map((chunk) =>
    chunk
      .split("\n")
      .filter((line) => !/^\s*(--.*)?$/.test(line)) // drop blank + comment-only lines
      .join("\n")
      .trim(),
  )
  .filter(Boolean);

if (statements.length !== 4) {
  console.error(`Expected 4 statements, parsed ${statements.length}. Refusing to run.`);
  process.exit(1);
}

console.log(`Applying 0045_meta_lead_stage.sql — ${statements.length} statements\n`);
for (const stmt of statements) {
  const label = stmt.replace(/\s+/g, " ").slice(0, 70);
  try {
    await sql.query(stmt);
    console.log(`  OK    ${label}...`);
  } catch (err) {
    console.error(`  FAIL  ${label}...\n        ${err.message}`);
    process.exit(1);
  }
}

const cols = await sql`SELECT column_name FROM information_schema.columns
  WHERE table_name='local_contacts' AND column_name LIKE ANY(ARRAY['meta_lead%','capi_%'])
  ORDER BY column_name`;
console.log(`\nColumns now present: ${cols.map((c) => c.column_name).join(", ")}`);
console.log(cols.length === 7 ? "\nMigration complete." : "\n*** Expected 7 columns ***");
