CREATE TABLE "file_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_object_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_file_object_id_file_objects_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "file_attachments_tenant_file_entity_idx" ON "file_attachments" USING btree ("tenant_id","file_object_id","entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "file_attachments_tenant_entity_idx" ON "file_attachments" USING btree ("tenant_id","entity_type","entity_id");
