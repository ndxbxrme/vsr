CREATE TABLE "workflow_delay_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"workflow_stage_id" uuid,
	"requested_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"workflow_track" text NOT NULL,
	"date_field" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"review_note" text,
	"old_target_at" timestamp with time zone,
	"requested_target_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_delay_requests" ADD CONSTRAINT "workflow_delay_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delay_requests" ADD CONSTRAINT "workflow_delay_requests_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delay_requests" ADD CONSTRAINT "workflow_delay_requests_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delay_requests" ADD CONSTRAINT "workflow_delay_requests_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delay_requests" ADD CONSTRAINT "workflow_delay_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_delay_requests" ADD CONSTRAINT "workflow_delay_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_delay_requests_tenant_case_idx" ON "workflow_delay_requests" USING btree ("tenant_id","case_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_delay_requests_tenant_status_idx" ON "workflow_delay_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "workflow_delay_requests_instance_idx" ON "workflow_delay_requests" USING btree ("workflow_instance_id","created_at");