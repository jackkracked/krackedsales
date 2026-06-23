-- Store the Google Meet/Zoom link on calls (from the GHL event address) so Fathom
-- recordings can be matched to the exact call by meeting URL. Additive + idempotent.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "meeting_url" text;
CREATE INDEX IF NOT EXISTS "calls_meeting_url_idx" ON "calls" ("meeting_url");
