#!/usr/bin/env node
/**
 * Apply db/migrations/0063_pay_tracker_ledger.sql. Additive and idempotent.
 *
 * Asserts the statement count BEFORE executing, and strips comment lines BEFORE splitting on
 * ";" (tasks/lessons.md, 2026-08-07). No statement in the file contains a ";" inside a string.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 15;
const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0063_pay_tracker_ledger.sql", "utf8");
const statements = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);

if (statements.length !== EXPECTED) {
  console.error(`✖ expected ${EXPECTED} statements, parsed ${statements.length}. Refusing to run.`);
  process.exit(1);
}
if (process.argv.includes("--dry-run")) {
  for (const [i, s] of statements.entries()) console.log(`[${i + 1}] ${s.split("\n")[0].slice(0, 90)}`);
  process.exit(0);
}
// Refuses to touch the database unless told to, explicitly. Any other invocation (no flag,
// --help, --dry-run) only prints what it WOULD run. (tasks/lessons.md, 2026-09-25: a bare run of
// this script's first version applied a go-live switch by accident.)
if (!process.argv.includes("--apply")) {
  console.log(`DRY RUN. ${statements.length} statement(s) would run. Re-run with --apply to execute:`);
  for (const [i, st] of statements.entries()) console.log(`[${i + 1}] ${st.replace(/\s+/g, " ").slice(0, 110)}`);
  process.exit(0);
}
for (const [i, stmt] of statements.entries()) {
  console.log(`▸ [${i + 1}/${statements.length}] ${stmt.slice(0, 62).replace(/\s+/g, " ")}…`);
  await sql.query(stmt);
}
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_name IN ('ghl_appointments','tracker_credit_decisions','tracker_call_outcomes',
    'tracker_month_settings','tracker_overrides','tracker_month_closes','tracker_settled_rows')`;
const col = await sql`SELECT 1 FROM information_schema.columns
  WHERE table_name='call_dispositions' AND column_name='created_by_user_id'`;
const seeded = await sql`SELECT count(*)::int n FROM tracker_month_settings WHERE month='2000-01'`;
if (tables.length !== 7 || col.length !== 1) { console.error("✖ verification failed", tables, col); process.exit(1); }
console.log(`✔ 7 tables, call_dispositions.created_by_user_id, ${seeded[0].n} baseline settings rows`);
