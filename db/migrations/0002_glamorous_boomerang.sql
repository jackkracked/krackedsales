CREATE TABLE "agreement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_templates_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "commission_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_timing" text DEFAULT 'full_paid' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_index" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text,
	"contact_name" text,
	"body" text NOT NULL,
	"channel" text NOT NULL,
	"direction" text,
	"date_added" timestamp,
	"indexed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "proposal_instalments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"instalment_number" integer NOT NULL,
	"stripe_invoice_id" text,
	"stripe_hosted_url" text,
	"amount" double precision NOT NULL,
	"due_date" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text,
	"opportunity_id" text,
	"created_by" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_amount" double precision NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"service_description" text,
	"notes" text,
	"payment_structure" text NOT NULL,
	"billing_interval" text,
	"billing_interval_count" integer,
	"start_date" timestamp,
	"end_date" timestamp,
	"expires_at" timestamp,
	"stripe_invoice_id" text,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"stripe_hosted_url" text,
	"signed_at" timestamp,
	"signed_ip" text,
	"signature_data" text,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_customers_ghl_contact_id_unique" UNIQUE("ghl_contact_id"),
	CONSTRAINT "stripe_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "commission_pct" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_instalments" ADD CONSTRAINT "proposal_instalments_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;