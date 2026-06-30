-- 0020 — Rename comment_leads -> social_leads.
-- The table stores ALL Meta-captured leads now (trigger-word COMMENTS *and* DM conversations,
-- across FB/IG/TikTok), so the old name was misleading. See lib/db/schema.ts (socialLeads).
--
-- Zero-downtime: after the rename, a transitional auto-updatable VIEW named comment_leads keeps
-- pre-deploy code working until the new build is live. This table uses NO ON CONFLICT upserts,
-- so a simple single-table view passes through all INSERT/UPDATE/DELETE/SELECT with no limitation.
--
-- Idempotent + re-runnable. DO NOT apply with the generic ;-splitter (it shatters the DO block).
-- Apply with:   node --env-file=.env.production.vercel scripts/apply-rename-social-leads.mjs
-- Then, only AFTER the deploy is verified healthy:
--               node --env-file=.env.production.vercel scripts/drop-comment-leads-view.mjs

-- 1. Rename the base table, only if it still exists under the old name and the new one isn't taken.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'comment_leads' AND table_type = 'BASE TABLE'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'social_leads' AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE comment_leads RENAME TO social_leads;
  END IF;
END $$;

-- 2. Transitional alias so pre-deploy code referencing comment_leads keeps working during rollout.
CREATE OR REPLACE VIEW comment_leads AS SELECT * FROM social_leads;
