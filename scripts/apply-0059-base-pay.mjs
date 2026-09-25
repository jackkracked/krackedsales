#!/usr/bin/env node
/**
 * Apply db/migrations/0059_base_pay.sql.
 *
 * Asserts the statement count BEFORE executing, and strips comment lines BEFORE splitting on
 * ";" — splitting first lets a semicolon inside a comment cut a statement in half. See
 * tasks/lessons.md, 2026-08-07.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 1;
const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0059_base_pay.sql", "utf8");
const statements = file.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);

if (statements.length !== EXPECTED) {
  console.error(`✖ expected ${EXPECTED} statements, parsed ${statements.length}. Refusing to run.`);
  process.exit(1);
}
for (const [i, stmt] of statements.entries()) {
  console.log(`▸ [${i + 1}/${statements.length}] ${stmt.slice(0, 62)}…`);
  await sql.query(stmt);
}
const cols = await sql`
  SELECT column_name, data_type, column_default FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'base_pay_cents'`;
if (!cols.length) { console.error("✖ base_pay_cents missing"); process.exit(1); }
console.log(`✔ users.base_pay_cents ${cols[0].data_type} default ${cols[0].column_default}`);
