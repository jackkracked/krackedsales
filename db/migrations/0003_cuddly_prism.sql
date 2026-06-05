CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"user_email" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_name" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_event_id" text NOT NULL,
	"contact_id" text,
	"contact_name" text,
	"rep_email" text,
	"outcome" text NOT NULL,
	"notes" text,
	"dispositioned_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "call_dispositions_calendar_event_id_unique" UNIQUE("calendar_event_id")
);
--> statement-breakpoint
CREATE TABLE "dashboard_kpi_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"selected_keys" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_kpi_prefs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "ghl_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"status" text NOT NULL,
	"total_records" integer,
	"synced_records" integer,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "local_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" text,
	"first_name" text,
	"last_name" text,
	"full_name" text,
	"email" text,
	"phone" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"source" text,
	"assigned_user_id" text,
	"custom_fields" jsonb DEFAULT '[]'::jsonb,
	"address" text,
	"city" text,
	"state" text,
	"country" text,
	"company_name" text,
	"website" text,
	"dnd" boolean DEFAULT false,
	"raw_data" jsonb,
	"created_at_ghl" timestamp,
	"updated_at_ghl" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"last_message_body" text,
	"last_message_date" timestamp,
	"unread_count" integer DEFAULT 0,
	"type" text,
	"assigned_to" text,
	"inbox" boolean DEFAULT true,
	"starred" boolean DEFAULT false,
	"raw_data" jsonb,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text,
	"direction" text,
	"type" text,
	"body" text,
	"subject" text,
	"status" text,
	"source" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"raw_data" jsonb,
	"message_date" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"pipeline_id" text,
	"pipeline_stage_id" text,
	"pipeline_name" text,
	"stage_name" text,
	"name" text,
	"status" text,
	"monetary_value" double precision,
	"assigned_to" text,
	"source" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"contact_tags" jsonb DEFAULT '[]'::jsonb,
	"contact_company_name" text,
	"contact_date_added" timestamp,
	"last_stage_change_at" timestamp,
	"raw_data" jsonb,
	"created_at_ghl" timestamp,
	"updated_at_ghl" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"content" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"node_name" text,
	"status" text NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"error" text,
	"duration_ms" integer,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"trigger_event" text NOT NULL,
	"trigger_data" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "workflow_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_webhooks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"listen_mode" boolean DEFAULT false NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"viewport" jsonb,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_insights" ADD COLUMN "suggested_outcome" text;--> statement-breakpoint
ALTER TABLE "call_insights" ADD COLUMN "suggested_notes" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "fathom_recording_id" integer;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "fathom_summary" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "fathom_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "fathom_share_url" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "signer_title" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "additional_rates" text;--> statement-breakpoint
ALTER TABLE "rep_targets" ADD COLUMN "demos_per_month" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "opportunity_name" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "user_name" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_calendars" ADD COLUMN "conflict_calendar_id" text DEFAULT 'primary';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fathom_api_key" text;--> statement-breakpoint
ALTER TABLE "dashboard_kpi_prefs" ADD CONSTRAINT "dashboard_kpi_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summaries" ADD CONSTRAINT "weekly_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_logs" ADD CONSTRAINT "workflow_run_logs_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_webhooks" ADD CONSTRAINT "workflow_webhooks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_fathom_recording_id_unique" UNIQUE("fathom_recording_id");