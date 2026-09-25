-- 0037 Manual payments: let admins log off-Stripe payments (wire, bill.com, check, etc.)
-- onto a customer. Stored in customer_payments with source='manual'. Additive + idempotent.

ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "method" text;
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "created_by" uuid;
