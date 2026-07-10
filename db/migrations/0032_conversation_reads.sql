-- 0032 — Conversation read/handled markers for the dashboard "awaiting reply" strip.
-- Additive + idempotent: safe to run straight against prod, no data migration.
-- A conversation stays hidden from the strip while read_at is newer than its last inbound
-- message; a new inbound message re-surfaces it. Covers all channels (GHL / Meta / TikTok)
-- via (channel, conversation_id).

CREATE TABLE IF NOT EXISTS "conversation_reads" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "channel"         text NOT NULL,
  "conversation_id" text NOT NULL,
  "read_at"         timestamp NOT NULL DEFAULT now(),
  "read_by"         text,
  "created_at"      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_reads_channel_conv_key"
  ON "conversation_reads" ("channel", "conversation_id");
