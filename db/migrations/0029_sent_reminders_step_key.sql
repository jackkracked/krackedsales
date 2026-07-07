-- 0029, Dedup reminders by a STABLE step key instead of the array index, so editing a
-- sequence (removing/reordering a step) can never re-email a client who already got it.
-- sent_reminders is empty at this point, so swapping the unique index is safe.

ALTER TABLE "sent_reminders" ADD COLUMN IF NOT EXISTS "step_key" text;

DROP INDEX IF EXISTS "sent_reminders_entity_template_step_key";

CREATE UNIQUE INDEX IF NOT EXISTS "sent_reminders_entity_template_stepkey_key"
  ON "sent_reminders" ("entity_id", "template_key", "step_key");
