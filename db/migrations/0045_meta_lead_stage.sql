-- Leads Centre: the Meta lead stage, and the record of what we told Facebook about it.
--
-- WHY THIS LIVES ON local_contacts, not on opportunities:
-- an opportunity belongs to a contact, and a person has exactly one qualification state.
-- Putting the stage on both would let them disagree, which is the two-sources-of-truth
-- pattern that produced the 90-day billing failure and the Cheeky $10,800 display bug.
-- Opportunities READ this value through their contact. One person, one stage.
--
-- This is DELIBERATELY separate from the GHL pipeline stage. Both exist, neither
-- overwrites the other: the pipeline stage is where the deal is, the Meta lead stage is
-- what we tell Facebook's optimiser. Only the latter fires the Conversions API.
--
-- Additive and idempotent. No preview environment, so this lands straight in production.

ALTER TABLE local_contacts
  -- intake | need_more_info | qualified | disqualified | converted | lost | not_qualified
  -- NULL = never triaged. Mirrors Meta's own stage vocabulary exactly.
  ADD COLUMN IF NOT EXISTS meta_lead_stage        TEXT,
  ADD COLUMN IF NOT EXISTS meta_lead_stage_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta_lead_stage_by     UUID,

  -- The Conversions API receipt. Without this the signal is unobservable, and an
  -- unobservable signal is how you lose $180-per-qualified-lead optimisation for weeks
  -- without noticing. sent | failed | skipped | NULL(never attempted)
  ADD COLUMN IF NOT EXISTS capi_status            TEXT,
  ADD COLUMN IF NOT EXISTS capi_sent_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capi_event_id          TEXT,
  ADD COLUMN IF NOT EXISTS capi_error             TEXT;

-- The Leads Centre reads "Meta-attributed contacts, newest first, filtered by stage".
CREATE INDEX IF NOT EXISTS local_contacts_meta_lead_stage_idx
  ON local_contacts (meta_lead_stage);

CREATE INDEX IF NOT EXISTS local_contacts_created_at_ghl_idx
  ON local_contacts (created_at_ghl DESC NULLS LAST);

-- Joining a GHL contact to its Meta lead (for the exact lead id CAPI prefers) is by email.
CREATE INDEX IF NOT EXISTS facebook_leads_email_idx
  ON facebook_leads (LOWER(email));
