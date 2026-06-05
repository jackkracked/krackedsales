-- KPI system: offer funnels, manual expenses, visibility toggles

CREATE TABLE IF NOT EXISTS offer_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pipeline_ids jsonb NOT NULL DEFAULT '[]',
  campaign_filter text,
  ad_platform text NOT NULL DEFAULT 'meta',
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  amount double precision NOT NULL,
  month text NOT NULL,
  category text,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS kpi_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  metric_key text NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT now() NOT NULL
);
