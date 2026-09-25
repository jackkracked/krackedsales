-- 0053: Today list state.
--
-- The list itself is NOT stored. It is recomputed on every load, ranked fresh against reality
-- (Jack, 2026-08-27: "make sure they're refreshed... you might go in another day, and there
-- might be a higher priority task for him"). A stored list is a list that goes stale, and the
-- paragraph this replaces went stale daily.
--
-- What persists is only the rep's own DECISIONS about an item: done, or snoozed until later.
-- `source_key` is the stable identity of a derived item (e.g. "proposal:<id>:chase"), so a
-- decision survives the list being rebuilt from scratch on the next page load.
CREATE TABLE IF NOT EXISTS today_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key    text NOT NULL,
  completed_at  timestamp,
  snoozed_until timestamp,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);

-- One decision per item per rep. Marking done twice is the same fact, not two rows.
CREATE UNIQUE INDEX IF NOT EXISTS today_items_user_source_uniq ON today_items (user_id, source_key);

-- The read path is always "this user's live decisions", so index for exactly that.
CREATE INDEX IF NOT EXISTS today_items_user_idx ON today_items (user_id, completed_at, snoozed_until);
