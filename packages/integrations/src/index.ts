import {
  dezrezRefreshJobPayloadSchema,
  dezrezIntegrationSettingsSchema,
  dezrezWebhookPayloadSchema,
  integrationJobTypeSchema,
  propertySyncRequestPayloadSchema,
  type DezrezSeedProperty,
  type IntegrationJobType,
} from '@vitalspace/contracts';
import { type createDbClient, schema } from '@vitalspace/db';
import { buildTenantRoom } from '@vitalspace/realtime';
import { createHash } from 'node:crypto';
import { and, asc, eq, lte } from 'drizzle-orm';

type DbClient = ReturnType<typeof createDbClient>['db'];

const COLLECTION_EVENT_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

export type ProcessPendingPropertySyncsResult = {
  processedEvents: number;
  failedEvents: number;
  upsertedProperties: number;
};

export type ProcessPendingDezrezWebhookEventsResult = {
  processedEvents: number;
  failedEvents: number;
  createdJobs: number;
};

export type ProcessPendingIntegrationJobsResult = {
  completedJobs: number;
  failedJobs: number;
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

async function markIntegrationJobFailed(db: DbClient, jobId: string, message: string) {
  await db
    .update(schema.integrationJobs)
    .set({
      status: 'failed',
      failedAt: new Date(),
      errorMessage: message,
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationJobs.id, jobId));
}

function buildWebhookPayloadHash(payload: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function getDezrezRoleId(payload: {
  PropertyRoleId?: string | undefined;
  MarketingRoleId?: string | undefined;
}) {
  return payload.PropertyRoleId ?? payload.MarketingRoleId ?? null;
}

export function classifyDezrezWebhookEvent(
  payload: Record<string, unknown>,
): Array<{
  jobType: IntegrationJobType;
  entityType: string;
  entityExternalId: string | null;
}> {
  const parsed = dezrezWebhookPayloadSchema.parse(payload);
  const eventName = parsed.EventName ?? null;
  const propertyRoleId = getDezrezRoleId(parsed);

  const pushRoleJob = (jobType: IntegrationJobType) => {
    if (!propertyRoleId) {
      return [];
    }

    return [
      {
        jobType,
        entityType: 'property_role',
        entityExternalId: propertyRoleId,
      },
    ];
  };

  if (eventName && ['Offer', 'OfferResponse', 'LettingOffer', 'offer'].includes(eventName)) {
    return pushRoleJob('offer.role.refresh');
  }

  if (eventName && ['Viewing', 'ViewingFeedback', 'viewing'].includes(eventName)) {
    return pushRoleJob('viewing.role.refresh');
  }

  if (
    eventName &&
    ['GenericEvent', 'EventPropertySearch', 'EventKey', 'EventAlarm', 'event'].includes(eventName)
  ) {
    return pushRoleJob('timeline.role.refresh');
  }

  if (propertyRoleId) {
    return pushRoleJob('property.role.refresh');
  }

  if (parsed.PropertyId) {
    return [
      {
        jobType: integrationJobTypeSchema.enum['property.role.refresh'],
        entityType: 'property',
        entityExternalId: parsed.PropertyId,
      },
    ];
  }

  return [];
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

export async function processPendingDezrezWebhookEvents(args: {
  db: DbClient;
  limit?: number;
}): Promise<ProcessPendingDezrezWebhookEventsResult> {
  const pendingWebhookEvents = await args.db
    .select()
    .from(schema.webhookEvents)
    .where(
      and(
        eq(schema.webhookEvents.provider, 'dezrez'),
        eq(schema.webhookEvents.processingStatus, 'pending'),
      ),
    )
    .orderBy(asc(schema.webhookEvents.receivedAt))
    .limit(args.limit ?? 20);

  const result: ProcessPendingDezrezWebhookEventsResult = {
    processedEvents: 0,
    failedEvents: 0,
    createdJobs: 0,
  };

  for (const webhookEvent of pendingWebhookEvents) {
    if (!webhookEvent.integrationAccountId || !webhookEvent.tenantId) {
      await args.db
        .update(schema.webhookEvents)
        .set({
          processingStatus: 'failed',
          errorMessage: 'integration_account_not_resolved',
        })
        .where(eq(schema.webhookEvents.id, webhookEvent.id));
      result.failedEvents += 1;
      continue;
    }

    try {
      const payload = dezrezWebhookPayloadSchema.parse(webhookEvent.payloadJson);
      const jobs = classifyDezrezWebhookEvent(payload);

      for (const job of jobs) {
        const payloadHash = buildWebhookPayloadHash(payload);
        const refreshPayload = dezrezRefreshJobPayloadSchema.parse({
          webhookEventId: webhookEvent.id,
          eventName: payload.EventName ?? null,
          propertyId: payload.PropertyId ?? null,
          propertyRoleId: getDezrezRoleId(payload),
          rootEntityId: payload.RootEntityId ?? null,
          rawEvent: payload,
        });

        await args.db
          .insert(schema.integrationJobs)
          .values({
            tenantId: webhookEvent.tenantId,
            integrationAccountId: webhookEvent.integrationAccountId,
            webhookEventId: webhookEvent.id,
            provider: 'dezrez',
            jobType: job.jobType,
            entityType: job.entityType,
            entityExternalId: job.entityExternalId,
            dedupeKey: `${webhookEvent.integrationAccountId}:${job.jobType}:${payloadHash}`,
            payloadJson: refreshPayload,
          })
          .onConflictDoNothing({
            target: [schema.integrationJobs.provider, schema.integrationJobs.dedupeKey],
          });
      }

      await args.db
        .update(schema.webhookEvents)
        .set({
          processingStatus: 'processed',
          processedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(schema.webhookEvents.id, webhookEvent.id));

      result.processedEvents += 1;
      result.createdJobs += jobs.length;
    } catch (error) {
      await args.db
        .update(schema.webhookEvents)
        .set({
          processingStatus: 'failed',
          errorMessage: error instanceof Error ? error.message : 'webhook_processing_failed',
        })
        .where(eq(schema.webhookEvents.id, webhookEvent.id));
      result.failedEvents += 1;
    }
  }

  return result;
}

export async function processPendingIntegrationJobs(args: {
  db: DbClient;
  limit?: number;
}): Promise<ProcessPendingIntegrationJobsResult> {
  const pendingJobs = await args.db
    .select()
    .from(schema.integrationJobs)
    .where(
      and(
        eq(schema.integrationJobs.status, 'pending'),
        lte(schema.integrationJobs.availableAt, new Date()),
      ),
    )
    .orderBy(asc(schema.integrationJobs.availableAt))
    .limit(args.limit ?? 20);

  const result: ProcessPendingIntegrationJobsResult = {
    completedJobs: 0,
    failedJobs: 0,
  };

  for (const job of pendingJobs) {
    if (!job.tenantId || !job.integrationAccountId) {
      await markIntegrationJobFailed(args.db, job.id, 'integration_job_unscoped');
      result.failedJobs += 1;
      continue;
    }

    try {
      if (job.provider !== 'dezrez') {
        throw new Error('unsupported_provider');
      }

      const payload = dezrezRefreshJobPayloadSchema.parse(job.payloadJson);

      if (job.jobType === 'property.role.refresh') {
        await args.db.insert(schema.outboxEvents).values({
          tenantId: job.tenantId,
          eventName: 'property.sync_requested',
          entityType: 'property',
          entityId: COLLECTION_EVENT_ENTITY_ID,
          mutationType: 'sync_requested',
          channelKey: buildTenantRoom(job.tenantId),
          payloadJson: propertySyncRequestPayloadSchema.parse({
            integrationAccountId: job.integrationAccountId,
            requestedByUserId: null,
          }),
        });
      } else {
        await args.db.insert(schema.outboxEvents).values({
          tenantId: job.tenantId,
          eventName: `dezrez.${job.jobType.replaceAll('.', '_')}.requested`,
          entityType: 'integration_job',
          entityId: job.id,
          mutationType: 'requested',
          channelKey: buildTenantRoom(job.tenantId),
          payloadJson: payload,
        });
      }

      await args.db.insert(schema.auditLogs).values({
        tenantId: job.tenantId,
        actorUserId: null,
        actorType: 'system',
        entityType: 'integration_job',
        entityId: job.id,
        action: `${job.provider}.${job.jobType}.completed`,
        summary: `Queued ${job.jobType} for ${job.provider}`,
        metadataJson: payload,
      });

      await args.db
        .update(schema.integrationJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationJobs.id, job.id));

      result.completedJobs += 1;
    } catch (error) {
      await markIntegrationJobFailed(
        args.db,
        job.id,
        error instanceof Error ? error.message : 'integration_job_failed',
      );
      result.failedJobs += 1;
    }
  }

  return result;
}
