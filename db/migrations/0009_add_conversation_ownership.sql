-- 0009_add_conversation_ownership.sql
-- Local-first conversation ownership / last-responder.
-- Stores, in our own Neon DB, which rep last *personally* responded to each
-- conversation (so the dashboard can scope a rep's view to their own threads
-- + the unassigned pool, while admins see everything).
-- All additive + idempotent — safe to run against production.

-- Who was the last human (rep) to send an outbound reply, and when/how.
ALTER TABLE local_conversations ADD COLUMN IF NOT EXISTS last_responder_user_id text;
ALTER TABLE local_conversations ADD COLUMN IF NOT EXISTS last_responded_at timestamp;
ALTER TABLE local_conversations ADD COLUMN IF NOT EXISTS last_responded_source text;

-- Author (GHL user id) of an individual outbound message, when GHL provides it.
ALTER TABLE local_messages ADD COLUMN IF NOT EXISTS sent_by_user_id text;

-- Dashboard filters by assignment + last-responder, sorted by recency.
CREATE INDEX IF NOT EXISTS idx_local_conversations_assigned_to ON local_conversations (assigned_to);
CREATE INDEX IF NOT EXISTS idx_local_conversations_last_responder ON local_conversations (last_responder_user_id);
CREATE INDEX IF NOT EXISTS idx_local_conversations_last_message_date ON local_conversations (last_message_date);
