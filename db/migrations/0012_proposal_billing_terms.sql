-- Flexible billing terms for proposals.
-- Additive + idempotent: safe to run against prod directly (no preview env).
--
--   list_amount     pre-discount full price (display only; > total_amount when discounted)
--   discount_type   "percent" | "fixed"
--   discount_value  the entered discount amount/percentage
--   auto_renew      true  => recurring subscription (every billing_interval_count months)
--                   false => paid-in-full fixed term (one charge covering N months, never recurs)
--
-- total_amount remains the BILLED amount (what Stripe charges). Existing rows keep
-- auto_renew = true, which exactly matches their current behaviour (all prior
-- management proposals were recurring subscriptions).

ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "list_amount" double precision;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "discount_type" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "discount_value" double precision;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "auto_renew" boolean NOT NULL DEFAULT true;
