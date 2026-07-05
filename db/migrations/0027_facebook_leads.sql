-- 0027, Individual Facebook / Instagram Lead Ads submissions, ingested directly
-- from Meta (leadgen webhook + Graph API), independent of GoHighLevel.
-- Additive + idempotent: safe to run straight against prod, no data migration.

CREATE TABLE IF NOT EXISTS "facebook_leads" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "leadgen_id"    text NOT NULL,
  "form_id"       text,
  "form_name"     text,
  "page_id"       text,
  "page_name"     text,
  "platform"      text NOT NULL DEFAULT 'facebook',
  "campaign_id"   text,
  "campaign_name" text,
  "adset_name"    text,
  "ad_name"       text,
  "full_name"     text,
  "email"         text,
  "phone"         text,
  "field_data"    jsonb,
  "is_organic"    boolean NOT NULL DEFAULT false,
  "created_time"  timestamp NOT NULL,
  "created_at"    timestamp NOT NULL DEFAULT now()
);

-- Dedup key: Meta redelivers leadgen webhooks, so the lead id must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS "facebook_leads_leadgen_id_key" ON "facebook_leads" ("leadgen_id");

-- The "New Leads" KPI + drawer query by submission time.
CREATE INDEX IF NOT EXISTS "facebook_leads_created_time_idx" ON "facebook_leads" ("created_time");
