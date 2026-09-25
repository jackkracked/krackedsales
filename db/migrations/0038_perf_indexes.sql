-- 0038 Performance indexes for the local GHL mirror + hot local tables, so pages that read
-- from Postgres (instead of scraping GHL live) do indexed lookups, not seq scans. Additive +
-- idempotent. Applied to prod 2026-07-23.

CREATE INDEX IF NOT EXISTS idx_local_opportunities_pipeline_id ON local_opportunities (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_local_opportunities_contact_id ON local_opportunities (contact_id);
CREATE INDEX IF NOT EXISTS idx_local_opportunities_assigned_to ON local_opportunities (assigned_to);
CREATE INDEX IF NOT EXISTS idx_local_opportunities_pipeline_stage_id ON local_opportunities (pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_local_conversations_assigned_to ON local_conversations (assigned_to);
CREATE INDEX IF NOT EXISTS idx_local_conversations_last_message_date ON local_conversations (last_message_date);
CREATE INDEX IF NOT EXISTS idx_local_conversations_inbox ON local_conversations (inbox);
CREATE INDEX IF NOT EXISTS idx_local_contacts_email ON local_contacts (email);
CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events (created_at);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls (started_at);
CREATE INDEX IF NOT EXISTS idx_calls_call_type ON calls (call_type);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks (completed);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_contact_id ON pipeline_stage_events (contact_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_created_at ON pipeline_stage_events (created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_run_logs_run_id ON workflow_run_logs (run_id);
