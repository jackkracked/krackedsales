#!/usr/bin/env node
/**
 * Apply db/migrations/0046_meta_leads_mirror.sql.
 *
 * Asserts the statement count BEFORE executing. scripts/apply-0045-meta-lead-stage.mjs split
 * on ";" then dropped any chunk STARTING with "--", and because every statement in that file
 * is preceded by its own comment block, all four were filtered out — it would have applied
 * nothing and printed success. See tasks/lessons.md, 2026-08-07.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 5; // 1 CREATE TABLE + 4 CREATE INDEX

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  let v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0046_meta_leads_mirror.sql", "utf8");
// ORDER MATTERS: strip comment lines FIRST, then split on ";".
// Splitting first is wrong even with per-chunk comment stripping, because a comment
// containing a semicolon ("-- The rail counts group by stage; the feed orders by date.")
// splits a statement in half and leaves the tail of the sentence as bare SQL. That is
// exactly what happened on the first run of this script: "syntax error at or near 'the'".
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

// Pre-flight: how big is the table we are about to touch? A CREATE INDEX blocks writes while
// it builds, so on a large table this is the difference between milliseconds and an outage.
const before = await sql.query(`select to_regclass('public.meta_leads') as exists`);
console.log("meta_leads exists already:", (before.rows ?? before)[0].exists ?? "no");

for (const [i, s] of statements.entries()) {
  console.log(`▸ [${i + 1}/${statements.length}] ${s.slice(0, 64).replace(/\s+/g, " ")}…`);
  await sql.query(s);
}

const cols = await sql.query(
  `select column_name from information_schema.columns where table_name='meta_leads' order by ordinal_position`,
);
const names = (cols.rows ?? cols).map((c) => c.column_name);
console.log(`\n✔ meta_leads has ${names.length} columns: ${names.join(", ")}`);
if (names.length < 14) { console.error("✖ column count looks wrong"); process.exit(1); }
