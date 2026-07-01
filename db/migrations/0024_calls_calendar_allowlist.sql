-- Calls page: filter which Meet calendars appear (hide internal calls).
-- Additive + idempotent.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS calendar_id text;

CREATE TABLE IF NOT EXISTS call_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allowed_calendar_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);
