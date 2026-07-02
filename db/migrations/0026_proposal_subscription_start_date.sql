-- Additive, idempotent. The rep-chosen date the recurring subscription's first charge lands
-- (implemented as the Stripe subscription trial_end). Null = legacy behaviour (start + one cycle).
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS subscription_start_date timestamp;
