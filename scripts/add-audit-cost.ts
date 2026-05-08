import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  await sql`ALTER TABLE cost_settings ADD COLUMN IF NOT EXISTS cost_per_audit DOUBLE PRECISION NOT NULL DEFAULT 0`;
  console.log("✓ cost_per_audit column added");
}

run().catch(console.error);
