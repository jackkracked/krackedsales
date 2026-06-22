-- Demo Boards: branded hosted demo board per prospect (replaces the bare Miro board).
-- Additive + idempotent: safe to run against prod directly.

CREATE TABLE IF NOT EXISTS "demo_boards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "token" text NOT NULL UNIQUE,
  "slug" text NOT NULL,
  "reference_code" text NOT NULL,
  "clickup_task_id" text,
  "ghl_contact_id" text,
  "contact_name" text NOT NULL,
  "contact_email" text,
  "rep_id" uuid REFERENCES "users"("id"),
  "designer_id" uuid REFERENCES "users"("id"),
  "title" text,
  "built_on" text,
  "status" text NOT NULL DEFAULT 'awaiting_design',
  "sent_channel" text,
  "sent_at" timestamptz,
  "first_opened_at" timestamptz,
  "booked_at" timestamptz,
  "last_activity_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "demo_boards_status_idx" ON "demo_boards" ("status");
CREATE INDEX IF NOT EXISTS "demo_boards_rep_idx" ON "demo_boards" ("rep_id");
CREATE INDEX IF NOT EXISTS "demo_boards_clickup_task_idx" ON "demo_boards" ("clickup_task_id");

CREATE TABLE IF NOT EXISTS "demo_board_designs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "board_id" uuid NOT NULL REFERENCES "demo_boards"("id") ON DELETE CASCADE,
  "blob_url" text NOT NULL,
  "mime_type" text,
  "width" integer,
  "height" integer,
  "version" integer NOT NULL DEFAULT 1,
  "uploaded_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "demo_board_designs_board_idx" ON "demo_board_designs" ("board_id");

CREATE TABLE IF NOT EXISTS "demo_board_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "board_id" uuid NOT NULL REFERENCES "demo_boards"("id") ON DELETE CASCADE,
  "design_id" uuid REFERENCES "demo_board_designs"("id") ON DELETE SET NULL,
  "parent_id" uuid,
  "x" double precision,
  "y" double precision,
  "body" text NOT NULL,
  "author_type" text NOT NULL,
  "author_id" uuid REFERENCES "users"("id"),
  "author_name" text,
  "visibility" text NOT NULL DEFAULT 'shared',
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "demo_board_comments_board_idx" ON "demo_board_comments" ("board_id");

CREATE TABLE IF NOT EXISTS "demo_board_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "board_id" uuid NOT NULL REFERENCES "demo_boards"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "actor" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "demo_board_events_board_idx" ON "demo_board_events" ("board_id");
CREATE INDEX IF NOT EXISTS "demo_board_events_type_idx" ON "demo_board_events" ("type");
