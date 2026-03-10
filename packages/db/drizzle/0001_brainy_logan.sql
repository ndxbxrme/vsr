DROP INDEX "external_references_provider_entity_external_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "integration_accounts_tenant_provider_idx" ON "integration_accounts" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "external_references_provider_entity_external_idx" ON "external_references" USING btree ("tenant_id","provider","entity_type","external_id");