-- Additive, idempotent. Tracks the first "paid" Slack alert per proposal so the
-- multiple Stripe events that can mark a proposal paid only announce it once.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS slack_paid_notified_at timestamp;
