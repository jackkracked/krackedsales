-- Deposit system for management proposals
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS has_deposit boolean NOT NULL DEFAULT false;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deposit_total double precision;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deposits_paid_total double precision NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS subscription_created_at timestamp;

ALTER TABLE proposal_instalments ADD COLUMN IF NOT EXISTS is_deposit boolean NOT NULL DEFAULT false;
