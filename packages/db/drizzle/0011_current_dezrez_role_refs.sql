ALTER TABLE "external_references" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "external_references" ADD COLUMN "superseded_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "external_references"
SET "is_current" = false,
    "updated_at" = now()
WHERE "provider" = 'dezrez'
  AND "entity_type" = 'property'
  AND "external_type" <> 'property_role';
--> statement-breakpoint
WITH ranked_role_refs AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "entity_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS "rank"
  FROM "external_references"
  WHERE "provider" = 'dezrez'
    AND "entity_type" = 'property'
    AND "external_type" = 'property_role'
)
UPDATE "external_references" AS "er"
SET "is_current" = "ranked_role_refs"."rank" = 1,
    "superseded_at" = CASE
      WHEN "ranked_role_refs"."rank" = 1 THEN NULL
      ELSE coalesce("er"."superseded_at", "er"."updated_at", "er"."created_at", now())
    END,
    "updated_at" = now()
FROM "ranked_role_refs"
WHERE "er"."id" = "ranked_role_refs"."id";
--> statement-breakpoint
INSERT INTO "external_references" (
  "tenant_id",
  "provider",
  "entity_type",
  "entity_id",
  "external_type",
  "external_id",
  "metadata_json",
  "is_current",
  "last_seen_at",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON ("er"."tenant_id", "er"."entity_id")
  "er"."tenant_id",
  'dezrez',
  'property',
  "er"."entity_id",
  'property',
  "er"."metadata_json" ->> 'propertyId',
  jsonb_build_object(
    'propertyId', "er"."metadata_json" ->> 'propertyId',
    'displayAddress', "er"."metadata_json" ->> 'displayAddress'
  ),
  true,
  "er"."last_seen_at",
  now(),
  now()
FROM "external_references" AS "er"
WHERE "er"."provider" = 'dezrez'
  AND "er"."entity_type" = 'property'
  AND "er"."external_type" = 'property_role'
  AND "er"."metadata_json" ->> 'propertyId' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "external_references" AS "existing"
    WHERE "existing"."tenant_id" = "er"."tenant_id"
      AND "existing"."provider" = 'dezrez'
      AND "existing"."entity_type" = 'property'
      AND "existing"."external_type" = 'property'
      AND "existing"."external_id" = "er"."metadata_json" ->> 'propertyId'
  )
ORDER BY "er"."tenant_id", "er"."entity_id", "er"."updated_at" DESC, "er"."created_at" DESC, "er"."id" DESC;
--> statement-breakpoint
CREATE INDEX "external_references_property_current_idx" ON "external_references" USING btree ("tenant_id","provider","entity_type","entity_id","external_type","is_current");
--> statement-breakpoint
CREATE UNIQUE INDEX "external_references_current_property_role_idx"
ON "external_references" USING btree ("tenant_id","entity_id")
WHERE "provider" = 'dezrez'
  AND "entity_type" = 'property'
  AND "external_type" = 'property_role'
  AND "is_current" = true;
