-- 0056: Remember where a dial campaign came from, so it can keep itself current.
--
-- Jack, 2026-09-22: "if we work it one day, and then the next day we come back to it, but in
-- the meantime there's been new leads in that stage, are the new leads going to be in this
-- campaign? That's how I want it to work, like a dynamic campaign."
--
-- Without these two columns a stage-loaded campaign is a photograph: correct the second it is
-- taken and stale every day after. Storing the source lets the queue be topped up from the
-- same stage whenever it is opened, using the identical function that built it.
--
-- NULL on both = a hand-built campaign, which stays exactly as it is. That is the default and
-- every existing campaign keeps it.
--
-- Additive and idempotent. Safe to re-run.
ALTER TABLE dialer_campaigns ADD COLUMN IF NOT EXISTS source_pipeline_id text;

ALTER TABLE dialer_campaigns ADD COLUMN IF NOT EXISTS source_stage_id text;

ALTER TABLE dialer_campaigns ADD COLUMN IF NOT EXISTS source_synced_at timestamptz;
