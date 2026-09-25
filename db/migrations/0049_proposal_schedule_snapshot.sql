-- 0049: freeze the payment schedule a client has already been shown.
--
-- The payment schedule is computed at render time, so correcting the date logic would silently
-- change what an already-sent proposal displays when the client reopens it. This column stores
-- the rows as they were presented, so anything already sent or signed keeps rendering exactly
-- what the client saw, while new proposals compute fresh from the corrected logic.
--
-- Shape: [{"label":"Payment 1 of 3","when":"11 Aug 2026","amount":1500}, ...]
--
-- Additive and idempotent: a nullable column with no default and no backfill here. NULL means
-- "compute it", which is the existing behaviour, so this file alone changes nothing at runtime.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS schedule_snapshot jsonb;

-- Records WHEN the snapshot was taken, so it is possible to tell a frozen row apart from one
-- that simply has no schedule (upfront proposals legitimately have none).
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS schedule_snapshot_at timestamptz;
