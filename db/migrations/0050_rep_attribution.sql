-- 0050: rep attribution — who BOOKED a call, and who CLOSED a deal.
--
-- Both additive and nullable. NULL preserves today's behaviour exactly, so this file changes
-- nothing at runtime on its own.
--
-- 1. calls.booked_by_ghl_user_id
--    `calls.rep_email` records who ATTENDED. Nothing records who BOOKED. Kelsey (setter) books
--    for Gage and Alice, so all of her booking work currently lands on THEIR rows and her
--    headline setter metric cannot be computed at all.
--    GHL appointments carry `createdBy: { source, userId }` — already documented in
--    scripts/backfill-call-rep.mjs as "booked in GHL, ATTRIBUTABLE". We simply never stored it.
--    Storing the GHL user id (not our email) because that is what the appointment payload
--    carries; users.ghl_user_id maps it back, and every active user has one.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS booked_by_ghl_user_id text;
CREATE INDEX IF NOT EXISTS calls_booked_by_idx ON calls (booked_by_ghl_user_id);

-- 2. proposals.closed_by
--    Every rep metric keys on proposals.created_by, i.e. whoever BUILT the proposal. That is the
--    wrong signal for a close: Tofu Go was Alice's deal, but Gage sent the proposal because she
--    was tied up, so the leaderboard credits Gage.
--    NULL means "same as created_by", so no backfill is needed and nothing changes for existing
--    rows. Metrics read COALESCE(closed_by, created_by). created_by is left untouched as the
--    audit trail of who actually built it.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS proposals_closed_by_idx ON proposals (closed_by);
