import { decryptJsonPayload } from '@vitalspace/auth';
import {
  dezrezIntegrationCredentialsSchema,
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
import { createDezrezClient } from './dezrez-client';
export { createDezrezClient, normalizeDezrezPropertySummary } from './dezrez-client';

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

function getString(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function getNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function getDate(value: unknown) {
  const text = getString(value);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function getObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function getFirstString(...values: Array<unknown>) {
  for (const value of values) {
    const text = getString(value);
    if (text) {
      return text;
    }
  }

  return null;
}

function humanizeIdentifier(value: string) {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) {
    return 'Activity';
  }

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function extractCollectionRecords(value: unknown) {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  const collection = getObject(value)?.Collection;
  return Array.isArray(collection) ? (collection as Array<Record<string, unknown>>) : [];
}

function buildSyntheticExternalId(rawEvent: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(rawEvent)).digest('hex');
}

async function findPropertyByRoleExternalId(args: {
  db: DbClient;
  tenantId: string;
  roleExternalId: string;
}) {
  const [reference] = await args.db
    .select()
    .from(schema.externalReferences)
    .where(
      and(
        eq(schema.externalReferences.tenantId, args.tenantId),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
        eq(schema.externalReferences.externalType, 'property_role'),
        eq(schema.externalReferences.externalId, args.roleExternalId),
      ),
    )
    .limit(1);

  return reference?.entityId ?? null;
}

function normalizeOffer(rawOffer: Record<string, unknown>) {
  const applicantGroup =
    rawOffer.ApplicantGroup && typeof rawOffer.ApplicantGroup === 'object'
      ? (rawOffer.ApplicantGroup as Record<string, unknown>)
      : undefined;
  const primaryMember =
    applicantGroup?.PrimaryMember && typeof applicantGroup.PrimaryMember === 'object'
      ? (applicantGroup.PrimaryMember as Record<string, unknown>)
      : undefined;
  const response =
    rawOffer.Response && typeof rawOffer.Response === 'object'
      ? (rawOffer.Response as Record<string, unknown>)
      : undefined;
  const responseType =
    response?.ResponseType && typeof response.ResponseType === 'object'
      ? (response.ResponseType as Record<string, unknown>)
      : undefined;
  const grade =
    applicantGroup?.Grade && typeof applicantGroup.Grade === 'object'
      ? (applicantGroup.Grade as Record<string, unknown>)
      : undefined;

  return {
    externalId: getString(rawOffer.Id),
    propertyRoleExternalId: getString(rawOffer.MarketingRoleId),
    applicantName: getString(primaryMember?.ContactName),
    applicantEmail: getString(primaryMember?.PrimaryEmail),
    applicantGrade: getString(grade?.Name),
    amount: getNumber(rawOffer.Value),
    status: getString(responseType?.Name),
    offeredAt: getDate(rawOffer.DateTime),
    rawPayload: rawOffer,
  };
}

function normalizeViewingSummary(rawViewing: Record<string, unknown>, details?: Record<string, unknown>) {
  const source = details ?? rawViewing;
  const status = getObject(source.EventStatus);
  const grade = getObject(source.Grade);
  const mainContact = getObject(source.MainContact);
  const feedback = Array.isArray(source.Feedback) ? source.Feedback : [];
  const notes = Array.isArray(source.Notes) ? source.Notes : [];

  return {
    externalId: getString(source.Id ?? rawViewing.Id),
    propertyRoleExternalId:
      getString(source.MarketingRoleId) ?? getString(rawViewing.MarketingRoleId),
    applicantName: getString(mainContact?.name) ?? getString(mainContact?.ContactName),
    applicantEmail: getString(mainContact?.email) ?? getString(mainContact?.PrimaryEmail),
    applicantGrade: getString(grade?.Name),
    eventStatus: getString(status?.Name) ?? getString(status?.SystemName),
    startsAt: getDate(source.StartDate),
    feedbackCount: feedback.length,
    notesCount: notes.length,
    rawPayload: source,
  };
}

async function replaceOffersForRole(args: {
  db: DbClient;
  tenantId: string;
  roleExternalId: string;
  offers: Array<Record<string, unknown>>;
}) {
  const propertyId = await findPropertyByRoleExternalId({
    db: args.db,
    tenantId: args.tenantId,
    roleExternalId: args.roleExternalId,
  });

  for (const rawOffer of args.offers) {
    const normalized = normalizeOffer(rawOffer);
    if (!normalized.externalId) {
      continue;
    }

    const [existingOffer] = await args.db
      .select()
      .from(schema.offers)
      .where(
        and(
          eq(schema.offers.tenantId, args.tenantId),
          eq(schema.offers.provider, 'dezrez'),
          eq(schema.offers.externalId, normalized.externalId),
        ),
      )
      .limit(1);

    if (existingOffer) {
      await args.db
        .update(schema.offers)
        .set({
          propertyId,
          propertyRoleExternalId: normalized.propertyRoleExternalId ?? args.roleExternalId,
          applicantName: normalized.applicantName,
          applicantEmail: normalized.applicantEmail,
          applicantGrade: normalized.applicantGrade,
          amount: normalized.amount,
          status: normalized.status,
          offeredAt: normalized.offeredAt,
          rawPayload: normalized.rawPayload,
          updatedAt: new Date(),
        })
        .where(eq(schema.offers.id, existingOffer.id));
      continue;
    }

    await args.db.insert(schema.offers).values({
      tenantId: args.tenantId,
      propertyId,
      provider: 'dezrez',
      externalId: normalized.externalId,
      propertyRoleExternalId: normalized.propertyRoleExternalId ?? args.roleExternalId,
      applicantName: normalized.applicantName,
      applicantEmail: normalized.applicantEmail,
      applicantGrade: normalized.applicantGrade,
      amount: normalized.amount,
      status: normalized.status,
      offeredAt: normalized.offeredAt,
      rawPayload: normalized.rawPayload,
    });
  }

  return { propertyId };
}

async function replaceViewingsForRole(args: {
  db: DbClient;
  tenantId: string;
  roleExternalId: string;
  viewings: Array<Record<string, unknown>>;
  viewingDetails: Array<Record<string, unknown>>;
}) {
  const propertyId = await findPropertyByRoleExternalId({
    db: args.db,
    tenantId: args.tenantId,
    roleExternalId: args.roleExternalId,
  });
  const detailsById = new Map(
    args.viewingDetails
      .map((viewing) => [getString(viewing.Id), viewing] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0])),
  );

  for (const rawViewing of args.viewings) {
    const externalId = getString(rawViewing.Id);
    if (!externalId) {
      continue;
    }

    const normalized = normalizeViewingSummary(rawViewing, detailsById.get(externalId));
    const [existingViewing] = await args.db
      .select()
      .from(schema.viewings)
      .where(
        and(
          eq(schema.viewings.tenantId, args.tenantId),
          eq(schema.viewings.provider, 'dezrez'),
          eq(schema.viewings.externalId, externalId),
        ),
      )
      .limit(1);

    if (existingViewing) {
      await args.db
        .update(schema.viewings)
        .set({
          propertyId,
          propertyRoleExternalId: normalized.propertyRoleExternalId ?? args.roleExternalId,
          applicantName: normalized.applicantName,
          applicantEmail: normalized.applicantEmail,
          applicantGrade: normalized.applicantGrade,
          eventStatus: normalized.eventStatus,
          feedbackCount: normalized.feedbackCount,
          notesCount: normalized.notesCount,
          startsAt: normalized.startsAt,
          rawPayload: normalized.rawPayload,
          updatedAt: new Date(),
        })
        .where(eq(schema.viewings.id, existingViewing.id));
      continue;
    }

    await args.db.insert(schema.viewings).values({
      tenantId: args.tenantId,
      propertyId,
      provider: 'dezrez',
      externalId,
      propertyRoleExternalId: normalized.propertyRoleExternalId ?? args.roleExternalId,
      applicantName: normalized.applicantName,
      applicantEmail: normalized.applicantEmail,
      applicantGrade: normalized.applicantGrade,
      eventStatus: normalized.eventStatus,
      feedbackCount: normalized.feedbackCount,
      notesCount: normalized.notesCount,
      startsAt: normalized.startsAt,
      rawPayload: normalized.rawPayload,
    });
  }

  return { propertyId };
}

