import { decryptJsonPayload, getEncryptionSecretMetadata } from '@vitalspace/auth';
import {
  dezrezIntegrationCredentialsSchema,
  dezrezRefreshJobPayloadSchema,
  dezrezIntegrationSettingsSchema,
  dezrezWebhookPayloadSchema,
  propertySyncRequestPayloadSchema,
  type DezrezSeedProperty,
  type IntegrationJobType,
} from '@vitalspace/contracts';
import { type createDbClient, schema } from '@vitalspace/db';
import { buildTenantRoom } from '@vitalspace/realtime';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import {
  createDezrezClient,
  extractDezrezPropertyAddress,
  isPlaceholderPropertyDisplayAddress,
  normalizeDezrezPropertySummary,
} from './dezrez-client';
export {
  createDezrezClient,
  extractDezrezPropertyAddress,
  isPlaceholderPropertyDisplayAddress,
  normalizeDezrezPropertySummary,
} from './dezrez-client';

type DbClient = ReturnType<typeof createDbClient>['db'];

const COLLECTION_EVENT_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
const PROPERTY_STALE_CANDIDATE_MISS_THRESHOLD = 1;
const PROPERTY_DELIST_MISS_THRESHOLD = 3;
const PROPERTY_SYNC_ANOMALY_MIN_BASELINE = 20;
const PROPERTY_SYNC_ANOMALY_DROP_RATIO = 0.5;

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

function isMeaningfulExternalId(value: string | null | undefined) {
  return Boolean(value && value !== '0');
}

const PROPERTY_ROLE_REFRESH_FIELD_NAMES = new Set([
  'RoleStatus',
  'RoleType',
  'Price',
  'Value',
  'PriceValue',
  'Address',
  'DisplayAddress',
  'Postcode',
  'Bedrooms',
  'Bathrooms',
  'Receptions',
  'PropertyType',
  'Style',
  'Summary',
  'Description',
  'Features',
  'AvailableDate',
  'Deposit',
  'Term',
  'ServiceLevel',
]);

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

function extractWebhookChanges(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.AllChanges)) {
    return [] as Array<Record<string, unknown>>;
  }

  return payload.AllChanges.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function getWebhookChangeNames(payload: Record<string, unknown>) {
  return extractWebhookChanges(payload)
    .map((change) => getFirstString(change.PropertyName))
    .filter((name): name is string => Boolean(name));
}

function inferGenericEventSubtype(payload: Record<string, unknown>) {
  for (const change of extractWebhookChanges(payload)) {
    if (getFirstString(change.PropertyName) !== 'EventType') {
      continue;
    }

    const subtype = getFirstString(
      change.NewSystemName,
      change.NewName,
      change.NewValue,
      change.OldSystemName,
      change.OldName,
      change.OldValue,
    );
    if (subtype) {
      return subtype;
    }
  }

  return null;
}

function isTimelineChangeWebhook(payload: Record<string, unknown>) {
  return getWebhookChangeNames(payload).includes('Events');
}

function isPropertyAffectingWebhook(payload: Record<string, unknown>) {
  return getWebhookChangeNames(payload).some((name) => PROPERTY_ROLE_REFRESH_FIELD_NAMES.has(name));
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

function getFirstCollectionRecord(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  const collection = extractCollectionRecords(value);
  return collection[0] ?? null;
}

function buildSyntheticExternalId(rawEvent: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(rawEvent)).digest('hex');
}

function getPropertyIdFromReferenceMetadata(reference: ExternalReferenceLike) {
  if (!reference.metadataJson || typeof reference.metadataJson !== 'object') {
    return null;
  }

  return getString((reference.metadataJson as Record<string, unknown>).propertyId);
}

type ExternalReferenceLike = {
  metadataJson: unknown;
};

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
  }

  return sorted[midpoint] ?? null;
}

