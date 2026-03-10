import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createDbClient, migrateDb, schema } from '@vitalspace/db';
import { processPendingPropertySyncs } from '@vitalspace/integrations';
import { buildTenantRoom } from '@vitalspace/realtime';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

const { db } = createDbClient(DATABASE_URL);

async function truncateAllTables() {
  await db.execute(sql`
    TRUNCATE TABLE
      "membership_roles",
      "role_permissions",
      "permissions",
      "roles",
      "sessions",
      "credentials",
      "oauth_accounts",
      "tenant_domains",
      "branches",
      "memberships",
      "file_objects",
      "audit_logs",
      "outbox_events",
      "integration_accounts",
      "webhook_events",
      "properties",
      "external_references",
      "tenants",
      "users"
    RESTART IDENTITY CASCADE
  `);
}

describe('processPendingPropertySyncs', () => {
  beforeAll(async () => {
    await migrateDb(DATABASE_URL);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  it('upserts seeded Dezrez properties and marks the sync request as published', async () => {
    const createdTenants = await db
      .insert(schema.tenants)
      .values({
        name: 'Worker Estates',
        slug: 'worker-estates',
      })
      .returning();
    const tenant = createdTenants[0];
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const createdIntegrationAccounts = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Primary Dezrez',
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-100',
              displayAddress: '1 Albert Square, Manchester',
              postcode: 'M2 5DB',
              marketingStatus: 'for_sale',
            },
            {
              externalId: 'DRZ-200',
              displayAddress: '2 King Street, Manchester',
              postcode: 'M2 4WU',
              marketingStatus: 'under_offer',
            },
          ],
        },
      })
      .returning();
    const integrationAccount = createdIntegrationAccounts[0];
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.outboxEvents).values({
      tenantId: tenant.id,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: '00000000-0000-0000-0000-000000000000',
      mutationType: 'sync_requested',
      channelKey: buildTenantRoom(tenant.id),
      payloadJson: {
        integrationAccountId: integrationAccount.id,
        requestedByUserId: null,
      },
    });

    const firstRun = await processPendingPropertySyncs({ db });
    expect(firstRun).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 2,
    });

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const externalReferences = await db
      .select()
      .from(schema.externalReferences)
      .where(eq(schema.externalReferences.tenantId, tenant.id));
    const syncRequests = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.sync_requested'));

    expect(properties).toHaveLength(2);
    expect(externalReferences).toHaveLength(2);
    expect(syncRequests[0]?.status).toBe('published');

    await db
      .update(schema.integrationAccounts)
      .set({
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-100',
              displayAddress: '1 Albert Square, Manchester',
              postcode: 'M2 5DB',
              marketingStatus: 'exchanged',
            },
            {
              externalId: 'DRZ-300',
              displayAddress: '3 Deansgate, Manchester',
              postcode: 'M3 2BA',
              marketingStatus: 'for_sale',
            },
          ],
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationAccounts.id, integrationAccount.id));

    await db.insert(schema.outboxEvents).values({
      tenantId: tenant.id,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: '00000000-0000-0000-0000-000000000000',
      mutationType: 'sync_requested',
      channelKey: buildTenantRoom(tenant.id),
      payloadJson: {
        integrationAccountId: integrationAccount.id,
        requestedByUserId: null,
      },
    });

    const secondRun = await processPendingPropertySyncs({ db });
    expect(secondRun).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 2,
    });

    const updatedProperties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const createdEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.created'));
    const updatedEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.updated'));

    expect(updatedProperties).toHaveLength(3);
    expect(updatedProperties.some((property) => property.marketingStatus === 'exchanged')).toBe(true);
    expect(createdEvents).toHaveLength(3);
    expect(updatedEvents).toHaveLength(1);
  });
});
