import { and, eq, sql } from 'drizzle-orm';
import { createDbClient, schema } from '../packages/db/src/index.ts';

type PropertyRow = typeof schema.properties.$inferSelect;
type ExternalReferenceRow = typeof schema.externalReferences.$inferSelect;

type DuplicateMember = {
  property: PropertyRow;
  reference: ExternalReferenceRow;
  providerPropertyId: string;
};

function isPlaceholderAddress(value: string) {
  return /^Property \d+$/.test(value.trim());
}

function scoreDuplicateMember(member: DuplicateMember) {
  let score = 0;

  if (!isPlaceholderAddress(member.property.displayAddress)) {
    score += 1000;
  }

  if (member.property.postcode) {
    score += 100;
  }

  if (member.property.marketingStatus) {
    score += 25;
  }

  score += Math.min(member.property.displayAddress.length, 100);

  return score;
}

function pickCanonicalMember(members: DuplicateMember[]) {
  return [...members].sort((left, right) => {
    const scoreDifference = scoreDuplicateMember(right) - scoreDuplicateMember(left);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    const createdDifference =
      new Date(left.property.createdAt).valueOf() - new Date(right.property.createdAt).valueOf();
    if (createdDifference !== 0) {
      return createdDifference;
    }

    return left.property.id.localeCompare(right.property.id);
  })[0];
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';
  const apply = process.argv.includes('--apply');
  const { db, client } = createDbClient(databaseUrl);

  try {
    const duplicateProviderPropertyIds = await db.execute(sql`
      select
        tenant_id,
        metadata_json ->> 'propertyId' as provider_property_id,
        count(*)::int as count
      from external_references
      where provider = 'dezrez'
        and entity_type = 'property'
        and metadata_json ->> 'propertyId' is not null
      group by tenant_id, metadata_json ->> 'propertyId'
      having count(*) > 1
      order by count(*) desc, provider_property_id
    `);

    const summaries: Array<Record<string, unknown>> = [];

    for (const duplicateGroup of duplicateProviderPropertyIds as Array<{
      tenant_id: string;
      provider_property_id: string;
      count: number;
    }>) {
      const references = await db.execute(sql`
        select
          p.*,
          er.id as reference_id,
          er.external_id,
          er.external_type,
          er.metadata_json,
          er.created_at as reference_created_at,
          er.updated_at as reference_updated_at,
          er.last_seen_at
        from properties p
        join external_references er
          on er.entity_id = p.id
         and er.entity_type = 'property'
         and er.provider = 'dezrez'
        where er.tenant_id = ${duplicateGroup.tenant_id}
          and er.metadata_json ->> 'propertyId' = ${duplicateGroup.provider_property_id}
        order by p.created_at, er.external_id
      `);

      const members = (references as Array<Record<string, unknown>>).map((row) => {
        const property = {
          id: row.id as string,
          tenantId: row.tenant_id as string,
          branchId: row.branch_id as string | null,
          displayAddress: row.display_address as string,
          postcode: row.postcode as string | null,
          status: row.status as string,
          marketingStatus: row.marketing_status as string | null,
          createdAt: row.created_at as Date,
          updatedAt: row.updated_at as Date,
        } satisfies PropertyRow;

        const reference = {
          id: row.reference_id as string,
          tenantId: row.tenant_id as string | null,
          provider: 'dezrez',
          entityType: 'property',
          entityId: row.id as string,
          externalType: row.external_type as string,
          externalId: row.external_id as string,
          metadataJson: row.metadata_json as Record<string, unknown> | null,
          lastSeenAt: row.last_seen_at as Date | null,
          createdAt: row.reference_created_at as Date,
          updatedAt: row.reference_updated_at as Date,
        } satisfies ExternalReferenceRow;

        return {
          property,
          reference,
          providerPropertyId: duplicateGroup.provider_property_id,
        } satisfies DuplicateMember;
      });

      const canonical = pickCanonicalMember(members);
      const duplicates = members.filter((member) => member.property.id !== canonical.property.id);

      summaries.push({
        tenantId: duplicateGroup.tenant_id,
        providerPropertyId: duplicateGroup.provider_property_id,
        canonicalPropertyId: canonical.property.id,
        canonicalDisplayAddress: canonical.property.displayAddress,
        duplicatePropertyIds: duplicates.map((member) => member.property.id),
        duplicateDisplayAddresses: duplicates.map((member) => member.property.displayAddress),
        duplicateExternalIds: duplicates.map((member) => member.reference.externalId),
      });

      if (!apply || duplicates.length === 0) {
        continue;
      }

      await db.transaction(async (tx) => {
        for (const duplicate of duplicates) {
          await tx
            .update(schema.cases)
            .set({ propertyId: canonical.property.id, updatedAt: new Date() })
            .where(eq(schema.cases.propertyId, duplicate.property.id));

          await tx
            .update(schema.offers)
            .set({ propertyId: canonical.property.id, updatedAt: new Date() })
            .where(eq(schema.offers.propertyId, duplicate.property.id));

          await tx
            .update(schema.viewings)
            .set({ propertyId: canonical.property.id, updatedAt: new Date() })
            .where(eq(schema.viewings.propertyId, duplicate.property.id));

          await tx
            .update(schema.timelineEvents)
            .set({ subjectId: canonical.property.id, updatedAt: new Date() })
            .where(
              and(
                eq(schema.timelineEvents.subjectType, 'property'),
                eq(schema.timelineEvents.subjectId, duplicate.property.id),
              ),
            );

          const duplicateFileAttachments = await tx
            .select()
            .from(schema.fileAttachments)
            .where(
              and(
                eq(schema.fileAttachments.entityType, 'property'),
                eq(schema.fileAttachments.entityId, duplicate.property.id),
              ),
            );

          for (const attachment of duplicateFileAttachments) {
            const [existingAttachment] = await tx
              .select()
              .from(schema.fileAttachments)
              .where(
                and(
                  eq(schema.fileAttachments.tenantId, attachment.tenantId),
                  eq(schema.fileAttachments.fileObjectId, attachment.fileObjectId),
                  eq(schema.fileAttachments.entityType, 'property'),
                  eq(schema.fileAttachments.entityId, canonical.property.id),
                ),
              )
              .limit(1);

            if (existingAttachment) {
              await tx.delete(schema.fileAttachments).where(eq(schema.fileAttachments.id, attachment.id));
            } else {
              await tx
                .update(schema.fileAttachments)
                .set({ entityId: canonical.property.id, updatedAt: new Date() })
                .where(eq(schema.fileAttachments.id, attachment.id));
            }
          }

          await tx
            .update(schema.auditLogs)
            .set({ entityId: canonical.property.id })
            .where(
              and(
                eq(schema.auditLogs.entityType, 'property'),
                eq(schema.auditLogs.entityId, duplicate.property.id),
              ),
            );

          await tx
            .update(schema.outboxEvents)
            .set({ entityId: canonical.property.id })
            .where(
              and(
                eq(schema.outboxEvents.entityType, 'property'),
                eq(schema.outboxEvents.entityId, duplicate.property.id),
              ),
            );

          await tx
            .update(schema.externalReferences)
            .set({
              entityId: canonical.property.id,
              updatedAt: new Date(),
            })
            .where(eq(schema.externalReferences.id, duplicate.reference.id));

          await tx.delete(schema.properties).where(eq(schema.properties.id, duplicate.property.id));
        }
      });
    }

    const afterCounts = apply
      ? await db.execute(sql`
          select
            count(*)::int as total_properties,
            count(distinct display_address)::int as distinct_addresses
          from properties
        `)
      : null;

    console.log(
      JSON.stringify(
        {
          apply,
          duplicateGroupCount: summaries.length,
          summaries,
          afterCounts: afterCounts ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
