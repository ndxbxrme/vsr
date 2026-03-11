CREATE TABLE "lettings_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"lettings_case_id" uuid NOT NULL,
	"contact_id" uuid,
	"monthly_rent_offered" integer,
	"status" text DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"notes" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lettings_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"monthly_rent" integer,
	"deposit_amount" integer,
	"letting_status" text DEFAULT 'application' NOT NULL,
	"agreed_at" timestamp with time zone,
	"move_in_at" timestamp with time zone,
	"agreed_let_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lettings_applications" ADD CONSTRAINT "lettings_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettings_applications" ADD CONSTRAINT "lettings_applications_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettings_applications" ADD CONSTRAINT "lettings_applications_lettings_case_id_lettings_cases_id_fk" FOREIGN KEY ("lettings_case_id") REFERENCES "public"."lettings_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettings_applications" ADD CONSTRAINT "lettings_applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettings_cases" ADD CONSTRAINT "lettings_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettings_cases" ADD CONSTRAINT "lettings_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lettings_applications_tenant_case_idx" ON "lettings_applications" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "lettings_applications_tenant_status_idx" ON "lettings_applications" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lettings_cases_case_idx" ON "lettings_cases" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "lettings_cases_tenant_status_idx" ON "lettings_cases" USING btree ("tenant_id","letting_status");