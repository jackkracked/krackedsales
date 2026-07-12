-- 0033 — Unit-economics dashboard assumptions (single validated JSONB blob).
-- Additive + idempotent: safe to run straight against prod, no data migration.

CREATE TABLE IF NOT EXISTS "unit_economics_settings" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "assumptions"    jsonb NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "updated_by"     text,
  "updated_at"     timestamp NOT NULL DEFAULT now()
);
