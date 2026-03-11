CREATE TABLE "sales_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"asking_price" integer,
	"agreed_price" integer,
	"sale_status" text DEFAULT 'instruction' NOT NULL,
	"memorandum_sent_at" timestamp with time zone,
	"target_exchange_at" timestamp with time zone,
	"target_completion_at" timestamp with time zone,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"sales_case_id" uuid NOT NULL,
	"contact_id" uuid,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"notes" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_cases" ADD CONSTRAINT "sales_cases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_cases" ADD CONSTRAINT "sales_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_offers" ADD CONSTRAINT "sales_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_offers" ADD CONSTRAINT "sales_offers_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_offers" ADD CONSTRAINT "sales_offers_sales_case_id_sales_cases_id_fk" FOREIGN KEY ("sales_case_id") REFERENCES "public"."sales_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_offers" ADD CONSTRAINT "sales_offers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_cases_case_idx" ON "sales_cases" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "sales_cases_tenant_status_idx" ON "sales_cases" USING btree ("tenant_id","sale_status");--> statement-breakpoint
CREATE INDEX "sales_offers_tenant_case_idx" ON "sales_offers" USING btree ("tenant_id","case_id");--> statement-breakpoint
CREATE INDEX "sales_offers_tenant_status_idx" ON "sales_offers" USING btree ("tenant_id","status");