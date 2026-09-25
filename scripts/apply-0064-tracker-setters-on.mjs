#!/usr/bin/env node
/** Apply db/migrations/0064_tracker_setters_on.sql. Statement count asserted before running. */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
const EXPECTED = 2;
const raw = fs.readFileSync(".env.production.vercel", "utf8");
const env = (k) => {
  const m = raw.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} missing`);
  const v = m[1].trim();
  try { return JSON.parse(v); } catch { return v; }
};
const sql = neon(env("DATABASE_URL"));
const statements = fs.readFileSync("db/migrations/0064_tracker_setters_on.sql", "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);
if (statements.length !== EXPECTED) { console.error(`✖ expected ${EXPECTED}, parsed ${statements.length}`); process.exit(1); }
// Refuses to touch the database unless told to, explicitly. Any other invocation (no flag,
// --help, --dry-run) only prints what it WOULD run. (tasks/lessons.md, 2026-09-25: a bare run of
// this script's first version applied a go-live switch by accident.)
if (!process.argv.includes("--apply")) {
  console.log(`DRY RUN. ${statements.length} statement(s) would run. Re-run with --apply to execute:`);
  for (const [i, st] of statements.entries()) console.log(`[${i + 1}] ${st.replace(/\s+/g, " ").slice(0, 110)}`);
  process.exit(0);
}
for (const s of statements) await sql.query(s);
const c = await sql`SELECT enabled FROM role_permissions WHERE role='setter' AND feature_key='view_tracker'`;
if (!c.length || c[0].enabled !== true) { console.error("✖ setter view_tracker not on", c); process.exit(1); }
console.log("✔ Pay Tracker switched on for setters");