function normalizeTimelineEvent(rawEvent: Record<string, unknown>) {
  const eventTypeObject = getObject(rawEvent.EventType);
  const actor =
    getObject(rawEvent.Negotiator) ??
    getObject(rawEvent.CreatedBy) ??
    getObject(rawEvent.StaffMember) ??
    getObject(rawEvent.User) ??
    getObject(rawEvent.Person);
  const eventType =
    getFirstString(
      eventTypeObject?.SystemName,
      eventTypeObject?.Name,
      rawEvent.EventType,
      rawEvent.Type,
      rawEvent.EventName,
    ) ?? 'activity';
  const title =
    getFirstString(
      rawEvent.Title,
      rawEvent.Subject,
      rawEvent.Description,
      rawEvent.Details,
      eventTypeObject?.Name,
    ) ?? humanizeIdentifier(eventType);
  const body = getFirstString(
    rawEvent.Body,
    rawEvent.Notes,
    rawEvent.Note,
    rawEvent.Message,
    rawEvent.Comments,
    rawEvent.Description,
    rawEvent.Details,
  );
  const occurredAt =
    getDate(rawEvent.OccurredAt) ??
    getDate(rawEvent.DateTime) ??
    getDate(rawEvent.EventDateTime) ??
    getDate(rawEvent.StartDate) ??
    getDate(rawEvent.CreatedDate) ??
    getDate(rawEvent.LastUpdated) ??
    new Date();
  const actorName = getFirstString(
    actor?.ContactName,
    actor?.Name,
    actor?.FullName,
    actor?.DisplayName,
    rawEvent.ActorName,
  );
  const actorEmail = getFirstString(actor?.PrimaryEmail, actor?.Email, rawEvent.ActorEmail);
  const eventId =
    getFirstString(
      rawEvent.Id,
      rawEvent.EventId,
      rawEvent.RootEntityId,
      rawEvent.SystemEventId,
      rawEvent.ActivityId,
    ) ?? buildSyntheticExternalId(rawEvent);

  return {
    externalId: eventId,
    propertyRoleExternalId: getFirstString(rawEvent.MarketingRoleId, rawEvent.PropertyRoleId),
    eventType,
    title,
    body,
    actorType: actorName || actorEmail ? 'external_user' : 'external_system',
    metadataJson: {
      actorName,
      actorEmail,
      providerEventType: getFirstString(eventTypeObject?.Name, eventTypeObject?.SystemName),
    },
    rawPayload: rawEvent,
    occurredAt,
  };
}

