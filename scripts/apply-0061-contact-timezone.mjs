#!/usr/bin/env node
/** Apply db/migrations/0061_contact_timezone.sql. Statement count asserted before running. */
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
const statements = fs.readFileSync("db/migrations/0061_contact_timezone.sql", "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);
if (statements.length !== EXPECTED) { console.error(`✖ expected ${EXPECTED}, parsed ${statements.length}`); process.exit(1); }
for (const s of statements) await sql.query(s);
const cols = await sql`
  SELECT column_name FROM information_schema.columns
   WHERE table_name = 'local_contacts' AND column_name IN ('timezone','timezone_source') ORDER BY 1`;
console.log(`✔ local_contacts now has: ${cols.map((c) => c.column_name).join(", ")}`);
if (cols.length !== 2) process.exit(1);
