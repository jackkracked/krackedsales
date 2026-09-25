-- 0055: Task assignment + Slack identity.
--
-- Gage, 2026-09-22: "Would it be hard to add an assign task feature? that way I can assign
-- tasks to kelsey or alice etc and then maybe it can auto send them slack reminders".
--
-- WHY `assigned_by_*` AND NOT JUST `user_id`
-- `tasks.user_id` already exists and already means "whose task is this", so assignment is
-- just writing someone else's id into it. But that ALONE loses two things:
--   1. The DM cannot say who delegated the work ("Gage assigned you...").
--   2. The task would vanish from the assigner's own "My tasks", because that list filters
--      on user_id. Jack, 2026-09-22: keep them in Gage's list. The list therefore filters
--      `user_id = me OR assigned_by_user_id = me`, which is only possible with this column.
--
-- WHY `users.slack_user_id` AND NOT A LOOKUP BY EMAIL
-- Slack's users.lookupByEmail resolves Alice and Kelsey from their app logins, but NOT Gage:
-- his Slack account is gageflesher10@gmail.com while he signs into this app as
-- gage@krackedretention.com. Resolving at send time would therefore work for two people and
-- silently no-op for the admin who uses the feature most. Storing the id makes the mapping
-- explicit, survives email changes, and costs no API call per send.
--   Gage  U013TBC8TFH | Alice U0B0LPJS7QV | Kelsey U0BM77DPJTF   (verified 2026-09-22)
--
-- Additive and idempotent. Safe to re-run. No preview environment, so this lands in prod.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by_user_id uuid REFERENCES users(id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by_name text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_user_id text;
