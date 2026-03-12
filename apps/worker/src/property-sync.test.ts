import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createDbClient, migrateDb, schema } from '@vitalspace/db';
import {
  classifyDezrezWebhookEvent,
  processPendingDezrezWebhookEvents,
  processPendingIntegrationJobs,
  processPendingPropertySyncs,
} from '@vitalspace/integrations';
import { buildTenantRoom } from '@vitalspace/realtime';
import { runWorkerCycle } from './worker';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://vitalspace:vitalspace@localhost:5432/vitalspace_test';

const { db } = createDbClient(DATABASE_URL);

function buildSeedProperties(count: number, options?: { rolePrefix?: string; addressPrefix?: string }) {
  const rolePrefix = options?.rolePrefix ?? 'DRZ';
  const addressPrefix = options?.addressPrefix ?? 'Seed';

  return Array.from({ length: count }, (_, index) => ({
    externalId: `${rolePrefix}-${index + 1}`,
    propertyId: `${900000 + index + 1}`,
    displayAddress: `${index + 1} ${addressPrefix} Street, Manchester`,
    postcode: `M${(index % 9) + 1} ${100 + index}`,
    marketingStatus: 'for_sale',
  }));
}

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
      "file_attachments",
      "file_objects",
      "audit_logs",
      "outbox_events",
      "integration_accounts",
      "webhook_events",
      "integration_jobs",
      "properties",
      "contacts",
      "workflow_transition_events",
      "workflow_instances",
      "workflow_stages",
      "workflow_templates",
      "communication_dispatches",
      "sms_templates",
      "email_templates",
      "case_notes",
      "case_parties",
      "cases",
      "sales_offers",
      "sales_cases",
      "lettings_applications",
      "lettings_cases",
      "offers",
      "viewings",
      "timeline_events",
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

  it('marks unseen properties stale and then delisted after consecutive healthy misses', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Stale Estates',
        slug: 'stale-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Stale Dezrez',
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-A',
              propertyId: '1001',
              displayAddress: '1 Active Street, Manchester',
              postcode: 'M1 1AA',
              marketingStatus: 'for_sale',
            },
            {
              externalId: 'DRZ-B',
              propertyId: '1002',
              displayAddress: '2 Missing Street, Manchester',
              postcode: 'M1 1AB',
              marketingStatus: 'for_sale',
            },
          ],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    const enqueueSync = async () => {
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
    };

    await enqueueSync();
    expect(await processPendingPropertySyncs({ db })).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 2,
    });

    await db
      .update(schema.integrationAccounts)
      .set({
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-A',
              propertyId: '1001',
              displayAddress: '1 Active Street, Manchester',
              postcode: 'M1 1AA',
              marketingStatus: 'for_sale',
            },
          ],
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationAccounts.id, integrationAccount.id));

    await enqueueSync();
    await processPendingPropertySyncs({ db });

    await enqueueSync();
    await processPendingPropertySyncs({ db });

    await enqueueSync();
    await processPendingPropertySyncs({ db });

    const properties = await db
      .select({
        displayAddress: schema.properties.displayAddress,
        syncState: schema.properties.syncState,
        consecutiveMissCount: schema.properties.consecutiveMissCount,
        staleCandidateAt: schema.properties.staleCandidateAt,
        delistedAt: schema.properties.delistedAt,
        delistedReason: schema.properties.delistedReason,
      })
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id))
      .orderBy(asc(schema.properties.displayAddress));

    expect(properties).toHaveLength(2);
    expect(properties[0]).toMatchObject({
      displayAddress: '1 Active Street, Manchester',
      syncState: 'active',
      consecutiveMissCount: 0,
      delistedAt: null,
    });
    expect(properties[1]).toMatchObject({
      displayAddress: '2 Missing Street, Manchester',
      syncState: 'delisted',
      consecutiveMissCount: 3,
      delistedReason: 'missing_from_healthy_sync',
    });
    expect(properties[1]?.staleCandidateAt).toBeTruthy();
    expect(properties[1]?.delistedAt).toBeTruthy();

    const syncRuns = await db
      .select({
        propertyCount: schema.propertySyncRuns.propertyCount,
        staleCandidateCount: schema.propertySyncRuns.staleCandidateCount,
        delistedCount: schema.propertySyncRuns.delistedCount,
      })
      .from(schema.propertySyncRuns)
      .where(eq(schema.propertySyncRuns.integrationAccountId, integrationAccount.id))
      .orderBy(asc(schema.propertySyncRuns.startedAt));

    expect(syncRuns).toHaveLength(4);
    expect(syncRuns[1]).toMatchObject({
      propertyCount: 1,
      staleCandidateCount: 1,
      delistedCount: 0,
    });
    expect(syncRuns[3]).toMatchObject({
      propertyCount: 1,
      staleCandidateCount: 0,
      delistedCount: 1,
    });
  });

  it('treats anomalous empty runs as non-authoritative and does not delist properties', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Anomaly Estates',
        slug: 'anomaly-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Anomaly Dezrez',
        settingsJson: {
          seedProperties: buildSeedProperties(20, {
            rolePrefix: 'DRZ-ANOM',
            addressPrefix: 'Anomaly',
          }),
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    const enqueueSync = async () => {
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
    };

    await enqueueSync();
    expect(await processPendingPropertySyncs({ db })).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 20,
    });

    await db
      .update(schema.integrationAccounts)
      .set({
        settingsJson: {
          seedProperties: [],
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationAccounts.id, integrationAccount.id));

    await enqueueSync();
    expect(await processPendingPropertySyncs({ db })).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 0,
    });

    const propertyStates = await db
      .select({
        syncState: schema.properties.syncState,
        consecutiveMissCount: schema.properties.consecutiveMissCount,
        delistedAt: schema.properties.delistedAt,
      })
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));

    expect(propertyStates).toHaveLength(20);
    expect(propertyStates.every((property) => property.syncState === 'active')).toBe(true);
    expect(propertyStates.every((property) => property.consecutiveMissCount === 0)).toBe(true);
    expect(propertyStates.every((property) => property.delistedAt === null)).toBe(true);

    const syncRuns = await db
      .select({
        anomalyStatus: schema.propertySyncRuns.anomalyStatus,
        anomalyReason: schema.propertySyncRuns.anomalyReason,
        propertyCount: schema.propertySyncRuns.propertyCount,
        staleCandidateCount: schema.propertySyncRuns.staleCandidateCount,
        delistedCount: schema.propertySyncRuns.delistedCount,
      })
      .from(schema.propertySyncRuns)
      .where(eq(schema.propertySyncRuns.integrationAccountId, integrationAccount.id))
      .orderBy(desc(schema.propertySyncRuns.startedAt))
      .limit(1);

    expect(syncRuns[0]).toMatchObject({
      anomalyStatus: 'anomalous',
      anomalyReason: 'empty_feed_after_non_empty_history',
      propertyCount: 0,
      staleCandidateCount: 0,
      delistedCount: 0,
    });
  });

  it('classifies Dezrez webhooks into durable jobs and refreshes a single property role without a full sync', async () => {
    const createdTenants = await db
      .insert(schema.tenants)
      .values({
        name: 'Webhook Worker Estates',
        slug: 'webhook-worker-estates',
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
        name: 'Webhook Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [
            {
              externalId: '30026645',
              propertyId: '3671906',
              displayAddress: 'The Pulse, 50 Seymour Grove, Manchester, M16 0LN',
              postcode: 'M16 0LN',
              marketingStatus: 'for_sale',
            },
          ],
        },
      })
      .returning();
    const integrationAccount = createdIntegrationAccounts[0];
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.webhookEvents).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      eventType: 'InstructionToSell',
      signatureValid: true,
      payloadJson: {
        EventName: 'InstructionToSell',
        PropertyId: 3671906,
        PropertyRoleId: 30026645,
        RootEntityId: 88991,
      },
      processingStatus: 'pending',
    });

    const classified = await processPendingDezrezWebhookEvents({ db });
    expect(classified).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      createdJobs: 1,
    });

    const jobs = await db.select().from(schema.integrationJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobType).toBe('property.role.refresh');

    const completed = await processPendingIntegrationJobs({ db });
    expect(completed).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });

    const propertyRefreshEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.refreshed'));

    const propertySyncRequests = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.sync_requested'));
    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));

    expect(propertyRefreshEvents).toHaveLength(1);
    expect(propertyRefreshEvents[0]?.tenantId).toBe(tenant.id);
    expect(propertySyncRequests).toHaveLength(0);
    expect(properties).toHaveLength(1);
    expect(properties[0]?.displayAddress).toContain('The Pulse');
  });

  it('matches an existing property by provider propertyId metadata during targeted refreshes', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Property Id Match Estates',
        slug: 'property-id-match-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: tenant.id,
        displayAddress: '50 Seymour Grove, Manchester',
        postcode: 'M16 0LN',
      })
      .returning();
    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values({
      tenantId: tenant.id,
      provider: 'dezrez',
      entityType: 'property',
      entityId: property.id,
      externalType: 'property_role',
      externalId: '3671906',
      metadataJson: {
        propertyId: '3671906',
        displayAddress: '50 Seymour Grove, Manchester',
      },
      lastSeenAt: new Date(),
    });

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Property Id Match Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      jobType: 'property.role.refresh',
      entityType: 'property_role',
      entityExternalId: '30026645',
      dedupeKey: 'property-role-refresh-match-by-property-id',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'InstructionToSell',
        propertyId: '3671906',
        propertyRoleId: '30026645',
        rootEntityId: '88991',
        rawEvent: {
          EventName: 'InstructionToSell',
          PropertyId: '3671906',
          PropertyRoleId: '30026645',
        },
      },
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Id: 3671906,
            RoleId: 30026645,
            PropertyId: 3671906,
            DisplayAddress: 'The Pulse, 50 Seymour Grove, Manchester, M16 0LN',
            Address: {
              Postcode: 'M16 0LN',
            },
            RoleStatus: {
              SystemName: 'InstructionToSell',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const previousClientId = process.env.DEZREZ_CLIENT_ID;
    const previousClientSecret = process.env.DEZREZ_CLIENT_SECRET;
    process.env.DEZREZ_CLIENT_ID = 'client-id';
    process.env.DEZREZ_CLIENT_SECRET = 'client-secret';

    try {
      await db
        .update(schema.integrationAccounts)
        .set({
          settingsJson: {
            mode: 'live',
            agencyId: 36,
            authUrl: 'https://auth.dezrez.example/oauth/token/',
            coreApiUrl: 'https://core.dezrez.example/api/',
          },
        })
        .where(eq(schema.integrationAccounts.id, integrationAccount.id));

      const originalFetch = global.fetch;
      global.fetch = fetchFn as typeof fetch;

      try {
        const result = await processPendingIntegrationJobs({ db });
        expect(result).toEqual({
          completedJobs: 1,
          failedJobs: 0,
        });
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      process.env.DEZREZ_CLIENT_ID = previousClientId;
      process.env.DEZREZ_CLIENT_SECRET = previousClientSecret;
    }

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const references = await db
      .select()
      .from(schema.externalReferences)
      .where(
        and(
          eq(schema.externalReferences.tenantId, tenant.id),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
        ),
      );

    expect(properties).toHaveLength(1);
    expect(references).toHaveLength(3);

    const stablePropertyReference = references.find((reference) => reference.externalType === 'property');
    const currentRoleReference = references.find(
      (reference) => reference.externalType === 'property_role' && reference.isCurrent,
    );
    const historicalRoleReference = references.find(
      (reference) =>
        reference.externalType === 'property_role' &&
        reference.externalId === '3671906' &&
        reference.isCurrent === false,
    );

    expect(stablePropertyReference?.externalId).toBe('3671906');
    expect(stablePropertyReference?.entityId).toBe(property.id);
    expect(currentRoleReference?.externalId).toBe('30026645');
    expect(currentRoleReference?.entityId).toBe(property.id);
    expect(historicalRoleReference?.entityId).toBe(property.id);
  });

  it('does not overwrite a real address with a placeholder during targeted refresh and hydrates from the stable property record', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Placeholder Repair Estates',
        slug: 'placeholder-repair-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: tenant.id,
        displayAddress: '50 Seymour Grove, Manchester',
        postcode: 'M16 0LN',
      })
      .returning();
    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values([
      {
        tenantId: tenant.id,
        provider: 'dezrez',
        entityType: 'property',
        entityId: property.id,
        externalType: 'property',
        externalId: '3671906',
        metadataJson: {
          propertyId: '3671906',
          displayAddress: '50 Seymour Grove, Manchester',
        },
        isCurrent: true,
        lastSeenAt: new Date(),
      },
      {
        tenantId: tenant.id,
        provider: 'dezrez',
        entityType: 'property',
        entityId: property.id,
        externalType: 'property_role',
        externalId: '30026645',
        metadataJson: {
          propertyId: '3671906',
          displayAddress: '50 Seymour Grove, Manchester',
        },
        isCurrent: true,
        lastSeenAt: new Date(),
      },
    ]);

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Placeholder Repair Dezrez',
        settingsJson: {
          mode: 'live',
          agencyId: 36,
          authUrl: 'https://auth.dezrez.example/oauth/token/',
          coreApiUrl: 'https://core.dezrez.example/api/',
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      jobType: 'property.role.refresh',
      entityType: 'property_role',
      entityExternalId: '30026645',
      dedupeKey: 'property-role-refresh-placeholder-repair',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'PropertyRoleUpdated',
        propertyId: '3671906',
        propertyRoleId: '30026645',
        rootEntityId: '30026645',
        rawEvent: {
          PropertyId: '3671906',
          PropertyRoleId: '30026645',
        },
      },
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Id: 3671906,
            RoleId: 30026645,
            PropertyId: 3671906,
            DisplayAddress: 'Property 30026645',
            RoleStatus: {
              SystemName: 'InstructionToSell',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Id: 3671906,
            Address: {
              BuildingName: 'The Pulse',
              Street: '50 Seymour Grove',
              Town: 'Manchester',
              Postcode: 'M16 0LN',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const previousClientId = process.env.DEZREZ_CLIENT_ID;
    const previousClientSecret = process.env.DEZREZ_CLIENT_SECRET;
    process.env.DEZREZ_CLIENT_ID = 'client-id';
    process.env.DEZREZ_CLIENT_SECRET = 'client-secret';

    try {
      const originalFetch = global.fetch;
      global.fetch = fetchFn as typeof fetch;

      try {
        const result = await processPendingIntegrationJobs({ db });
        expect(result).toEqual({
          completedJobs: 1,
          failedJobs: 0,
        });
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      process.env.DEZREZ_CLIENT_ID = previousClientId;
      process.env.DEZREZ_CLIENT_SECRET = previousClientSecret;
    }

    const [updatedProperty] = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, property.id))
      .limit(1);

    expect(updatedProperty?.displayAddress).toBe('The Pulse, 50 Seymour Grove, Manchester, M16 0LN');
    expect(updatedProperty?.postcode).toBe('M16 0LN');
  });

  it('skips creating a new property from a placeholder-only targeted refresh', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Placeholder Skip Estates',
        slug: 'placeholder-skip-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Placeholder Skip Dezrez',
        settingsJson: {
          mode: 'live',
          agencyId: 36,
          authUrl: 'https://auth.dezrez.example/oauth/token/',
          coreApiUrl: 'https://core.dezrez.example/api/',
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      jobType: 'property.role.refresh',
      entityType: 'property_role',
      entityExternalId: '29215602',
      dedupeKey: 'property-role-refresh-placeholder-skip',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'PropertyRoleUpdated',
        propertyId: '1961108',
        propertyRoleId: '29215602',
        rootEntityId: '29215602',
        rawEvent: {
          PropertyId: '1961108',
          PropertyRoleId: '29215602',
        },
      },
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Id: 1961108,
            RoleId: 29215602,
            PropertyId: 1961108,
            DisplayAddress: 'Property 29215602',
            RoleStatus: {
              SystemName: 'Completed',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Id: 1961108,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const previousClientId = process.env.DEZREZ_CLIENT_ID;
    const previousClientSecret = process.env.DEZREZ_CLIENT_SECRET;
    process.env.DEZREZ_CLIENT_ID = 'client-id';
    process.env.DEZREZ_CLIENT_SECRET = 'client-secret';

    try {
      const originalFetch = global.fetch;
      global.fetch = fetchFn as typeof fetch;

      try {
        const result = await processPendingIntegrationJobs({ db });
        expect(result).toEqual({
          completedJobs: 1,
          failedJobs: 0,
        });
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      process.env.DEZREZ_CLIENT_ID = previousClientId;
      process.env.DEZREZ_CLIENT_SECRET = previousClientSecret;
    }

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const refreshedEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.refreshed'));

    expect(properties).toHaveLength(0);
    expect(refreshedEvents).toHaveLength(0);
  });

  it('preserves historical role refs and marks the newest role as current when a property is relisted', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Relist Estates',
        slug: 'relist-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Relist Dezrez',
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-OLD-ROLE',
              propertyId: '501001',
              displayAddress: '88 Relist Road, Manchester',
              postcode: 'M4 1AA',
              marketingStatus: 'for_sale',
            },
          ],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    const enqueueSync = async () => {
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
    };

    await enqueueSync();
    expect(await processPendingPropertySyncs({ db })).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 1,
    });

    await db
      .update(schema.integrationAccounts)
      .set({
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-NEW-ROLE',
              propertyId: '501001',
              displayAddress: '88 Relist Road, Manchester',
              postcode: 'M4 1AA',
              marketingStatus: 'for_sale',
            },
          ],
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationAccounts.id, integrationAccount.id));

    await enqueueSync();
    expect(await processPendingPropertySyncs({ db })).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 1,
    });

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const references = await db
      .select({
        externalType: schema.externalReferences.externalType,
        externalId: schema.externalReferences.externalId,
        isCurrent: schema.externalReferences.isCurrent,
        supersededAt: schema.externalReferences.supersededAt,
        metadataJson: schema.externalReferences.metadataJson,
      })
      .from(schema.externalReferences)
      .where(
        and(
          eq(schema.externalReferences.tenantId, tenant.id),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
        ),
      )
      .orderBy(asc(schema.externalReferences.externalType), asc(schema.externalReferences.externalId));

    expect(properties).toHaveLength(1);
    expect(references).toHaveLength(3);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalType: 'property',
          externalId: '501001',
          isCurrent: true,
        }),
        expect.objectContaining({
          externalType: 'property_role',
          externalId: 'DRZ-OLD-ROLE',
          isCurrent: false,
        }),
        expect.objectContaining({
          externalType: 'property_role',
          externalId: 'DRZ-NEW-ROLE',
          isCurrent: true,
          supersededAt: null,
        }),
      ]),
    );
    expect(
      references.find(
        (reference) =>
          reference.externalType === 'property_role' && reference.externalId === 'DRZ-OLD-ROLE',
      )?.supersededAt,
    ).toBeTruthy();
  });

  it('normalizes seeded Dezrez offers and viewings into first-class tables', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Offer Viewing Estates',
        slug: 'offer-viewing-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: tenant.id,
        displayAddress: '1 Albert Square, Manchester',
        postcode: 'M2 5DB',
      })
      .returning();
    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values({
      tenantId: tenant.id,
      provider: 'dezrez',
      entityType: 'property',
      entityId: property.id,
      externalType: 'property_role',
      externalId: '30026645',
      metadataJson: {
        propertyId: '3671906',
      },
      lastSeenAt: new Date(),
    });

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Normalized Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
          seedOffersByRoleId: {
            '30026645': [
              {
                Id: 91001,
                MarketingRoleId: 30026645,
                DateTime: '2026-03-10T10:00:00.000Z',
                Value: 275000,
                ApplicantGroup: {
                  PrimaryMember: {
                    ContactName: 'Alex Buyer',
                    PrimaryEmail: 'alex@example.com',
                  },
                  Grade: {
                    Name: 'Hot Buyer',
                  },
                },
                Response: {
                  ResponseType: {
                    Name: 'Accepted',
                  },
                },
              },
            ],
          },
          seedViewingsByRoleId: {
            '30026645': [
              {
                Id: 82001,
                MarketingRoleId: 30026645,
                StartDate: '2026-03-11T14:30:00.000Z',
              },
            ],
          },
          seedViewingDetailsByRoleId: {
            '30026645': [
              {
                Id: 82001,
                MarketingRoleId: 30026645,
                StartDate: '2026-03-11T14:30:00.000Z',
                EventStatus: {
                  Name: 'Completed',
                },
                Grade: {
                  Name: 'First Time Buyer',
                },
                MainContact: {
                  name: 'Jamie Viewer',
                  email: 'jamie@example.com',
                },
                Feedback: [{ Id: 1 }],
                Notes: [{ Id: 1 }, { Id: 2 }],
              },
            ],
          },
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values([
      {
        tenantId: tenant.id,
        integrationAccountId: integrationAccount.id,
        provider: 'dezrez',
        jobType: 'offer.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30026645',
        dedupeKey: 'offer-role-refresh-30026645',
        payloadJson: {
          webhookEventId: '00000000-0000-0000-0000-000000000000',
          eventName: 'Offer',
          propertyId: '3671906',
          propertyRoleId: '30026645',
          rootEntityId: null,
          rawEvent: {
            EventName: 'Offer',
            PropertyRoleId: '30026645',
          },
        },
      },
      {
        tenantId: tenant.id,
        integrationAccountId: integrationAccount.id,
        provider: 'dezrez',
        jobType: 'viewing.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30026645',
        dedupeKey: 'viewing-role-refresh-30026645',
        payloadJson: {
          webhookEventId: '00000000-0000-0000-0000-000000000000',
          eventName: 'ViewingFeedback',
          propertyId: '3671906',
          propertyRoleId: '30026645',
          rootEntityId: null,
          rawEvent: {
            EventName: 'ViewingFeedback',
            PropertyRoleId: '30026645',
          },
        },
      },
    ]);

    const result = await processPendingIntegrationJobs({ db });
    expect(result).toEqual({
      completedJobs: 2,
      failedJobs: 0,
    });

    const offers = await db.select().from(schema.offers);
    const viewings = await db.select().from(schema.viewings);

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      tenantId: tenant.id,
      propertyId: property.id,
      externalId: '91001',
      applicantName: 'Alex Buyer',
      applicantEmail: 'alex@example.com',
      applicantGrade: 'Hot Buyer',
      amount: 275000,
      status: 'Accepted',
    });

    expect(viewings).toHaveLength(1);
    expect(viewings[0]).toMatchObject({
      tenantId: tenant.id,
      propertyId: property.id,
      externalId: '82001',
      applicantName: 'Jamie Viewer',
      applicantEmail: 'jamie@example.com',
      applicantGrade: 'First Time Buyer',
      eventStatus: 'Completed',
      feedbackCount: 1,
      notesCount: 2,
    });
  });

  it('normalizes seeded Dezrez timeline events into shared timeline rows', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Timeline Estates',
        slug: 'timeline-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: tenant.id,
        displayAddress: '9 Deansgate, Manchester',
        postcode: 'M3 1AZ',
      })
      .returning();
    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values({
      tenantId: tenant.id,
      provider: 'dezrez',
      entityType: 'property',
      entityId: property.id,
      externalType: 'property_role',
      externalId: '30029999',
      metadataJson: {
        propertyId: '3999001',
      },
      lastSeenAt: new Date(),
    });

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Timeline Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
          seedEventsByRoleId: {
            '30029999': [
              {
                Id: 70001,
                MarketingRoleId: 30029999,
                DateTime: '2026-03-12T09:15:00.000Z',
                Title: 'Offer chased',
                Description: 'Buyer solicitor asked for an update.',
                EventType: {
                  Name: 'Note',
                  SystemName: 'note',
                },
                Negotiator: {
                  ContactName: 'Case Handler',
                  PrimaryEmail: 'handler@example.com',
                },
              },
              {
                Id: 70002,
                MarketingRoleId: 30029999,
                DateTime: '2026-03-12T11:00:00.000Z',
                Subject: 'Mailout',
                Body: 'Property sent to applicants.',
                EventType: {
                  Name: 'Mailout',
                  SystemName: 'mailout',
                },
              },
            ],
          },
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      jobType: 'timeline.role.refresh',
      entityType: 'property_role',
      entityExternalId: '30029999',
      dedupeKey: 'timeline-role-refresh-30029999',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'GenericEvent',
        propertyId: '3999001',
        propertyRoleId: '30029999',
        rootEntityId: null,
        rawEvent: {
          EventName: 'GenericEvent',
          PropertyRoleId: '30029999',
        },
      },
    });

    const result = await processPendingIntegrationJobs({ db });
    expect(result).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });

    const timelineEvents = await db.select().from(schema.timelineEvents);
    const realtimeEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'timeline.refreshed'));

    expect(timelineEvents).toHaveLength(2);
    expect(timelineEvents[0]).toMatchObject({
      tenantId: tenant.id,
      subjectType: 'property',
      subjectId: property.id,
      provider: 'dezrez',
      externalId: '70001',
      propertyRoleExternalId: '30029999',
      eventType: 'note',
      title: 'Offer chased',
      body: 'Buyer solicitor asked for an update.',
      actorType: 'external_user',
    });
    expect(timelineEvents[1]).toMatchObject({
      tenantId: tenant.id,
      subjectId: property.id,
      externalId: '70002',
      eventType: 'mailout',
      title: 'Mailout',
      body: 'Property sent to applicants.',
      actorType: 'external_system',
    });
    expect(realtimeEvents).toHaveLength(1);
    expect(realtimeEvents[0]?.payloadJson).toMatchObject({
      propertyRoleExternalId: '30029999',
      count: 2,
    });
  });

  it('classifies event-bag webhook updates as timeline refreshes instead of property refreshes', () => {
    expect(
      classifyDezrezWebhookEvent({
        DocumentId: 54867015,
        PropertyRoleId: 30029999,
        RootEntityId: 30029999,
        ChangeType: 'Updated',
        AllChanges: [
          {
            PropertyName: 'Events',
            AddedKeys: [248397451],
          },
        ],
      }),
    ).toEqual([
      {
        jobType: 'timeline.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30029999',
      },
    ]);
  });

  it('classifies property-affecting GenericEvents as targeted property and timeline refreshes', () => {
    expect(
      classifyDezrezWebhookEvent({
        EventName: 'GenericEvent',
        PropertyRoleId: 30029999,
        PropertyId: 3999001,
        AllChanges: [
          {
            PropertyName: 'Price',
            NewValue: '250000',
          },
          {
            PropertyName: 'EventType',
            NewSystemName: 'PriceChanged',
          },
        ],
      }),
    ).toEqual([
      {
        jobType: 'timeline.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30029999',
      },
      {
        jobType: 'property.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30029999',
      },
    ]);
  });

  it('ignores property-id-only webhooks that would otherwise force a full sync fallback', () => {
    expect(
      classifyDezrezWebhookEvent({
        PropertyId: 3902513,
        RootEntityId: 3902513,
        ChangeType: 'Updated',
      }),
    ).toEqual([]);
  });

  it('coalesces duplicate pending webhook refresh jobs for the same role target', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Coalesce Estates',
        slug: 'coalesce-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Coalesce Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      jobType: 'viewing.role.refresh',
      entityType: 'property_role',
      entityExternalId: '30029999',
      dedupeKey: 'existing-pending-viewing-job',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'ViewingFeedback',
        propertyId: '3999001',
        propertyRoleId: '30029999',
        rootEntityId: '88991',
        rawEvent: {
          EventName: 'ViewingFeedback',
          PropertyRoleId: '30029999',
        },
      },
      status: 'pending',
    });

    const [webhookEvent] = await db
      .insert(schema.webhookEvents)
      .values({
        tenantId: tenant.id,
        integrationAccountId: integrationAccount.id,
        provider: 'dezrez',
        eventType: 'ViewingFeedback',
        signatureValid: true,
        payloadJson: {
          EventName: 'ViewingFeedback',
          PropertyId: '3999001',
          PropertyRoleId: '30029999',
          RootEntityId: '88991',
        },
        processingStatus: 'pending',
      })
      .returning();
    if (!webhookEvent) {
      throw new Error('webhook_event_not_created');
    }

    const result = await processPendingDezrezWebhookEvents({ db });
    expect(result).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      createdJobs: 0,
    });

    const jobs = await db
      .select()
      .from(schema.integrationJobs)
      .where(eq(schema.integrationJobs.tenantId, tenant.id));
    expect(jobs).toHaveLength(1);

    const updatedWebhook = await db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, webhookEvent.id))
      .limit(1);
    expect(updatedWebhook[0]).toMatchObject({
      processingStatus: 'ignored',
      errorMessage: 'coalesced_existing_job',
    });
  });

  it('queues a full sync with trigger metadata when a fallback property refresh cannot hydrate a role', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Fallback Sync Estates',
        slug: 'fallback-sync-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Fallback Sync Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    const [job] = await db
      .insert(schema.integrationJobs)
      .values({
        tenantId: tenant.id,
        integrationAccountId: integrationAccount.id,
        provider: 'dezrez',
        jobType: 'property.role.refresh',
        entityType: 'property',
        entityExternalId: '3999001',
        dedupeKey: 'property-role-refresh-fallback-3999001',
        payloadJson: {
          webhookEventId: '00000000-0000-0000-0000-000000000000',
          eventName: null,
          propertyId: '3999001',
          propertyRoleId: null,
          rootEntityId: '3999001',
          rawEvent: {
            PropertyId: '3999001',
          },
        },
      })
      .returning();
    if (!job) {
      throw new Error('integration_job_not_created');
    }

    const result = await processPendingIntegrationJobs({ db });
    expect(result).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });

    const syncRequests = await db
      .select({
        payloadJson: schema.outboxEvents.payloadJson,
      })
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.sync_requested'));

    expect(syncRequests).toHaveLength(1);
    expect(syncRequests[0]?.payloadJson).toMatchObject({
      integrationAccountId: integrationAccount.id,
      requestedByUserId: null,
      trigger: {
        source: 'integration_job_fallback',
        integrationJobId: job.id,
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        jobType: 'property.role.refresh',
        entityType: 'property',
        entityExternalId: '3999001',
      },
    });
  });

  it('runs the webhook to job to property sync chain in one worker cycle', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Cycle Estates',
        slug: 'cycle-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Cycle Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [
            {
              externalId: 'role-cycle-1',
              propertyId: 'property-cycle-1',
              displayAddress: '100 Deansgate, Manchester',
              postcode: 'M3 2BB',
              marketingStatus: 'for_sale',
            },
          ],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.webhookEvents).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      eventType: 'InstructionToSell',
      signatureValid: true,
      payloadJson: {
        EventName: 'InstructionToSell',
        PropertyId: 'property-cycle-1',
        PropertyRoleId: 'role-cycle-1',
        RootEntityId: 'event-cycle-1',
      },
      processingStatus: 'pending',
    });

    const result = await runWorkerCycle({
      databaseUrl: DATABASE_URL,
    });

    expect(result.webhookResult).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      createdJobs: 1,
    });
    expect(result.integrationJobResult).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });
    expect(result.propertySyncResult).toEqual({
      processedEvents: 0,
      failedEvents: 0,
      upsertedProperties: 0,
    });

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    expect(properties).toHaveLength(1);
    expect(properties[0]?.displayAddress).toBe('100 Deansgate, Manchester');
  });
});
