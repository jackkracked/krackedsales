ALTER TABLE "proposals" ADD COLUMN "lost_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "lost_by" text;