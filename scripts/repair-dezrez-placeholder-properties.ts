import { config as loadDotEnv } from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { decryptJsonPayload } from '@vitalspace/auth';
import { createDbClient, schema } from '@vitalspace/db';
import {
  createDezrezClient,
  extractDezrezPropertyAddress,
  isPlaceholderPropertyDisplayAddress,
  normalizeDezrezPropertySummary,
} from '@vitalspace/integrations';

loadDotEnv({ path: new URL('../.env', import.meta.url).pathname });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('database_url_not_configured');
}

const encryptionKey = process.env.APP_ENCRYPTION_KEY ?? '';
if (encryptionKey.trim().length < 32) {
  throw new Error('app_encryption_key_not_configured');
}

async function main() {
  const client = createDbClient(connectionString);

  try {
    const placeholders = await client.db
      .select({
        propertyId: schema.properties.id,
        tenantId: schema.properties.tenantId,
        currentRoleExternalId: schema.externalReferences.externalId,
        stablePropertyExternalId: sql<string | null>`(
          SELECT er.external_id
          FROM external_references er
          WHERE er.tenant_id = ${schema.properties.tenantId}
            AND er.entity_id = ${schema.properties.id}
            AND er.provider = 'dezrez'
            AND er.entity_type = 'property'
            AND er.external_type = 'property'
          ORDER BY er.updated_at DESC
          LIMIT 1
        )`,
        integrationAccountId: sql<string | null>`(
          SELECT ia.id
          FROM integration_accounts ia
          WHERE ia.tenant_id = ${schema.properties.tenantId}
            AND ia.provider = 'dezrez'
            AND ia.status = 'active'
          ORDER BY ia.updated_at DESC
          LIMIT 1
        )`,
      })
      .from(schema.properties)
      .innerJoin(
        schema.externalReferences,
        and(
          eq(schema.externalReferences.tenantId, schema.properties.tenantId),
          eq(schema.externalReferences.entityId, schema.properties.id),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
          eq(schema.externalReferences.externalType, 'property_role'),
          eq(schema.externalReferences.isCurrent, true),
        ),
      )
      .where(sql`${schema.properties.displayAddress} ~ '^Property [0-9]+$'`)
      .orderBy(schema.properties.displayAddress);

    let repaired = 0;
    let unresolved = 0;

    for (const placeholder of placeholders) {
      if (!placeholder.integrationAccountId) {
        unresolved += 1;
        continue;
      }

      const [integrationAccount] = await client.db
        .select()
        .from(schema.integrationAccounts)
        .where(eq(schema.integrationAccounts.id, placeholder.integrationAccountId))
        .limit(1);
      if (!integrationAccount) {
        unresolved += 1;
        continue;
      }

      const credentials = integrationAccount.credentialsJsonEncrypted
        ? decryptJsonPayload(integrationAccount.credentialsJsonEncrypted, encryptionKey)
        : {};
      const dezrezClient = createDezrezClient({
        settings: integrationAccount.settingsJson ?? {},
        credentials,
      });

      let normalized =
        placeholder.currentRoleExternalId
          ? normalizeDezrezPropertySummary(
              (await dezrezClient.getRole(placeholder.currentRoleExternalId)) as Record<string, unknown>,
            )
          : null;

      if (
        normalized &&
        isPlaceholderPropertyDisplayAddress(normalized.displayAddress) &&
        placeholder.stablePropertyExternalId
      ) {
        const propertyPayload = (await dezrezClient.getProperty(
          placeholder.stablePropertyExternalId,
        )) as Record<string, unknown>;
        const enrichedAddress = extractDezrezPropertyAddress(propertyPayload);
        if (enrichedAddress.displayAddress && !isPlaceholderPropertyDisplayAddress(enrichedAddress.displayAddress)) {
          normalized = {
            ...normalized,
            displayAddress: enrichedAddress.displayAddress,
            postcode: enrichedAddress.postcode ?? normalized.postcode,
          };
        }
      }

      if (!normalized || isPlaceholderPropertyDisplayAddress(normalized.displayAddress)) {
        unresolved += 1;
        continue;
      }

      await client.db
        .update(schema.properties)
        .set({
          displayAddress: normalized.displayAddress,
          postcode: normalized.postcode ?? null,
          status: normalized.status ?? 'active',
          marketingStatus: normalized.marketingStatus ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.properties.id, placeholder.propertyId));

      await client.db
        .update(schema.externalReferences)
        .set({
          metadataJson: {
            displayAddress: normalized.displayAddress,
            propertyId: normalized.propertyId ?? placeholder.stablePropertyExternalId,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.externalReferences.tenantId, placeholder.tenantId),
            eq(schema.externalReferences.entityId, placeholder.propertyId),
            eq(schema.externalReferences.provider, 'dezrez'),
            eq(schema.externalReferences.entityType, 'property'),
          ),
        );

      repaired += 1;
    }

    console.log(JSON.stringify({ scanned: placeholders.length, repaired, unresolved }, null, 2));
  } finally {
    await client.client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
