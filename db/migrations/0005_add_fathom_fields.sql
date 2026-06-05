ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fathom_api_key" text;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "fathom_recording_id" integer UNIQUE;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "fathom_summary" text;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "fathom_synced_at" timestamp;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "fathom_share_url" text;
ALTER TABLE "call_insights" ADD COLUMN IF NOT EXISTS "suggested_outcome" text;
ALTER TABLE "call_insights" ADD COLUMN IF NOT EXISTS "suggested_notes" text;
