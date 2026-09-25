-- 0058: Guards for crediting a booked call back to the link that caused it.
--
-- WHY A UNIQUE INDEX RATHER THAN A CHECK IN CODE
-- `ghl_appointment_id` is what pays someone. If two links for the same contact could both
-- claim the same appointment, two people would be paid $25 for one booked call, and the error
-- would be invisible: both rows look perfectly valid on their own. The database is the only
-- place that can make that impossible regardless of what any future caller does.
--
-- Partial, because the column is null for every link that has not converted yet, and null is
-- not unique in Postgres but an explicit WHERE keeps the index small and the intent obvious.
--
-- Additive and idempotent. Safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS booking_links_appointment_uniq
  ON booking_links (ghl_appointment_id)
  WHERE ghl_appointment_id IS NOT NULL;

-- The attribution job's only scan: links still waiting to convert, newest first.
CREATE INDEX IF NOT EXISTS booking_links_pending_idx
  ON booking_links (created_at DESC)
  WHERE booked_at IS NULL;
