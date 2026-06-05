/**
 * lib/db/migrations/add-opportunity-contact-fields.ts
 *
 * Adds contactTags, contactCompanyName, and contactDateAdded columns to
 * local_opportunities. Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
 *
 * Run with:
 *   npx tsx lib/db/migrations/add-opportunity-contact-fields.ts
 */
import { neon } from "@neondatabase/serverless";

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);

  console.log("Running migration: add-opportunity-contact-fields");

  await sql`
    ALTER TABLE local_opportunities
      ADD COLUMN IF NOT EXISTS contact_tags      jsonb        NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS contact_company_name text,
      ADD COLUMN IF NOT EXISTS contact_date_added   timestamp
  `;

  console.log("Migration complete: 3 columns added to local_opportunities");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
