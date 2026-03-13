ALTER TABLE "cases" ADD COLUMN "owner_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_owner_membership_id_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_tenant_owner_idx" ON "cases" USING btree ("tenant_id","owner_membership_id");--> statement-breakpoint
