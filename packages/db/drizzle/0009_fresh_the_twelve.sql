CREATE TABLE "communication_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"template_type" text NOT NULL,
	"template_id" uuid NOT NULL,
	"sent_by_user_id" uuid,
	"recipient_name" text,
	"recipient_email" text,
	"recipient_phone" text,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"metadata_json" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"subject_template" text NOT NULL,
	"body_text_template" text NOT NULL,
	"body_html_template" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"body_template" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_dispatches" ADD CONSTRAINT "communication_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_dispatches" ADD CONSTRAINT "communication_dispatches_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_dispatches" ADD CONSTRAINT "communication_dispatches_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communication_dispatches_tenant_case_idx" ON "communication_dispatches" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "communication_dispatches_tenant_status_idx" ON "communication_dispatches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_tenant_key_idx" ON "email_templates" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_templates_tenant_key_idx" ON "sms_templates" USING btree ("tenant_id","key");