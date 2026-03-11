CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"property_role_external_id" text,
	"applicant_name" text,
	"applicant_email" text,
	"applicant_grade" text,
	"amount" integer,
	"status" text,
	"offered_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"property_role_external_id" text,
	"applicant_name" text,
	"applicant_email" text,
	"applicant_grade" text,
	"event_status" text,
	"feedback_count" integer DEFAULT 0 NOT NULL,
	"notes_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewings" ADD CONSTRAINT "viewings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_provider_external_idx" ON "offers" USING btree ("tenant_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "offers_tenant_property_idx" ON "offers" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "viewings_provider_external_idx" ON "viewings" USING btree ("tenant_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "viewings_tenant_property_idx" ON "viewings" USING btree ("tenant_id","property_id");