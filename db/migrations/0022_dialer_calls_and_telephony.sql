-- 0022 Power Dialer: calls/disposition extensions + Twilio settings & numbers. Additive + idempotent.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS twilio_call_sid text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES dialer_campaigns(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_url text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS source text DEFAULT 'ghl';
CREATE UNIQUE INDEX IF NOT EXISTS calls_twilio_call_sid_key ON calls (twilio_call_sid) WHERE twilio_call_sid IS NOT NULL;

ALTER TABLE call_dispositions ALTER COLUMN calendar_event_id DROP NOT NULL;
ALTER TABLE call_dispositions ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES calls(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS call_dispositions_call_id_key ON call_dispositions (call_id) WHERE call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dialer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_account_sid text,
  twilio_api_key_sid text,
  twilio_api_key_secret text,
  twiml_app_sid text,
  caller_id text,
  voicemail_greeting_url text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS twilio_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  twilio_sid text,
  label text,
  assigned_rep_user_id uuid REFERENCES users(id),
  is_shared boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS twilio_numbers_phone_key ON twilio_numbers (phone_number);
