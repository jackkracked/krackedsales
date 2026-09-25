#!/usr/bin/env node
/**
 * Apply db/migrations/0058_booking_attribution.sql.
 *
 * Asserts the statement count BEFORE executing, and strips comment lines BEFORE splitting on
 * ";" — splitting first lets a semicolon inside a comment cut a statement in half. See
 * tasks/lessons.md, 2026-08-07.
 *
 * Both statements are indexes only. No column changes, no data rewritten.
 */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const EXPECTED = 2; // 1 x CREATE UNIQUE INDEX + 1 x CREATE INDEX

const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));

const file = fs.readFileSync("db/migrations/0058_booking_attribution.sql", "utf8");
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

const idx = await sql`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'booking_links' ORDER BY indexname`;
console.log(`✔ booking_links indexes: ${idx.map((i) => i.indexname).join(", ")}`);
const need = ["booking_links_appointment_uniq", "booking_links_pending_idx"];
const missing = need.filter((n) => !idx.some((i) => i.indexname === n));
if (missing.length) { console.error(`✖ missing: ${missing.join(", ")}`); process.exit(1); }
console.log("✔ 0058 applied");
