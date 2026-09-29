-- 0065: Closer and setter on every proposal. Plan: tasks/proposal-roles-plan.md.
--
-- `closed_by` already exists and is the closer column (NULL = suggested: whoever created it).
-- These add the SETTER, confirmation stamps for both, the status a proposal had before it was
-- archived (so Unarchive restores it exactly), and an audit trail of every credit change.
--
-- Additive and idempotent. Nothing existing changes. Safe to re-run.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS setter_user_id uuid REFERENCES users(id);
-- NULL = suggested by the booking rule (today's behaviour) | 'assigned' = setter_user_id is the
-- setter | 'none' = explicitly no setter, no setter commission.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS setter_mode text CHECK (setter_mode IN ('assigned', 'none'));
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS closer_confirmed_by uuid REFERENCES users(id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS closer_confirmed_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS setter_confirmed_by uuid REFERENCES users(id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS setter_confirmed_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS status_before_archive text;

-- Every credit change, forever. No foreign key to proposals: deleting a proposal must never
-- delete the record of who was paid on it.
CREATE TABLE IF NOT EXISTS proposal_credit_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid NOT NULL,
  field        text NOT NULL CHECK (field IN ('closer', 'setter')),
  from_user_id uuid,
  to_user_id   uuid,
  from_mode    text,
  to_mode      text,
  action       text NOT NULL CHECK (action IN ('assign', 'confirm', 'none')),
  changed_by   uuid NOT NULL REFERENCES users(id),
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_credit_changes_proposal_idx ON proposal_credit_changes (proposal_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS proposals_setter_user_idx ON proposals (setter_user_id) WHERE setter_user_id IS NOT NULL;
