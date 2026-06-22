-- Audit requests created from the in-app Create Audit modal. Additive + idempotent.
-- Mirrors the ClickUp audit task and links it to a GHL contact so the contacts
-- list can show audit status and the "Audit delivered" filter + KPIs work.
CREATE TABLE IF NOT EXISTS "audits" (
  "clickup_task_id" text PRIMARY KEY NOT NULL,
  "ghl_contact_id"  text,
  "brand_name"      text,
  "website"         text,
  "details"         text,
  "status"          text NOT NULL DEFAULT 'requested',  -- requested | delivered
  "clickup_status"  text,                                -- last-seen ClickUp task status
  "requested_at"    timestamp DEFAULT now() NOT NULL,
  "delivered_at"    timestamp,
  "created_by"      uuid,
  "checked_at"      timestamp DEFAULT now() NOT NULL
);

-- Contacts route filters audits by ghl_contact_id; cron scans by status.
CREATE INDEX IF NOT EXISTS "audits_ghl_contact_id_idx" ON "audits" ("ghl_contact_id");
CREATE INDEX IF NOT EXISTS "audits_status_idx" ON "audits" ("status");
