-- 0040 90-Day Management billing + proposal-builder overhaul. All additive + nullable so existing
-- proposals are untouched (null => today's behavior everywhere). Lands straight in prod (no preview env).

-- Proposal config for the 90-day management billing model.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS management_option text;          -- 'upfront' | 'spread' (null = legacy)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS auto_rebill_mode text;           -- 'none' | 'monthly' | 'full90' (null => 'none')
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS stripe_payment_method_id text;   -- saved card for off_session splits/rebills
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS first_month_complete boolean DEFAULT false;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS billing_issue boolean DEFAULT false; -- a rebill/split failed → show "payment issue"
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS cc_emails jsonb;                  -- extra recipients (array of email strings)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS billing_email text;              -- separate invoice/finance email (null => contactEmail)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS is_legacy_manual boolean DEFAULT false; -- migrated old deals: no auto-charge

-- Manual Management MRR adjustments — for real management clients billed OUTSIDE tracked Stripe (e.g. the
-- migrated legacy deals). Each line adds to Management MRR with a human reason, fully auditable.
CREATE TABLE IF NOT EXISTS manual_mrr_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_cents   integer NOT NULL,          -- monthly MRR contribution, cents
  reason         text NOT NULL,             -- why this exists (shown beside the line)
  client_name    text,
  ghl_contact_id text,
  proposal_id    uuid,                       -- optional link to the originating proposal
  effective_from timestamptz,               -- when it starts counting
  effective_to   timestamptz,               -- optional end (null = ongoing)
  active         boolean DEFAULT true NOT NULL,
  created_by     uuid,
  created_at     timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manual_mrr_active ON manual_mrr_adjustments (active);
