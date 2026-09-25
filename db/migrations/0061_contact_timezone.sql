-- 0061: Give every contact a timezone, so the dialer can tell what time it is where they are.
--
-- Jack, 2026-09-25: "make sure everyone has a timezone assigned".
--
-- WHY A STORED COLUMN WHEN IT CAN BE COMPUTED
-- The warning itself computes from the phone number at dial time, because that can never go
-- stale. These columns exist so the timezone is VISIBLE: on the contact, in a query, in a list
-- of who is in which region. A number nobody can see is a number nobody can check.
--
-- `timezone_source` records how confident we were, because "we read it off the area code" and
-- "GoHighLevel told us" are different claims and should not look identical later.
--
-- Additive, nullable, idempotent. Nothing reads these until the dialer warning ships.
ALTER TABLE local_contacts ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE local_contacts ADD COLUMN IF NOT EXISTS timezone_source text;
