import {
  dezrezIntegrationSettingsSchema,
  propertySyncRequestPayloadSchema,
  type DezrezSeedProperty,
} from '@vitalspace/contracts';
import { type createDbClient, schema } from '@vitalspace/db';
import { buildTenantRoom } from '@vitalspace/realtime';
import { and, eq, lte } from 'drizzle-orm';

type DbClient = ReturnType<typeof createDbClient>['db'];

export type ProcessPendingPropertySyncsResult = {
  processedEvents: number;
  failedEvents: number;
  upsertedProperties: number;
};

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label}_not_found`);
  }

  return value;
}

async function markOutboxEventFailed(db: DbClient, eventId: string, message: string) {
  await db
    .update(schema.outboxEvents)
    .set({
      status: 'failed',
      failedAt: new Date(),
      errorMessage: message,
    })
    .where(eq(schema.outboxEvents.id, eventId));
}

async function upsertProperty(args: {
  db: DbClient;
  tenantId: string;
  requestedByUserId: string | null;
  upstreamProperty: DezrezSeedProperty;
}) {
  const [existingReference] = await args.db
    .select()
    .from(schema.externalReferences)
    .where(
      and(
        eq(schema.externalReferences.tenantId, args.tenantId),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
        eq(schema.externalReferences.externalId, args.upstreamProperty.externalId),
      ),
    )
    .limit(1);

  if (existingReference) {
    const updatedProperties = await args.db
      .update(schema.properties)
      .set({
        displayAddress: args.upstreamProperty.displayAddress,
        postcode: args.upstreamProperty.postcode ?? null,
        status: args.upstreamProperty.status ?? 'active',
        marketingStatus: args.upstreamProperty.marketingStatus ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.properties.id, existingReference.entityId))
      .returning();
    const property = requireValue(updatedProperties[0], 'property');

    await args.db
      .update(schema.externalReferences)
      .set({
        metadataJson: {
          displayAddress: args.upstreamProperty.displayAddress,
        },
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.externalReferences.id, existingReference.id));

    await args.db.insert(schema.auditLogs).values({
      tenantId: args.tenantId,
      actorUserId: args.requestedByUserId,
      actorType: args.requestedByUserId ? 'user' : 'system',
      entityType: 'property',
      entityId: property.id,
      action: 'property.updated',
      summary: `Updated property ${property.displayAddress} from Dezrez sync`,
      metadataJson: {
        externalId: args.upstreamProperty.externalId,
      },
    });

    await args.db.insert(schema.outboxEvents).values({
      tenantId: args.tenantId,
      eventName: 'property.updated',
      entityType: 'property',
      entityId: property.id,
      mutationType: 'updated',
      channelKey: buildTenantRoom(args.tenantId),
      payloadJson: {
        externalId: args.upstreamProperty.externalId,
        displayAddress: property.displayAddress,
      },
    });

    return { propertyId: property.id, mutationType: 'updated' as const };
  }

  const createdProperties = await args.db
    .insert(schema.properties)
    .values({
      tenantId: args.tenantId,
      displayAddress: args.upstreamProperty.displayAddress,
      postcode: args.upstreamProperty.postcode ?? null,
      status: args.upstreamProperty.status ?? 'active',
      marketingStatus: args.upstreamProperty.marketingStatus ?? null,
    })
    .returning();
  const property = requireValue(createdProperties[0], 'property');

  await args.db.insert(schema.externalReferences).values({
    tenantId: args.tenantId,
    provider: 'dezrez',
    entityType: 'property',
    entityId: property.id,
    externalType: 'property',
    externalId: args.upstreamProperty.externalId,
    metadataJson: {
      displayAddress: args.upstreamProperty.displayAddress,
    },
    lastSeenAt: new Date(),
  });

  await args.db.insert(schema.auditLogs).values({
    tenantId: args.tenantId,
    actorUserId: args.requestedByUserId,
    actorType: args.requestedByUserId ? 'user' : 'system',
    entityType: 'property',
    entityId: property.id,
    action: 'property.created',
    summary: `Created property ${property.displayAddress} from Dezrez sync`,
    metadataJson: {
      externalId: args.upstreamProperty.externalId,
    },
  });

  await args.db.insert(schema.outboxEvents).values({
    tenantId: args.tenantId,
    eventName: 'property.created',
    entityType: 'property',
    entityId: property.id,
    mutationType: 'created',
    channelKey: buildTenantRoom(args.tenantId),
    payloadJson: {
      externalId: args.upstreamProperty.externalId,
      displayAddress: property.displayAddress,
    },
  });

  return { propertyId: property.id, mutationType: 'created' as const };
}

export async function processPendingPropertySyncs(args: {
  db: DbClient;
  limit?: number;
}): Promise<ProcessPendingPropertySyncsResult> {
  const pendingEvents = await args.db
    .select()
    .from(schema.outboxEvents)
    .where(
      and(
        eq(schema.outboxEvents.eventName, 'property.sync_requested'),
        eq(schema.outboxEvents.status, 'pending'),
        lte(schema.outboxEvents.availableAt, new Date()),
      ),
    )
    .limit(args.limit ?? 10);

  const result: ProcessPendingPropertySyncsResult = {
    processedEvents: 0,
    failedEvents: 0,
    upsertedProperties: 0,
  };

  for (const pendingEvent of pendingEvents) {
    if (!pendingEvent.tenantId) {
      await markOutboxEventFailed(args.db, pendingEvent.id, 'tenant_id_required');
      result.failedEvents += 1;
      continue;
    }

    const parsedPayload = propertySyncRequestPayloadSchema.safeParse(pendingEvent.payloadJson);
    if (!parsedPayload.success) {
      await markOutboxEventFailed(args.db, pendingEvent.id, 'invalid_sync_payload');
      result.failedEvents += 1;
      continue;
    }

    const [integrationAccount] = await args.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.id, parsedPayload.data.integrationAccountId),
          eq(schema.integrationAccounts.tenantId, pendingEvent.tenantId),
          eq(schema.integrationAccounts.provider, 'dezrez'),
        ),
      )
      .limit(1);

    if (!integrationAccount) {
      await markOutboxEventFailed(args.db, pendingEvent.id, 'integration_account_not_found');
      result.failedEvents += 1;
      continue;
    }

    try {
      const settings = dezrezIntegrationSettingsSchema.parse(integrationAccount.settingsJson ?? {});
      let upsertCount = 0;

      for (const upstreamProperty of settings.seedProperties) {
        await upsertProperty({
          db: args.db,
          tenantId: pendingEvent.tenantId,
          requestedByUserId: parsedPayload.data.requestedByUserId,
          upstreamProperty,
        });
        upsertCount += 1;
      }

      await args.db.insert(schema.auditLogs).values({
        tenantId: pendingEvent.tenantId,
        actorUserId: parsedPayload.data.requestedByUserId,
        actorType: parsedPayload.data.requestedByUserId ? 'user' : 'system',
        entityType: 'integration_account',
        entityId: integrationAccount.id,
        action: 'property.sync_completed',
        summary: `Completed Dezrez property sync with ${upsertCount} properties`,
        metadataJson: {
          propertyCount: upsertCount,
        },
      });

      await args.db.insert(schema.outboxEvents).values({
        tenantId: pendingEvent.tenantId,
        eventName: 'property.sync_completed',
        entityType: 'integration_account',
        entityId: integrationAccount.id,
        mutationType: 'sync_completed',
        channelKey: buildTenantRoom(pendingEvent.tenantId),
        payloadJson: {
          propertyCount: upsertCount,
        },
      });

      await args.db
        .update(schema.outboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
          errorMessage: null,
          failedAt: null,
        })
        .where(eq(schema.outboxEvents.id, pendingEvent.id));

      result.processedEvents += 1;
      result.upsertedProperties += upsertCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sync_failed';
      await markOutboxEventFailed(args.db, pendingEvent.id, message);
      result.failedEvents += 1;
    }
  }

  return result;
}
