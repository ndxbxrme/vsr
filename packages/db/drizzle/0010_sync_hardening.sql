CREATE TABLE "property_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "integration_account_id" uuid NOT NULL,
  "trigger_source" text DEFAULT 'manual_api' NOT NULL,
  "sync_type" text DEFAULT 'full' NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "anomaly_status" text DEFAULT 'healthy' NOT NULL,
  "anomaly_reason" text,
  "property_count" integer DEFAULT 0 NOT NULL,
  "stale_candidate_count" integer DEFAULT 0 NOT NULL,
  "delisted_count" integer DEFAULT 0 NOT NULL,
  "metadata_json" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "sync_state" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "consecutive_miss_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "last_seen_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "last_seen_in_sync_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "missing_since_sync_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "stale_candidate_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "delisted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "delisted_reason" text;
--> statement-breakpoint
CREATE TABLE "property_sync_inventory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "sync_run_id" uuid NOT NULL,
  "property_id" uuid,
  "external_id" text NOT NULL,
  "provider_property_id" text,
  "display_address" text,
  "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_sync_runs" ADD CONSTRAINT "property_sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_sync_runs" ADD CONSTRAINT "property_sync_runs_integration_account_id_integration_accounts_id_fk" FOREIGN KEY ("integration_account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_sync_inventory" ADD CONSTRAINT "property_sync_inventory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_sync_inventory" ADD CONSTRAINT "property_sync_inventory_sync_run_id_property_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."property_sync_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_sync_inventory" ADD CONSTRAINT "property_sync_inventory_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "property_sync_runs_tenant_started_idx" ON "property_sync_runs" USING btree ("tenant_id","started_at");
--> statement-breakpoint
CREATE INDEX "property_sync_runs_integration_started_idx" ON "property_sync_runs" USING btree ("integration_account_id","started_at");
--> statement-breakpoint
CREATE INDEX "properties_tenant_sync_state_idx" ON "properties" USING btree ("tenant_id","sync_state");
--> statement-breakpoint
CREATE UNIQUE INDEX "property_sync_inventory_run_external_idx" ON "property_sync_inventory" USING btree ("sync_run_id","external_id");
--> statement-breakpoint
CREATE INDEX "property_sync_inventory_run_property_idx" ON "property_sync_inventory" USING btree ("sync_run_id","provider_property_id");
