-- 0034 Customers tab: customers snapshot table + customer markers on local_contacts.
-- Additive + idempotent. Safe to run against prod.

CREATE TABLE IF NOT EXISTS "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dedupe_key" text NOT NULL,
  "email" text,
  "name" text,
  "contact_id" text,
  "stripe_customer_ids" jsonb DEFAULT '[]'::jsonb,
  "ltv_net" integer NOT NULL DEFAULT 0,
  "gross_paid" integer NOT NULL DEFAULT 0,
  "refunded" integer NOT NULL DEFAULT 0,
  "payments_count" integer NOT NULL DEFAULT 0,
  "currency" text DEFAULT 'usd',
  "first_paid_at" timestamp,
  "last_paid_at" timestamp,
  "status" text NOT NULL DEFAULT 'inactive',
  "type" text NOT NULL DEFAULT 'one_off',
  "current_mrr" integer NOT NULL DEFAULT 0,
  "subscription_status" text,
  "subscription_detail" text,
  "is_test" boolean NOT NULL DEFAULT false,
  "source" text,
  "synced_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_dedupe_key_uq" ON "customers" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "customers_status_idx" ON "customers" ("status");
CREATE INDEX IF NOT EXISTS "customers_ltv_idx" ON "customers" ("ltv_net");
CREATE INDEX IF NOT EXISTS "customers_contact_idx" ON "customers" ("contact_id");

ALTER TABLE "local_contacts" ADD COLUMN IF NOT EXISTS "is_customer" boolean DEFAULT false;
ALTER TABLE "local_contacts" ADD COLUMN IF NOT EXISTS "customer_status" text;
CREATE INDEX IF NOT EXISTS "local_contacts_is_customer_idx" ON "local_contacts" ("is_customer");