async function createPropertySyncRun(args: {
  db: DbClient;
  tenantId: string;
  integrationAccountId: string;
  triggerSource: string;
  metadataJson: Record<string, unknown> | null;
}) {
  const createdRuns = await args.db
    .insert(schema.propertySyncRuns)
    .values({
      tenantId: args.tenantId,
      integrationAccountId: args.integrationAccountId,
      triggerSource: args.triggerSource,
      syncType: 'full',
      status: 'running',
      metadataJson: args.metadataJson,
    })
    .returning();

  return requireValue(createdRuns[0], 'property_sync_run');
}

async function classifyPropertySyncRunHealth(args: {
  db: DbClient;
  integrationAccountId: string;
  currentPropertyCount: number;
}) {
  const previousHealthyRuns = await args.db
    .select({
      propertyCount: schema.propertySyncRuns.propertyCount,
    })
    .from(schema.propertySyncRuns)
    .where(
      and(
        eq(schema.propertySyncRuns.integrationAccountId, args.integrationAccountId),
        eq(schema.propertySyncRuns.status, 'completed'),
        eq(schema.propertySyncRuns.anomalyStatus, 'healthy'),
      ),
    )
    .orderBy(desc(schema.propertySyncRuns.completedAt), desc(schema.propertySyncRuns.startedAt))
    .limit(5);
  const baselineCounts = previousHealthyRuns
    .map((run) => Number(run.propertyCount ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const baselineMedian = median(baselineCounts);

  if (
    baselineMedian !== null &&
    baselineMedian >= PROPERTY_SYNC_ANOMALY_MIN_BASELINE &&
    args.currentPropertyCount === 0
  ) {
    return {
      anomalyStatus: 'anomalous' as const,
      anomalyReason: 'empty_feed_after_non_empty_history',
      baselineMedian,
    };
  }

  if (
    baselineMedian !== null &&
    baselineMedian >= PROPERTY_SYNC_ANOMALY_MIN_BASELINE &&
    args.currentPropertyCount < Math.ceil(baselineMedian * PROPERTY_SYNC_ANOMALY_DROP_RATIO)
  ) {
    return {
      anomalyStatus: 'anomalous' as const,
      anomalyReason: 'count_drop_exceeds_threshold',
      baselineMedian,
    };
  }

  return {
    anomalyStatus: 'healthy' as const,
    anomalyReason: null,
    baselineMedian,
  };
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

async function syncDezrezPropertyReferences(args: {
  db: DbClient;
  tenantId: string;
  propertyId: string;
  roleExternalId: string;
  providerPropertyId: string | null;
  displayAddress: string;
}) {
  const metadataJson = {
    displayAddress: args.displayAddress,
    propertyId: args.providerPropertyId,
  };

  if (args.providerPropertyId) {
    const [propertyReference] = await args.db
      .select()
      .from(schema.externalReferences)
      .where(
        and(
          eq(schema.externalReferences.tenantId, args.tenantId),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
          eq(schema.externalReferences.externalType, 'property'),
          eq(schema.externalReferences.externalId, args.providerPropertyId),
        ),
      )
      .limit(1);

    if (propertyReference) {
      await args.db
        .update(schema.externalReferences)
        .set({
          entityId: args.propertyId,
          metadataJson,
          isCurrent: true,
          supersededAt: null,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.externalReferences.id, propertyReference.id));
    } else {
      await args.db.insert(schema.externalReferences).values({
        tenantId: args.tenantId,
        provider: 'dezrez',
        entityType: 'property',
        entityId: args.propertyId,
        externalType: 'property',
        externalId: args.providerPropertyId,
        metadataJson,
        isCurrent: true,
        lastSeenAt: new Date(),
      });
    }
  }

  const [currentRoleReference] = await args.db
    .select()
    .from(schema.externalReferences)
    .where(
      and(
        eq(schema.externalReferences.tenantId, args.tenantId),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
        eq(schema.externalReferences.externalType, 'property_role'),
        eq(schema.externalReferences.entityId, args.propertyId),
        eq(schema.externalReferences.isCurrent, true),
      ),
    )
    .limit(1);

  if (currentRoleReference?.externalId !== args.roleExternalId) {
    await args.db
      .update(schema.externalReferences)
      .set({
        isCurrent: false,
        supersededAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.externalReferences.tenantId, args.tenantId),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
          eq(schema.externalReferences.externalType, 'property_role'),
          eq(schema.externalReferences.entityId, args.propertyId),
          eq(schema.externalReferences.isCurrent, true),
        ),
      );
  }

  const [roleReference] = await args.db
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

  if (roleReference) {
    await args.db
      .update(schema.externalReferences)
      .set({
        entityId: args.propertyId,
        metadataJson,
        isCurrent: true,
        supersededAt: null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.externalReferences.id, roleReference.id));
  } else {
    await args.db.insert(schema.externalReferences).values({
      tenantId: args.tenantId,
      provider: 'dezrez',
      entityType: 'property',
      entityId: args.propertyId,
      externalType: 'property_role',
      externalId: args.roleExternalId,
      metadataJson,
      isCurrent: true,
      lastSeenAt: new Date(),
    });
  }
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
  const hasRole = isMeaningfulExternalId(propertyRoleId);

  const pushRoleJob = (jobType: IntegrationJobType) => {
    if (!hasRole) {
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
    const jobs = pushRoleJob('timeline.role.refresh');
    if (isPropertyAffectingWebhook(payload)) {
      jobs.push(...pushRoleJob('property.role.refresh'));
    }
    return jobs;
  }

  if (!eventName && isTimelineChangeWebhook(payload)) {
    return pushRoleJob('timeline.role.refresh');
  }

  if (!eventName && isPropertyAffectingWebhook(payload)) {
    return pushRoleJob('property.role.refresh');
  }

  if (hasRole) {
    return pushRoleJob('property.role.refresh');
  }

  return [];
}

export function inferDezrezWebhookEventLabel(payload: Record<string, unknown>) {
  const parsed = dezrezWebhookPayloadSchema.safeParse(payload);
  const propertyRoleId =
    getString(payload.PropertyRoleId) ?? getString(payload.MarketingRoleId);
  const propertyId = getString(payload.PropertyId);
  const rootEntityId = getString(payload.RootEntityId);
  const documentId = getString(payload.DocumentId);
  const changeType = getString(payload.ChangeType);

  if (parsed.success && parsed.data.EventName) {
    if (parsed.data.EventName === 'GenericEvent') {
      const subtype = inferGenericEventSubtype(payload);
      return subtype ? `GenericEvent:${subtype}` : 'GenericEvent';
    }

    return parsed.data.EventName;
  }

  if (isMeaningfulExternalId(propertyRoleId) && isTimelineChangeWebhook(payload)) {
    return 'PropertyRoleEventsUpdated';
  }

  if (isMeaningfulExternalId(propertyRoleId)) {
    if (isMeaningfulExternalId(documentId)) {
      return 'PropertyRoleDocumentUpdated';
    }

    const normalizedChangeType =
      typeof changeType === 'string' && changeType.length > 0
        ? `${changeType.charAt(0).toUpperCase()}${changeType.slice(1).toLowerCase()}`
        : null;

    return normalizedChangeType ? `PropertyRole${normalizedChangeType}` : 'PropertyRoleUpdated';
  }

  if (isMeaningfulExternalId(propertyId)) {
    const normalizedChangeType =
      typeof changeType === 'string' && changeType.length > 0
        ? `${changeType.charAt(0).toUpperCase()}${changeType.slice(1).toLowerCase()}`
        : null;

    return normalizedChangeType ? `Property${normalizedChangeType}` : 'PropertyUpdated';
  }

  if (isMeaningfulExternalId(rootEntityId)) {
    const normalizedChangeType =
      typeof changeType === 'string' && changeType.length > 0
        ? `${changeType.charAt(0).toUpperCase()}${changeType.slice(1).toLowerCase()}`
        : null;

    return normalizedChangeType ? `Entity${normalizedChangeType}` : 'EntityUpdated';
  }

  return 'unknown';
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
  const encryptionSecret = process.env.APP_ENCRYPTION_KEY ?? '';
  const decryptedCredentials = integrationAccount.credentialsJsonEncrypted
    ? (() => {
        try {
          return decryptJsonPayload(integrationAccount.credentialsJsonEncrypted, encryptionSecret);
        } catch (error) {
          const secretMetadata = getEncryptionSecretMetadata(encryptionSecret);
          const details = JSON.stringify({
            integrationAccountId: integrationAccount.id,
            tenantId: integrationAccount.tenantId,
            pid: process.pid,
            encryptionSecretPresent: secretMetadata.present,
            encryptionSecretLength: secretMetadata.length,
            encryptionSecretTrimmedLength: secretMetadata.trimmedLength,
          });
          const errorMessage = error instanceof Error ? error.message : 'unknown_error';
          throw new Error(`integration_credentials_decrypt_failed:${errorMessage}:${details}`);
        }
      })()
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
  syncRunId?: string | null;
  allowPlaceholderCreate?: boolean;
}) {
  const [existingReferenceByExternalId] = await args.db
    .select()
    .from(schema.externalReferences)
    .where(
      and(
        eq(schema.externalReferences.tenantId, args.tenantId),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
        eq(schema.externalReferences.externalType, 'property_role'),
        eq(schema.externalReferences.externalId, args.upstreamProperty.externalId),
      ),
    )
    .limit(1);
  const [existingReferenceByPropertyId] = args.upstreamProperty.propertyId
    ? await args.db
        .select()
        .from(schema.externalReferences)
        .where(
          and(
            eq(schema.externalReferences.tenantId, args.tenantId),
            eq(schema.externalReferences.provider, 'dezrez'),
            eq(schema.externalReferences.entityType, 'property'),
            eq(schema.externalReferences.externalType, 'property'),
            eq(schema.externalReferences.externalId, args.upstreamProperty.propertyId),
          ),
        )
        .limit(1)
    : [undefined];
  const [existingReferenceByLegacyPropertyIdMetadata] = args.upstreamProperty.propertyId
    ? await args.db
        .select()
        .from(schema.externalReferences)
        .where(
          and(
            eq(schema.externalReferences.tenantId, args.tenantId),
            eq(schema.externalReferences.provider, 'dezrez'),
            eq(schema.externalReferences.entityType, 'property'),
            sql`${schema.externalReferences.metadataJson} ->> 'propertyId' = ${args.upstreamProperty.propertyId}`,
          ),
        )
        .limit(1)
    : [undefined];
  const existingReference =
    existingReferenceByExternalId ??
    existingReferenceByPropertyId ??
    existingReferenceByLegacyPropertyIdMetadata;

  if (existingReference) {
    const [existingProperty] = await args.db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, existingReference.entityId))
      .limit(1);
    const resolvedDisplayAddress =
      isPlaceholderPropertyDisplayAddress(args.upstreamProperty.displayAddress) &&
      existingProperty?.displayAddress &&
      !isPlaceholderPropertyDisplayAddress(existingProperty.displayAddress)
        ? existingProperty.displayAddress
        : args.upstreamProperty.displayAddress;
    const resolvedPostcode =
      args.upstreamProperty.postcode ??
      (existingProperty?.postcode && existingProperty.postcode.trim().length > 0 ? existingProperty.postcode : null);
    const updatedProperties = await args.db
      .update(schema.properties)
      .set({
        displayAddress: resolvedDisplayAddress,
        postcode: resolvedPostcode,
        status: args.upstreamProperty.status ?? 'active',
        marketingStatus: args.upstreamProperty.marketingStatus ?? null,
        syncState: 'active',
        consecutiveMissCount: 0,
        lastSeenAt: new Date(),
        lastSeenInSyncRunId: args.syncRunId ?? null,
        missingSinceSyncRunId: null,
        staleCandidateAt: null,
        delistedAt: null,
        delistedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.properties.id, existingReference.entityId))
      .returning();
    const property = requireValue(updatedProperties[0], 'property');

    await syncDezrezPropertyReferences({
      db: args.db,
      tenantId: args.tenantId,
      propertyId: property.id,
      roleExternalId: args.upstreamProperty.externalId,
      providerPropertyId: args.upstreamProperty.propertyId ?? null,
      displayAddress: resolvedDisplayAddress,
    });

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

  if (
    args.allowPlaceholderCreate === false &&
    isPlaceholderPropertyDisplayAddress(args.upstreamProperty.displayAddress) &&
    !args.upstreamProperty.postcode
  ) {
    return { propertyId: null, mutationType: 'skipped' as const };
  }

  const createdProperties = await args.db
    .insert(schema.properties)
      .values({
        tenantId: args.tenantId,
        displayAddress: args.upstreamProperty.displayAddress,
        postcode: args.upstreamProperty.postcode ?? null,
        status: args.upstreamProperty.status ?? 'active',
        marketingStatus: args.upstreamProperty.marketingStatus ?? null,
        syncState: 'active',
        consecutiveMissCount: 0,
        lastSeenAt: new Date(),
        lastSeenInSyncRunId: args.syncRunId ?? null,
      })
    .returning();
  const property = requireValue(createdProperties[0], 'property');

  await syncDezrezPropertyReferences({
    db: args.db,
    tenantId: args.tenantId,
    propertyId: property.id,
    roleExternalId: args.upstreamProperty.externalId,
    providerPropertyId: args.upstreamProperty.propertyId ?? null,
    displayAddress: args.upstreamProperty.displayAddress,
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

async function storePropertySyncInventory(args: {
  db: DbClient;
  tenantId: string;
  syncRunId: string;
  seenProperties: Array<{
    propertyId: string | null;
    externalId: string;
    providerPropertyId: string | null;
    displayAddress: string;
  }>;
}) {
  if (!args.seenProperties.length) {
    return;
  }

  await args.db.insert(schema.propertySyncInventory).values(
    args.seenProperties.map((property) => ({
      tenantId: args.tenantId,
      syncRunId: args.syncRunId,
      propertyId: property.propertyId,
      externalId: property.externalId,
      providerPropertyId: property.providerPropertyId,
      displayAddress: property.displayAddress,
    })),
  );
}

async function applyPropertySyncState(args: {
  db: DbClient;
  tenantId: string;
  syncRunId: string;
  seenRoleIds: Set<string>;
  seenProviderPropertyIds: Set<string>;
}) {
  const propertyReferences = await args.db
    .select({
      propertyId: schema.properties.id,
      tenantId: schema.properties.tenantId,
      syncState: schema.properties.syncState,
      consecutiveMissCount: schema.properties.consecutiveMissCount,
      lastSeenAt: schema.properties.lastSeenAt,
      lastSeenInSyncRunId: schema.properties.lastSeenInSyncRunId,
      missingSinceSyncRunId: schema.properties.missingSinceSyncRunId,
      staleCandidateAt: schema.properties.staleCandidateAt,
      delistedAt: schema.properties.delistedAt,
      externalId: schema.externalReferences.externalId,
      metadataJson: schema.externalReferences.metadataJson,
    })
    .from(schema.properties)
    .innerJoin(
      schema.externalReferences,
      and(
        eq(schema.externalReferences.tenantId, schema.properties.tenantId),
        eq(schema.externalReferences.entityId, schema.properties.id),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
      ),
    )
    .where(eq(schema.properties.tenantId, args.tenantId));

  const groupedByProperty = new Map<
    string,
    {
      propertyId: string;
      syncState: string;
      consecutiveMissCount: number;
      missingSinceSyncRunId: string | null;
      staleCandidateAt: Date | null;
      delistedAt: Date | null;
      references: Array<{ externalId: string; providerPropertyId: string | null }>;
    }
  >();

  for (const row of propertyReferences) {
    const existing = groupedByProperty.get(row.propertyId);
    if (existing) {
      existing.references.push({
        externalId: row.externalId,
        providerPropertyId: getPropertyIdFromReferenceMetadata(row),
      });
      continue;
    }

    groupedByProperty.set(row.propertyId, {
      propertyId: row.propertyId,
      syncState: row.syncState,
      consecutiveMissCount: row.consecutiveMissCount ?? 0,
      missingSinceSyncRunId: row.missingSinceSyncRunId ?? null,
      staleCandidateAt: row.staleCandidateAt ?? null,
      delistedAt: row.delistedAt ?? null,
      references: [
        {
          externalId: row.externalId,
          providerPropertyId: getPropertyIdFromReferenceMetadata(row),
        },
      ],
    });
  }

  for (const property of groupedByProperty.values()) {
    const seen = property.references.some(
      (reference) =>
        args.seenRoleIds.has(reference.externalId) ||
        (reference.providerPropertyId ? args.seenProviderPropertyIds.has(reference.providerPropertyId) : false),
    );

    if (seen) {
      await args.db
        .update(schema.properties)
        .set({
          syncState: 'active',
          consecutiveMissCount: 0,
          lastSeenAt: new Date(),
          lastSeenInSyncRunId: args.syncRunId,
          missingSinceSyncRunId: null,
          staleCandidateAt: null,
          delistedAt: null,
          delistedReason: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.properties.id, property.propertyId));
      continue;
    }

    const nextMissCount = property.consecutiveMissCount + 1;
    const becomesDelisted = nextMissCount >= PROPERTY_DELIST_MISS_THRESHOLD;
    const becomesStaleCandidate = nextMissCount >= PROPERTY_STALE_CANDIDATE_MISS_THRESHOLD;

    await args.db
      .update(schema.properties)
      .set({
        syncState: becomesDelisted ? 'delisted' : becomesStaleCandidate ? 'stale_candidate' : 'active',
        consecutiveMissCount: nextMissCount,
        missingSinceSyncRunId: property.missingSinceSyncRunId ?? args.syncRunId,
        staleCandidateAt: property.staleCandidateAt ?? new Date(),
        delistedAt: becomesDelisted ? property.delistedAt ?? new Date() : null,
        delistedReason: becomesDelisted ? 'missing_from_healthy_sync' : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.properties.id, property.propertyId));
  }

  const [staleCandidateCountRow, delistedCountRow] = await Promise.all([
    args.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.properties)
      .where(
        and(
          eq(schema.properties.tenantId, args.tenantId),
          eq(schema.properties.syncState, 'stale_candidate'),
        ),
      ),
    args.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.properties)
      .where(
        and(
          eq(schema.properties.tenantId, args.tenantId),
          eq(schema.properties.syncState, 'delisted'),
        ),
      ),
  ]);

  return {
    staleCandidateCount: Number(staleCandidateCountRow[0]?.count ?? 0),
    delistedCount: Number(delistedCountRow[0]?.count ?? 0),
  };
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

    let syncRun: typeof schema.propertySyncRuns.$inferSelect | null = null;

    try {
      console.log('@vitalspace/worker property.sync_requested processing', {
        outboxEventId: pendingEvent.id,
        tenantId: pendingEvent.tenantId,
        trigger:
          pendingEvent.payloadJson && typeof pendingEvent.payloadJson === 'object'
            ? (pendingEvent.payloadJson as Record<string, unknown>).trigger ?? null
            : null,
      });

      const triggerMetadata =
        parsedPayload.data.trigger && typeof parsedPayload.data.trigger === 'object'
          ? parsedPayload.data.trigger
          : null;
      syncRun = await createPropertySyncRun({
        db: args.db,
        tenantId: pendingEvent.tenantId,
        integrationAccountId: integrationAccount.id,
        triggerSource: triggerMetadata?.source ?? 'manual_api',
        metadataJson: {
          outboxEventId: pendingEvent.id,
          trigger: triggerMetadata,
        },
      });

      const { client } = await loadDezrezIntegrationClient({
        db: args.db,
        integrationAccountId: integrationAccount.id,
        tenantId: pendingEvent.tenantId,
      });
      const upstreamProperties = await client.listPropertiesForSync();
      let upsertCount = 0;
      const seenRoleIds = new Set<string>();
      const seenProviderPropertyIds = new Set<string>();
      const seenInventory: Array<{
        propertyId: string | null;
        externalId: string;
        providerPropertyId: string | null;
        displayAddress: string;
      }> = [];

      for (const upstreamProperty of upstreamProperties) {
        const { propertyId } = await upsertProperty({
          db: args.db,
          tenantId: pendingEvent.tenantId,
          requestedByUserId: parsedPayload.data.requestedByUserId,
          upstreamProperty,
          syncRunId: syncRun.id,
        });
        upsertCount += 1;
        seenRoleIds.add(upstreamProperty.externalId);
        if (upstreamProperty.propertyId) {
          seenProviderPropertyIds.add(upstreamProperty.propertyId);
        }
        seenInventory.push({
          propertyId,
          externalId: upstreamProperty.externalId,
          providerPropertyId: upstreamProperty.propertyId ?? null,
          displayAddress: upstreamProperty.displayAddress,
        });
      }

      await storePropertySyncInventory({
        db: args.db,
        tenantId: pendingEvent.tenantId,
        syncRunId: syncRun.id,
        seenProperties: seenInventory,
      });

      const health = await classifyPropertySyncRunHealth({
        db: args.db,
        integrationAccountId: integrationAccount.id,
        currentPropertyCount: upsertCount,
      });
      const stateCounts =
        health.anomalyStatus === 'healthy'
          ? await applyPropertySyncState({
              db: args.db,
              tenantId: pendingEvent.tenantId,
              syncRunId: syncRun.id,
              seenRoleIds,
              seenProviderPropertyIds,
            })
          : { staleCandidateCount: 0, delistedCount: 0 };

      await args.db
        .update(schema.propertySyncRuns)
        .set({
          status: 'completed',
          anomalyStatus: health.anomalyStatus,
          anomalyReason: health.anomalyReason,
          propertyCount: upsertCount,
          staleCandidateCount: stateCounts.staleCandidateCount,
          delistedCount: stateCounts.delistedCount,
          metadataJson: {
            outboxEventId: pendingEvent.id,
            trigger: triggerMetadata,
            baselineMedian: health.baselineMedian,
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.propertySyncRuns.id, syncRun.id));

      await args.db.insert(schema.auditLogs).values({
        tenantId: pendingEvent.tenantId,
        actorUserId: parsedPayload.data.requestedByUserId,
        actorType: parsedPayload.data.requestedByUserId ? 'user' : 'system',
        entityType: 'integration_account',
        entityId: integrationAccount.id,
        action: 'property.sync_completed',
        summary: `Completed Dezrez property sync with ${upsertCount} properties`,
        metadataJson: {
          syncRunId: syncRun.id,
          propertyCount: upsertCount,
          anomalyStatus: health.anomalyStatus,
          anomalyReason: health.anomalyReason,
          staleCandidateCount: stateCounts.staleCandidateCount,
          delistedCount: stateCounts.delistedCount,
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
          syncRunId: syncRun.id,
          propertyCount: upsertCount,
          anomalyStatus: health.anomalyStatus,
          anomalyReason: health.anomalyReason,
          staleCandidateCount: stateCounts.staleCandidateCount,
          delistedCount: stateCounts.delistedCount,
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
      if (syncRun) {
        await args.db
          .update(schema.propertySyncRuns)
          .set({
            status: 'failed',
            anomalyStatus: 'healthy',
            anomalyReason: null,
            completedAt: new Date(),
            metadataJson: {
              ...(syncRun.metadataJson && typeof syncRun.metadataJson === 'object'
                ? (syncRun.metadataJson as Record<string, unknown>)
                : {}),
              errorMessage: message,
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.propertySyncRuns.id, syncRun.id));
      }
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
      let createdJobsForWebhook = 0;
      let coalescedJobsForWebhook = 0;

      for (const job of jobs) {
        const [existingPendingJob] = await args.db
          .select({ id: schema.integrationJobs.id })
          .from(schema.integrationJobs)
          .where(
            and(
              eq(schema.integrationJobs.tenantId, webhookEvent.tenantId),
              eq(schema.integrationJobs.integrationAccountId, webhookEvent.integrationAccountId),
              eq(schema.integrationJobs.provider, 'dezrez'),
              eq(schema.integrationJobs.jobType, job.jobType),
              eq(schema.integrationJobs.entityType, job.entityType),
              job.entityExternalId === null
                ? sql`${schema.integrationJobs.entityExternalId} is null`
                : eq(schema.integrationJobs.entityExternalId, job.entityExternalId),
              eq(schema.integrationJobs.status, 'pending'),
            ),
          )
          .limit(1);

        if (existingPendingJob) {
          coalescedJobsForWebhook += 1;
          continue;
        }

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
        createdJobsForWebhook += 1;
      }

      await args.db
        .update(schema.webhookEvents)
        .set({
          processingStatus: createdJobsForWebhook > 0 ? 'processed' : 'ignored',
          processedAt: new Date(),
          errorMessage:
            createdJobsForWebhook > 0
              ? null
              : coalescedJobsForWebhook > 0
                ? 'coalesced_existing_job'
                : 'no_jobs_created',
        })
        .where(eq(schema.webhookEvents.id, webhookEvent.id));

      result.processedEvents += 1;
      result.createdJobs += createdJobsForWebhook;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'webhook_processing_failed';
      await args.db
        .update(schema.webhookEvents)
        .set({
          processingStatus: 'failed',
          errorMessage: message,
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
        let upstreamProperty =
          job.entityType === 'property_role' && job.entityExternalId
            ? normalizeDezrezPropertySummary(
                getFirstCollectionRecord(await client.getRole(job.entityExternalId)) ?? {},
              )
            : null;

        if (
          upstreamProperty &&
          upstreamProperty.propertyId &&
          isPlaceholderPropertyDisplayAddress(upstreamProperty.displayAddress)
        ) {
          const rawProperty = getFirstCollectionRecord(await client.getProperty(upstreamProperty.propertyId)) ?? {};
          const enrichedAddress = extractDezrezPropertyAddress(rawProperty);
          if (enrichedAddress.displayAddress && !isPlaceholderPropertyDisplayAddress(enrichedAddress.displayAddress)) {
            upstreamProperty = {
              ...upstreamProperty,
              displayAddress: enrichedAddress.displayAddress,
              postcode: enrichedAddress.postcode ?? upstreamProperty.postcode,
            };
          }
        }

        if (upstreamProperty) {
          const { propertyId } = await upsertProperty({
            db: args.db,
            tenantId: job.tenantId,
            requestedByUserId: null,
            upstreamProperty,
            allowPlaceholderCreate: false,
          });

          if (propertyId) {
            await args.db.insert(schema.outboxEvents).values({
              tenantId: job.tenantId,
              eventName: 'property.refreshed',
              entityType: 'property',
              entityId: propertyId,
              mutationType: 'refreshed',
              channelKey: buildTenantRoom(job.tenantId),
              payloadJson: {
                externalId: upstreamProperty.externalId,
                displayAddress: upstreamProperty.displayAddress,
              },
            });
          }
        } else {
          const queuedSyncRequests = await args.db
            .insert(schema.outboxEvents)
            .values({
              tenantId: job.tenantId,
              eventName: 'property.sync_requested',
              entityType: 'property',
              entityId: COLLECTION_EVENT_ENTITY_ID,
              mutationType: 'sync_requested',
              channelKey: buildTenantRoom(job.tenantId),
              payloadJson: propertySyncRequestPayloadSchema.parse({
                integrationAccountId: job.integrationAccountId,
                requestedByUserId: null,
                trigger: {
                  source: 'integration_job_fallback',
                  integrationJobId: job.id,
                  webhookEventId: payload.webhookEventId,
                  jobType: job.jobType,
                  entityType: job.entityType,
                  entityExternalId: job.entityExternalId ?? undefined,
                },
              }),
            })
            .returning();

          console.log('@vitalspace/worker property.sync_requested queued', {
            source: 'integration_job_fallback',
            outboxEventId: queuedSyncRequests[0]?.id ?? null,
            tenantId: job.tenantId,
            integrationAccountId: job.integrationAccountId,
            integrationJobId: job.id,
            webhookEventId: payload.webhookEventId,
            jobType: job.jobType,
            entityType: job.entityType,
            entityExternalId: job.entityExternalId,
          });
        }
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
      const message = error instanceof Error ? error.message : 'integration_job_failed';
      await markIntegrationJobFailed(
        args.db,
        job.id,
        message,
      );
      result.failedJobs += 1;
    }
  }

  return result;
}
