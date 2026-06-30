-- 0021 Power Dialer: campaigns + queue. Additive + idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS dialer_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES users(id),
  owner_scope text NOT NULL DEFAULT 'admin',
  max_attempts integer NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dialer_campaign_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES dialer_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dialer_campaign_reps_campaign_user_key ON dialer_campaign_reps (campaign_id, user_id);

CREATE TABLE IF NOT EXISTS dialer_campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES dialer_campaigns(id) ON DELETE CASCADE,
  contact_id text NOT NULL,
  contact_name text,
  phone text,
  position integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  locked_by_user_id uuid REFERENCES users(id),
  locked_at timestamp,
  last_outcome text,
  last_attempt_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dialer_campaign_contacts_campaign_contact_key ON dialer_campaign_contacts (campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS dialer_campaign_contacts_queue_idx ON dialer_campaign_contacts (campaign_id, status, position);
