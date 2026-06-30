-- Link a comment lead to the GHL contact + opportunity it becomes when a demo is
-- submitted (the moment it turns into a real pipeline lead). Until these are set, a
-- comment lead is inbox-only and is NOT counted as a pipeline lead. Additive + idempotent.
ALTER TABLE "comment_leads" ADD COLUMN IF NOT EXISTS "ghl_contact_id"     text;
ALTER TABLE "comment_leads" ADD COLUMN IF NOT EXISTS "ghl_opportunity_id" text;
