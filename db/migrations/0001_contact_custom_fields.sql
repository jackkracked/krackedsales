CREATE TABLE IF NOT EXISTS "contact_custom_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contact_uid" text NOT NULL,
  "field_name" text NOT NULL,
  "field_value" text DEFAULT '',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "contact_custom_fields_uid_idx"
  ON "contact_custom_fields" ("contact_uid");
