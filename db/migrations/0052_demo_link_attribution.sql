-- 0052: Demo Link attribution.
--
-- The link VALUE itself lives in GoHighLevel, in the "Insert Miro Link" custom field
-- (id Kr9sT50pSDCq5TP6ObPT). GHL is the source of truth and filling it triggers a GHL
-- workflow, which is the whole point of the feature.
--
-- What GHL does NOT store is WHO set it and WHEN. Because saving fires a client-facing
-- workflow, the team needs to see who pulled that trigger without opening GHL. So we record
-- authorship on our side, at the moment we perform the write.
--
-- A link set directly inside GHL leaves these NULL, and the UI reads that as
-- "Set in GoHighLevel" rather than inventing an author.
--
-- Additive, nullable, idempotent. Nothing reads these until the feature ships.
ALTER TABLE local_contacts ADD COLUMN IF NOT EXISTS demo_link_set_by uuid REFERENCES users(id);

ALTER TABLE local_contacts ADD COLUMN IF NOT EXISTS demo_link_set_at timestamp;
