CREATE TABLE "case_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" uuid,
	"note_type" text DEFAULT 'internal' NOT NULL,
	"body" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"contact_id" uuid,
	"party_role" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"property_id" uuid,
	"case_type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reference" text,
	"title" text NOT NULL,
	"description" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"contact_type" text DEFAULT 'person' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"organization_name" text,
	"primary_email" text,
	"primary_phone" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"current_workflow_stage_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_template_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"stage_order" integer NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"config_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"case_type" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"definition_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_transition_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"from_workflow_stage_id" uuid,
	"to_workflow_stage_id" uuid,
	"actor_user_id" uuid,
	"transition_key" text NOT NULL,
	"summary" text NOT NULL,
	"metadata_json" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_current_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("current_workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_from_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("from_workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_to_workflow_stage_id_workflow_stages_id_fk" FOREIGN KEY ("to_workflow_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_notes_tenant_case_idx" ON "case_notes" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "case_parties_tenant_case_idx" ON "case_parties" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "case_parties_tenant_contact_idx" ON "case_parties" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "cases_tenant_type_status_idx" ON "cases" USING btree ("tenant_id","case_type","status");--> statement-breakpoint
CREATE INDEX "cases_tenant_property_idx" ON "cases" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_tenant_reference_idx" ON "cases" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX "contacts_tenant_status_idx" ON "contacts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "contacts_tenant_name_idx" ON "contacts" USING btree ("tenant_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_case_idx" ON "workflow_instances" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_tenant_status_idx" ON "workflow_instances" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_template_key_idx" ON "workflow_stages" USING btree ("workflow_template_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_template_order_idx" ON "workflow_stages" USING btree ("workflow_template_id","stage_order");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_tenant_key_idx" ON "workflow_templates" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "workflow_transition_events_tenant_case_occurred_idx" ON "workflow_transition_events" USING btree ("tenant_id","case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "workflow_transition_events_instance_idx" ON "workflow_transition_events" USING btree ("workflow_instance_id");
