#!/usr/bin/env node
/** Apply db/migrations/0062_calling_hours.sql. Statement count asserted before running. */
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
const statements = fs.readFileSync("db/migrations/0062_calling_hours.sql", "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);
if (statements.length !== EXPECTED) { console.error(`✖ expected ${EXPECTED}, parsed ${statements.length}`); process.exit(1); }
for (const s of statements) await sql.query(s);
const c = await sql`SELECT column_name FROM information_schema.columns
  WHERE table_name='dialer_settings' AND column_name='calling_hours'`;
console.log(c.length ? "✔ dialer_settings.calling_hours added" : "✖ column missing");
if (!c.length) process.exit(1);
