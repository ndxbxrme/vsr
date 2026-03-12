DROP INDEX IF EXISTS "external_references_provider_entity_external_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "external_references_provider_entity_external_idx"
ON "external_references" USING btree ("tenant_id","provider","entity_type","external_type","external_id");
