-- 0041 90-day off-session charge ledger. The source of truth for which spread charges (flexible
-- first-month splits + months 2 & 3) are due and which are paid. The cron reads this; each row's
-- idempotency_key makes its off-session charge exactly-once. Additive only, lands straight in prod.

CREATE TABLE IF NOT EXISTS ninety_day_splits (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id              uuid NOT NULL,
  charge_number            integer NOT NULL,             -- ordered within the term
  label                    text,                         -- e.g. "Month 2 of 3"
  amount_cents             integer NOT NULL,
  currency                 text NOT NULL DEFAULT 'usd',
  due_date                 timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'pending', -- pending|paid|failed|action_required|canceled
  idempotency_key          text NOT NULL UNIQUE,         -- stable per row; used for the off-session PI
  stripe_payment_intent_id text,
  attempts                 integer NOT NULL DEFAULT 0,
  last_error               text,
  charged_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_90d_splits_due ON ninety_day_splits (status, due_date);
CREATE INDEX IF NOT EXISTS idx_90d_splits_proposal ON ninety_day_splits (proposal_id);
