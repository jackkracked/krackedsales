-- 0011_kpi_last_values.sql
-- "Last good value" cache per (scope, date-range, metric). When a data source
-- (Stripe/Meta/…) fails on a refresh, the dashboard serves the last successful
-- value instead of flashing a fake $0. Additive + idempotent.

CREATE TABLE IF NOT EXISTS kpi_last_values (
  scope_key   text NOT NULL,
  range_key   text NOT NULL,
  metric_key  text NOT NULL,
  value       double precision,
  prev        double precision,
  series      jsonb,
  captured_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, range_key, metric_key)
);
