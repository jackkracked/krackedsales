import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run() {
  console.log("Creating call_dispositions table...");
  await sql`
    CREATE TABLE IF NOT EXISTS "call_dispositions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "calendar_event_id" text NOT NULL,
      "contact_id" text,
      "contact_name" text,
      "rep_email" text,
      "outcome" text NOT NULL,
      "notes" text,
      "dispositioned_at" timestamp DEFAULT now() NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      CONSTRAINT "call_dispositions_calendar_event_id_unique" UNIQUE("calendar_event_id")
    )
  `;
  console.log("Migration complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
