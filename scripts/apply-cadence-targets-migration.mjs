// Applies migration 0018_add_cadence_targets.sql (per-cadence KPI targets).
// Additive + idempotent — safe to run against prod, safe to re-run.
//   DATABASE_URL=... node scripts/apply-cadence-targets-migration.mjs
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL (or DATABASE_URL_UNPOOLED) env var is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "../db/migrations/0018_add_cadence_targets.sql");
const migration = readFileSync(migrationPath, "utf-8");

// Strip comment lines, then split on semicolons.
const statements = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const sql = neon(DATABASE_URL);

console.log(`Running ${statements.length} statements against the database...`);
let failed = 0;
for (const stmt of statements) {
  try {
    await sql.query(stmt);
    console.log("✓", stmt.slice(0, 80).replace(/\n/g, " "));
  } catch (err) {
    failed++;
    console.error("✗", stmt.slice(0, 80).replace(/\n/g, " "));
    console.error("  Error:", err.message);
  }
}

console.log(failed === 0 ? "\nDone — migration applied." : `\nDone with ${failed} error(s).`);
process.exit(failed === 0 ? 0 : 1);
