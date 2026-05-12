CREATE TABLE "ab_test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ab_group" text NOT NULL,
	"winner_template_id" uuid,
	"loser_template_id" uuid,
	"winner_sends" integer NOT NULL,
	"winner_responses" integer NOT NULL,
	"loser_sends" integer NOT NULL,
	"loser_responses" integer NOT NULL,
	"winner_rate" numeric(5, 4),
	"loser_rate" numeric(5, 4),
	"chi_square" numeric(8, 4),
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ghl_calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"trigger" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"stage_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_categories" (
	"domain" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"reason" text,
	"analyzed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"contact_id" text,
	"wants_text" text,
	"objections_text" text,
	"next_steps_text" text,
	"red_flags_text" text,
	"sentiment_score" integer,
	"sentiment_label" text,
	"analyzed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_type" text NOT NULL,
	"direction" text,
	"contact_id" text,
	"contact_name" text,
	"rep_email" text,
	"rep_name" text,
	"started_at" timestamp NOT NULL,
	"duration_seconds" integer,
	"meet_conference_id" text,
	"meet_space_id" text,
	"transcript_available" boolean DEFAULT false NOT NULL,
	"transcript_text" text,
	"transcript_stored_at" timestamp,
	"smart_notes_url" text,
	"ghl_message_id" text,
	"ghl_conversation_id" text,
	"recording_available" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "calls_meet_conference_id_unique" UNIQUE("meet_conference_id"),
	CONSTRAINT "calls_ghl_message_id_unique" UNIQUE("ghl_message_id")
);
--> statement-breakpoint
CREATE TABLE "contact_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_uid" text NOT NULL,
	"field_name" text NOT NULL,
	"field_value" text DEFAULT '',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_per_email" double precision DEFAULT 0 NOT NULL,
	"cost_per_audit" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_current_stage_times" (
	"clickup_task_id" text PRIMARY KEY NOT NULL,
	"stage_name" text NOT NULL,
	"minutes_in_stage" integer NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_ghl_links" (
	"clickup_task_id" text PRIMARY KEY NOT NULL,
	"ghl_contact_id" text,
	"date_sent_at" timestamp,
	"first_call_at" timestamp,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_sent_dates" (
	"clickup_task_id" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_stage_totals" (
	"task_stage_key" text PRIMARY KEY NOT NULL,
	"clickup_task_id" text NOT NULL,
	"stage_name" text NOT NULL,
	"minutes_total" integer NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"copy_days" integer DEFAULT 2 NOT NULL,
	"design_days" integer DEFAULT 5 NOT NULL,
	"copy_rev_days" integer DEFAULT 2 NOT NULL,
	"design_rev_days" integer DEFAULT 2 NOT NULL,
	"internal_qa_days" integer DEFAULT 1 NOT NULL,
	"fulfillment_days" integer DEFAULT 7 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"opp_id" text NOT NULL,
	"stage_name" text NOT NULL,
	"type" text NOT NULL,
	"reasoning" text NOT NULL,
	"messages_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skipped_until" timestamp,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"acted_on_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "meta_pages" (
	"page_id" text PRIMARY KEY NOT NULL,
	"page_name" text NOT NULL,
	"page_avatar" text,
	"page_access_token" text NOT NULL,
	"instagram_account_id" text,
	"instagram_handle" text,
	"instagram_avatar" text,
	"connected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"entity_id" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"replied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rep_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deals_per_month" integer DEFAULT 5 NOT NULL,
	"calls_per_day" integer DEFAULT 15 NOT NULL,
	"revenue_target" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rep_targets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monthly_cost" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiktok_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_id" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"business_access_token" text,
	"advertiser_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rep_name" text NOT NULL,
	"rep_email" text NOT NULL,
	"ghl_calendar_id" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_calendars_rep_email_unique" UNIQUE("rep_email")
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ghl_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "followup_sends" ALTER COLUMN "followup_contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "followup_sends" ALTER COLUMN "template_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_leads" ADD COLUMN "contacted_at" timestamp;--> statement-breakpoint
ALTER TABLE "comment_leads" ADD COLUMN "demo_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "followup_sends" ADD COLUMN "opp_id" text;--> statement-breakpoint
ALTER TABLE "followup_sends" ADD COLUMN "stage_name" text;--> statement-breakpoint
ALTER TABLE "followup_sends" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "followup_sends" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "followup_sends" ADD COLUMN "sent_at_actual" timestamp;--> statement-breakpoint
ALTER TABLE "slack_settings" ADD COLUMN "bot_user_id" text;--> statement-breakpoint
ALTER TABLE "slack_settings" ADD COLUMN "demo_webhook_url" text;--> statement-breakpoint
ALTER TABLE "ab_test_results" ADD CONSTRAINT "ab_test_results_winner_template_id_reply_templates_id_fk" FOREIGN KEY ("winner_template_id") REFERENCES "public"."reply_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_test_results" ADD CONSTRAINT "ab_test_results_loser_template_id_reply_templates_id_fk" FOREIGN KEY ("loser_template_id") REFERENCES "public"."reply_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_insights" ADD CONSTRAINT "call_insights_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rep_targets" ADD CONSTRAINT "rep_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;