async function upsertTimelineEventsForRole(args: {
  db: DbClient;
  tenantId: string;
  roleExternalId: string;
  timelineEvents: Array<Record<string, unknown>>;
}) {
  const propertyId = await findPropertyByRoleExternalId({
    db: args.db,
    tenantId: args.tenantId,
    roleExternalId: args.roleExternalId,
  });
  let upsertedCount = 0;

  for (const rawEvent of args.timelineEvents) {
    const normalized = normalizeTimelineEvent(rawEvent);
    const [existingTimelineEvent] = await args.db
      .select()
      .from(schema.timelineEvents)
      .where(
        and(
          eq(schema.timelineEvents.tenantId, args.tenantId),
          eq(schema.timelineEvents.provider, 'dezrez'),
          eq(schema.timelineEvents.externalId, normalized.externalId),
        ),
      )
      .limit(1);

    if (existingTimelineEvent) {
      await args.db
        .update(schema.timelineEvents)
        .set({
          subjectType: 'property',
          subjectId: propertyId,
          propertyRoleExternalId: normalized.propertyRoleExternalId ?? args.roleExternalId,
          eventType: normalized.eventType,
          title: normalized.title,
          body: normalized.body,
          actorType: normalized.actorType,
          metadataJson: normalized.metadataJson,
          rawPayload: normalized.rawPayload,
          occurredAt: normalized.occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.timelineEvents.id, existingTimelineEvent.id));
      upsertedCount += 1;
      continue;
    }

    await args.db.insert(schema.timelineEvents).values({
      tenantId: args.tenantId,
      subjectType: 'property',
      subjectId: propertyId,
      provider: 'dezrez',
      externalId: normalized.externalId,
      propertyRoleExternalId: normalized.propertyRoleExternalId ?? args.roleExternalId,
      eventType: normalized.eventType,
      title: normalized.title,
      body: normalized.body,
      actorType: normalized.actorType,
      metadataJson: normalized.metadataJson,
      rawPayload: normalized.rawPayload,
      occurredAt: normalized.occurredAt,
    });
    upsertedCount += 1;
  }

  return { propertyId, upsertedCount };
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

async function loadDezrezIntegrationClient(args: {
  db: DbClient;
  integrationAccountId: string;
  tenantId: string;
}) {
  const [integrationAccount] = await args.db
    .select()
    .from(schema.integrationAccounts)
    .where(
      and(
        eq(schema.integrationAccounts.id, args.integrationAccountId),
        eq(schema.integrationAccounts.tenantId, args.tenantId),
        eq(schema.integrationAccounts.provider, 'dezrez'),
      ),
    )
    .limit(1);

  if (!integrationAccount) {
    throw new Error('integration_account_not_found');
  }

  const settings = dezrezIntegrationSettingsSchema.parse(integrationAccount.settingsJson ?? {});
  const decryptedCredentials = integrationAccount.credentialsJsonEncrypted
    ? decryptJsonPayload(
        integrationAccount.credentialsJsonEncrypted,
        process.env.APP_ENCRYPTION_KEY ?? '',
      )
    : {};
  const credentials = dezrezIntegrationCredentialsSchema.parse(decryptedCredentials);

  return {
    integrationAccount,
    client: createDezrezClient({
      settings,
      credentials,
    }),
  };
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
          propertyId: args.upstreamProperty.propertyId ?? null,
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
    externalType: 'property_role',
    externalId: args.upstreamProperty.externalId,
    metadataJson: {
      displayAddress: args.upstreamProperty.displayAddress,
      propertyId: args.upstreamProperty.propertyId ?? null,
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
      const { client } = await loadDezrezIntegrationClient({
        db: args.db,
        integrationAccountId: integrationAccount.id,
        tenantId: pendingEvent.tenantId,
      });
      const upstreamProperties = await client.listPropertiesForSync();
      let upsertCount = 0;

      for (const upstreamProperty of upstreamProperties) {
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
      const { client } = await loadDezrezIntegrationClient({
        db: args.db,
        integrationAccountId: job.integrationAccountId,
        tenantId: job.tenantId,
      });

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
      } else if (job.jobType === 'offer.role.refresh') {
        if (!job.entityExternalId) {
          throw new Error('role_external_id_required');
        }

        const offers = extractCollectionRecords(await client.getRoleOffers(job.entityExternalId));
        const { propertyId } = await replaceOffersForRole({
          db: args.db,
          tenantId: job.tenantId,
          roleExternalId: job.entityExternalId,
          offers,
        });

        await args.db.insert(schema.outboxEvents).values({
          tenantId: job.tenantId,
          eventName: 'offer.refreshed',
          entityType: 'offer',
          entityId: propertyId ?? COLLECTION_EVENT_ENTITY_ID,
          mutationType: 'refreshed',
          channelKey: buildTenantRoom(job.tenantId),
          payloadJson: {
            propertyRoleExternalId: job.entityExternalId,
            count: offers.length,
          },
        });
      } else if (job.jobType === 'viewing.role.refresh') {
        if (!job.entityExternalId) {
          throw new Error('role_external_id_required');
        }

        const [viewingsResponse, viewingDetailsResponse] = await Promise.all([
          client.getRoleViewingsBasic(job.entityExternalId),
          client.getRoleViewings(job.entityExternalId),
        ]);
        const viewings = extractCollectionRecords(viewingsResponse);
        const viewingDetails = extractCollectionRecords(viewingDetailsResponse);
        const { propertyId } = await replaceViewingsForRole({
          db: args.db,
          tenantId: job.tenantId,
          roleExternalId: job.entityExternalId,
          viewings,
          viewingDetails,
        });

        await args.db.insert(schema.outboxEvents).values({
          tenantId: job.tenantId,
          eventName: 'viewing.refreshed',
          entityType: 'viewing',
          entityId: propertyId ?? COLLECTION_EVENT_ENTITY_ID,
          mutationType: 'refreshed',
          channelKey: buildTenantRoom(job.tenantId),
          payloadJson: {
            propertyRoleExternalId: job.entityExternalId,
            count: viewings.length,
          },
        });
      } else if (job.jobType === 'timeline.role.refresh') {
        if (!job.entityExternalId) {
          throw new Error('role_external_id_required');
        }

        const timelineEvents = extractCollectionRecords(await client.getRoleEvents(job.entityExternalId));
        const { propertyId, upsertedCount } = await upsertTimelineEventsForRole({
          db: args.db,
          tenantId: job.tenantId,
          roleExternalId: job.entityExternalId,
          timelineEvents,
        });

        await args.db.insert(schema.outboxEvents).values({
          tenantId: job.tenantId,
          eventName: 'timeline.refreshed',
          entityType: 'timeline_event',
          entityId: propertyId ?? COLLECTION_EVENT_ENTITY_ID,
          mutationType: 'refreshed',
          channelKey: buildTenantRoom(job.tenantId),
          payloadJson: {
            propertyRoleExternalId: job.entityExternalId,
            count: upsertedCount,
          },
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
