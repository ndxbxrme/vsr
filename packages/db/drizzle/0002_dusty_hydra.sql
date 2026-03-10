CREATE TABLE "integration_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"integration_account_id" uuid,
	"webhook_event_id" uuid,
	"provider" text NOT NULL,
	"job_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_external_id" text,
	"dedupe_key" text NOT NULL,
	"payload_json" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_integration_account_id_integration_accounts_id_fk" FOREIGN KEY ("integration_account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_jobs" ADD CONSTRAINT "integration_jobs_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_jobs_provider_dedupe_idx" ON "integration_jobs" USING btree ("provider","dedupe_key");--> statement-breakpoint
CREATE INDEX "integration_jobs_status_idx" ON "integration_jobs" USING btree ("status","available_at");