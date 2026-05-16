import { neon } from "@neondatabase/serverless";

const DATABASE_URL = "postgresql://neondb_owner:npg_C8PvR5tKUFTn@ep-raspy-scene-am7b4apx-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const sql = neon(DATABASE_URL);

async function run() {
  console.log("Creating commission_settings table...");
  await sql`
    CREATE TABLE IF NOT EXISTS "commission_settings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "payout_timing" text DEFAULT 'full_paid' NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `;
  console.log("Adding commission_pct to users...");
  await sql`
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "commission_pct" double precision DEFAULT 0 NOT NULL
  `;
  console.log("Migration complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
