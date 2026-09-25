#!/usr/bin/env node
/**
 * Apply db/migrations/0056_dynamic_stage_campaigns.sql.
 *
 * Asserts the statement count BEFORE executing, and strips comment lines BEFORE splitting on
 * ";" — splitting first lets a semicolon inside a comment cut a statement in half. See
 * tasks/lessons.md, 2026-08-07.
 *
 * Additive and idempotent: ADD COLUMN IF NOT EXISTS. Safe to re-run. Every column is
 * nullable, so existing rows and existing code are untouched until the feature ships.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 3; // 3 x ALTER TABLE ADD COLUMN IF NOT EXISTS

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0056_dynamic_stage_campaigns.sql", "utf8");
const statements = file
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

if (statements.length !== EXPECTED) {
  console.error(`✖ expected ${EXPECTED} statements, parsed ${statements.length}. Refusing to run.`);
  statements.forEach((s, i) => console.error(`   [${i}] ${s.slice(0, 70)}…`));
  process.exit(1);
}

for (const [i, stmt] of statements.entries()) {
  console.log(`▸ [${i + 1}/${statements.length}] ${stmt.slice(0, 62)}…`);
  await sql.query(stmt);
}

const added = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_name = 'dialer_campaigns'
    AND column_name IN ('source_pipeline_id','source_stage_id','source_synced_at')
  ORDER BY column_name`;
for (const c of added) console.log(`✔ ${c.table_name}.${c.column_name}`);
if (added.length !== 3) {
  console.error(`✖ expected 3 new columns, found ${added.length}`);
  process.exit(1);
}
