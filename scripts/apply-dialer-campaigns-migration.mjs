import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const migrationPath = join(__dirname, "../db/migrations/0021_add_dialer_campaigns.sql");
const migration = readFileSync(migrationPath, "utf-8");

const stripped = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const statements = stripped
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`Running ${statements.length} statements...`);

for (const stmt of statements) {
  try {
    await sql.query(stmt);
    console.log("✓", stmt.slice(0, 80).replace(/\n/g, " "));
  } catch (err) {
    console.error("✗", stmt.slice(0, 80).replace(/\n/g, " "));
    console.error("  Error:", err.message);
  }
}

console.log("\nDone.");
