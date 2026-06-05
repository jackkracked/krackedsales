ALTER TABLE user_calendars ADD COLUMN IF NOT EXISTS conflict_calendar_id text DEFAULT 'primary';
