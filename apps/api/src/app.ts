import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '@vitalspace/auth';
import type { EntityChangedEvent } from '@vitalspace/contracts';
import {
  dezrezIntegrationSettingsSchema,
  propertySyncRequestPayloadSchema,
} from '@vitalspace/contracts';
import { type createDbClient, schema } from '@vitalspace/db';
import { buildEntityChangedEvent, buildTenantRoom } from '@vitalspace/realtime';
import { and, asc, eq } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  hasTenantRole,
  loadAuthContext,
  type AuthenticatedContext,
} from './auth-context';

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

const propertySyncRequestSchema = z.object({
  tenantId: z.string().uuid(),
});

const createDezrezAccountSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).default('Dezrez'),
  settings: dezrezIntegrationSettingsSchema,
});

const listPropertiesQuerySchema = z.object({
  tenantId: z.string().uuid(),
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

export function createApp(deps: ApiAppDeps) {
  const app = express();

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
    res.json({
      appName: 'VitalSpace',
      realtimeEnabled: true,
      oauthProviders: deps.oauthProviders ?? [],
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

    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await deps.db.insert(schema.sessions).values({
      userId: row.user.id,
      sessionTokenHash: hashOpaqueToken(token),
      ipAddress: req.ip,
      userAgent: req.header('user-agent') ?? null,
      expiresAt,
    });

    await deps.db
      .update(schema.users)
      .set({
        lastLoginAt: new Date(),
      })
      .where(eq(schema.users.id, row.user.id));

    return res.json({
      accessToken: token,
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
      },
    });
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
        seedPropertyCount: settings.seedProperties.length,
      },
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
    });

    deps.publishEntityChangedEvent?.(event);

    return res.status(202).json({ accepted: true, event });
  });

  return app;
}
