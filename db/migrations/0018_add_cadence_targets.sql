-- Per-cadence KPI targets so the on-track badge can pace honestly for any window.
-- One row per metric still (unique metric_key); we just add daily/weekly/monthly slots
-- plus which cadence the user actually typed (the "anchor"; the others auto-derive).
-- The legacy single `target` column is kept and treated as the MONTHLY value, so any
-- reader we haven't migrated still renders. Additive + idempotent (lands straight in prod).
ALTER TABLE "kpi_targets" ADD COLUMN IF NOT EXISTS "target_daily"   double precision;
ALTER TABLE "kpi_targets" ADD COLUMN IF NOT EXISTS "target_weekly"  double precision;
ALTER TABLE "kpi_targets" ADD COLUMN IF NOT EXISTS "target_monthly" double precision;
ALTER TABLE "kpi_targets" ADD COLUMN IF NOT EXISTS "anchor_cadence" text NOT NULL DEFAULT 'monthly';

-- Existing targets were effectively judged against Month-to-Date (the default view), so
-- they are already "per month": seed the monthly slot from the legacy value. Idempotent —
-- only fills rows that don't already have a monthly target.
UPDATE "kpi_targets"
   SET "target_monthly" = "target"
 WHERE "target_monthly" IS NULL;
