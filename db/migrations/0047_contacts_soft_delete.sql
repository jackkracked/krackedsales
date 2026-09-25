-- Ghost delete for contacts that no longer exist in GoHighLevel.
--
-- WHY NOT A HARD DELETE
-- Measured 2026-08-07: GHL holds 5,094 contacts, we held 5,274. The 180 extra were deleted or
-- merged in GHL and never removed here, because the sync only ever upserts. Jack wants the
-- counts to agree exactly, but `local_opportunities`, proposals, tasks, calls and activity all
-- reference contact ids — a hard DELETE would orphan those rows and lose history for deals
-- that genuinely happened. A timestamp column is reversible: clearing it restores the contact
-- exactly, and nothing downstream ever loses its reference.
--
-- Every read path that counts or lists contacts must filter `deleted_in_ghl_at IS NULL`.
--
-- Additive and idempotent. No preview environment, so this lands straight in production.

ALTER TABLE local_contacts
  ADD COLUMN IF NOT EXISTS deleted_in_ghl_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS local_contacts_live_idx
  ON local_contacts (id) WHERE deleted_in_ghl_at IS NULL;
