CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"property_role_external_id" text,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"actor_type" text DEFAULT 'external_system' NOT NULL,
	"metadata_json" jsonb,
	"raw_payload" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_subject_id_properties_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_events_provider_external_idx" ON "timeline_events" USING btree ("tenant_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "timeline_events_tenant_subject_occurred_idx" ON "timeline_events" USING btree ("tenant_id","subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_events_tenant_role_idx" ON "timeline_events" USING btree ("tenant_id","property_role_external_id");