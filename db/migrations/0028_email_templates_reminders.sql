-- 0028, Branded client-email templates + reminder send ledger.
-- Additive + idempotent: safe to run straight against prod, no data migration.

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key"           text NOT NULL,
  "name"          text NOT NULL,
  "kind"          text NOT NULL,
  "subject"       text NOT NULL,
  "body_template" text NOT NULL,
  "cta_label"     text NOT NULL DEFAULT '',
  "schedule"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notify_rep"    boolean NOT NULL DEFAULT true,
  "enabled"       boolean NOT NULL DEFAULT true,
  "active_from"   timestamp,
  "updated_by"    uuid REFERENCES "users"("id"),
  "updated_at"    timestamp NOT NULL DEFAULT now(),
  "created_at"    timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_key_key" ON "email_templates" ("key");

CREATE TABLE IF NOT EXISTS "sent_reminders" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id"       text NOT NULL,
  "template_key"    text NOT NULL,
  "step_number"     integer NOT NULL,
  "recipient_email" text,
  "status"          text NOT NULL DEFAULT 'sending',
  "error"           text,
  "sent_at"         timestamp NOT NULL DEFAULT now()
);

-- Dedup guarantee: a given reminder step for a given entity can be recorded at most once.
CREATE UNIQUE INDEX IF NOT EXISTS "sent_reminders_entity_template_step_key"
  ON "sent_reminders" ("entity_id", "template_key", "step_number");
