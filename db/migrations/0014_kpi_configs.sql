-- KPI configs: source of truth for configurable KPIs. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "kpi_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "metric_key" text NOT NULL UNIQUE,
  "dataset" text NOT NULL,
  "aggregation" jsonb NOT NULL,
  "filters" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "date_field" text,
  "unit" text NOT NULL DEFAULT 'currency',
  "enabled" boolean NOT NULL DEFAULT true,
  "updated_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
