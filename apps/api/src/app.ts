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
  dezrezIntegrationCredentialsSchema,
  dezrezIntegrationSettingsSchema,
  dezrezWebhookPayloadSchema,
  propertySyncRequestPayloadSchema,
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
import { loadStoredFile, persistUploadedFile } from './file-storage';
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  maybeEncryptToken,
  parseOAuthState,
} from './oauth';
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

const tenantScopedQuerySchema = z.object({
  tenantId: z.string().uuid(),
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

const webhookQuerySchema = z.object({
  provider: z.literal('dezrez').optional().default('dezrez'),
  integrationAccountId: z.string().uuid().optional(),
});

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
  const [property] = await args.db
    .select({
      id: schema.properties.id,
      tenantId: schema.properties.tenantId,
      branchId: schema.properties.branchId,
      displayAddress: schema.properties.displayAddress,
      postcode: schema.properties.postcode,
      status: schema.properties.status,
      marketingStatus: schema.properties.marketingStatus,
      externalId: schema.externalReferences.externalId,
      provider: schema.externalReferences.provider,
      propertyExternalMetadata: schema.externalReferences.metadataJson,
      createdAt: schema.properties.createdAt,
      updatedAt: schema.properties.updatedAt,
    })
    .from(schema.properties)
    .leftJoin(
      schema.externalReferences,
      and(
        eq(schema.externalReferences.tenantId, schema.properties.tenantId),
        eq(schema.externalReferences.entityId, schema.properties.id),
        eq(schema.externalReferences.provider, 'dezrez'),
        eq(schema.externalReferences.entityType, 'property'),
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

function hasNonEmptyCredentials(credentials: Record<string, unknown>) {
  return Object.values(credentials).some((value) => value !== undefined && value !== null && value !== '');
}

async function resolveIntegrationAccount(args: {
  db: DbClient;
  provider: string;
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
    )
    .limit(2);

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

  app.use(express.json());

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
      integrationAccountId: parsedQuery.data.integrationAccountId,
    });

    const eventName =
      parsedQuery.data.provider === 'dezrez'
        ? dezrezWebhookPayloadSchema.safeParse(req.body).data?.EventName ?? 'unknown'
        : 'unknown';

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
    const [propertyCountRow, pendingWebhookCountRow, pendingIntegrationJobCountRow, pendingSyncCountRow] =
      await Promise.all([
        deps.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.properties)
          .where(eq(schema.properties.tenantId, parsed.data.tenantId)),
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
    ]);

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
            propertyCount === null ? null : `${propertyCount} properties refreshed`,
          errorMessage: null,
        };
      }),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 12);

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
        pendingWebhookCount: Number(pendingWebhookCountRow[0]?.count ?? 0),
        pendingIntegrationJobCount: Number(pendingIntegrationJobCountRow[0]?.count ?? 0),
        pendingPropertySyncCount: Number(pendingSyncCountRow[0]?.count ?? 0),
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
        },
        history: {
          recentActivity,
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

    const properties = await deps.db
      .select({
        id: schema.properties.id,
        branchId: schema.properties.branchId,
        displayAddress: schema.properties.displayAddress,
        postcode: schema.properties.postcode,
        status: schema.properties.status,
        marketingStatus: schema.properties.marketingStatus,
        externalId: schema.externalReferences.externalId,
      })
      .from(schema.properties)
      .leftJoin(
        schema.externalReferences,
        and(
          eq(schema.externalReferences.tenantId, schema.properties.tenantId),
          eq(schema.externalReferences.entityId, schema.properties.id),
          eq(schema.externalReferences.provider, 'dezrez'),
          eq(schema.externalReferences.entityType, 'property'),
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

    const event = buildEntityChangedEvent({
      tenantId: parsed.data.tenantId,
      entityType: 'property',
      entityId: COLLECTION_EVENT_ENTITY_ID,
      mutationType: 'sync_requested',
      payload: {
        integrationAccountId: integrationAccount.id,
      },
    });

    await deps.db.insert(schema.outboxEvents).values({
      tenantId: parsed.data.tenantId,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: COLLECTION_EVENT_ENTITY_ID,
      mutationType: 'sync_requested',
      channelKey: buildTenantRoom(parsed.data.tenantId),
      payloadJson: propertySyncRequestPayloadSchema.parse({
        integrationAccountId: integrationAccount.id,
        requestedByUserId: authReq.auth!.userId,
      }),
      publishedAt: deps.publishEntityChangedEvent ? new Date() : null,
    });

    deps.publishEntityChangedEvent?.(event);

    return res.status(202).json({ accepted: true, event });
  });

  return app;
}
