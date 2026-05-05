CREATE TABLE "comment_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"comment_text" text NOT NULL,
	"keyword" text NOT NULL,
	"comment_id" text,
	"post_id" text,
	"commenter_id" text,
	"email" text,
	"phone" text,
	"website" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"source_handle" text,
	"target_handle" text,
	"label" text,
	"branch_type" text
);
--> statement-breakpoint
CREATE TABLE "flow_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"ghl_conversation_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"demo_name" text,
	"platform" text,
	"demo_sent_at" timestamp NOT NULL,
	"last_response_at" timestamp,
	"is_converted" boolean DEFAULT false NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "followup_contacts_ghl_contact_id_unique" UNIQUE("ghl_contact_id")
);
--> statement-breakpoint
CREATE TABLE "followup_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"followup_contact_id" uuid NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"ghl_message_id" text,
	"message_text" text NOT NULL,
	"template_hash" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"resulted_in_response" boolean DEFAULT false NOT NULL,
	"resulted_in_conversion" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keyword_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_triggers_keyword_unique" UNIQUE("keyword")
);
--> statement-breakpoint
CREATE TABLE "kpi_card_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section" text NOT NULL,
	"card_key" text NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_key" text NOT NULL,
	"period" text NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"body_template" text NOT NULL,
	"channel" text NOT NULL,
	"times_sent" integer DEFAULT 0 NOT NULL,
	"times_responded" integer DEFAULT 0 NOT NULL,
	"times_converted" integer DEFAULT 0 NOT NULL,
	"response_rate" numeric(5, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text,
	"pipeline_id" text,
	"stage_id" text NOT NULL,
	"stage_name" text NOT NULL,
	"entered_at" timestamp NOT NULL,
	"source" text DEFAULT 'webhook' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ab_group" text,
	"weight" integer DEFAULT 100 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bot_token" text,
	"signing_secret" text,
	"channel_id" text,
	"channel_name" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_date" timestamp,
	"contact_id" text,
	"contact_name" text,
	"opportunity_id" text,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"stage_reached" text,
	"converted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"responded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_nodes" ADD CONSTRAINT "flow_nodes_template_id_reply_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reply_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_sends" ADD CONSTRAINT "followup_sends_followup_contact_id_followup_contacts_id_fk" FOREIGN KEY ("followup_contact_id") REFERENCES "public"."followup_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_conversions" ADD CONSTRAINT "template_conversions_send_id_template_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."template_sends"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_responses" ADD CONSTRAINT "template_responses_send_id_template_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."template_sends"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_sends" ADD CONSTRAINT "template_sends_template_id_reply_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reply_templates"("id") ON DELETE no action ON UPDATE no action;