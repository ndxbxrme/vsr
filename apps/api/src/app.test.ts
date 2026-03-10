import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { eq, sql } from 'drizzle-orm';
import {
  processPendingDezrezWebhookEvents,
  processPendingIntegrationJobs,
  processPendingPropertySyncs,
} from '@vitalspace/integrations';
import { createDbClient, migrateDb, schema } from '@vitalspace/db';
import { Server } from 'socket.io';
import { io as createSocketClient } from 'socket.io-client';
import { createApp } from './app';
import { configureRealtime } from './realtime';
import { createRuntimeApp } from './runtime';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

const { db, client } = createDbClient(DATABASE_URL);
const app = createApp({
  db,
  oauthProviders: ['google'],
});

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
      "integration_jobs",
      "properties",
      "external_references",
      "tenants",
      "users"
    RESTART IDENTITY CASCADE
  `);
}

describe('api auth and tenancy', () => {
  beforeAll(async () => {
    await migrateDb(DATABASE_URL);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await client.end();
  });

  it('supports signup, login, and current-user lookup', async () => {
    const signup = await request(app).post('/api/v1/auth/signup').send({
      email: 'owner@example.com',
      password: 'Secret123',
      firstName: 'Casey',
      lastName: 'Owner',
    });

    expect(signup.status).toBe(201);

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@example.com',
      password: 'Secret123',
    });

    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();

    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.email).toBe('owner@example.com');
    expect(me.body.memberships).toHaveLength(0);
  });

  it('supports tenant and branch creation for an authenticated tenant admin', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Acme Estates',
        slug: 'acme-estates',
        branchName: 'Manchester',
        branchSlug: 'manchester',
      });

    expect(createTenant.status).toBe(201);
    expect(createTenant.body.tenant.slug).toBe('acme-estates');
    expect(createTenant.body.branch.slug).toBe('manchester');

    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].roles[0].key).toBe('tenant_admin');

    const createBranch = await request(app)
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Sale',
        slug: 'sale',
      });

    expect(createBranch.status).toBe(201);
    expect(createBranch.body.branch.slug).toBe('sale');

    const auditRows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.tenantId, createTenant.body.tenant.id));
    const outboxRows = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.tenantId, createTenant.body.tenant.id));

    expect(auditRows).toHaveLength(2);
    expect(outboxRows).toHaveLength(2);
    expect(outboxRows.map((row) => row.eventName)).toEqual(
      expect.arrayContaining(['tenant.created', 'branch.created']),
    );
  });

  it('rejects protected routes without valid authentication', async () => {
    const response = await request(app).post('/api/v1/tenants').send({
      name: 'No Auth',
      slug: 'no-auth',
      branchName: 'Main',
      branchSlug: 'main',
    });

    expect(response.status).toBe(401);
  });

  it('stores a Dezrez account, processes a sync request, and returns synced properties', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'property-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'property-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Property Estates',
        slug: 'property-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const configureDezrez = await request(app)
      .post('/api/v1/integrations/dezrez/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Primary Dezrez',
        settings: {
          seedProperties: [
            {
              externalId: 'DRZ-500',
              displayAddress: '5 Market Street, Manchester',
              postcode: 'M1 1WR',
              marketingStatus: 'for_sale',
            },
            {
              externalId: 'DRZ-501',
              displayAddress: '7 Market Street, Manchester',
              postcode: 'M1 1WR',
              marketingStatus: 'under_offer',
            },
          ],
        },
      });

    expect(configureDezrez.status).toBe(201);

    const sync = await request(app)
      .post('/api/v1/integrations/dezrez/sync')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
      });

    expect(sync.status).toBe(202);

    const processed = await processPendingPropertySyncs({ db });
    expect(processed).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 2,
    });

    const properties = await request(app)
      .get('/api/v1/properties')
      .query({
        tenantId: createTenant.body.tenant.id,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(properties.status).toBe(200);
    expect(properties.body.properties).toHaveLength(2);
    expect(properties.body.properties[0]).toMatchObject({
      displayAddress: '5 Market Street, Manchester',
      externalId: 'DRZ-500',
    });
    expect(properties.body.properties[1]).toMatchObject({
      displayAddress: '7 Market Street, Manchester',
      externalId: 'DRZ-501',
    });
  });

  it('accepts Dezrez webhooks on /event and turns them into durable integration jobs', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'webhook-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'webhook-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Webhook Estates',
        slug: 'webhook-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const configureDezrez = await request(app)
      .post('/api/v1/integrations/dezrez/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Webhook Dezrez',
        settings: {
          seedProperties: [
            {
              externalId: '30026645',
              displayAddress: '50 Manchester Street, Manchester',
              postcode: 'M16 9GZ',
              marketingStatus: 'for_sale',
            },
          ],
        },
      });

    expect(configureDezrez.status).toBe(201);

    const event = await request(app).post('/event').send({
      EventName: 'ViewingFeedback',
      PropertyId: 3671906,
      PropertyRoleId: 30026645,
      RootEntityId: 88991,
    });

    expect(event.status).toBe(202);
    expect(event.body.provider).toBe('dezrez');

    const webhookRows = await db.select().from(schema.webhookEvents);
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows[0]?.eventType).toBe('ViewingFeedback');
    expect(webhookRows[0]?.integrationAccountId).toBe(
      configureDezrez.body.integrationAccount.id,
    );

    const classified = await processPendingDezrezWebhookEvents({ db });
    expect(classified).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      createdJobs: 1,
    });

    const integrationJobs = await db.select().from(schema.integrationJobs);
    expect(integrationJobs).toHaveLength(1);
    expect(integrationJobs[0]?.jobType).toBe('viewing.role.refresh');

    const processedJobs = await processPendingIntegrationJobs({ db });
    expect(processedJobs).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });

    const refreshOutboxEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'dezrez.viewing_role_refresh.requested'));

    expect(refreshOutboxEvents).toHaveLength(1);
    expect(integrationJobs[0]?.status).not.toBe('failed');
  });

  it('authenticates sockets with bearer tokens and broadcasts tenant-scoped events', async () => {
    const server = createServer();
    const io = new Server(server, {
      cors: { origin: '*' },
    });
    configureRealtime(io, db);

    const runtimeApp = createRuntimeApp({
      db,
      io,
      oauthProviders: ['google'],
    });
    server.on('request', runtimeApp);

    await request(runtimeApp).post('/api/v1/auth/signup').send({
      email: 'socket-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(runtimeApp).post('/api/v1/auth/login').send({
      email: 'socket-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(runtimeApp)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Socket Estates',
        slug: 'socket-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const configureDezrez = await request(runtimeApp)
      .post('/api/v1/integrations/dezrez/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Socket Dezrez',
        settings: {
          seedProperties: [],
        },
      });

    expect(configureDezrez.status).toBe(201);

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server_address_not_available');
    }

    const socket = createSocketClient(`http://127.0.0.1:${address.port}`, {
      auth: {
        token: accessToken,
      },
      transports: ['websocket'],
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('socket_connect_timeout')), 3000);
        socket.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.on('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const eventPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('socket_event_timeout')), 3000);
        socket.on('entity.changed', (event) => {
          clearTimeout(timeout);
          resolve(event as Record<string, unknown>);
        });
      });

      const sync = await request(runtimeApp)
        .post('/api/v1/integrations/dezrez/sync')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          tenantId: createTenant.body.tenant.id,
        });

      expect(sync.status).toBe(202);

      const event = await eventPromise;
      expect(event.tenantId).toBe(createTenant.body.tenant.id);
      expect(event.entityType).toBe('property');
      expect(event.mutationType).toBe('sync_requested');
    } finally {
      socket.close();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
  });
});
