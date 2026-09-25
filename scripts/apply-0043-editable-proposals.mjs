// Apply migration 0043 (editable proposals + templates). DDL only, idempotent.
// Statements are issued individually (no naive ;-split) so nothing can shatter.
// Uses DATABASE_URL_UNPOOLED from .env.verify (same recipe as the other apply-*.mjs).
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.verify", "utf8");
const url = env
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL_UNPOOLED="))
  ?.split("=")
  .slice(1)
  .join("=")
  .trim()
  .replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL_UNPOOLED not found in .env.verify");

const sql = neon(url);

const statements = [
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deliverables jsonb`,
  `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS content jsonb`,
  `CREATE TABLE IF NOT EXISTS proposal_templates (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     type text NOT NULL UNIQUE,
     sections jsonb NOT NULL,
     updated_by uuid REFERENCES users(id),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
];

for (const stmt of statements) {
  await sql.query(stmt);
  console.log("ok:", stmt.split("\n")[0].slice(0, 70));
}

// Verify
const cols = await sql.query(
  `select column_name from information_schema.columns where table_name='proposals' and column_name in ('deliverables','content') order by column_name`,
  [],
);
const tbl = await sql.query(
  `select to_regclass('public.proposal_templates') as t`,
  [],
);
console.log("proposals new columns:", cols.map((c) => c.column_name).join(", "));
console.log("proposal_templates table:", tbl[0].t);
console.log("0043 applied.");
