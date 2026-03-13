import {
  createOpaqueToken,
  encryptJsonPayload,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '@vitalspace/auth';
import type { EntityChangedEvent } from '@vitalspace/contracts';
import {
  createCaseNoteSchema,
  createCasePartySchema,
  createCaseSchema,
  createEmailTemplateSchema,
  createContactSchema,
  createLettingsApplicationSchema,
  createLettingsCaseSchema,
  createSalesCaseSchema,
  createSalesOfferSchema,
  createSmsTemplateSchema,
  createWorkflowTemplateSchema,
  createWorkflowTransitionSchema,
  dezrezIntegrationCredentialsSchema,
  dezrezIntegrationSettingsSchema,
  dezrezWebhookPayloadSchema,
  propertySyncRequestPayloadSchema,
  sendCaseCommunicationSchema,
  updateLettingsCaseSchema,
  updateSalesCaseSchema,
} from '@vitalspace/contracts';
import { type createDbClient, schema } from '@vitalspace/db';
import { buildEntityChangedEvent, buildTenantRoom } from '@vitalspace/realtime';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  hasTenantRole,
  loadAuthContext,
  type AuthenticatedContext,
} from './auth-context';
import {
  addCaseNoteRecord,
  addCasePartyRecord,
  createCaseRecord,
  createContactRecord,
  createWorkflowTemplateRecord,
  listCaseRecords,
  listContacts,
  listWorkflowTemplates,
  loadCaseDetail,
  loadCaseRecord,
  transitionWorkflowInstance,
} from './case-service';
import {
  createEmailTemplateRecord,
  createSmsTemplateRecord,
  listCaseCommunicationDispatches,
  listEmailTemplates,
  listSmsTemplates,
  sendCaseCommunicationRecord,
} from './communications-service';
import { loadStoredFile, persistUploadedFile } from './file-storage';
import {
  createLettingsApplicationRecord,
  createLettingsCaseRecord,
  ensureLettingsCaseExists,
  listLettingsApplications,
  listLettingsCaseRecords,
  loadLettingsCaseDetail,
  loadLettingsDashboard,
  updateLettingsCaseRecord,
} from './lettings-service';
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  maybeEncryptToken,
  parseOAuthState,
} from './oauth';
import {
  createSalesCaseRecord,
  createSalesOfferRecord,
  ensureSalesCaseExists,
  listSalesCaseRecords,
  listSalesOffers,
  loadSalesCaseDetail,
  loadSalesDashboard,
  updateSalesCaseRecord,
} from './sales-service';
import { loadTenantReconciliation } from './reconciliation-service';
import { resolveTenantFromHost } from './tenant-resolution';

type DbClient = ReturnType<typeof createDbClient>['db'];

export type ApiAppDeps = {
  db: DbClient;
  publishEntityChangedEvent?: (event: EntityChangedEvent) => void;
  oauthProviders?: string[];
};

type AuthenticatedRequest = Request & {
  auth?: AuthenticatedContext | null;
};

const COLLECTION_EVENT_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const oauthStartQuerySchema = z.object({
  redirectTo: z.string().url(),
});

const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const createTenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  branchName: z.string().min(1),
  branchSlug: z.string().min(1),
});

const createBranchSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
});

const createTenantDomainSchema = z.object({
  tenantId: z.string().uuid(),
  domain: z.string().min(1),
  domainType: z.enum(['subdomain', 'custom']),
  isPrimary: z.boolean().default(false),
  verificationStatus: z.enum(['pending', 'verified']).default('pending'),
});

const propertySyncRequestSchema = z.object({
  tenantId: z.string().uuid(),
});

const retrySyncRequestSchema = z.object({
  tenantId: z.string().uuid(),
  outboxEventId: z.string().uuid().optional(),
});

const retryIntegrationJobSchema = z.object({
  tenantId: z.string().uuid(),
  integrationJobId: z.string().uuid().optional(),
});

const replayWebhookSchema = z.object({
  tenantId: z.string().uuid(),
  webhookEventId: z.string().uuid().optional(),
});

const createDezrezAccountSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).default('Dezrez'),
  settings: dezrezIntegrationSettingsSchema,
  credentials: dezrezIntegrationCredentialsSchema.optional(),
});

const listPropertiesQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

const propertyParamsSchema = z.object({
  propertyId: z.string().uuid(),
});

const fileParamsSchema = z.object({
  fileId: z.string().uuid(),
});

const caseParamsSchema = z.object({
  caseId: z.string().uuid(),
});

const tenantScopedQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

const listContactsQuerySchema = z.object({
  tenantId: z.string().uuid(),
});

const listCasesQuerySchema = z.object({
  tenantId: z.string().uuid(),
  caseType: z.enum(['sales', 'lettings']).optional(),
  status: z.enum(['open', 'on_hold', 'completed', 'cancelled']).optional(),
  branchId: z.string().uuid().optional(),
});

const listWorkflowTemplatesQuerySchema = z.object({
  tenantId: z.string().uuid(),
  caseType: z.enum(['sales', 'lettings']).optional(),
});

const listSalesCasesQuerySchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(['open', 'on_hold', 'completed', 'cancelled']).optional(),
  saleStatus: z.string().min(1).optional(),
  branchId: z.string().uuid().optional(),
});

const listLettingsCasesQuerySchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(['open', 'on_hold', 'completed', 'cancelled']).optional(),
  lettingStatus: z.string().min(1).optional(),
  branchId: z.string().uuid().optional(),
});

const listFilesQuerySchema = z.object({
  tenantId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
});

const uploadFileSchema = z.object({
  tenantId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  label: z.string().min(1).optional(),
  originalName: z.string().min(1),
  contentType: z.string().min(1),
  base64Data: z.string().min(1),
});

const createWorkflowTemplateRequestSchema = createWorkflowTemplateSchema.extend({
  tenantId: z.string().uuid(),
});

const createCaseRequestSchema = createCaseSchema;
const createLettingsCaseRequestSchema = createLettingsCaseSchema;
const updateLettingsCaseRequestSchema = updateLettingsCaseSchema;
const createLettingsApplicationRequestSchema = createLettingsApplicationSchema;
const createSalesCaseRequestSchema = createSalesCaseSchema;
const updateSalesCaseRequestSchema = updateSalesCaseSchema;
const createSalesOfferRequestSchema = createSalesOfferSchema;
const createEmailTemplateRequestSchema = createEmailTemplateSchema;
const createSmsTemplateRequestSchema = createSmsTemplateSchema;
const sendCaseCommunicationRequestSchema = sendCaseCommunicationSchema;

const createCaseTransitionRequestSchema = createWorkflowTransitionSchema;

const webhookQuerySchema = z.object({
  provider: z.literal('dezrez').optional().default('dezrez'),
  integrationAccountId: z.string().uuid().optional(),
});

