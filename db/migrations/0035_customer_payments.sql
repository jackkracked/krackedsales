-- 0035 Customer payments: one row per incoming payment, for date-range aggregation.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS "customer_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dedupe_key" text NOT NULL,
  "stripe_id" text NOT NULL,
  "source" text NOT NULL,
  "amount_net" integer NOT NULL DEFAULT 0,
  "currency" text DEFAULT 'usd',
  "paid_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_payments_stripe_id_uq" ON "customer_payments" ("stripe_id");
CREATE INDEX IF NOT EXISTS "customer_payments_key_idx" ON "customer_payments" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "customer_payments_paid_idx" ON "customer_payments" ("paid_at");
