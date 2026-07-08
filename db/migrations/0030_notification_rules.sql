-- 0030 — Internal Slack notification rules (the Notifications control center).
-- Additive + idempotent: safe to run straight against prod, no data migration.

CREATE TABLE IF NOT EXISTS "notification_rules" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key"              text NOT NULL,
  "name"             text NOT NULL,
  "description"      text NOT NULL DEFAULT '',
  "recipients"       text NOT NULL DEFAULT 'both',
  "message_template" text NOT NULL,
  "enabled"          boolean NOT NULL DEFAULT true,
  "updated_by"       uuid REFERENCES "users"("id"),
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  "created_at"       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_rules_key_key" ON "notification_rules" ("key");
