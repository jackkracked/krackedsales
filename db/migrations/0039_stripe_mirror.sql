-- 0039 Stripe mirror for instant KPIs. Local copies of the Stripe entities the KPI engine
-- reads (charges/invoices/subscriptions/refunds), so the engine computes from Postgres
-- (~ms) instead of paginating Stripe's API live (~seconds). Kept fresh by a Stripe webhook +
-- reconcile cron. Money stored as INTEGER CENTS (Stripe-native); dates as timestamptz from
-- unix seconds so `.getTime()` reproduces the engine's `created * 1000` epoch-ms exactly.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS local_stripe_charges (
  id             text PRIMARY KEY,
  customer_id    text,
  customer_name  text,               -- display label = name|email|id (customerName())
  status         text,               -- succeeded | failed | pending
  amount         integer,            -- cents
  currency       text,
  fee            integer,            -- cents, from expanded balance_transaction.fee
  description    text,
  refunded       integer,            -- cents, amount_refunded
  paid           boolean,
  is_test        boolean DEFAULT false,
  created        timestamptz,
  raw            jsonb,
  synced_at      timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_stripe_charges_created ON local_stripe_charges (created);
CREATE INDEX IF NOT EXISTS idx_local_stripe_charges_status ON local_stripe_charges (status);

CREATE TABLE IF NOT EXISTS local_stripe_invoices (
  id                  text PRIMARY KEY,
  number              text,
  customer_id         text,
  customer_name       text,
  status              text,           -- open | paid | void | uncollectible
  amount_paid         integer,        -- cents
  amount_remaining    integer,        -- cents
  amount_due          integer,        -- cents
  currency            text,
  parent_type         text,           -- 'subscription_details' => sub invoice
  billing_reason      text,
  is_subscription     boolean,
  credit_notes_amount integer,        -- cents (post_payment_credit_notes_amount)
  subscription_id     text,
  created             timestamptz,
  due_date            timestamptz,
  paid_at             timestamptz,
  raw                 jsonb,
  synced_at           timestamptz DEFAULT now() NOT NULL,
  updated_at          timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_stripe_invoices_created ON local_stripe_invoices (created);
CREATE INDEX IF NOT EXISTS idx_local_stripe_invoices_status ON local_stripe_invoices (status);
CREATE INDEX IF NOT EXISTS idx_local_stripe_invoices_due_date ON local_stripe_invoices (due_date);

CREATE TABLE IF NOT EXISTS local_stripe_subscriptions (
  id                    text PRIMARY KEY,
  customer_id           text,
  customer_name         text,
  status                text,         -- active | canceled | past_due | ...
  created               timestamptz,
  canceled_at           timestamptz,
  cancel_at_period_end  boolean,
  item0_unit_amount     integer,      -- cents, items.data[0].price.unit_amount
  item0_interval        text,         -- month | year | week | day
  item0_interval_count  integer,
  item0_quantity        integer,
  current_mrr_cents     integer,      -- Σ all items normalized monthly (customers-basis)
  price_nickname        text,
  proposal_id           text,         -- metadata.proposal_id
  items                 jsonb,        -- all items' price+qty (multi-item)
  raw                   jsonb,
  synced_at             timestamptz DEFAULT now() NOT NULL,
  updated_at            timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_stripe_subscriptions_status ON local_stripe_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_local_stripe_subscriptions_created ON local_stripe_subscriptions (created);
CREATE INDEX IF NOT EXISTS idx_local_stripe_subscriptions_canceled_at ON local_stripe_subscriptions (canceled_at);

CREATE TABLE IF NOT EXISTS local_stripe_refunds (
  id          text PRIMARY KEY,
  charge_id   text,
  amount      integer,                -- cents
  currency    text,
  created     timestamptz,
  raw         jsonb,
  synced_at   timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_stripe_refunds_created ON local_stripe_refunds (created);
