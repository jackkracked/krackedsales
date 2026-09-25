#!/usr/bin/env node
/**
 * Apply db/migrations/0052_demo_link_attribution.sql.
 *
 * Asserts the statement count BEFORE executing, and strips comment lines BEFORE splitting on
 * ";" — splitting first lets a semicolon inside a comment cut a statement in half. See
 * tasks/lessons.md, 2026-08-07.
 *
 * Additive and idempotent: two nullable ADD COLUMN IF NOT EXISTS on local_contacts. Safe to
 * re-run. Nothing reads these columns until the Demo Link feature ships.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 2; // 2 x ALTER TABLE ADD COLUMN IF NOT EXISTS

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0052_demo_link_attribution.sql", "utf8");
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

const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'local_contacts' AND column_name LIKE 'demo_link%'
  ORDER BY column_name`;
const names = cols.map((c) => c.column_name);
console.log(`\n✔ local_contacts now has: ${names.join(", ") || "NOTHING (check the migration)"}`);
if (names.length !== 2) {
  console.error("✖ expected demo_link_set_at and demo_link_set_by to both be present");
  process.exit(1);
}