function toWebhookId(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function toWebhookChangeType(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function extractWebhookChanges(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.AllChanges)) {
    return [] as Array<Record<string, unknown>>;
  }

  return payload.AllChanges.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function inferGenericEventSubtype(payload: Record<string, unknown>) {
  for (const change of extractWebhookChanges(payload)) {
    if (toWebhookId(change.PropertyName) !== 'EventType') {
      continue;
    }

    const subtype =
      toWebhookId(change.NewSystemName) ??
      toWebhookId(change.NewName) ??
      toWebhookId(change.NewValue) ??
      toWebhookId(change.OldSystemName) ??
      toWebhookId(change.OldName) ??
      toWebhookId(change.OldValue);
    if (subtype) {
      return subtype;
    }
  }

  return null;
}

function hasWebhookChange(payload: Record<string, unknown>, propertyName: string) {
  return extractWebhookChanges(payload).some((change) => toWebhookId(change.PropertyName) === propertyName);
}

function inferContactItemWebhookEventType(payload: Record<string, unknown>) {
  const contactAddressId = toWebhookId(payload.ContactAddressId);
  if (contactAddressId && contactAddressId !== '0') {
    const changeType = toWebhookChangeType(payload.ChangeType) ?? 'Updated';
    return `ContactAddress${changeType}`;
  }

  const contactItemId =
    toWebhookId(payload.NewEmailContactItemId) ??
    toWebhookId(payload.NewPhoneContactItemId) ??
    toWebhookId(payload.NewAddressContactItemId) ??
    toWebhookId(payload.NewContactItemId);
  if (!contactItemId || contactItemId === '0') {
    return null;
  }

  const contactItemType = extractWebhookChanges(payload).find(
    (change) => toWebhookId(change.PropertyName) === 'ContactItemType',
  );
  const contactType =
    toWebhookId(contactItemType?.NewSystemName) ??
    toWebhookId(contactItemType?.NewName) ??
    toWebhookId(contactItemType?.NewValue) ??
    'ContactItem';
  const changeType = toWebhookChangeType(payload.ChangeType) ?? 'Updated';

  return `${contactType}ContactItem${changeType}`;
}

function inferDezrezWebhookEventType(payload: Record<string, unknown>) {
  const parsed = dezrezWebhookPayloadSchema.safeParse(payload);
  if (parsed.success && parsed.data.EventName) {
    if (parsed.data.EventName === 'GenericEvent') {
      const subtype = inferGenericEventSubtype(payload);
      return subtype ? `GenericEvent:${subtype}` : 'GenericEvent';
    }

    return parsed.data.EventName;
  }

  const propertyRoleId =
    toWebhookId(payload.PropertyRoleId) ?? toWebhookId(payload.MarketingRoleId);
  const propertyId = toWebhookId(payload.PropertyId);
  const rootEntityId = toWebhookId(payload.RootEntityId);
  const documentId = toWebhookId(payload.DocumentId);
  const changeType = toWebhookChangeType(payload.ChangeType);
  const contactItemEventType = inferContactItemWebhookEventType(payload);

  if (contactItemEventType) {
    return contactItemEventType;
  }

  if (propertyRoleId && propertyRoleId !== '0') {
    if (hasWebhookChange(payload, 'Events')) {
      return 'PropertyRoleEventsUpdated';
    }

    if (documentId && documentId !== '0') {
      return 'PropertyRoleDocumentUpdated';
    }

    return changeType ? `PropertyRole${changeType}` : 'PropertyRoleUpdated';
  }

  if (propertyId && propertyId !== '0') {
    return changeType ? `Property${changeType}` : 'PropertyUpdated';
  }

  if (rootEntityId && rootEntityId !== '0') {
    return changeType ? `Entity${changeType}` : 'EntityUpdated';
  }

  return 'unknown';
}

function summarizeWebhookPayload(payload: Record<string, unknown>) {
  const agencyId = toWebhookId(payload.AgencyId);
  const branchId = toWebhookId(payload.BranchId);
  const propertyId = toWebhookId(payload.PropertyId);
  const propertyRoleId = toWebhookId(payload.PropertyRoleId) ?? toWebhookId(payload.MarketingRoleId);
  const rootEntityId = toWebhookId(payload.RootEntityId);
  const documentId = toWebhookId(payload.DocumentId);
  const changedByPersonId = toWebhookId(payload.ChangedByPersonId);
  const personId = toWebhookId(payload.PersonId);

  return {
    agencyId: agencyId && agencyId !== '0' ? agencyId : null,
    branchId: branchId && branchId !== '0' ? branchId : null,
    propertyId: propertyId && propertyId !== '0' ? propertyId : null,
    propertyRoleId: propertyRoleId && propertyRoleId !== '0' ? propertyRoleId : null,
    rootEntityId: rootEntityId && rootEntityId !== '0' ? rootEntityId : null,
    documentId: documentId && documentId !== '0' ? documentId : null,
    changedByPersonId: changedByPersonId && changedByPersonId !== '0' ? changedByPersonId : null,
    personId: personId && personId !== '0' ? personId : null,
    changeType: toWebhookChangeType(payload.ChangeType),
    occurredAt:
      typeof payload.Occurred === 'string' && payload.Occurred.trim().length > 0 ? payload.Occurred : null,
  };
}

function shouldLogWebhookPayload(eventType: string) {
  return eventType === 'unknown';
}

async function recordMutation(args: {
  db: DbClient;
  actorUserId: string | null;
  tenantId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  mutationType: string;
  payload?: Record<string, unknown>;
  publishEntityChangedEvent: ((event: EntityChangedEvent) => void) | undefined;
}) {
  await args.db.insert(schema.auditLogs).values({
    tenantId: args.tenantId,
    actorUserId: args.actorUserId,
    actorType: args.actorUserId ? 'user' : 'system',
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    summary: args.summary,
    metadataJson: args.payload ?? null,
  });

  if (args.tenantId) {
    await args.db.insert(schema.outboxEvents).values({
      tenantId: args.tenantId,
      eventName: `${args.entityType}.${args.mutationType}`,
      entityType: args.entityType,
      entityId: args.entityId,
      mutationType: args.mutationType,
      channelKey: buildTenantRoom(args.tenantId),
      payloadJson: args.payload ?? null,
      status: args.publishEntityChangedEvent ? 'published' : 'pending',
      publishedAt: args.publishEntityChangedEvent ? new Date() : null,
    });

    args.publishEntityChangedEvent?.(
      buildEntityChangedEvent({
        tenantId: args.tenantId,
        entityType: args.entityType,
        entityId: args.entityId,
        mutationType: args.mutationType,
        payload: args.payload,
      }),
    );
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as AuthenticatedRequest).auth) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label}_not_found`);
  }

  return value;
}

function hasTenantMembership(auth: AuthenticatedContext, tenantId: string) {
  return auth.memberships.some((membership) => membership.tenantId === tenantId);
}

async function createSession(args: {
  db: DbClient;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await args.db.insert(schema.sessions).values({
    userId: args.userId,
    sessionTokenHash: hashOpaqueToken(token),
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
    expiresAt,
  });
  await args.db
    .update(schema.users)
    .set({
      lastLoginAt: new Date(),
    })
    .where(eq(schema.users.id, args.userId));

  return token;
}

async function loadPropertyRecord(args: {
  db: DbClient;
  tenantId: string;
  propertyId: string;
}) {
  const currentDezrezPropertyRoleReferences = args.db
    .selectDistinctOn([schema.externalReferences.entityId], {
      tenantId: schema.externalReferences.tenantId,
      entityId: schema.externalReferences.entityId,
      externalId: schema.externalReferences.externalId,
      provider: schema.externalReferences.provider,
      metadataJson: schema.externalReferences.metadataJson,
    })
    .from(schema.externalReferences)
    .where(
      and(
        eq(schema.externalReferences.tenantId, args.tenantId),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
        eq(schema.externalReferences.externalType, 'property_role'),
        eq(schema.externalReferences.isCurrent, true),
      ),
    )
    .orderBy(
      schema.externalReferences.entityId,
      desc(schema.externalReferences.updatedAt),
      desc(schema.externalReferences.createdAt),
    )
    .as('current_dezrez_property_role_references');

  const [property] = await args.db
    .select({
      id: schema.properties.id,
      tenantId: schema.properties.tenantId,
      branchId: schema.properties.branchId,
      displayAddress: schema.properties.displayAddress,
      postcode: schema.properties.postcode,
      status: schema.properties.status,
      marketingStatus: schema.properties.marketingStatus,
      syncState: schema.properties.syncState,
      consecutiveMissCount: schema.properties.consecutiveMissCount,
      lastSeenAt: schema.properties.lastSeenAt,
      staleCandidateAt: schema.properties.staleCandidateAt,
      delistedAt: schema.properties.delistedAt,
      delistedReason: schema.properties.delistedReason,
      externalId: currentDezrezPropertyRoleReferences.externalId,
      provider: currentDezrezPropertyRoleReferences.provider,
      propertyExternalMetadata: currentDezrezPropertyRoleReferences.metadataJson,
      createdAt: schema.properties.createdAt,
      updatedAt: schema.properties.updatedAt,
    })
    .from(schema.properties)
    .leftJoin(
      currentDezrezPropertyRoleReferences,
      and(
        eq(currentDezrezPropertyRoleReferences.tenantId, schema.properties.tenantId),
        eq(currentDezrezPropertyRoleReferences.entityId, schema.properties.id),
      ),
    )
    .where(
      and(
        eq(schema.properties.tenantId, args.tenantId),
        eq(schema.properties.id, args.propertyId),
      ),
    )
    .limit(1);

  return property ?? null;
}

async function queueManualDezrezRoleRefreshJobs(args: {
  db: DbClient;
  tenantId: string;
  integrationAccountId: string;
  propertyExternalId: string;
  propertyMetadata: Record<string, unknown> | null;
}) {
  const propertyIdValue =
    args.propertyMetadata && typeof args.propertyMetadata.propertyId !== 'undefined'
      ? String(args.propertyMetadata.propertyId)
      : null;
  const rawEvent = {
    EventName: 'ManualRefresh',
    PropertyId: propertyIdValue,
    PropertyRoleId: args.propertyExternalId,
    RootEntityId: null,
  };

  const jobs = [
    'offer.role.refresh',
    'viewing.role.refresh',
    'timeline.role.refresh',
  ] as const;

  for (const jobType of jobs) {
    await args.db
      .insert(schema.integrationJobs)
      .values({
        tenantId: args.tenantId,
        integrationAccountId: args.integrationAccountId,
        webhookEventId: null,
        provider: 'dezrez',
        jobType,
        entityType: 'property_role',
        entityExternalId: args.propertyExternalId,
        dedupeKey: `${args.integrationAccountId}:${jobType}:manual:${args.propertyExternalId}`,
        payloadJson: {
          webhookEventId: COLLECTION_EVENT_ENTITY_ID,
          eventName: 'ManualRefresh',
          propertyId: propertyIdValue,
          propertyRoleId: args.propertyExternalId,
          rootEntityId: null,
          rawEvent,
        },
      })
      .onConflictDoNothing({
        target: [schema.integrationJobs.provider, schema.integrationJobs.dedupeKey],
      });
  }
}

function hasNonEmptyCredentials(credentials: Record<string, unknown>) {
  return Object.values(credentials).some((value) => value !== undefined && value !== null && value !== '');
}

async function resolveIntegrationAccount(args: {
  db: DbClient;
  provider: string;
  payload?: Record<string, unknown> | undefined;
  integrationAccountId?: string | undefined;
}) {
  if (args.integrationAccountId) {
    const [integrationAccount] = await args.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.id, args.integrationAccountId),
          eq(schema.integrationAccounts.provider, args.provider),
          eq(schema.integrationAccounts.status, 'active'),
        ),
      )
      .limit(1);
    return integrationAccount ?? null;
  }

  const integrationAccounts = await args.db
    .select()
    .from(schema.integrationAccounts)
    .where(
      and(
        eq(schema.integrationAccounts.provider, args.provider),
        eq(schema.integrationAccounts.status, 'active'),
      ),
    );

  if (args.provider === 'dezrez' && args.payload) {
    const payloadAgencyId =
      typeof args.payload.AgencyId === 'number'
        ? args.payload.AgencyId
        : typeof args.payload.AgencyId === 'string' && args.payload.AgencyId.trim().length > 0
          ? Number(args.payload.AgencyId)
          : null;
    const payloadBranchId =
      typeof args.payload.BranchId === 'number'
        ? args.payload.BranchId
        : typeof args.payload.BranchId === 'string' && args.payload.BranchId.trim().length > 0
          ? Number(args.payload.BranchId)
          : null;

    const parsedAgencyId =
      payloadAgencyId !== null && Number.isFinite(payloadAgencyId) && payloadAgencyId > 0
        ? payloadAgencyId
        : null;
    const parsedBranchId =
      payloadBranchId !== null && Number.isFinite(payloadBranchId) && payloadBranchId > 0
        ? payloadBranchId
        : null;

    if (parsedAgencyId !== null) {
      const agencyMatches = integrationAccounts.filter((integrationAccount) => {
        const parsedSettings = dezrezIntegrationSettingsSchema.safeParse(integrationAccount.settingsJson ?? {});
        if (!parsedSettings.success) {
          return false;
        }

        return parsedSettings.data.agencyId === parsedAgencyId;
      });

      if (parsedBranchId !== null) {
        const exactBranchMatches = agencyMatches.filter((integrationAccount) => {
          const parsedSettings = dezrezIntegrationSettingsSchema.safeParse(
            integrationAccount.settingsJson ?? {},
          );
          return parsedSettings.success && parsedSettings.data.branchIds.includes(parsedBranchId);
        });
        if (exactBranchMatches.length === 1) {
          return exactBranchMatches[0] ?? null;
        }
        if (exactBranchMatches.length > 1) {
          return null;
        }

        const wildcardBranchMatches = agencyMatches.filter((integrationAccount) => {
          const parsedSettings = dezrezIntegrationSettingsSchema.safeParse(
            integrationAccount.settingsJson ?? {},
          );
          return parsedSettings.success && parsedSettings.data.branchIds.length === 0;
        });
        if (wildcardBranchMatches.length === 1) {
          return wildcardBranchMatches[0] ?? null;
        }
        if (wildcardBranchMatches.length > 1) {
          return null;
        }
      }

      if (agencyMatches.length === 1) {
        return agencyMatches[0] ?? null;
      }

      if (agencyMatches.length === 0 && integrationAccounts.length === 1) {
        return integrationAccounts[0] ?? null;
      }

      return null;
    }
  }

  if (integrationAccounts.length === 1) {
    return integrationAccounts[0] ?? null;
  }

  return null;
}

export function createApp(deps: ApiAppDeps) {
  const app = express();

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  });

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        if ((req.url ?? '').startsWith('/event')) {
          (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
        }
      },
    }),
  );

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/event') {
      console.error('@vitalspace/api /event json_parse_failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
        rawBody: (req as Request & { rawBody?: string }).rawBody ?? null,
      });
    }

    if (
      error &&
      typeof error === 'object' &&
      'type' in error &&
      (error as { type?: string }).type === 'entity.parse.failed'
    ) {
      return res.status(400).json({ error: 'invalid_json' });
    }

    return next(error);
  });

  app.use(async (req, _res, next) => {
    const authReq = req as AuthenticatedRequest;
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice('Bearer '.length);
    authReq.auth = await loadAuthContext(deps.db, token);
    return next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'api' });
  });

  app.get('/api/v1/bootstrap', (_req: Request, res: Response) => {
    void (async () => {
      const resolvedTenant = await resolveTenantFromHost({
        db: deps.db,
        host: _req.header('x-forwarded-host') ?? _req.header('host'),
      });

      res.json({
      appName: 'VitalSpace',
      realtimeEnabled: true,
      oauthProviders: deps.oauthProviders ?? [],
        resolvedTenant,
      });
    })().catch((error) => {
      res.status(500).json({
        error: 'bootstrap_failed',
        message: error instanceof Error ? error.message : 'unknown_error',
      });
    });
  });

  app.post('/event', async (req: Request, res: Response) => {
    const parsedQuery = webhookQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsedQuery.error.flatten() });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const sharedSecret = process.env.DEZREZ_WEBHOOK_SECRET;
    const providedSecret = req.header('x-vitalspace-webhook-secret') ?? req.query.secret;
    const signatureValid =
      !sharedSecret || (typeof providedSecret === 'string' && providedSecret === sharedSecret);
    const integrationAccount = await resolveIntegrationAccount({
      db: deps.db,
      provider: parsedQuery.data.provider,
      payload: req.body as Record<string, unknown>,
      integrationAccountId: parsedQuery.data.integrationAccountId,
    });

    const eventName =
      parsedQuery.data.provider === 'dezrez'
        ? inferDezrezWebhookEventType(req.body as Record<string, unknown>)
        : 'unknown';

    if (shouldLogWebhookPayload(eventName)) {
      console.log(`@vitalspace/api /event ${eventName} body`, JSON.stringify(req.body));
    }

    const createdWebhookEvents = await deps.db
      .insert(schema.webhookEvents)
      .values({
        tenantId: integrationAccount?.tenantId ?? null,
        integrationAccountId: integrationAccount?.id ?? null,
        provider: parsedQuery.data.provider,
        eventType: eventName,
        signatureValid,
        payloadJson: req.body as Record<string, unknown>,
        processingStatus: signatureValid ? 'pending' : 'rejected',
        errorMessage: signatureValid ? null : 'invalid_signature',
      })
      .returning();
    const webhookEvent = requireValue(createdWebhookEvents[0], 'webhook_event');

    if (!signatureValid) {
      return res.status(401).json({ error: 'invalid_signature', webhookEventId: webhookEvent.id });
    }

    return res.status(202).json({
      accepted: true,
      webhookEventId: webhookEvent.id,
      provider: parsedQuery.data.provider,
      integrationAccountId: integrationAccount?.id ?? null,
    });
  });

  app.post('/api/v1/auth/signup', async (req: Request, res: Response) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    const emailNormalized = normalizeEmail(parsed.data.email);
    const [existingUser] = await deps.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailNormalized, emailNormalized))
      .limit(1);

    if (existingUser) {
      return res.status(409).json({ error: 'email_in_use' });
    }

    const createdUsers = await deps.db
      .insert(schema.users)
      .values({
        email: parsed.data.email,
        emailNormalized,
        firstName: parsed.data.firstName ?? null,
        lastName: parsed.data.lastName ?? null,
        displayName:
          [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(' ') || emailNormalized,
      })
      .returning();
    const user = requireValue(createdUsers[0], 'user');

    await deps.db.insert(schema.credentials).values({
      userId: user.id,
      passwordHash: hashPassword(parsed.data.password),
      passwordSetAt: new Date(),
    });

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
    });
  });

  app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    const emailNormalized = normalizeEmail(parsed.data.email);
    const [row] = await deps.db
      .select({
        user: schema.users,
        credential: schema.credentials,
      })
      .from(schema.users)
      .innerJoin(schema.credentials, eq(schema.credentials.userId, schema.users.id))
      .where(eq(schema.users.emailNormalized, emailNormalized))
      .limit(1);

    if (!row || !verifyPassword(parsed.data.password, row.credential.passwordHash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const token = await createSession({
      db: deps.db,
      userId: row.user.id,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    return res.json({
      accessToken: token,
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
      },
    });
  });

  app.get('/api/v1/auth/oauth/google/start', async (req: Request, res: Response) => {
    if (!deps.oauthProviders?.includes('google')) {
      return res.status(404).json({ error: 'provider_not_available' });
    }

    const parsed = oauthStartQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    const callbackUrl = new URL('/api/v1/auth/oauth/google/callback', `${req.protocol}://${req.get('host')}`);
    return res.redirect(
      buildGoogleAuthorizationUrl({
        callbackUrl: callbackUrl.toString(),
        redirectTo: parsed.data.redirectTo,
      }),
    );
  });

  app.get('/api/v1/auth/oauth/google/callback', async (req: Request, res: Response) => {
    if (!deps.oauthProviders?.includes('google')) {
      return res.status(404).json({ error: 'provider_not_available' });
    }

    const parsed = oauthCallbackQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    const state = parseOAuthState(parsed.data.state);
    if (!state) {
      return res.status(400).json({ error: 'invalid_oauth_state' });
    }

    const callbackUrl = new URL('/api/v1/auth/oauth/google/callback', `${req.protocol}://${req.get('host')}`);
    const profile = await exchangeGoogleCode({
      code: parsed.data.code,
      callbackUrl: callbackUrl.toString(),
    });

    let [oauthAccount] = await deps.db
      .select()
      .from(schema.oauthAccounts)
      .where(
        and(
          eq(schema.oauthAccounts.provider, 'google'),
          eq(schema.oauthAccounts.providerUserId, profile.providerUserId),
        ),
      )
      .limit(1);

    let userId = oauthAccount?.userId ?? null;

    if (!userId && profile.email) {
      const [existingUser] = await deps.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.emailNormalized, profile.email))
        .limit(1);
      userId = existingUser?.id ?? null;
    }

    if (!userId) {
      const createdUsers = await deps.db
        .insert(schema.users)
        .values({
          email: profile.email,
          emailNormalized: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          displayName: profile.displayName ?? profile.email ?? profile.providerUserId,
        })
        .returning();
      userId = requireValue(createdUsers[0], 'oauth_user').id;
    }

    const oauthAccountPayload = {
      userId,
      provider: 'google' as const,
      providerUserId: profile.providerUserId,
      emailFromProvider: profile.email,
      accessTokenEncrypted: maybeEncryptToken(profile.accessToken),
      refreshTokenEncrypted: maybeEncryptToken(profile.refreshToken),
      tokenExpiresAt: profile.expiresAt,
      profileJson: profile.profile,
      updatedAt: new Date(),
    };

    if (oauthAccount) {
      await deps.db
        .update(schema.oauthAccounts)
        .set(oauthAccountPayload)
        .where(eq(schema.oauthAccounts.id, oauthAccount.id));
    } else {
      const createdAccounts = await deps.db
        .insert(schema.oauthAccounts)
        .values(oauthAccountPayload)
        .returning();
      oauthAccount = requireValue(createdAccounts[0], 'oauth_account');
    }

    const token = await createSession({
      db: deps.db,
      userId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    const redirectUrl = new URL(state.redirectTo);
    redirectUrl.searchParams.set('accessToken', token);
    redirectUrl.searchParams.set('provider', 'google');
    return res.redirect(redirectUrl.toString());
  });

  app.post('/api/v1/auth/logout', requireAuth, async (req: Request, res: Response) => {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    await deps.db
      .update(schema.sessions)
      .set({
        revokedAt: new Date(),
      })
      .where(eq(schema.sessions.sessionTokenHash, hashOpaqueToken(authHeader.slice('Bearer '.length))));

    return res.status(204).send();
  });

  app.get('/api/v1/me', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    return res.json({
      userId: authReq.auth?.userId,
      email: authReq.auth?.email,
      memberships: authReq.auth?.memberships ?? [],
    });
  });

  app.get('/api/v1/contacts', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listContactsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const contacts = await listContacts({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({ contacts });
  });

  app.post('/api/v1/contacts', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const contact = await createContactRecord({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      contactType: parsed.data.contactType,
      displayName: parsed.data.displayName,
      ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
      ...(parsed.data.firstName !== undefined ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName !== undefined ? { lastName: parsed.data.lastName } : {}),
      ...(parsed.data.organizationName !== undefined
        ? { organizationName: parsed.data.organizationName }
        : {}),
      ...(parsed.data.primaryEmail !== undefined ? { primaryEmail: parsed.data.primaryEmail } : {}),
      ...(parsed.data.primaryPhone !== undefined ? { primaryPhone: parsed.data.primaryPhone } : {}),
      ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
    });

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'contact',
      entityId: contact.id,
      action: 'contact.created',
      summary: `Created contact ${contact.displayName}`,
      mutationType: 'created',
      payload: {
        contactType: contact.contactType,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({ contact });
  });

  app.get('/api/v1/workflow-templates', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listWorkflowTemplatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const workflowTemplates = await listWorkflowTemplates({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      ...(parsed.data.caseType !== undefined ? { caseType: parsed.data.caseType } : {}),
    });

    return res.json({ workflowTemplates });
  });

  app.post('/api/v1/workflow-templates', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createWorkflowTemplateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const workflowTemplateBundle = await createWorkflowTemplateRecord({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      key: parsed.data.key,
      name: parsed.data.name,
      status: parsed.data.status,
      isSystem: parsed.data.isSystem,
      ...(parsed.data.caseType !== undefined ? { caseType: parsed.data.caseType } : {}),
      ...(parsed.data.definition !== undefined ? { definition: parsed.data.definition } : {}),
      stages: parsed.data.stages.map((stage) => ({
        key: stage.key,
        name: stage.name,
        stageOrder: stage.stageOrder,
        ...(stage.isTerminal !== undefined ? { isTerminal: stage.isTerminal } : {}),
        ...(stage.config !== undefined ? { config: stage.config } : {}),
      })),
    });

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'workflow_template',
      entityId: workflowTemplateBundle.workflowTemplate.id,
      action: 'workflow_template.created',
      summary: `Created workflow template ${workflowTemplateBundle.workflowTemplate.name}`,
      mutationType: 'created',
      payload: {
        caseType: workflowTemplateBundle.workflowTemplate.caseType,
        stageCount: workflowTemplateBundle.workflowStages.length,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({
      workflowTemplate: workflowTemplateBundle.workflowTemplate,
      workflowStages: workflowTemplateBundle.workflowStages,
    });
  });

  app.get('/api/v1/cases', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listCasesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const cases = await listCaseRecords({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      ...(parsed.data.caseType !== undefined ? { caseType: parsed.data.caseType } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
    });

    return res.json({ cases });
  });

  app.post('/api/v1/cases', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createCaseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const createdCaseBundle = await createCaseRecord({
        db: deps.db,
        tenantId: parsed.data.tenantId,
        caseType: parsed.data.caseType,
        status: parsed.data.status,
        title: parsed.data.title,
        ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
        ...(parsed.data.propertyId !== undefined ? { propertyId: parsed.data.propertyId } : {}),
        ...(parsed.data.workflowTemplateId !== undefined
          ? { workflowTemplateId: parsed.data.workflowTemplateId }
          : {}),
        ...(parsed.data.reference !== undefined ? { reference: parsed.data.reference } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsed.data.tenantId,
        entityType: 'case',
        entityId: createdCaseBundle.caseRecord.id,
        action: 'case.created',
        summary: `Created ${createdCaseBundle.caseRecord.caseType} case ${createdCaseBundle.caseRecord.title}`,
        mutationType: 'created',
        payload: {
          caseType: createdCaseBundle.caseRecord.caseType,
          propertyId: createdCaseBundle.caseRecord.propertyId,
          workflowTemplateId: createdCaseBundle.workflowTemplate?.id ?? null,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({
        case: createdCaseBundle.caseRecord,
        workflow: createdCaseBundle.workflowInstance
          ? {
              instance: createdCaseBundle.workflowInstance,
              template: createdCaseBundle.workflowTemplate,
              stages: createdCaseBundle.workflowStages,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'workflow_template_case_type_mismatch') {
        return res.status(400).json({ error: 'workflow_template_case_type_mismatch' });
      }

      if (error instanceof Error && error.message === 'workflow_template_not_found') {
        return res.status(404).json({ error: 'workflow_template_not_found' });
      }

      throw error;
    }
  });

  app.get('/api/v1/cases/:caseId', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const caseDetail = await loadCaseDetail({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!caseDetail) {
      return res.status(404).json({ error: 'case_not_found' });
    }

    return res.json({
      case: caseDetail.caseRecord,
      parties: caseDetail.parties,
      notes: caseDetail.notes,
      files: caseDetail.files,
      communications: caseDetail.communications,
      workflow: caseDetail.workflow,
      timelineEntries: caseDetail.timelineEntries,
    });
  });

  app.get('/api/v1/email-templates', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const emailTemplates = await listEmailTemplates({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({ emailTemplates });
  });

  app.post('/api/v1/email-templates', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createEmailTemplateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const emailTemplate = await createEmailTemplateRecord({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      key: parsed.data.key,
      name: parsed.data.name,
      subjectTemplate: parsed.data.subjectTemplate,
      bodyTextTemplate: parsed.data.bodyTextTemplate,
      ...(parsed.data.bodyHtmlTemplate !== undefined
        ? { bodyHtmlTemplate: parsed.data.bodyHtmlTemplate }
        : {}),
      status: parsed.data.status,
      ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
    });

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'email_template',
      entityId: emailTemplate.id,
      action: 'email_template.created',
      summary: `Created email template ${emailTemplate.name}`,
      mutationType: 'created',
      payload: {
        key: emailTemplate.key,
        status: emailTemplate.status,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({ emailTemplate });
  });

  app.get('/api/v1/sms-templates', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const smsTemplates = await listSmsTemplates({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({ smsTemplates });
  });

  app.post('/api/v1/sms-templates', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createSmsTemplateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const smsTemplate = await createSmsTemplateRecord({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      key: parsed.data.key,
      name: parsed.data.name,
      bodyTemplate: parsed.data.bodyTemplate,
      status: parsed.data.status,
      ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
    });

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'sms_template',
      entityId: smsTemplate.id,
      action: 'sms_template.created',
      summary: `Created SMS template ${smsTemplate.name}`,
      mutationType: 'created',
      payload: {
        key: smsTemplate.key,
        status: smsTemplate.status,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({ smsTemplate });
  });

  app.get(
    '/api/v1/cases/:caseId/communications',
    requireAuth,
    async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const parsedParams = caseParamsSchema.safeParse(req.params);
      const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
      if (!parsedParams.success || !parsedQuery.success) {
        return res.status(400).json({ error: 'invalid_request' });
      }

      if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const caseRecord = await loadCaseRecord({
        db: deps.db,
        tenantId: parsedQuery.data.tenantId,
        caseId: parsedParams.data.caseId,
      });

      if (!caseRecord) {
        return res.status(404).json({ error: 'case_not_found' });
      }

      const communications = await listCaseCommunicationDispatches({
        db: deps.db,
        tenantId: parsedQuery.data.tenantId,
        caseId: parsedParams.data.caseId,
      });

      return res.json({ communications });
    },
  );

  app.post(
    '/api/v1/cases/:caseId/communications',
    requireAuth,
    async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const parsedParams = caseParamsSchema.safeParse(req.params);
      const parsedBody = sendCaseCommunicationRequestSchema.safeParse(req.body);
      if (!parsedParams.success || !parsedBody.success) {
        return res.status(400).json({ error: 'invalid_request' });
      }

      if (parsedBody.data.caseId !== parsedParams.data.caseId) {
        return res.status(400).json({ error: 'case_id_mismatch' });
      }

      if (parsedBody.data.channel !== parsedBody.data.templateType) {
        return res.status(400).json({ error: 'channel_template_type_mismatch' });
      }

      if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const caseRecord = await loadCaseRecord({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
      });

      if (!caseRecord) {
        return res.status(404).json({ error: 'case_not_found' });
      }

      try {
        const result = await sendCaseCommunicationRecord({
          db: deps.db,
          tenantId: parsedBody.data.tenantId,
          caseId: parsedParams.data.caseId,
          channel: parsedBody.data.channel,
          templateId: parsedBody.data.templateId,
          templateType: parsedBody.data.templateType,
          sentByUserId: authReq.auth!.userId,
          ...(parsedBody.data.recipientName !== undefined
            ? { recipientName: parsedBody.data.recipientName }
            : {}),
          ...(parsedBody.data.recipientEmail !== undefined
            ? { recipientEmail: parsedBody.data.recipientEmail }
            : {}),
          ...(parsedBody.data.recipientPhone !== undefined
            ? { recipientPhone: parsedBody.data.recipientPhone }
            : {}),
          variables: parsedBody.data.variables,
          ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
        });

        await recordMutation({
          db: deps.db,
          actorUserId: authReq.auth!.userId,
          tenantId: parsedBody.data.tenantId,
          entityType: 'case',
          entityId: parsedParams.data.caseId,
          action: 'case.communication_sent',
          summary: result.summary,
          mutationType: 'updated',
          payload: {
            dispatchId: result.dispatch.id,
            channel: result.dispatch.channel,
            templateType: result.dispatch.templateType,
            templateId: result.dispatch.templateId,
            recipientEmail: result.dispatch.recipientEmail,
            recipientPhone: result.dispatch.recipientPhone,
          },
          publishEntityChangedEvent: deps.publishEntityChangedEvent,
        });

        return res.status(201).json({ communication: result.dispatch });
      } catch (error) {
        if (error instanceof Error && error.message === 'recipient_email_required') {
          return res.status(400).json({ error: 'recipient_email_required' });
        }

        if (error instanceof Error && error.message === 'recipient_phone_required') {
          return res.status(400).json({ error: 'recipient_phone_required' });
        }

        if (error instanceof Error && error.message === 'email_template_not_found') {
          return res.status(404).json({ error: 'email_template_not_found' });
        }

        if (error instanceof Error && error.message === 'sms_template_not_found') {
          return res.status(404).json({ error: 'sms_template_not_found' });
        }

        throw error;
      }
    },
  );

  app.post('/api/v1/cases/:caseId/parties', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = createCasePartySchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (parsedBody.data.caseId !== parsedParams.data.caseId) {
      return res.status(400).json({ error: 'case_id_mismatch' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const caseRecord = await loadCaseRecord({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!caseRecord) {
      return res.status(404).json({ error: 'case_not_found' });
    }

    try {
      const caseParty = await addCasePartyRecord({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
        partyRole: parsedBody.data.partyRole,
        displayName: parsedBody.data.displayName,
        isPrimary: parsedBody.data.isPrimary,
        ...(parsedBody.data.contactId !== undefined ? { contactId: parsedBody.data.contactId } : {}),
        ...(parsedBody.data.email !== undefined ? { email: parsedBody.data.email } : {}),
        ...(parsedBody.data.phone !== undefined ? { phone: parsedBody.data.phone } : {}),
        ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsedBody.data.tenantId,
        entityType: 'case_party',
        entityId: caseParty.id,
        action: 'case_party.created',
        summary: `Added ${caseParty.partyRole} to case ${caseRecord.title}`,
        mutationType: 'created',
        payload: {
          caseId: caseRecord.id,
          contactId: caseParty.contactId,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({ caseParty });
    } catch (error) {
      if (error instanceof Error && error.message === 'contact_not_found') {
        return res.status(404).json({ error: 'contact_not_found' });
      }

      throw error;
    }
  });

  app.post('/api/v1/cases/:caseId/notes', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = createCaseNoteSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (parsedBody.data.caseId !== parsedParams.data.caseId) {
      return res.status(400).json({ error: 'case_id_mismatch' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const caseRecord = await loadCaseRecord({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!caseRecord) {
      return res.status(404).json({ error: 'case_not_found' });
    }

    const caseNote = await addCaseNoteRecord({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
      authorUserId: authReq.auth!.userId,
      noteType: parsedBody.data.noteType,
      body: parsedBody.data.body,
      ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
    });

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsedBody.data.tenantId,
      entityType: 'case_note',
      entityId: caseNote.id,
      action: 'case_note.created',
      summary: `Added note to case ${caseRecord.title}`,
      mutationType: 'created',
      payload: {
        caseId: caseRecord.id,
        noteType: caseNote.noteType,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({ caseNote });
  });

  app.post('/api/v1/cases/:caseId/transitions', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = createCaseTransitionRequestSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (parsedBody.data.caseId !== parsedParams.data.caseId) {
      return res.status(400).json({ error: 'case_id_mismatch' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const caseRecord = await loadCaseRecord({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!caseRecord) {
      return res.status(404).json({ error: 'case_not_found' });
    }

    try {
      const transition = await transitionWorkflowInstance({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
        actorUserId: authReq.auth!.userId,
        toStageKey: parsedBody.data.toStageKey,
        ...(parsedBody.data.summary !== undefined ? { summary: parsedBody.data.summary } : {}),
        ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsedBody.data.tenantId,
        entityType: 'workflow_instance',
        entityId: transition.workflowInstanceId,
        action: 'workflow_instance.transitioned',
        summary: transition.transitionEvent.summary,
        mutationType: 'updated',
        payload: {
          caseId: caseRecord.id,
          fromStageId: transition.currentStage?.id ?? null,
          toStageId: transition.targetStage.id,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({
        transitionEvent: transition.transitionEvent,
        targetStage: transition.targetStage,
        completedAt: transition.completedAt,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'workflow_instance_not_found') {
        return res.status(404).json({ error: 'workflow_instance_not_found' });
      }

      if (error instanceof Error && error.message === 'workflow_stage_not_found') {
        return res.status(404).json({ error: 'workflow_stage_not_found' });
      }

      throw error;
    }
  });

  app.get('/api/v1/sales/dashboard', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const dashboard = await loadSalesDashboard({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({ dashboard });
  });

  app.get('/api/v1/reports/sales-pipeline', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const dashboard = await loadSalesDashboard({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({
      report: {
        counts: dashboard.counts,
        values: dashboard.values,
        cases: dashboard.recentCases,
        generatedAt: new Date().toISOString(),
      },
    });
  });

  app.get('/api/v1/sales/cases', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listSalesCasesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const cases = await listSalesCaseRecords({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.saleStatus !== undefined ? { saleStatus: parsed.data.saleStatus } : {}),
      ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
    });

    return res.json({ cases });
  });

  app.post('/api/v1/sales/cases', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createSalesCaseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const createdSalesCaseBundle = await createSalesCaseRecord({
        db: deps.db,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
        saleStatus: parsed.data.saleStatus,
        ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
        ...(parsed.data.propertyId !== undefined ? { propertyId: parsed.data.propertyId } : {}),
        ...(parsed.data.ownerMembershipId !== undefined
          ? { ownerMembershipId: parsed.data.ownerMembershipId }
          : {}),
        ...(parsed.data.workflowTemplateId !== undefined
          ? { workflowTemplateId: parsed.data.workflowTemplateId }
          : {}),
        ...(parsed.data.closedReason !== undefined ? { closedReason: parsed.data.closedReason } : {}),
        ...(parsed.data.reference !== undefined ? { reference: parsed.data.reference } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.askingPrice !== undefined ? { askingPrice: parsed.data.askingPrice } : {}),
        ...(parsed.data.agreedPrice !== undefined ? { agreedPrice: parsed.data.agreedPrice } : {}),
        ...(parsed.data.memorandumSentAt !== undefined
          ? { memorandumSentAt: new Date(parsed.data.memorandumSentAt) }
          : {}),
        ...(parsed.data.targetExchangeAt !== undefined
          ? { targetExchangeAt: new Date(parsed.data.targetExchangeAt) }
          : {}),
        ...(parsed.data.targetCompletionAt !== undefined
          ? { targetCompletionAt: new Date(parsed.data.targetCompletionAt) }
          : {}),
        ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsed.data.tenantId,
        entityType: 'sales_case',
        entityId: createdSalesCaseBundle.salesCase.id,
        action: 'sales_case.created',
        summary: `Created sales case ${createdSalesCaseBundle.caseRecord.title}`,
        mutationType: 'created',
        payload: {
          caseId: createdSalesCaseBundle.caseRecord.id,
          saleStatus: createdSalesCaseBundle.salesCase.saleStatus,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({
        case: createdSalesCaseBundle.caseRecord,
        salesCase: createdSalesCaseBundle.salesCase,
        workflow: createdSalesCaseBundle.workflowInstance
          ? {
              instance: createdSalesCaseBundle.workflowInstance,
              template: createdSalesCaseBundle.workflowTemplate,
              stages: createdSalesCaseBundle.workflowStages,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'workflow_template_case_type_mismatch') {
        return res.status(400).json({ error: 'workflow_template_case_type_mismatch' });
      }

      if (error instanceof Error && error.message === 'workflow_template_not_found') {
        return res.status(404).json({ error: 'workflow_template_not_found' });
      }

      if (error instanceof Error && error.message === 'owner_membership_not_found') {
        return res.status(404).json({ error: 'owner_membership_not_found' });
      }

      throw error;
    }
  });

  app.patch('/api/v1/sales/cases/:caseId', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = updateSalesCaseRequestSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const salesCaseRef = await ensureSalesCaseExists({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!salesCaseRef) {
      return res.status(404).json({ error: 'sales_case_not_found' });
    }

    let salesCase;
    try {
      salesCase = await updateSalesCaseRecord({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
        ...(parsedBody.data.title !== undefined ? { title: parsedBody.data.title } : {}),
        ...(parsedBody.data.description !== undefined
          ? { description: parsedBody.data.description }
          : {}),
        ...(parsedBody.data.ownerMembershipId !== undefined
          ? { ownerMembershipId: parsedBody.data.ownerMembershipId }
          : {}),
        ...(parsedBody.data.status !== undefined ? { status: parsedBody.data.status } : {}),
        ...(parsedBody.data.closedReason !== undefined
          ? { closedReason: parsedBody.data.closedReason }
          : {}),
        ...(parsedBody.data.askingPrice !== undefined
          ? { askingPrice: parsedBody.data.askingPrice }
          : {}),
        ...(parsedBody.data.agreedPrice !== undefined ? { agreedPrice: parsedBody.data.agreedPrice } : {}),
        ...(parsedBody.data.saleStatus !== undefined ? { saleStatus: parsedBody.data.saleStatus } : {}),
        ...(parsedBody.data.memorandumSentAt !== undefined
          ? {
              memorandumSentAt: parsedBody.data.memorandumSentAt
                ? new Date(parsedBody.data.memorandumSentAt)
                : null,
            }
          : {}),
        ...(parsedBody.data.targetExchangeAt !== undefined
          ? {
              targetExchangeAt: parsedBody.data.targetExchangeAt
                ? new Date(parsedBody.data.targetExchangeAt)
                : null,
            }
          : {}),
        ...(parsedBody.data.targetCompletionAt !== undefined
          ? {
              targetCompletionAt: parsedBody.data.targetCompletionAt
                ? new Date(parsedBody.data.targetCompletionAt)
                : null,
            }
          : {}),
        ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'owner_membership_not_found') {
        return res.status(404).json({ error: 'owner_membership_not_found' });
      }

      throw error;
    }

    if (!salesCase) {
      return res.status(404).json({ error: 'sales_case_not_found' });
    }

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsedBody.data.tenantId,
      entityType: 'sales_case',
      entityId: salesCase.id,
      action: 'sales_case.updated',
      summary: `Updated sales case ${salesCaseRef.caseRecord.title}`,
      mutationType: 'updated',
      payload: {
        caseId: parsedParams.data.caseId,
        saleStatus: salesCase.saleStatus,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.json({ salesCase });
  });

  app.get('/api/v1/sales/cases/:caseId', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const detail = await loadSalesCaseDetail({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!detail) {
      return res.status(404).json({ error: 'sales_case_not_found' });
    }

    return res.json({
      case: detail.caseRecord,
      salesCase: detail.salesCase,
      salesOffers: detail.salesOffers,
      parties: detail.parties,
      notes: detail.notes,
      files: detail.files,
      communications: detail.communications,
      workflow: detail.workflow,
      timelineEntries: detail.timelineEntries,
    });
  });

  app.get('/api/v1/sales/cases/:caseId/offers', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const salesCaseRef = await ensureSalesCaseExists({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!salesCaseRef) {
      return res.status(404).json({ error: 'sales_case_not_found' });
    }

    const salesOffers = await listSalesOffers({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    return res.json({ salesOffers });
  });

  app.post('/api/v1/sales/cases/:caseId/offers', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = createSalesOfferRequestSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (parsedBody.data.caseId !== parsedParams.data.caseId) {
      return res.status(400).json({ error: 'case_id_mismatch' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const salesCaseRef = await ensureSalesCaseExists({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!salesCaseRef) {
      return res.status(404).json({ error: 'sales_case_not_found' });
    }

    try {
      const salesOffer = await createSalesOfferRecord({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
        amount: parsedBody.data.amount,
        status: parsedBody.data.status,
        ...(parsedBody.data.contactId !== undefined ? { contactId: parsedBody.data.contactId } : {}),
        ...(parsedBody.data.submittedAt !== undefined
          ? { submittedAt: new Date(parsedBody.data.submittedAt) }
          : {}),
        ...(parsedBody.data.respondedAt !== undefined
          ? {
              respondedAt: parsedBody.data.respondedAt
                ? new Date(parsedBody.data.respondedAt)
                : null,
            }
          : {}),
        ...(parsedBody.data.notes !== undefined ? { notes: parsedBody.data.notes } : {}),
        ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsedBody.data.tenantId,
        entityType: 'sales_offer',
        entityId: salesOffer.id,
        action: 'sales_offer.created',
        summary: `Added sales offer to case ${salesCaseRef.caseRecord.title}`,
        mutationType: 'created',
        payload: {
          caseId: parsedParams.data.caseId,
          amount: salesOffer.amount,
          status: salesOffer.status,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({ salesOffer });
    } catch (error) {
      if (error instanceof Error && error.message === 'contact_not_found') {
        return res.status(404).json({ error: 'contact_not_found' });
      }

      if (error instanceof Error && error.message === 'sales_case_not_found') {
        return res.status(404).json({ error: 'sales_case_not_found' });
      }

      throw error;
    }
  });

  app.get('/api/v1/lettings/dashboard', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const dashboard = await loadLettingsDashboard({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({ dashboard });
  });

  app.get('/api/v1/reports/agreed-lets', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const dashboard = await loadLettingsDashboard({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    return res.json({
      report: {
        counts: dashboard.counts,
        values: dashboard.values,
        agreedLets: dashboard.agreedLets,
        generatedAt: new Date().toISOString(),
      },
    });
  });

  app.get('/api/v1/pilot-readiness', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [summary] = await deps.db
      .select({
        propertyCount: sql<number>`(
          select count(*)
          from ${schema.properties}
          where ${schema.properties.tenantId} = ${parsed.data.tenantId}
        )`,
        emailTemplateCount: sql<number>`(
          select count(*)
          from ${schema.emailTemplates}
          where ${schema.emailTemplates.tenantId} = ${parsed.data.tenantId}
        )`,
        smsTemplateCount: sql<number>`(
          select count(*)
          from ${schema.smsTemplates}
          where ${schema.smsTemplates.tenantId} = ${parsed.data.tenantId}
        )`,
        salesWorkflowTemplateCount: sql<number>`(
          select count(*)
          from ${schema.workflowTemplates}
          where ${schema.workflowTemplates.tenantId} = ${parsed.data.tenantId}
            and ${schema.workflowTemplates.caseType} = 'sales'
        )`,
        lettingsWorkflowTemplateCount: sql<number>`(
          select count(*)
          from ${schema.workflowTemplates}
          where ${schema.workflowTemplates.tenantId} = ${parsed.data.tenantId}
            and ${schema.workflowTemplates.caseType} = 'lettings'
        )`,
        salesCaseCount: sql<number>`(
          select count(*)
          from ${schema.cases}
          where ${schema.cases.tenantId} = ${parsed.data.tenantId}
            and ${schema.cases.caseType} = 'sales'
        )`,
        lettingsCaseCount: sql<number>`(
          select count(*)
          from ${schema.cases}
          where ${schema.cases.tenantId} = ${parsed.data.tenantId}
            and ${schema.cases.caseType} = 'lettings'
        )`,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, parsed.data.tenantId))
      .limit(1);

    if (!summary) {
      return res.status(404).json({ error: 'tenant_not_found' });
    }

    const readiness = {
      counts: {
        propertyCount: Number(summary.propertyCount ?? 0),
        emailTemplateCount: Number(summary.emailTemplateCount ?? 0),
        smsTemplateCount: Number(summary.smsTemplateCount ?? 0),
        salesWorkflowTemplateCount: Number(summary.salesWorkflowTemplateCount ?? 0),
        lettingsWorkflowTemplateCount: Number(summary.lettingsWorkflowTemplateCount ?? 0),
        salesCaseCount: Number(summary.salesCaseCount ?? 0),
        lettingsCaseCount: Number(summary.lettingsCaseCount ?? 0),
      },
    };

    const checks = [
      {
        key: 'properties_seeded',
        label: 'Properties synced or created',
        status: readiness.counts.propertyCount > 0 ? 'ready' : 'missing',
        detail:
          readiness.counts.propertyCount > 0
            ? `${readiness.counts.propertyCount} properties available for case linking.`
            : 'Sync Dezrez or seed at least one property before pilot usage.',
      },
      {
        key: 'sales_workflow_templates',
        label: 'Sales workflow templates configured',
        status: readiness.counts.salesWorkflowTemplateCount > 0 ? 'ready' : 'missing',
        detail:
          readiness.counts.salesWorkflowTemplateCount > 0
            ? `${readiness.counts.salesWorkflowTemplateCount} sales workflow templates available.`
            : 'Create at least one sales workflow template.',
      },
      {
        key: 'lettings_workflow_templates',
        label: 'Lettings workflow templates configured',
        status: readiness.counts.lettingsWorkflowTemplateCount > 0 ? 'ready' : 'missing',
        detail:
          readiness.counts.lettingsWorkflowTemplateCount > 0
            ? `${readiness.counts.lettingsWorkflowTemplateCount} lettings workflow templates available.`
            : 'Create at least one lettings workflow template.',
      },
      {
        key: 'communication_templates',
        label: 'Email and SMS templates available',
        status:
          readiness.counts.emailTemplateCount > 0 && readiness.counts.smsTemplateCount > 0
            ? 'ready'
            : 'missing',
        detail:
          readiness.counts.emailTemplateCount > 0 && readiness.counts.smsTemplateCount > 0
            ? `${readiness.counts.emailTemplateCount} email templates and ${readiness.counts.smsTemplateCount} SMS templates are ready.`
            : 'Add at least one active email template and one SMS template.',
      },
      {
        key: 'sales_flow_seeded',
        label: 'Sales pilot path exercised',
        status: readiness.counts.salesCaseCount > 0 ? 'ready' : 'missing',
        detail:
          readiness.counts.salesCaseCount > 0
            ? `${readiness.counts.salesCaseCount} sales cases already exist in the new workspace.`
            : 'Create at least one sales case before pilot day.',
      },
      {
        key: 'lettings_flow_seeded',
        label: 'Lettings pilot path exercised',
        status: readiness.counts.lettingsCaseCount > 0 ? 'ready' : 'missing',
        detail:
          readiness.counts.lettingsCaseCount > 0
            ? `${readiness.counts.lettingsCaseCount} lettings cases already exist in the new workspace.`
            : 'Create at least one lettings case before pilot day.',
      },
      {
        key: 'reporting_available',
        label: 'Operational reports available',
        status: 'ready',
        detail: 'Sales pipeline and agreed lets reports are exposed through the new API and UI.',
      },
    ];

    const pilotFlows = [
      {
        key: 'sales_case_progression',
        label: 'Sales case progression',
        status:
          readiness.counts.propertyCount > 0 &&
          readiness.counts.salesWorkflowTemplateCount > 0 &&
          readiness.counts.salesCaseCount > 0
            ? 'ready'
            : 'needs_setup',
        detail:
          'Open a sales case, add an offer, add notes/files, send a communication, and complete a workflow move.',
      },
      {
        key: 'lettings_agreed_let',
        label: 'Lettings agreed let flow',
        status:
          readiness.counts.propertyCount > 0 &&
          readiness.counts.lettingsWorkflowTemplateCount > 0 &&
          readiness.counts.lettingsCaseCount > 0
            ? 'ready'
            : 'needs_setup',
        detail:
          'Open a lettings case, add an application, advance progression, and confirm the case appears in the agreed lets report.',
      },
    ];

    return res.json({
      readiness,
      checks,
      pilotFlows,
      laterItems: [
        'Birthdays and wider CRM screens remain out of Milestone B.',
        'Client management, solicitors, and broader reporting are still later-phase work.',
        'Milestone C should focus on pilot hardening, migration helpers, and integration depth rather than new modules.',
      ],
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/v1/reconciliation', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const reconciliation = await loadTenantReconciliation({
      db: deps.db,
      tenantId: parsed.data.tenantId,
    });

    if (!reconciliation) {
      return res.status(404).json({ error: 'tenant_not_found' });
    }

    return res.json({ reconciliation });
  });

  app.get('/api/v1/lettings/cases', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listLettingsCasesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const cases = await listLettingsCaseRecords({
      db: deps.db,
      tenantId: parsed.data.tenantId,
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.lettingStatus !== undefined
        ? { lettingStatus: parsed.data.lettingStatus }
        : {}),
      ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
    });

    return res.json({ cases });
  });

  app.post('/api/v1/lettings/cases', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createLettingsCaseRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const createdLettingsCaseBundle = await createLettingsCaseRecord({
        db: deps.db,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
        lettingStatus: parsed.data.lettingStatus,
        ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
        ...(parsed.data.propertyId !== undefined ? { propertyId: parsed.data.propertyId } : {}),
        ...(parsed.data.ownerMembershipId !== undefined
          ? { ownerMembershipId: parsed.data.ownerMembershipId }
          : {}),
        ...(parsed.data.workflowTemplateId !== undefined
          ? { workflowTemplateId: parsed.data.workflowTemplateId }
          : {}),
        ...(parsed.data.closedReason !== undefined ? { closedReason: parsed.data.closedReason } : {}),
        ...(parsed.data.reference !== undefined ? { reference: parsed.data.reference } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.monthlyRent !== undefined ? { monthlyRent: parsed.data.monthlyRent } : {}),
        ...(parsed.data.depositAmount !== undefined
          ? { depositAmount: parsed.data.depositAmount }
          : {}),
        ...(parsed.data.agreedAt !== undefined ? { agreedAt: new Date(parsed.data.agreedAt) } : {}),
        ...(parsed.data.moveInAt !== undefined ? { moveInAt: new Date(parsed.data.moveInAt) } : {}),
        ...(parsed.data.agreedLetAt !== undefined
          ? { agreedLetAt: new Date(parsed.data.agreedLetAt) }
          : {}),
        ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsed.data.tenantId,
        entityType: 'lettings_case',
        entityId: createdLettingsCaseBundle.lettingsCase.id,
        action: 'lettings_case.created',
        summary: `Created lettings case ${createdLettingsCaseBundle.caseRecord.title}`,
        mutationType: 'created',
        payload: {
          caseId: createdLettingsCaseBundle.caseRecord.id,
          lettingStatus: createdLettingsCaseBundle.lettingsCase.lettingStatus,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({
        case: createdLettingsCaseBundle.caseRecord,
        lettingsCase: createdLettingsCaseBundle.lettingsCase,
        workflow: createdLettingsCaseBundle.workflowInstance
          ? {
              instance: createdLettingsCaseBundle.workflowInstance,
              template: createdLettingsCaseBundle.workflowTemplate,
              stages: createdLettingsCaseBundle.workflowStages,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'workflow_template_case_type_mismatch') {
        return res.status(400).json({ error: 'workflow_template_case_type_mismatch' });
      }

      if (error instanceof Error && error.message === 'workflow_template_not_found') {
        return res.status(404).json({ error: 'workflow_template_not_found' });
      }

      if (error instanceof Error && error.message === 'owner_membership_not_found') {
        return res.status(404).json({ error: 'owner_membership_not_found' });
      }

      throw error;
    }
  });

  app.patch('/api/v1/lettings/cases/:caseId', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = updateLettingsCaseRequestSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const lettingsCaseRef = await ensureLettingsCaseExists({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!lettingsCaseRef) {
      return res.status(404).json({ error: 'lettings_case_not_found' });
    }

    let lettingsCase;
    try {
      lettingsCase = await updateLettingsCaseRecord({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
        ...(parsedBody.data.title !== undefined ? { title: parsedBody.data.title } : {}),
        ...(parsedBody.data.description !== undefined
          ? { description: parsedBody.data.description }
          : {}),
        ...(parsedBody.data.ownerMembershipId !== undefined
          ? { ownerMembershipId: parsedBody.data.ownerMembershipId }
          : {}),
        ...(parsedBody.data.status !== undefined ? { status: parsedBody.data.status } : {}),
        ...(parsedBody.data.closedReason !== undefined
          ? { closedReason: parsedBody.data.closedReason }
          : {}),
        ...(parsedBody.data.monthlyRent !== undefined
          ? { monthlyRent: parsedBody.data.monthlyRent }
          : {}),
        ...(parsedBody.data.depositAmount !== undefined
          ? { depositAmount: parsedBody.data.depositAmount }
          : {}),
        ...(parsedBody.data.lettingStatus !== undefined
          ? { lettingStatus: parsedBody.data.lettingStatus }
          : {}),
        ...(parsedBody.data.agreedAt !== undefined
          ? {
              agreedAt: parsedBody.data.agreedAt ? new Date(parsedBody.data.agreedAt) : null,
            }
          : {}),
        ...(parsedBody.data.moveInAt !== undefined
          ? {
              moveInAt: parsedBody.data.moveInAt ? new Date(parsedBody.data.moveInAt) : null,
            }
          : {}),
        ...(parsedBody.data.agreedLetAt !== undefined
          ? {
              agreedLetAt: parsedBody.data.agreedLetAt ? new Date(parsedBody.data.agreedLetAt) : null,
            }
          : {}),
        ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'owner_membership_not_found') {
        return res.status(404).json({ error: 'owner_membership_not_found' });
      }

      throw error;
    }

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsedBody.data.tenantId,
      entityType: 'lettings_case',
      entityId: lettingsCase.id,
      action: 'lettings_case.updated',
      summary: `Updated lettings case ${lettingsCaseRef.caseRecord.title}`,
      mutationType: 'updated',
      payload: {
        caseId: parsedParams.data.caseId,
        lettingStatus: lettingsCase.lettingStatus,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.json({ lettingsCase });
  });

  app.get('/api/v1/lettings/cases/:caseId', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const detail = await loadLettingsCaseDetail({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!detail) {
      return res.status(404).json({ error: 'lettings_case_not_found' });
    }

    return res.json({
      case: detail.caseRecord,
      lettingsCase: detail.lettingsCase,
      lettingsApplications: detail.lettingsApplications,
      parties: detail.parties,
      notes: detail.notes,
      files: detail.files,
      communications: detail.communications,
      workflow: detail.workflow,
      timelineEntries: detail.timelineEntries,
    });
  });

  app.get('/api/v1/lettings/cases/:caseId/applications', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const lettingsCaseRef = await ensureLettingsCaseExists({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!lettingsCaseRef) {
      return res.status(404).json({ error: 'lettings_case_not_found' });
    }

    const lettingsApplications = await listLettingsApplications({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    return res.json({ lettingsApplications });
  });

  app.post('/api/v1/lettings/cases/:caseId/applications', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedParams = caseParamsSchema.safeParse(req.params);
    const parsedBody = createLettingsApplicationRequestSchema.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (parsedBody.data.caseId !== parsedParams.data.caseId) {
      return res.status(400).json({ error: 'case_id_mismatch' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedBody.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const lettingsCaseRef = await ensureLettingsCaseExists({
      db: deps.db,
      tenantId: parsedBody.data.tenantId,
      caseId: parsedParams.data.caseId,
    });

    if (!lettingsCaseRef) {
      return res.status(404).json({ error: 'lettings_case_not_found' });
    }

    try {
      const lettingsApplication = await createLettingsApplicationRecord({
        db: deps.db,
        tenantId: parsedBody.data.tenantId,
        caseId: parsedParams.data.caseId,
        status: parsedBody.data.status,
        ...(parsedBody.data.contactId !== undefined ? { contactId: parsedBody.data.contactId } : {}),
        ...(parsedBody.data.monthlyRentOffered !== undefined
          ? { monthlyRentOffered: parsedBody.data.monthlyRentOffered }
          : {}),
        ...(parsedBody.data.submittedAt !== undefined
          ? { submittedAt: new Date(parsedBody.data.submittedAt) }
          : {}),
        ...(parsedBody.data.respondedAt !== undefined
          ? {
              respondedAt: parsedBody.data.respondedAt
                ? new Date(parsedBody.data.respondedAt)
                : null,
            }
          : {}),
        ...(parsedBody.data.notes !== undefined ? { notes: parsedBody.data.notes } : {}),
        ...(parsedBody.data.metadata !== undefined ? { metadata: parsedBody.data.metadata } : {}),
      });

      await recordMutation({
        db: deps.db,
        actorUserId: authReq.auth!.userId,
        tenantId: parsedBody.data.tenantId,
        entityType: 'lettings_application',
        entityId: lettingsApplication.id,
        action: 'lettings_application.created',
        summary: `Added lettings application to case ${lettingsCaseRef.caseRecord.title}`,
        mutationType: 'created',
        payload: {
          caseId: parsedParams.data.caseId,
          monthlyRentOffered: lettingsApplication.monthlyRentOffered,
          status: lettingsApplication.status,
        },
        publishEntityChangedEvent: deps.publishEntityChangedEvent,
      });

      return res.status(201).json({ lettingsApplication });
    } catch (error) {
      if (error instanceof Error && error.message === 'contact_not_found') {
        return res.status(404).json({ error: 'contact_not_found' });
      }

      if (error instanceof Error && error.message === 'lettings_case_not_found') {
        return res.status(404).json({ error: 'lettings_case_not_found' });
      }

      throw error;
    }
  });

  app.post('/api/v1/files', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = uploadFileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const stored = await persistUploadedFile({
      tenantId: parsed.data.tenantId,
      originalName: parsed.data.originalName,
      base64Data: parsed.data.base64Data,
    });

    const createdFiles = await deps.db
      .insert(schema.fileObjects)
      .values({
        tenantId: parsed.data.tenantId,
        storageProvider: stored.storageProvider,
        storageKey: stored.storageKey,
        originalName: parsed.data.originalName,
        contentType: parsed.data.contentType,
        sizeBytes: String(stored.sizeBytes),
      })
      .returning();
    const fileObject = requireValue(createdFiles[0], 'file_object');

    const createdAttachments = await deps.db
      .insert(schema.fileAttachments)
      .values({
        tenantId: parsed.data.tenantId,
        fileObjectId: fileObject.id,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        label: parsed.data.label ?? null,
      })
      .returning();
    const attachment = requireValue(createdAttachments[0], 'file_attachment');

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'file_object',
      entityId: fileObject.id,
      action: 'file_object.uploaded',
      summary: `Uploaded ${parsed.data.originalName}`,
      mutationType: 'uploaded',
      payload: {
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        originalName: fileObject.originalName,
        contentType: fileObject.contentType,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({
      file: {
        id: fileObject.id,
        tenantId: fileObject.tenantId,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        label: attachment.label,
        originalName: fileObject.originalName,
        contentType: fileObject.contentType,
        sizeBytes: Number(fileObject.sizeBytes),
        createdAt: fileObject.createdAt,
      },
    });
  });

  app.get('/api/v1/files', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listFilesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const files = await deps.db
      .select({
        id: schema.fileObjects.id,
        tenantId: schema.fileObjects.tenantId,
        entityType: schema.fileAttachments.entityType,
        entityId: schema.fileAttachments.entityId,
        label: schema.fileAttachments.label,
        originalName: schema.fileObjects.originalName,
        contentType: schema.fileObjects.contentType,
        sizeBytes: schema.fileObjects.sizeBytes,
        createdAt: schema.fileObjects.createdAt,
      })
      .from(schema.fileAttachments)
      .innerJoin(schema.fileObjects, eq(schema.fileObjects.id, schema.fileAttachments.fileObjectId))
      .where(
        and(
          eq(schema.fileAttachments.tenantId, parsed.data.tenantId),
          eq(schema.fileAttachments.entityType, parsed.data.entityType),
          eq(schema.fileAttachments.entityId, parsed.data.entityId),
        ),
      )
      .orderBy(asc(schema.fileObjects.createdAt));

    return res.json({
      files: files.map((file) => ({
        ...file,
        sizeBytes: Number(file.sizeBytes),
      })),
    });
  });

  app.get('/api/v1/files/:fileId/download', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    const parsedParams = fileParamsSchema.safeParse(req.params);
    if (!parsedQuery.success || !parsedParams.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [fileObject] = await deps.db
      .select()
      .from(schema.fileObjects)
      .where(
        and(
          eq(schema.fileObjects.id, parsedParams.data.fileId),
          eq(schema.fileObjects.tenantId, parsedQuery.data.tenantId),
        ),
      )
      .limit(1);

    if (!fileObject) {
      return res.status(404).json({ error: 'file_not_found' });
    }

    const buffer = await loadStoredFile(fileObject.storageKey);
    res.setHeader('Content-Type', fileObject.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileObject.originalName.replace(/"/g, '')}"`,
    );
    return res.send(buffer);
  });

  app.post('/api/v1/tenants', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    const createdTenants = await deps.db
      .insert(schema.tenants)
      .values({
        name: parsed.data.name,
        slug: parsed.data.slug,
      })
      .returning();
    const tenant = requireValue(createdTenants[0], 'tenant');

    const createdBranches = await deps.db
      .insert(schema.branches)
      .values({
        tenantId: tenant.id,
        name: parsed.data.branchName,
        slug: parsed.data.branchSlug,
      })
      .returning();
    const branch = requireValue(createdBranches[0], 'branch');

    const createdRoles = await deps.db
      .insert(schema.roles)
      .values({
        tenantId: tenant.id,
        key: 'tenant_admin',
        name: 'Tenant Admin',
        scopeType: 'tenant',
        isSystem: true,
      })
      .returning();
    const role = requireValue(createdRoles[0], 'role');

    const createdMemberships = await deps.db
      .insert(schema.memberships)
      .values({
        tenantId: tenant.id,
        branchId: branch.id,
        userId: authReq.auth!.userId,
      })
      .returning();
    const membership = requireValue(createdMemberships[0], 'membership');

    await deps.db.insert(schema.membershipRoles).values({
      membershipId: membership.id,
      roleId: role.id,
    });

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: tenant.id,
      entityType: 'tenant',
      entityId: tenant.id,
      action: 'tenant.created',
      summary: `Created tenant ${tenant.name}`,
      mutationType: 'created',
      payload: {
        branchId: branch.id,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({
      tenant,
      branch,
      membershipId: membership.id,
    });
  });

  app.post('/api/v1/branches', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createBranchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const createdBranches = await deps.db
      .insert(schema.branches)
      .values({
        tenantId: parsed.data.tenantId,
        name: parsed.data.name,
        slug: parsed.data.slug,
      })
      .returning();
    const branch = requireValue(createdBranches[0], 'branch');

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'branch',
      entityId: branch.id,
      action: 'branch.created',
      summary: `Created branch ${branch.name}`,
      mutationType: 'created',
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({ branch });
  });

  app.post('/api/v1/tenant-domains', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createTenantDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const createdDomains = await deps.db
      .insert(schema.tenantDomains)
      .values({
        tenantId: parsed.data.tenantId,
        domain: parsed.data.domain.toLowerCase(),
        domainType: parsed.data.domainType,
        isPrimary: parsed.data.isPrimary,
        verificationStatus: parsed.data.verificationStatus,
        verifiedAt: parsed.data.verificationStatus === 'verified' ? new Date() : null,
      })
      .returning();
    const domain = requireValue(createdDomains[0], 'tenant_domain');

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'tenant_domain',
      entityId: domain.id,
      action: 'tenant_domain.created',
      summary: `Created tenant domain ${domain.domain}`,
      mutationType: 'created',
      payload: {
        domain: domain.domain,
        domainType: domain.domainType,
        verificationStatus: domain.verificationStatus,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(201).json({
      domain: {
        id: domain.id,
        tenantId: domain.tenantId,
        domain: domain.domain,
        domainType: domain.domainType,
        verificationStatus: domain.verificationStatus,
        isPrimary: domain.isPrimary,
      },
    });
  });

  app.post('/api/v1/integrations/dezrez/accounts', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = createDezrezAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const settings = dezrezIntegrationSettingsSchema.parse(parsed.data.settings);
    const credentials = dezrezIntegrationCredentialsSchema.parse(parsed.data.credentials ?? {});
    const encryptionSecret = process.env.APP_ENCRYPTION_KEY;
    if (hasNonEmptyCredentials(credentials) && !encryptionSecret) {
      return res.status(500).json({ error: 'app_encryption_key_not_configured' });
    }

    const storedCredentials = hasNonEmptyCredentials(credentials)
      ? encryptJsonPayload(credentials, encryptionSecret!)
      : null;
    const [existingAccount] = await deps.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.tenantId, parsed.data.tenantId),
          eq(schema.integrationAccounts.provider, 'dezrez'),
        ),
      )
      .limit(1);

    const mutationType = existingAccount ? 'updated' : 'created';
    let integrationAccount;

    if (existingAccount) {
      const updatedAccounts = await deps.db
        .update(schema.integrationAccounts)
        .set({
          name: parsed.data.name,
          status: 'active',
          credentialsJsonEncrypted: storedCredentials,
          settingsJson: settings,
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationAccounts.id, existingAccount.id))
        .returning();
      integrationAccount = requireValue(updatedAccounts[0], 'integration_account');
    } else {
      const createdAccounts = await deps.db
        .insert(schema.integrationAccounts)
        .values({
          tenantId: parsed.data.tenantId,
          provider: 'dezrez',
          name: parsed.data.name,
          status: 'active',
          credentialsJsonEncrypted: storedCredentials,
          settingsJson: settings,
        })
        .returning();
      integrationAccount = requireValue(createdAccounts[0], 'integration_account');
    }

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'integration_account',
      entityId: integrationAccount.id,
      action: `integration_account.${mutationType}`,
      summary: `${existingAccount ? 'Updated' : 'Created'} Dezrez integration account`,
      mutationType,
      payload: {
        provider: 'dezrez',
        mode: settings.mode,
        seedPropertyCount: settings.seedProperties.length,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.status(existingAccount ? 200 : 201).json({
      integrationAccount: {
        id: integrationAccount.id,
        tenantId: integrationAccount.tenantId,
        provider: integrationAccount.provider,
        name: integrationAccount.name,
        status: integrationAccount.status,
        mode: settings.mode,
        hasCredentials:
          Boolean(credentials.apiKey) || Boolean(credentials.clientId && credentials.clientSecret),
        seedPropertyCount: settings.seedProperties.length,
      },
    });
  });

  app.get('/api/v1/integrations/dezrez/accounts', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = tenantScopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [integrationAccount] = await deps.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.tenantId, parsed.data.tenantId),
          eq(schema.integrationAccounts.provider, 'dezrez'),
        ),
      )
      .limit(1);

    if (!integrationAccount) {
      return res.json({ integrationAccount: null });
    }

    const settings = dezrezIntegrationSettingsSchema.parse(integrationAccount.settingsJson ?? {});
    const [
      propertyCountRow,
      staleCandidateCountRow,
      delistedCountRow,
      pendingWebhookCountRow,
      pendingIntegrationJobCountRow,
      pendingSyncCountRow,
      failedWebhookCountRow,
      rejectedWebhookCountRow,
      unresolvedWebhookCountRow,
      ignoredWebhookCountRow,
      unknownWebhookCountRow,
    ] =
      await Promise.all([
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.properties)
          .where(eq(schema.properties.tenantId, parsed.data.tenantId)),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.properties)
          .where(
            and(
              eq(schema.properties.tenantId, parsed.data.tenantId),
              eq(schema.properties.syncState, 'stale_candidate'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.properties)
          .where(
            and(
              eq(schema.properties.tenantId, parsed.data.tenantId),
              eq(schema.properties.syncState, 'delisted'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.webhookEvents)
          .where(
            and(
              eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
              eq(schema.webhookEvents.provider, 'dezrez'),
              eq(schema.webhookEvents.processingStatus, 'pending'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.integrationJobs)
          .where(
            and(
              eq(schema.integrationJobs.tenantId, parsed.data.tenantId),
              eq(schema.integrationJobs.provider, 'dezrez'),
              eq(schema.integrationJobs.status, 'pending'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.outboxEvents)
          .where(
            and(
              eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
              eq(schema.outboxEvents.eventName, 'property.sync_requested'),
              eq(schema.outboxEvents.status, 'pending'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.webhookEvents)
          .where(
            and(
              eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
              eq(schema.webhookEvents.provider, 'dezrez'),
              eq(schema.webhookEvents.processingStatus, 'failed'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.webhookEvents)
          .where(
            and(
              eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
              eq(schema.webhookEvents.provider, 'dezrez'),
              eq(schema.webhookEvents.processingStatus, 'rejected'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.webhookEvents)
          .where(
            and(
              eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
              eq(schema.webhookEvents.provider, 'dezrez'),
              eq(schema.webhookEvents.processingStatus, 'failed'),
              eq(schema.webhookEvents.errorMessage, 'integration_account_not_resolved'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.webhookEvents)
          .where(
            and(
              eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
              eq(schema.webhookEvents.provider, 'dezrez'),
              eq(schema.webhookEvents.processingStatus, 'ignored'),
            ),
          ),
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.webhookEvents)
          .where(
            and(
              eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
              eq(schema.webhookEvents.provider, 'dezrez'),
              eq(schema.webhookEvents.eventType, 'unknown'),
            ),
          ),
      ]);

    const [
      lastSyncRequested,
      lastSyncCompleted,
      latestWebhookReceived,
      lastWebhookError,
      lastIntegrationJobError,
      lastSyncRequestError,
      recentWebhooks,
      recentIntegrationJobs,
      recentSyncRequests,
      recentSyncCompletions,
      latestSyncRun,
      recentWebhookHistory,
    ] = await Promise.all([
      deps.db
        .select({
          createdAt: schema.outboxEvents.createdAt,
          publishedAt: schema.outboxEvents.publishedAt,
          status: schema.outboxEvents.status,
        })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
            eq(schema.outboxEvents.eventName, 'property.sync_requested'),
          ),
        )
        .orderBy(desc(schema.outboxEvents.createdAt))
        .limit(1),
      deps.db
        .select({
          createdAt: schema.outboxEvents.createdAt,
          payloadJson: schema.outboxEvents.payloadJson,
        })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
            eq(schema.outboxEvents.eventName, 'property.sync_completed'),
            eq(schema.outboxEvents.entityId, integrationAccount.id),
          ),
        )
        .orderBy(desc(schema.outboxEvents.createdAt))
        .limit(1),
      deps.db
        .select({
          receivedAt: schema.webhookEvents.receivedAt,
          eventType: schema.webhookEvents.eventType,
          processingStatus: schema.webhookEvents.processingStatus,
        })
        .from(schema.webhookEvents)
        .where(
          and(
            eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
            eq(schema.webhookEvents.provider, 'dezrez'),
          ),
        )
        .orderBy(desc(schema.webhookEvents.receivedAt))
        .limit(1),
      deps.db
        .select({
          id: schema.webhookEvents.id,
          receivedAt: schema.webhookEvents.receivedAt,
          eventType: schema.webhookEvents.eventType,
          errorMessage: schema.webhookEvents.errorMessage,
        })
        .from(schema.webhookEvents)
        .where(
          and(
            eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
            eq(schema.webhookEvents.provider, 'dezrez'),
            eq(schema.webhookEvents.processingStatus, 'failed'),
          ),
        )
        .orderBy(desc(schema.webhookEvents.receivedAt))
        .limit(1),
      deps.db
        .select({
          id: schema.integrationJobs.id,
          failedAt: schema.integrationJobs.failedAt,
          jobType: schema.integrationJobs.jobType,
          entityExternalId: schema.integrationJobs.entityExternalId,
          errorMessage: schema.integrationJobs.errorMessage,
        })
        .from(schema.integrationJobs)
        .where(
          and(
            eq(schema.integrationJobs.tenantId, parsed.data.tenantId),
            eq(schema.integrationJobs.provider, 'dezrez'),
            eq(schema.integrationJobs.status, 'failed'),
          ),
        )
        .orderBy(desc(schema.integrationJobs.failedAt))
        .limit(1),
      deps.db
        .select({
          id: schema.outboxEvents.id,
          createdAt: schema.outboxEvents.createdAt,
          errorMessage: schema.outboxEvents.errorMessage,
        })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
            eq(schema.outboxEvents.eventName, 'property.sync_requested'),
            eq(schema.outboxEvents.status, 'failed'),
          ),
        )
        .orderBy(desc(schema.outboxEvents.createdAt))
        .limit(1),
      deps.db
        .select({
          id: schema.webhookEvents.id,
          eventType: schema.webhookEvents.eventType,
          processingStatus: schema.webhookEvents.processingStatus,
          receivedAt: schema.webhookEvents.receivedAt,
          errorMessage: schema.webhookEvents.errorMessage,
        })
        .from(schema.webhookEvents)
        .where(
          and(
            eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
            eq(schema.webhookEvents.provider, 'dezrez'),
          ),
        )
        .orderBy(desc(schema.webhookEvents.receivedAt))
        .limit(5),
      deps.db
        .select({
          id: schema.integrationJobs.id,
          jobType: schema.integrationJobs.jobType,
          status: schema.integrationJobs.status,
          entityExternalId: schema.integrationJobs.entityExternalId,
          availableAt: schema.integrationJobs.availableAt,
          lockedAt: schema.integrationJobs.lockedAt,
          completedAt: schema.integrationJobs.completedAt,
          failedAt: schema.integrationJobs.failedAt,
          errorMessage: schema.integrationJobs.errorMessage,
        })
        .from(schema.integrationJobs)
        .where(
          and(
            eq(schema.integrationJobs.tenantId, parsed.data.tenantId),
            eq(schema.integrationJobs.provider, 'dezrez'),
          ),
        )
        .orderBy(
          desc(
            sql`coalesce(${schema.integrationJobs.failedAt}, ${schema.integrationJobs.completedAt}, ${schema.integrationJobs.lockedAt}, ${schema.integrationJobs.availableAt}, ${schema.integrationJobs.createdAt})`,
          ),
        )
        .limit(5),
      deps.db
        .select({
          id: schema.outboxEvents.id,
          status: schema.outboxEvents.status,
          createdAt: schema.outboxEvents.createdAt,
          publishedAt: schema.outboxEvents.publishedAt,
          errorMessage: schema.outboxEvents.errorMessage,
        })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
            eq(schema.outboxEvents.eventName, 'property.sync_requested'),
          ),
        )
        .orderBy(desc(schema.outboxEvents.createdAt))
        .limit(5),
      deps.db
        .select({
          id: schema.outboxEvents.id,
          status: schema.outboxEvents.status,
          createdAt: schema.outboxEvents.createdAt,
          publishedAt: schema.outboxEvents.publishedAt,
          payloadJson: schema.outboxEvents.payloadJson,
        })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
            eq(schema.outboxEvents.eventName, 'property.sync_completed'),
            eq(schema.outboxEvents.entityId, integrationAccount.id),
          ),
        )
        .orderBy(desc(schema.outboxEvents.createdAt))
        .limit(5),
      deps.db
        .select({
          id: schema.propertySyncRuns.id,
          triggerSource: schema.propertySyncRuns.triggerSource,
          status: schema.propertySyncRuns.status,
          anomalyStatus: schema.propertySyncRuns.anomalyStatus,
          anomalyReason: schema.propertySyncRuns.anomalyReason,
          propertyCount: schema.propertySyncRuns.propertyCount,
          staleCandidateCount: schema.propertySyncRuns.staleCandidateCount,
          delistedCount: schema.propertySyncRuns.delistedCount,
          metadataJson: schema.propertySyncRuns.metadataJson,
          startedAt: schema.propertySyncRuns.startedAt,
          completedAt: schema.propertySyncRuns.completedAt,
        })
        .from(schema.propertySyncRuns)
        .where(
          and(
            eq(schema.propertySyncRuns.tenantId, parsed.data.tenantId),
            eq(schema.propertySyncRuns.integrationAccountId, integrationAccount.id),
          ),
        )
        .orderBy(desc(schema.propertySyncRuns.startedAt))
        .limit(1),
      deps.db
        .select({
          id: schema.webhookEvents.id,
          eventType: schema.webhookEvents.eventType,
          processingStatus: schema.webhookEvents.processingStatus,
          errorMessage: schema.webhookEvents.errorMessage,
          receivedAt: schema.webhookEvents.receivedAt,
          payloadJson: schema.webhookEvents.payloadJson,
        })
        .from(schema.webhookEvents)
        .where(
          and(
            eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
            eq(schema.webhookEvents.provider, 'dezrez'),
          ),
        )
        .orderBy(desc(schema.webhookEvents.receivedAt))
        .limit(10),
    ]);

    const latestSyncRunRecord = latestSyncRun[0] ?? null;
    const latestSyncRunMetadata =
      latestSyncRunRecord?.metadataJson && typeof latestSyncRunRecord.metadataJson === 'object'
        ? (latestSyncRunRecord.metadataJson as Record<string, unknown>)
        : null;
    const latestSyncRunBaselineMedian =
      latestSyncRunMetadata && typeof latestSyncRunMetadata.baselineMedian !== 'undefined'
        ? Number(latestSyncRunMetadata.baselineMedian ?? 0)
        : null;

    const recentActivity = [
      ...recentWebhooks.map((webhook) => ({
        id: webhook.id,
        source: 'webhook' as const,
        status: webhook.processingStatus,
        occurredAt: webhook.receivedAt.toISOString(),
        title: webhook.eventType,
        subtitle: null,
        errorMessage: webhook.errorMessage,
      })),
      ...recentIntegrationJobs.map((job) => ({
        id: job.id,
        source: 'integration_job' as const,
        status: job.status,
        occurredAt:
          job.failedAt?.toISOString() ??
          job.completedAt?.toISOString() ??
          job.lockedAt?.toISOString() ??
          job.availableAt.toISOString(),
        title: job.jobType,
        subtitle: job.entityExternalId,
        errorMessage: job.errorMessage,
      })),
      ...recentSyncRequests.map((event) => ({
        id: event.id,
        source: 'sync_request' as const,
        status: event.status,
        occurredAt: event.createdAt.toISOString(),
        title: 'Property sync requested',
        subtitle: event.publishedAt ? `published ${event.publishedAt.toISOString()}` : null,
        errorMessage: event.errorMessage,
      })),
      ...recentSyncCompletions.map((event) => {
        const payload =
          typeof event.payloadJson === 'object' && event.payloadJson
            ? (event.payloadJson as Record<string, unknown>)
            : null;
        const propertyCount =
          payload && typeof payload.propertyCount !== 'undefined'
            ? Number(payload.propertyCount ?? 0)
            : null;
        return {
          id: event.id,
          source: 'sync_completion' as const,
          status: event.status,
          occurredAt: event.createdAt.toISOString(),
          title: 'Property sync completed',
          subtitle:
            propertyCount === null
              ? null
              : [
                  `${propertyCount} properties refreshed`,
                  payload && typeof payload.staleCandidateCount !== 'undefined'
                    ? `${Number(payload.staleCandidateCount ?? 0)} stale candidates`
                    : null,
                  payload && typeof payload.delistedCount !== 'undefined'
                    ? `${Number(payload.delistedCount ?? 0)} delisted`
                    : null,
                  payload && payload.anomalyStatus === 'anomalous'
                    ? `anomalous${payload.anomalyReason ? ` (${String(payload.anomalyReason)})` : ''}`
                    : null,
                ]
                  .filter((part): part is string => Boolean(part))
                  .join(' • '),
          errorMessage: null,
        };
      }),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 12);

    const recentWebhookEntries = recentWebhookHistory.map((webhook) => {
      const payload =
        webhook.payloadJson && typeof webhook.payloadJson === 'object'
          ? (webhook.payloadJson as Record<string, unknown>)
          : {};
      return {
        id: webhook.id,
        eventType: webhook.eventType,
        status: webhook.processingStatus,
        receivedAt: webhook.receivedAt.toISOString(),
        errorMessage: webhook.errorMessage,
        summary: summarizeWebhookPayload(payload),
        payloadJson: payload,
      };
    });

    return res.json({
      integrationAccount: {
        id: integrationAccount.id,
        tenantId: integrationAccount.tenantId,
        provider: integrationAccount.provider,
        name: integrationAccount.name,
        status: integrationAccount.status,
        mode: settings.mode,
        hasCredentials: Boolean(integrationAccount.credentialsJsonEncrypted),
        seedPropertyCount: settings.seedProperties.length,
        propertyCount: Number(propertyCountRow[0]?.count ?? 0),
        staleCandidatePropertyCount: Number(staleCandidateCountRow[0]?.count ?? 0),
        delistedPropertyCount: Number(delistedCountRow[0]?.count ?? 0),
        pendingWebhookCount: Number(pendingWebhookCountRow[0]?.count ?? 0),
        pendingIntegrationJobCount: Number(pendingIntegrationJobCountRow[0]?.count ?? 0),
        pendingPropertySyncCount: Number(pendingSyncCountRow[0]?.count ?? 0),
        metrics: {
          failedWebhookCount: Number(failedWebhookCountRow[0]?.count ?? 0),
          rejectedWebhookCount: Number(rejectedWebhookCountRow[0]?.count ?? 0),
          unresolvedWebhookCount: Number(unresolvedWebhookCountRow[0]?.count ?? 0),
          ignoredWebhookCount: Number(ignoredWebhookCountRow[0]?.count ?? 0),
          unknownWebhookCount: Number(unknownWebhookCountRow[0]?.count ?? 0),
        },
        lastSyncRequestedAt: lastSyncRequested[0]?.createdAt ?? null,
        lastSyncRequestedPublishedAt: lastSyncRequested[0]?.publishedAt ?? null,
        lastSyncRequestedStatus: lastSyncRequested[0]?.status ?? null,
        lastSyncCompletedAt: lastSyncCompleted[0]?.createdAt ?? null,
        lastSyncCompletedPropertyCount:
          typeof lastSyncCompleted[0]?.payloadJson === 'object' &&
          lastSyncCompleted[0]?.payloadJson &&
          'propertyCount' in lastSyncCompleted[0].payloadJson
            ? Number((lastSyncCompleted[0].payloadJson as Record<string, unknown>).propertyCount ?? 0)
            : null,
        latestWebhookReceivedAt: latestWebhookReceived[0]?.receivedAt ?? null,
        latestWebhookStatus: latestWebhookReceived[0]?.processingStatus ?? null,
        latestSyncRun: latestSyncRunRecord
          ? {
              id: latestSyncRunRecord.id,
              triggerSource: latestSyncRunRecord.triggerSource,
              status: latestSyncRunRecord.status,
              anomalyStatus: latestSyncRunRecord.anomalyStatus,
              anomalyReason: latestSyncRunRecord.anomalyReason,
              baselineMedian: latestSyncRunBaselineMedian,
              propertyCount: latestSyncRunRecord.propertyCount,
              staleCandidateCount: latestSyncRunRecord.staleCandidateCount,
              delistedCount: latestSyncRunRecord.delistedCount,
              startedAt: latestSyncRunRecord.startedAt,
              completedAt: latestSyncRunRecord.completedAt,
            }
          : null,
        diagnostics: {
          lastWebhookError: lastWebhookError[0]
            ? {
                id: lastWebhookError[0].id,
                receivedAt: lastWebhookError[0].receivedAt,
                eventType: lastWebhookError[0].eventType,
                errorMessage: lastWebhookError[0].errorMessage,
              }
            : null,
          lastIntegrationJobError: lastIntegrationJobError[0]
            ? {
                id: lastIntegrationJobError[0].id,
                failedAt: lastIntegrationJobError[0].failedAt,
                jobType: lastIntegrationJobError[0].jobType,
                entityExternalId: lastIntegrationJobError[0].entityExternalId,
                errorMessage: lastIntegrationJobError[0].errorMessage,
              }
            : null,
          lastSyncRequestError: lastSyncRequestError[0]
            ? {
                id: lastSyncRequestError[0].id,
                createdAt: lastSyncRequestError[0].createdAt,
                errorMessage: lastSyncRequestError[0].errorMessage,
              }
            : null,
          lastSyncAnomaly:
            latestSyncRunRecord && latestSyncRunRecord.anomalyStatus === 'anomalous'
              ? {
                  id: latestSyncRunRecord.id,
                  completedAt: latestSyncRunRecord.completedAt,
                  anomalyReason: latestSyncRunRecord.anomalyReason,
                  baselineMedian: latestSyncRunBaselineMedian,
                  propertyCount: latestSyncRunRecord.propertyCount,
                }
              : null,
        },
        history: {
          recentActivity,
          recentWebhooks: recentWebhookEntries,
        },
        updatedAt: integrationAccount.updatedAt,
      },
    });
  });

  app.post('/api/v1/integrations/dezrez/retry-sync-request', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = retrySyncRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const failedQuery = deps.db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
          eq(schema.outboxEvents.eventName, 'property.sync_requested'),
          eq(schema.outboxEvents.status, 'failed'),
          parsed.data.outboxEventId
            ? eq(schema.outboxEvents.id, parsed.data.outboxEventId)
            : sql`true`,
        ),
      )
      .orderBy(desc(schema.outboxEvents.createdAt))
      .limit(1);
    const [failedSyncRequest] = await failedQuery;

    if (!failedSyncRequest) {
      return res.status(404).json({ error: 'failed_sync_request_not_found' });
    }

    const updatedRows = await deps.db
      .update(schema.outboxEvents)
      .set({
        status: 'pending',
        availableAt: new Date(),
        publishedAt: null,
        failedAt: null,
        errorMessage: null,
      })
      .where(eq(schema.outboxEvents.id, failedSyncRequest.id))
      .returning();
    const retriedSyncRequest = requireValue(updatedRows[0], 'retried_sync_request');

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'integration_account',
      entityId: retriedSyncRequest.entityId,
      action: 'integration_account.sync_request_retried',
      summary: 'Retried failed Dezrez property sync request',
      mutationType: 'updated',
      payload: {
        outboxEventId: retriedSyncRequest.id,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.json({
      retried: true,
      outboxEventId: retriedSyncRequest.id,
    });
  });

  app.post('/api/v1/integrations/dezrez/retry-job', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = retryIntegrationJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [failedJob] = await deps.db
      .select()
      .from(schema.integrationJobs)
      .where(
        and(
          eq(schema.integrationJobs.tenantId, parsed.data.tenantId),
          eq(schema.integrationJobs.provider, 'dezrez'),
          eq(schema.integrationJobs.status, 'failed'),
          parsed.data.integrationJobId
            ? eq(schema.integrationJobs.id, parsed.data.integrationJobId)
            : sql`true`,
        ),
      )
      .orderBy(desc(schema.integrationJobs.failedAt))
      .limit(1);

    if (!failedJob) {
      return res.status(404).json({ error: 'failed_integration_job_not_found' });
    }

    const updatedRows = await deps.db
      .update(schema.integrationJobs)
      .set({
        status: 'pending',
        availableAt: new Date(),
        lockedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationJobs.id, failedJob.id))
      .returning();
    const retriedJob = requireValue(updatedRows[0], 'retried_integration_job');

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'integration_job',
      entityId: retriedJob.id,
      action: 'integration_job.retried',
      summary: `Retried failed ${retriedJob.jobType} integration job`,
      mutationType: 'updated',
      payload: {
        integrationJobId: retriedJob.id,
        jobType: retriedJob.jobType,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.json({
      retried: true,
      integrationJobId: retriedJob.id,
    });
  });

  app.post('/api/v1/integrations/dezrez/replay-webhook', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = replayWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [failedWebhook] = await deps.db
      .select()
      .from(schema.webhookEvents)
      .where(
        and(
          eq(schema.webhookEvents.tenantId, parsed.data.tenantId),
          eq(schema.webhookEvents.provider, 'dezrez'),
          eq(schema.webhookEvents.processingStatus, 'failed'),
          parsed.data.webhookEventId
            ? eq(schema.webhookEvents.id, parsed.data.webhookEventId)
            : sql`true`,
        ),
      )
      .orderBy(desc(schema.webhookEvents.receivedAt))
      .limit(1);

    if (!failedWebhook) {
      return res.status(404).json({ error: 'failed_webhook_not_found' });
    }

    const updatedRows = await deps.db
      .update(schema.webhookEvents)
      .set({
        processingStatus: 'pending',
        processedAt: null,
        errorMessage: null,
      })
      .where(eq(schema.webhookEvents.id, failedWebhook.id))
      .returning();
    const replayedWebhook = requireValue(updatedRows[0], 'replayed_webhook');

    await recordMutation({
      db: deps.db,
      actorUserId: authReq.auth!.userId,
      tenantId: parsed.data.tenantId,
      entityType: 'integration_account',
      entityId: replayedWebhook.integrationAccountId ?? COLLECTION_EVENT_ENTITY_ID,
      action: 'integration_account.webhook_replayed',
      summary: `Replayed failed Dezrez webhook ${replayedWebhook.eventType}`,
      mutationType: 'updated',
      payload: {
        webhookEventId: replayedWebhook.id,
        eventType: replayedWebhook.eventType,
      },
      publishEntityChangedEvent: deps.publishEntityChangedEvent,
    });

    return res.json({
      replayed: true,
      webhookEventId: replayedWebhook.id,
    });
  });

  app.get('/api/v1/properties', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = listPropertiesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
    }

    if (!hasTenantMembership(authReq.auth!, parsed.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const currentDezrezPropertyRoleReferences = deps.db
      .selectDistinctOn([schema.externalReferences.entityId], {
        tenantId: schema.externalReferences.tenantId,
        entityId: schema.externalReferences.entityId,
        externalId: schema.externalReferences.externalId,
      })
      .from(schema.externalReferences)
      .where(
        and(
          eq(schema.externalReferences.tenantId, parsed.data.tenantId),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
          eq(schema.externalReferences.externalType, 'property_role'),
          eq(schema.externalReferences.isCurrent, true),
        ),
      )
      .orderBy(
        schema.externalReferences.entityId,
        desc(schema.externalReferences.updatedAt),
        desc(schema.externalReferences.createdAt),
      )
      .as('current_dezrez_property_role_references');

    const properties = await deps.db
      .select({
        id: schema.properties.id,
        branchId: schema.properties.branchId,
        displayAddress: schema.properties.displayAddress,
        postcode: schema.properties.postcode,
        status: schema.properties.status,
        marketingStatus: schema.properties.marketingStatus,
        syncState: schema.properties.syncState,
        consecutiveMissCount: schema.properties.consecutiveMissCount,
        lastSeenAt: schema.properties.lastSeenAt,
        staleCandidateAt: schema.properties.staleCandidateAt,
        delistedAt: schema.properties.delistedAt,
        delistedReason: schema.properties.delistedReason,
        externalId: currentDezrezPropertyRoleReferences.externalId,
      })
      .from(schema.properties)
      .leftJoin(
        currentDezrezPropertyRoleReferences,
        and(
          eq(currentDezrezPropertyRoleReferences.tenantId, schema.properties.tenantId),
          eq(currentDezrezPropertyRoleReferences.entityId, schema.properties.id),
        ),
      )
      .where(eq(schema.properties.tenantId, parsed.data.tenantId))
      .orderBy(asc(schema.properties.displayAddress));

    return res.json({ properties });
  });

  app.get('/api/v1/properties/:propertyId', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    const parsedParams = propertyParamsSchema.safeParse(req.params);
    if (!parsedQuery.success || !parsedParams.success) {
      return res.status(400).json({
        error: 'invalid_request',
        details: {
          query: parsedQuery.success ? null : parsedQuery.error.flatten(),
          params: parsedParams.success ? null : parsedParams.error.flatten(),
        },
      });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const property = await loadPropertyRecord({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      propertyId: parsedParams.data.propertyId,
    });

    if (!property) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    const [offers, viewings, timelineEvents] = await Promise.all([
      deps.db
        .select({ id: schema.offers.id })
        .from(schema.offers)
        .where(
          and(
            eq(schema.offers.tenantId, parsedQuery.data.tenantId),
            eq(schema.offers.propertyId, property.id),
          ),
        ),
      deps.db
        .select({ id: schema.viewings.id })
        .from(schema.viewings)
        .where(
          and(
            eq(schema.viewings.tenantId, parsedQuery.data.tenantId),
            eq(schema.viewings.propertyId, property.id),
          ),
        ),
      deps.db
        .select({ id: schema.timelineEvents.id })
        .from(schema.timelineEvents)
        .where(
          and(
            eq(schema.timelineEvents.tenantId, parsedQuery.data.tenantId),
            eq(schema.timelineEvents.subjectType, 'property'),
            eq(schema.timelineEvents.subjectId, property.id),
          ),
        ),
    ]);

    return res.json({
      property: {
        ...property,
        counts: {
          offers: offers.length,
          viewings: viewings.length,
          timelineEvents: timelineEvents.length,
        },
      },
    });
  });

  app.get('/api/v1/properties/:propertyId/offers', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    const parsedParams = propertyParamsSchema.safeParse(req.params);
    if (!parsedQuery.success || !parsedParams.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const property = await loadPropertyRecord({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      propertyId: parsedParams.data.propertyId,
    });
    if (!property) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    const offers = await deps.db
      .select({
        id: schema.offers.id,
        externalId: schema.offers.externalId,
        propertyRoleExternalId: schema.offers.propertyRoleExternalId,
        applicantName: schema.offers.applicantName,
        applicantEmail: schema.offers.applicantEmail,
        applicantGrade: schema.offers.applicantGrade,
        amount: schema.offers.amount,
        status: schema.offers.status,
        offeredAt: schema.offers.offeredAt,
        createdAt: schema.offers.createdAt,
        updatedAt: schema.offers.updatedAt,
      })
      .from(schema.offers)
      .where(
        and(
          eq(schema.offers.tenantId, parsedQuery.data.tenantId),
          eq(schema.offers.propertyId, property.id),
        ),
      )
      .orderBy(desc(schema.offers.offeredAt), desc(schema.offers.createdAt));

    return res.json({ offers });
  });

  app.get('/api/v1/properties/:propertyId/viewings', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    const parsedParams = propertyParamsSchema.safeParse(req.params);
    if (!parsedQuery.success || !parsedParams.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const property = await loadPropertyRecord({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      propertyId: parsedParams.data.propertyId,
    });
    if (!property) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    const viewings = await deps.db
      .select({
        id: schema.viewings.id,
        externalId: schema.viewings.externalId,
        propertyRoleExternalId: schema.viewings.propertyRoleExternalId,
        applicantName: schema.viewings.applicantName,
        applicantEmail: schema.viewings.applicantEmail,
        applicantGrade: schema.viewings.applicantGrade,
        eventStatus: schema.viewings.eventStatus,
        feedbackCount: schema.viewings.feedbackCount,
        notesCount: schema.viewings.notesCount,
        startsAt: schema.viewings.startsAt,
        createdAt: schema.viewings.createdAt,
        updatedAt: schema.viewings.updatedAt,
      })
      .from(schema.viewings)
      .where(
        and(
          eq(schema.viewings.tenantId, parsedQuery.data.tenantId),
          eq(schema.viewings.propertyId, property.id),
        ),
      )
      .orderBy(desc(schema.viewings.startsAt), desc(schema.viewings.createdAt));

    return res.json({ viewings });
  });

  app.get('/api/v1/properties/:propertyId/timeline', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    const parsedParams = propertyParamsSchema.safeParse(req.params);
    if (!parsedQuery.success || !parsedParams.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantMembership(authReq.auth!, parsedQuery.data.tenantId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const property = await loadPropertyRecord({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      propertyId: parsedParams.data.propertyId,
    });
    if (!property) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    const timelineEvents = await deps.db
      .select({
        id: schema.timelineEvents.id,
        externalId: schema.timelineEvents.externalId,
        propertyRoleExternalId: schema.timelineEvents.propertyRoleExternalId,
        eventType: schema.timelineEvents.eventType,
        title: schema.timelineEvents.title,
        body: schema.timelineEvents.body,
        actorType: schema.timelineEvents.actorType,
        metadataJson: schema.timelineEvents.metadataJson,
        occurredAt: schema.timelineEvents.occurredAt,
        createdAt: schema.timelineEvents.createdAt,
      })
      .from(schema.timelineEvents)
      .where(
        and(
          eq(schema.timelineEvents.tenantId, parsedQuery.data.tenantId),
          eq(schema.timelineEvents.subjectType, 'property'),
          eq(schema.timelineEvents.subjectId, property.id),
        ),
      )
      .orderBy(desc(schema.timelineEvents.occurredAt), desc(schema.timelineEvents.createdAt));

    return res.json({ timelineEvents });
  });

  app.post('/api/v1/properties/:propertyId/refresh-related', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsedQuery = tenantScopedQuerySchema.safeParse(req.query);
    const parsedParams = propertyParamsSchema.safeParse(req.params);
    if (!parsedQuery.success || !parsedParams.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    if (!hasTenantRole(authReq.auth!, parsedQuery.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const property = await loadPropertyRecord({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      propertyId: parsedParams.data.propertyId,
    });
    if (!property) {
      return res.status(404).json({ error: 'property_not_found' });
    }

    if (!property.externalId) {
      return res.status(409).json({ error: 'property_external_reference_missing' });
    }

    const [integrationAccount] = await deps.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.tenantId, parsedQuery.data.tenantId),
          eq(schema.integrationAccounts.provider, 'dezrez'),
          eq(schema.integrationAccounts.status, 'active'),
        ),
      )
      .limit(1);

    if (!integrationAccount) {
      return res.status(404).json({ error: 'integration_account_not_found' });
    }

    await queueManualDezrezRoleRefreshJobs({
      db: deps.db,
      tenantId: parsedQuery.data.tenantId,
      integrationAccountId: integrationAccount.id,
      propertyExternalId: property.externalId,
      propertyMetadata:
        property.propertyExternalMetadata && typeof property.propertyExternalMetadata === 'object'
          ? (property.propertyExternalMetadata as Record<string, unknown>)
          : null,
    });

    return res.status(202).json({
      accepted: true,
      propertyId: property.id,
      propertyExternalId: property.externalId,
    });
  });

  app.post('/api/v1/integrations/dezrez/sync', requireAuth, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const parsed = propertySyncRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    if (!hasTenantRole(authReq.auth!, parsed.data.tenantId, 'tenant_admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [integrationAccount] = await deps.db
      .select()
      .from(schema.integrationAccounts)
      .where(
        and(
          eq(schema.integrationAccounts.tenantId, parsed.data.tenantId),
          eq(schema.integrationAccounts.provider, 'dezrez'),
        ),
      )
      .limit(1);

    if (!integrationAccount) {
      return res.status(404).json({ error: 'integration_account_not_found' });
    }

    const pendingSyncRequests = await deps.db
      .select({
        id: schema.outboxEvents.id,
        payloadJson: schema.outboxEvents.payloadJson,
      })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.tenantId, parsed.data.tenantId),
          eq(schema.outboxEvents.eventName, 'property.sync_requested'),
          eq(schema.outboxEvents.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.outboxEvents.createdAt));

    const existingPendingSyncRequest = pendingSyncRequests.find((event) => {
      if (!event.payloadJson || typeof event.payloadJson !== 'object') {
        return false;
      }

      return (
        (event.payloadJson as Record<string, unknown>).integrationAccountId === integrationAccount.id
      );
    });

    if (existingPendingSyncRequest) {
      console.log('@vitalspace/api property.sync_requested deduplicated', {
        tenantId: parsed.data.tenantId,
        integrationAccountId: integrationAccount.id,
        existingEventId: existingPendingSyncRequest.id,
      });
      return res.status(202).json({
        accepted: true,
        deduplicated: true,
        existingEventId: existingPendingSyncRequest.id,
      });
    }

    const event = buildEntityChangedEvent({
      tenantId: parsed.data.tenantId,
      entityType: 'property',
      entityId: COLLECTION_EVENT_ENTITY_ID,
      mutationType: 'sync_requested',
      payload: {
        integrationAccountId: integrationAccount.id,
      },
    });

    const createdSyncRequests = await deps.db
      .insert(schema.outboxEvents)
      .values({
      tenantId: parsed.data.tenantId,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: COLLECTION_EVENT_ENTITY_ID,
      mutationType: 'sync_requested',
      channelKey: buildTenantRoom(parsed.data.tenantId),
      payloadJson: propertySyncRequestPayloadSchema.parse({
        integrationAccountId: integrationAccount.id,
        requestedByUserId: authReq.auth!.userId,
        trigger: {
          source: 'manual_api',
        },
      }),
      status: 'pending',
      publishedAt: deps.publishEntityChangedEvent ? new Date() : null,
      })
      .returning();

    console.log('@vitalspace/api property.sync_requested queued', {
      source: 'manual_api',
      tenantId: parsed.data.tenantId,
      integrationAccountId: integrationAccount.id,
      outboxEventId: createdSyncRequests[0]?.id ?? null,
    });

    deps.publishEntityChangedEvent?.(event);

    return res.status(202).json({ accepted: true, deduplicated: false, event });
  });

  return app;
}
