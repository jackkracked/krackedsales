-- 0063: Pay tracker ledger. Setter half, editable months, month close.
--
-- Plan: tasks/setter-tracker-plan.md. Every table here exists to make one person's pay provable.
-- The rule throughout: store FACTS and HUMAN DECISIONS, never derived pay. Pay is recomputed
-- from these on every read, except where a month has been CLOSED, which freezes it on purpose.
--
-- Additive and idempotent: new tables, one new nullable column, one seed that only inserts
-- where absent. Nothing existing is modified or deleted. Safe to re-run.

-- ── 1. A copy of booked-call appointments that REMEMBERS cancellations ───────────────────────
-- `calls` skips cancelled appointments entirely, so it cannot show "cancelled, -$25". This keeps
-- every appointment on a booked-call calendar, including ones later cancelled, deleted or moved.
CREATE TABLE IF NOT EXISTS ghl_appointments (
  id                   text PRIMARY KEY,
  contact_id           text,
  calendar_id          text NOT NULL,
  calendar_name        text,
  assigned_user_id     text,
  created_by_source    text,
  created_by_user_id   text,
  date_added           timestamptz,
  start_time           timestamptz NOT NULL,
  status               text NOT NULL,
  cancelled_seen_at    timestamptz,
  deleted_at           timestamptz,
  moved_to_calendar_id text,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ghl_appointments_contact_idx ON ghl_appointments (contact_id);
CREATE INDEX IF NOT EXISTS ghl_appointments_start_idx ON ghl_appointments (start_time);

-- ── 2. Human decisions about who booked a call ───────────────────────────────────────────────
-- Append-only: the latest row per (appointment or manual row, setter) wins, and every earlier
-- decision stays as the audit trail. `claim` = "this is mine", `reject` = "this is not mine"
-- (or an admin settling a clash). A manual row with no appointment carries its own details.
CREATE TABLE IF NOT EXISTS tracker_credit_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  text,
  manual_row_id   uuid,
  setter_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision        text NOT NULL CHECK (decision IN ('claim', 'reject')),
  contact_id      text,
  contact_name    text,
  company_name    text,
  booked_at       timestamptz,
  call_at         timestamptz,
  decided_by      uuid NOT NULL REFERENCES users(id),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (appointment_id IS NOT NULL OR manual_row_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tracker_credit_decisions_appt_idx ON tracker_credit_decisions (appointment_id);
CREATE INDEX IF NOT EXISTS tracker_credit_decisions_setter_idx ON tracker_credit_decisions (setter_user_id);

-- ── 3. Did the call happen? Supersedable, authored, tied to the start time it refers to ─────
-- `call_dispositions` is first-write-wins and unauthored, so a rescheduled call could never be
-- corrected and anyone could mark a call as held. An outcome here counts only while
-- `for_start_time` equals the appointment's CURRENT start, so moving a call re-opens it.
CREATE TABLE IF NOT EXISTS tracker_call_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_ref         text NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('held', 'no_show')),
  for_start_time  timestamptz NOT NULL,
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracker_call_outcomes_ref_idx ON tracker_call_outcomes (row_ref);

-- Who wrote a dashboard disposition. Set from the session by the outcome route from now on.
-- Null on every existing row, which were all written before the tracker existed.
ALTER TABLE call_dispositions ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- ── 4. The three numbers at the top of each month ───────────────────────────────────────────
-- "From this month on": the values for month M are the latest row with month <= M. A NULL base
-- pay means "not set", which the screen says out loud rather than showing $0.
CREATE TABLE IF NOT EXISTS tracker_month_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month                text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  base_pay_cents       integer,
  booking_bonus_cents  integer NOT NULL DEFAULT 0,
  commission_pct       double precision NOT NULL DEFAULT 0,
  edited_fields        text[] NOT NULL DEFAULT '{}',
  edited_by            uuid REFERENCES users(id),
  edited_at            timestamptz,
  UNIQUE (user_id, month)
);

-- ── 5. Cell overrides and notes. Append-only; the latest per (person, row, field) wins ──────
CREATE TABLE IF NOT EXISTS tracker_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  row_key          text NOT NULL,
  field            text NOT NULL,
  value            jsonb,
  edited_by        uuid NOT NULL REFERENCES users(id),
  edited_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracker_overrides_subject_idx ON tracker_overrides (subject_user_id, row_key, field);

-- ── 6. Month close: once closed, a month's pay never changes ─────────────────────────────────
CREATE TABLE IF NOT EXISTS tracker_month_closes (
  month      text PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closed_by  uuid NOT NULL REFERENCES users(id),
  closed_at  timestamptz NOT NULL DEFAULT now()
);

-- What was actually settled for each money line, and in which month's pay. A later change shows
-- as (live amount - everything already settled for it) in the current open month. `row_key` is
-- the money line; `row_ref` is the booking or deal it belongs to, so a line that later disappears
-- can still be shown against its row. No cascade on the person: paid history is never deleted.
CREATE TABLE IF NOT EXISTS tracker_settled_rows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  row_key            text NOT NULL,
  row_ref            text NOT NULL,
  settled_in_month   text NOT NULL,
  bonus_cents        integer NOT NULL DEFAULT 0,
  commission_cents   integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, row_key, settled_in_month)
);

-- ── 7. Baseline month settings, from today's team settings ──────────────────────────────────
-- One row per user at 2000-01, so every month resolves to a real row and changing a default in
-- team settings later can never silently rewrite a past month. Setters start at $25 per booked
-- call, the figure in Kelsey's workbook. Base pay 0 means "never set", stored as NULL.
INSERT INTO tracker_month_settings (user_id, month, base_pay_cents, booking_bonus_cents, commission_pct)
SELECT u.id, '2000-01',
       NULLIF(u.base_pay_cents, 0),
       CASE WHEN u.role = 'setter' THEN 2500 ELSE 0 END,
       u.commission_pct
  FROM users u
ON CONFLICT (user_id, month) DO NOTHING;
