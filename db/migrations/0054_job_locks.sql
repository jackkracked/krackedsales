-- 0054: Job locks + last-run record for background sweeps.
--
-- Two problems, one row each.
--
-- 1. NOTHING STOPPED A SWEEP FROM STACKING. The pipeline parity repair fires from
--    `usePipelineParity` on every /pipeline mount while drift is non-zero, and each run is
--    ~39 sequential GHL calls. Several mounts (or several people) meant several concurrent
--    39-call walks against a location GHL burst-limits at ~100 requests per 10 seconds. The
--    sweep then 429s, fails, leaves drift in place, and the next mount tries again. On
--    2026-09-12 that loop had been running for 16 days and surfaced as
--    "Could not verify against GoHighLevel: Repair was refused".
--
-- 2. NOTHING RECORDED WHAT HAPPENED. Vercel keeps no runtime logs reachable with the
--    team-scoped token, so "when did this last work, and why did it fail" took an hour of
--    forensics. The last outcome now lives in the database, in plain text.
--
-- The lock is taken with ONE statement, because the Neon HTTP driver gives every statement
-- its own session: there are no interactive transactions to hold, and pg_try_advisory_lock
-- would release the moment the statement returned. The acquire is therefore an
-- INSERT ... ON CONFLICT DO UPDATE ... WHERE (expired) RETURNING key, which returns a row
-- only to the caller that actually won it.
--
-- Additive and idempotent. Safe to re-run. No preview environment, so this lands in prod.
CREATE TABLE IF NOT EXISTS job_locks (
  key              text PRIMARY KEY,
  locked_until     timestamptz,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_ok          boolean,
  last_status      text,
  last_detail      text,
  last_result      jsonb
);
