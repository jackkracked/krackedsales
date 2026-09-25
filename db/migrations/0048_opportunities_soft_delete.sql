-- Ghost delete for opportunities that no longer exist in GoHighLevel.
--
-- WHY: the sync only ever upserts, so an opportunity deleted in GHL lives here forever and
-- keeps being counted. Measured 2026-08-07 on "Email Design Demo Pipeline (AD FUNNEL)":
--
--   stage "Unresponsive (Demo Not Started)"   ours 46   GHL 0
--   pipeline total                            ours 2,312   GHL 2,194
--
-- Six of those 46 were sampled against GHL directly and every one returned 404 — deleted,
-- not moved. So the stage filter was not mis-resolving names (the TP1 stage matched GHL's
-- 230 exactly); it was counting corpses.
--
-- Soft, not hard: proposals and demos reference opportunity ids, and a deal that genuinely
-- happened should not lose its link because someone tidied the GHL board. Reversible.
--
-- Additive and idempotent. No preview environment, so this lands straight in production.

ALTER TABLE local_opportunities
  ADD COLUMN IF NOT EXISTS deleted_in_ghl_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS local_opportunities_live_idx
  ON local_opportunities (pipeline_id, pipeline_stage_id) WHERE deleted_in_ghl_at IS NULL;
