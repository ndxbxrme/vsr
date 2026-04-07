CREATE TABLE "workflow_stage_runtimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"dependency_state" text DEFAULT 'pending' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"estimated_start_at" timestamp with time zone,
	"estimated_complete_at" timestamp with time zone,
	"target_start_at" timestamp with time zone,
	"target_complete_at" timestamp with time zone,
	"actual_started_at" timestamp with time zone,
	"actual_completed_at" timestamp with time zone,
	"schedule_source" text DEFAULT 'calculated' NOT NULL,
	"last_recalculated_at" timestamp with time zone,
	"manual_override_at" timestamp with time zone,
	"manual_override_reason" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_stage_runtimes" ADD CONSTRAINT "workflow_stage_runtimes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_runtimes" ADD CONSTRAINT "workflow_stage_runtimes_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_runtimes" ADD CONSTRAINT "workflow_stage_runtimes_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stage_runtimes_instance_stage_idx" ON "workflow_stage_runtimes" USING btree ("workflow_instance_id","workflow_stage_id");--> statement-breakpoint
CREATE INDEX "workflow_stage_runtimes_tenant_status_idx" ON "workflow_stage_runtimes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "workflow_stage_runtimes_tenant_current_idx" ON "workflow_stage_runtimes" USING btree ("tenant_id","is_current");