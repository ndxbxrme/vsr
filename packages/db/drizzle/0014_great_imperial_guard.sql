CREATE TABLE "workflow_stage_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"legacy_action_id" text,
	"action_order" integer DEFAULT 0 NOT NULL,
	"trigger_on" text DEFAULT 'Complete' NOT NULL,
	"action_type" text NOT NULL,
	"name" text,
	"template_reference" text,
	"target_legacy_stage_id" text,
	"target_workflow_stage_id" uuid,
	"recipient_groups_json" jsonb,
	"specific_user_reference" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stage_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"from_workflow_stage_id" uuid,
	"to_workflow_stage_id" uuid NOT NULL,
	"edge_type" text DEFAULT 'trigger' NOT NULL,
	"trigger_on" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "workflow_templates_tenant_key_idx";--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD COLUMN "legacy_stage_id" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "side" text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "version_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "is_active_version" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "previous_workflow_template_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_stage_actions" ADD CONSTRAINT "workflow_stage_actions_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_actions" ADD CONSTRAINT "workflow_stage_actions_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_actions" ADD CONSTRAINT "workflow_stage_actions_target_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("target_workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_edges" ADD CONSTRAINT "workflow_stage_edges_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_edges" ADD CONSTRAINT "workflow_stage_edges_from_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("from_workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_edges" ADD CONSTRAINT "workflow_stage_edges_to_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("to_workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_stage_actions_template_stage_idx" ON "workflow_stage_actions" USING btree ("workflow_template_id","workflow_stage_id","action_order");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stage_edges_unique_idx" ON "workflow_stage_edges" USING btree ("workflow_template_id","from_workflow_stage_id","to_workflow_stage_id","edge_type","trigger_on");--> statement-breakpoint
CREATE INDEX "workflow_stage_edges_template_idx" ON "workflow_stage_edges" USING btree ("workflow_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_tenant_key_version_idx" ON "workflow_templates" USING btree ("tenant_id","key","version_number");--> statement-breakpoint
CREATE INDEX "workflow_templates_tenant_active_idx" ON "workflow_templates" USING btree ("tenant_id","case_type","is_active_version","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_templates_previous_idx" ON "workflow_templates" USING btree ("previous_workflow_template_id");--> statement-breakpoint
CREATE INDEX "workflow_templates_tenant_key_idx" ON "workflow_templates" USING btree ("tenant_id","key");