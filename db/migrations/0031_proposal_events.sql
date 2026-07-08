-- 0031 — Proposal engagement events (tracking: viewed / clicked / classified email opens).
-- Additive + idempotent: safe to run straight against prod, no data migration.

CREATE TABLE IF NOT EXISTS "proposal_events" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id"    uuid NOT NULL,
  "token"          text,
  "type"           text NOT NULL,
  "classification" text,
  "ip"             text,
  "user_agent"     text,
  "created_at"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "proposal_events_proposal_id_idx" ON "proposal_events" ("proposal_id");
