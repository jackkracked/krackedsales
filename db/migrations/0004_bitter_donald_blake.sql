CREATE TABLE "call_preps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_event_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"contact_name" text,
	"call_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sections" jsonb,
	"failed_sections" jsonb DEFAULT '[]'::jsonb,
	"generated_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "call_preps_calendar_event_id_unique" UNIQUE("calendar_event_id")
);
--> statement-breakpoint
CREATE TABLE "kpi_health_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_key" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"value" double precision,
	"source_status" text NOT NULL,
	"error_message" text,
	"response_time_ms" integer,
	"source_system" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_overrides" ADD COLUMN "note" text;