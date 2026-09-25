-- 0042 Flexible first payment for "Pay every 30 days". The first month can be split into portions
-- (e.g. $2,000 to secure + $2,500), and the 90-day term ANCHORS to when the last portion clears.
-- Additive + nullable, lands straight in prod.

-- Distinguish first-month split portions from the recurring months in the off-session ledger.
ALTER TABLE ninety_day_splits ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'month'; -- 'first_portion' | 'month'

-- The contract's official start = when the first month is fully collected. Months 2 & 3 anchor to it.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS contract_start_at timestamptz;
-- The rep-defined split of the first month: [{ amount: <dollars>, offsetDays: <int> }], portion 1 = offsetDays 0.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS first_payment_split jsonb;
