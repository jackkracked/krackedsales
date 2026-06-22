-- 0010_add_platform_reply_responder.sql
-- App-side ownership for Meta/TikTok: record which rep last replied to a
-- platform conversation (stored as their GHL user id so the dashboard filter
-- treats GHL + platform channels uniformly). Additive + idempotent.

ALTER TABLE platform_replies ADD COLUMN IF NOT EXISTS responder_user_id text;
