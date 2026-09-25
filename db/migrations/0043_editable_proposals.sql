-- 0043 Editable proposals + templates (additive, idempotent).
-- Structured line-by-line deliverables + per-proposal editable copy snapshot,
-- plus an editable-copy templates table. All nullable / IF NOT EXISTS so the
-- ~46 existing proposals migrate instantly and keep rendering via the code
-- fallback (lib/proposals/content.ts defaultContentFor). No seed here on purpose:
-- proposal_templates starts empty and is populated only when an admin saves.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deliverables jsonb;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS content jsonb;

CREATE TABLE IF NOT EXISTS proposal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL UNIQUE,
  sections jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);
