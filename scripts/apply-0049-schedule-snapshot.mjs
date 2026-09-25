#!/usr/bin/env node
/**
 * Apply db/migrations/0049_proposal_schedule_snapshot.sql.
 *
 * Asserts the statement count BEFORE executing, and strips comment lines BEFORE splitting on
 * ";" — splitting first lets a semicolon inside a comment cut a statement in half. See
 * scripts/apply-0046-meta-leads.mjs and tasks/lessons.md, 2026-08-07.
 *
 * Additive and idempotent: two nullable ADD COLUMN IF NOT EXISTS. Safe to re-run. It changes
 * nothing at runtime on its own, because NULL keeps the existing "compute the schedule" path.
 *
 * Run the BACKFILL (scripts/backfill-schedule-snapshots.mjs) after this and BEFORE deploying
 * the corrected date logic, or already-sent proposals will re-render with new dates.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 2; // 2 x ALTER TABLE ADD COLUMN

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0049_proposal_schedule_snapshot.sql", "utf8");
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

// ADD COLUMN with no default and no volatile expression is a metadata-only change in Postgres:
// it does not rewrite the table, so it is safe on a large `proposals` regardless of row count.
const before = await sql.query(`select count(*)::int as n from proposals`);
console.log(`proposals rows: ${(before.rows ?? before)[0].n}`);

for (const [i, s] of statements.entries()) {
  console.log(`▸ [${i + 1}/${statements.length}] ${s.slice(0, 64).replace(/\s+/g, " ")}…`);
  await sql.query(s);
}

const cols = await sql.query(
  `select column_name from information_schema.columns
   where table_name='proposals' and column_name in ('schedule_snapshot','schedule_snapshot_at')`,
);
const names = (cols.rows ?? cols).map((c) => c.column_name).sort();
console.log(`\n✔ added: ${names.join(", ")}`);
if (names.length !== 2) { console.error("✖ expected both columns present"); process.exit(1); }
