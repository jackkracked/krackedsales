-- RBAC: add role, is_active, ghl_user_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ghl_user_id text;

-- Role permission presets (editable per-role defaults)
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (role, feature_key)
);

-- Per-user permission overrides (take precedence over role defaults)
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL,
  UNIQUE (user_id, feature_key)
);

-- Monthly performance targets per rep
CREATE TABLE IF NOT EXISTS rep_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  deals_per_month integer NOT NULL DEFAULT 5,
  calls_per_day integer NOT NULL DEFAULT 15,
  revenue_target double precision NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Seed default role permissions
INSERT INTO role_permissions (role, feature_key, enabled) VALUES
  ('admin', 'view_dashboard',   true),
  ('admin', 'view_kpis',        true),
  ('admin', 'view_team',        true),
  ('admin', 'view_analytics',   true),
  ('admin', 'view_pipeline',    true),
  ('admin', 'view_inbox',       true),
  ('admin', 'view_calls',       true),
  ('admin', 'view_calendar',    true),
  ('admin', 'view_demo_tracker',true),
  ('admin', 'view_follow_ups',  true),
  ('admin', 'view_templates',   true),
  ('admin', 'manage_settings',  true),
  ('rep',   'view_dashboard',   true),
  ('rep',   'view_kpis',        false),
  ('rep',   'view_team',        false),
  ('rep',   'view_analytics',   false),
  ('rep',   'view_pipeline',    true),
  ('rep',   'view_inbox',       true),
  ('rep',   'view_calls',       true),
  ('rep',   'view_calendar',    true),
  ('rep',   'view_demo_tracker',false),
  ('rep',   'view_follow_ups',  true),
  ('rep',   'view_templates',   true),
  ('rep',   'manage_settings',  false)
ON CONFLICT (role, feature_key) DO NOTHING;
