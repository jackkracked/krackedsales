-- Leads Centre mirror: one row per lead as META holds it.
--
-- WHY THIS TABLE EXISTS
-- The Leads page derived its population from local_contacts (the GHL mirror) filtered to
-- "has a Facebook ad id". That can never match Meta's Leads Centre, and the gap is not a bug
-- in the filter — it is a gap in the DATA:
--
--   Meta Leads Centre   711 distinct people  (264 in the All tab + 465 Not qualified)
--   local_contacts      553 ad-attributed contacts
--   overlap             549
--
-- The 162 Meta has that we do not are mostly organic Instagram/Messenger leads carrying NO
-- email and NO phone (Chris Bryan, Amelia Louise, Suz SQ, shroombar, Salty Jaye, HIGROOV …),
-- plus Meta's own test@meta.com dummy and leads that have not yet reached GHL. They are not
-- GHL contacts, so no stage could ever be written for them, so Intake read 9 against Meta's
-- 16 and Converted 135 against 187.
--
-- This table holds Meta's own rows, verbatim from the Leads Centre CSV export, so the counts
-- can be EXACT. It links to local_contacts where we can identify the person, and stands alone
-- where we cannot.
--
-- WHY NOT INSERT THESE INTO local_contacts
-- local_contacts is a mirror of GHL, maintained by lib/ghl/sync.ts. Inventing rows in it
-- would (a) make them appear in Contacts as if they were real CRM contacts, (b) risk the
-- sync deleting or overwriting them, and (c) create exactly the duplicates Jack ruled out —
-- a person who later submits a form properly would arrive from GHL as a SECOND row.
-- A separate table cannot collide with the sync, and cannot duplicate a contact.
--
-- Additive and idempotent. No preview environment, so this lands straight in production.

CREATE TABLE IF NOT EXISTS meta_leads (
  -- Deterministic hash of email|name|created|form from the export, so re-importing the same
  -- file updates rather than duplicates. Idempotency is the whole point: Jack will re-export.
  id            TEXT PRIMARY KEY,

  -- Verbatim from Meta's export.
  created_meta  TIMESTAMPTZ,
  full_name     TEXT,
  email         TEXT,
  phone         TEXT,
  source        TEXT,          -- Paid | Organic
  form_name     TEXT,
  channel       TEXT,          -- Email address | Messenger | Instagram
  stage         TEXT NOT NULL, -- intake | need_more_info | qualified | disqualified | converted | not_qualified | lost
  owner         TEXT,
  labels        TEXT,

  -- The person in our CRM, when we could identify them. NULL means Meta knows this lead and
  -- we do not — which is a fact worth showing, not an error to hide.
  contact_id    TEXT,

  export_file   TEXT,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The rail counts group by stage; the feed orders by date.
CREATE INDEX IF NOT EXISTS meta_leads_stage_idx       ON meta_leads (stage);
CREATE INDEX IF NOT EXISTS meta_leads_created_idx     ON meta_leads (created_meta DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS meta_leads_contact_idx     ON meta_leads (contact_id);
-- Matching an incoming GHL contact back to its Meta row is by email.
CREATE INDEX IF NOT EXISTS meta_leads_email_idx       ON meta_leads (LOWER(email));
