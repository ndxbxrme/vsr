import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { eq, sql } from 'drizzle-orm';
import { decryptJsonPayload } from '@vitalspace/auth';
import {
  processPendingDezrezWebhookEvents,
  processPendingIntegrationJobs,
  processPendingPropertySyncs,
} from '@vitalspace/integrations';
import { createDbClient, migrateDb, schema } from '@vitalspace/db';
import { Server } from 'socket.io';
import { io as createSocketClient } from 'socket.io-client';
import { createApp } from './app';
import { configureRealtime, publishPendingOutboxEvents } from './realtime';
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
      "offers",
      "viewings",
      "timeline_events",
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

  it('returns property detail, offers, viewings, and timeline for a tenant member', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'reader@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'reader@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Read Model Estates',
        slug: 'read-model-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId,
        displayAddress: '10 Oxford Road, Manchester',
        postcode: 'M1 5QA',
        status: 'active',
        marketingStatus: 'for_sale',
      })
      .returning();

    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values({
      tenantId,
      provider: 'dezrez',
      entityType: 'property',
      entityId: property.id,
      externalType: 'property_role',
      externalId: 'DRZ-900',
      metadataJson: {
        propertyId: '3671999',
      },
      lastSeenAt: new Date(),
    });

    await db.insert(schema.offers).values({
      tenantId,
      propertyId: property.id,
      provider: 'dezrez',
      externalId: 'offer-900',
      propertyRoleExternalId: 'DRZ-900',
      applicantName: 'Alex Buyer',
      applicantEmail: 'alex@example.com',
      applicantGrade: 'Hot Buyer',
      amount: 285000,
      status: 'Accepted',
      offeredAt: new Date('2026-03-10T10:00:00.000Z'),
    });

    await db.insert(schema.viewings).values({
      tenantId,
      propertyId: property.id,
      provider: 'dezrez',
      externalId: 'viewing-900',
      propertyRoleExternalId: 'DRZ-900',
      applicantName: 'Jamie Viewer',
      applicantEmail: 'jamie@example.com',
      applicantGrade: 'First Time Buyer',
      eventStatus: 'Completed',
      feedbackCount: 2,
      notesCount: 1,
      startsAt: new Date('2026-03-11T15:30:00.000Z'),
    });

    await db.insert(schema.timelineEvents).values([
      {
        tenantId,
        subjectType: 'property',
        subjectId: property.id,
        provider: 'dezrez',
        externalId: 'timeline-900-a',
        propertyRoleExternalId: 'DRZ-900',
        eventType: 'note',
        title: 'Offer chased',
        body: 'Buyer solicitor asked for an update.',
        actorType: 'external_user',
        metadataJson: {
          actorName: 'Case Handler',
        },
        occurredAt: new Date('2026-03-12T09:15:00.000Z'),
      },
      {
        tenantId,
        subjectType: 'property',
        subjectId: property.id,
        provider: 'dezrez',
        externalId: 'timeline-900-b',
        propertyRoleExternalId: 'DRZ-900',
        eventType: 'mailout',
        title: 'Mailout',
        body: 'Property sent to applicants.',
        actorType: 'external_system',
        occurredAt: new Date('2026-03-12T11:00:00.000Z'),
      },
    ]);

    const detail = await request(app)
      .get(`/api/v1/properties/${property.id}`)
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.property).toMatchObject({
      id: property.id,
      displayAddress: '10 Oxford Road, Manchester',
      externalId: 'DRZ-900',
      counts: {
        offers: 1,
        viewings: 1,
        timelineEvents: 2,
      },
    });

    const offers = await request(app)
      .get(`/api/v1/properties/${property.id}/offers`)
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(offers.status).toBe(200);
    expect(offers.body.offers).toHaveLength(1);
    expect(offers.body.offers[0]).toMatchObject({
      externalId: 'offer-900',
      applicantName: 'Alex Buyer',
      amount: 285000,
      status: 'Accepted',
    });

    const viewings = await request(app)
      .get(`/api/v1/properties/${property.id}/viewings`)
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(viewings.status).toBe(200);
    expect(viewings.body.viewings).toHaveLength(1);
    expect(viewings.body.viewings[0]).toMatchObject({
      externalId: 'viewing-900',
      applicantName: 'Jamie Viewer',
      eventStatus: 'Completed',
      feedbackCount: 2,
      notesCount: 1,
    });

    const timeline = await request(app)
      .get(`/api/v1/properties/${property.id}/timeline`)
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(timeline.status).toBe(200);
    expect(timeline.body.timelineEvents).toHaveLength(2);
    expect(timeline.body.timelineEvents[0]).toMatchObject({
      externalId: 'timeline-900-b',
      eventType: 'mailout',
      title: 'Mailout',
    });
    expect(timeline.body.timelineEvents[1]).toMatchObject({
      externalId: 'timeline-900-a',
      eventType: 'note',
      title: 'Offer chased',
    });
  });

  it('returns Dezrez integration status including last sync timestamps and counts', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'status-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'status-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Status Estates',
        slug: 'status-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const configureDezrez = await request(app)
      .post('/api/v1/integrations/dezrez/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Status Dezrez',
        settings: {
          mode: 'seed',
          seedProperties: [
            {
              externalId: 'DRZ-status-1',
              displayAddress: '1 Status Street',
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
    expect(processed.upsertedProperties).toBe(1);

    await db.insert(schema.webhookEvents).values({
      tenantId: createTenant.body.tenant.id,
      integrationAccountId: configureDezrez.body.integrationAccount.id,
      provider: 'dezrez',
      eventType: 'ViewingFeedback',
      signatureValid: true,
      payloadJson: {
        EventName: 'ViewingFeedback',
      },
      processingStatus: 'failed',
      errorMessage: 'invalid_payload_shape',
    });

    await db.insert(schema.integrationJobs).values({
      tenantId: createTenant.body.tenant.id,
      integrationAccountId: configureDezrez.body.integrationAccount.id,
      provider: 'dezrez',
      jobType: 'viewing.role.refresh',
      entityType: 'property_role',
      entityExternalId: 'DRZ-status-1',
      dedupeKey: 'status-failed-job',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'ViewingFeedback',
        propertyId: '3671999',
        propertyRoleId: 'DRZ-status-1',
        rootEntityId: null,
        rawEvent: {
          EventName: 'ViewingFeedback',
          PropertyRoleId: 'DRZ-status-1',
        },
      },
      status: 'failed',
      failedAt: new Date('2026-03-10T11:00:00.000Z'),
      errorMessage: 'viewing_lookup_failed',
    });

    await db.insert(schema.outboxEvents).values({
      tenantId: createTenant.body.tenant.id,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: '00000000-0000-0000-0000-000000000000',
      mutationType: 'sync_requested',
      channelKey: `tenant:${createTenant.body.tenant.id}`,
      payloadJson: {
        integrationAccountId: configureDezrez.body.integrationAccount.id,
        requestedByUserId: null,
      },
      status: 'failed',
      errorMessage: 'integration_account_unreachable',
    });

    const status = await request(app)
      .get('/api/v1/integrations/dezrez/accounts')
      .query({
        tenantId: createTenant.body.tenant.id,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(status.status).toBe(200);
    expect(status.body.integrationAccount).toMatchObject({
      id: configureDezrez.body.integrationAccount.id,
      name: 'Status Dezrez',
      mode: 'seed',
      hasCredentials: false,
      seedPropertyCount: 1,
      propertyCount: 1,
      pendingWebhookCount: 0,
      pendingIntegrationJobCount: 0,
      pendingPropertySyncCount: 0,
      lastSyncRequestedStatus: 'failed',
      lastSyncCompletedPropertyCount: 1,
      latestWebhookStatus: 'failed',
    });
    expect(status.body.integrationAccount.lastSyncRequestedAt).toBeTruthy();
    expect(status.body.integrationAccount.lastSyncCompletedAt).toBeTruthy();
    expect(status.body.integrationAccount.latestWebhookReceivedAt).toBeTruthy();
    expect(status.body.integrationAccount.diagnostics.lastWebhookError).toMatchObject({
      eventType: 'ViewingFeedback',
      errorMessage: 'invalid_payload_shape',
    });
    expect(status.body.integrationAccount.diagnostics.lastIntegrationJobError).toMatchObject({
      jobType: 'viewing.role.refresh',
      entityExternalId: 'DRZ-status-1',
      errorMessage: 'viewing_lookup_failed',
    });
    expect(status.body.integrationAccount.diagnostics.lastSyncRequestError).toMatchObject({
      errorMessage: 'integration_account_unreachable',
    });
    expect(status.body.integrationAccount.history.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'webhook',
          title: 'ViewingFeedback',
          status: 'failed',
        }),
        expect.objectContaining({
          source: 'integration_job',
          title: 'viewing.role.refresh',
          status: 'failed',
          subtitle: 'DRZ-status-1',
        }),
        expect.objectContaining({
          source: 'sync_request',
          title: 'Property sync requested',
          status: 'failed',
        }),
        expect.objectContaining({
          source: 'sync_completion',
          title: 'Property sync completed',
        }),
      ]),
    );
  });

  it('retries failed Dezrez sync requests and integration jobs', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'retry-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'retry-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Retry Estates',
        slug: 'retry-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const configureDezrez = await request(app)
      .post('/api/v1/integrations/dezrez/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Retry Dezrez',
        settings: {
          mode: 'seed',
          seedProperties: [
            {
              externalId: 'retry-role-1',
              displayAddress: '9 Retry Road',
            },
          ],
        },
      });

    const [failedSyncRequest] = await db
      .insert(schema.outboxEvents)
      .values({
        tenantId: createTenant.body.tenant.id,
        eventName: 'property.sync_requested',
        entityType: 'property',
        entityId: '00000000-0000-0000-0000-000000000000',
        mutationType: 'sync_requested',
        channelKey: `tenant:${createTenant.body.tenant.id}`,
        payloadJson: {
          integrationAccountId: configureDezrez.body.integrationAccount.id,
          requestedByUserId: null,
        },
        status: 'failed',
        errorMessage: 'upstream_timeout',
      })
      .returning();

    const [failedJob] = await db
      .insert(schema.integrationJobs)
      .values({
        tenantId: createTenant.body.tenant.id,
        integrationAccountId: configureDezrez.body.integrationAccount.id,
        provider: 'dezrez',
        jobType: 'timeline.role.refresh',
        entityType: 'property_role',
        entityExternalId: 'retry-role-1',
        dedupeKey: 'retry-failed-job',
        payloadJson: {
          webhookEventId: '00000000-0000-0000-0000-000000000000',
          eventName: 'GenericEvent',
          propertyId: 'retry-property-1',
          propertyRoleId: 'retry-role-1',
          rootEntityId: null,
          rawEvent: {
            EventName: 'GenericEvent',
            PropertyRoleId: 'retry-role-1',
          },
        },
        status: 'failed',
        failedAt: new Date('2026-03-10T12:00:00.000Z'),
        errorMessage: 'timeline_fetch_failed',
      })
      .returning();

    if (!failedSyncRequest || !failedJob) {
      throw new Error('retry_test_setup_failed');
    }

    const retrySyncRequest = await request(app)
      .post('/api/v1/integrations/dezrez/retry-sync-request')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        outboxEventId: failedSyncRequest.id,
      });

    expect(retrySyncRequest.status).toBe(200);
    expect(retrySyncRequest.body).toMatchObject({
      retried: true,
      outboxEventId: failedSyncRequest.id,
    });

    const retryJob = await request(app)
      .post('/api/v1/integrations/dezrez/retry-job')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        integrationJobId: failedJob.id,
      });

    expect(retryJob.status).toBe(200);
    expect(retryJob.body).toMatchObject({
      retried: true,
      integrationJobId: failedJob.id,
    });

    const [retriedSyncRow] = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, failedSyncRequest.id))
      .limit(1);
    const [retriedJobRow] = await db
      .select()
      .from(schema.integrationJobs)
      .where(eq(schema.integrationJobs.id, failedJob.id))
      .limit(1);

    expect(retriedSyncRow).toMatchObject({
      status: 'pending',
      errorMessage: null,
    });
    expect(retriedJobRow).toMatchObject({
      status: 'pending',
      errorMessage: null,
    });
  });

  it('replays failed Dezrez webhooks', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'replay-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'replay-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Replay Estates',
        slug: 'replay-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const configureDezrez = await request(app)
      .post('/api/v1/integrations/dezrez/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        name: 'Replay Dezrez',
        settings: {
          mode: 'seed',
          seedProperties: [],
        },
      });

    const [failedWebhook] = await db
      .insert(schema.webhookEvents)
      .values({
        tenantId: createTenant.body.tenant.id,
        integrationAccountId: configureDezrez.body.integrationAccount.id,
        provider: 'dezrez',
        eventType: 'ViewingFeedback',
        signatureValid: true,
        payloadJson: {
          EventName: 'ViewingFeedback',
          PropertyRoleId: 'replay-role-1',
        },
        processingStatus: 'failed',
        errorMessage: 'invalid_payload_shape',
      })
      .returning();

    if (!failedWebhook) {
      throw new Error('failed_webhook_not_created');
    }

    const replay = await request(app)
      .post('/api/v1/integrations/dezrez/replay-webhook')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        webhookEventId: failedWebhook.id,
      });

    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      replayed: true,
      webhookEventId: failedWebhook.id,
    });

    const [replayedWebhook] = await db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, failedWebhook.id))
      .limit(1);

    expect(replayedWebhook).toMatchObject({
      processingStatus: 'pending',
      errorMessage: null,
    });
  });

  it('stores Dezrez credentials encrypted per tenant', async () => {
    const previousKey = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

    try {
      await request(app).post('/api/v1/auth/signup').send({
        email: 'encrypted-admin@example.com',
        password: 'Secret123',
      });

      const login = await request(app).post('/api/v1/auth/login').send({
        email: 'encrypted-admin@example.com',
        password: 'Secret123',
      });

      const accessToken = login.body.accessToken as string;

      const createTenant = await request(app)
        .post('/api/v1/tenants')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Encrypted Estates',
          slug: 'encrypted-estates',
          branchName: 'Main',
          branchSlug: 'main',
        });

      const configureDezrez = await request(app)
        .post('/api/v1/integrations/dezrez/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          tenantId: createTenant.body.tenant.id,
          name: 'Encrypted Dezrez',
          settings: {
            mode: 'seed',
            seedProperties: [],
          },
          credentials: {
            apiKey: 'tenant-api-key',
            clientId: 'tenant-client-id',
            clientSecret: 'tenant-client-secret',
          },
        });

      expect(configureDezrez.status).toBe(201);
      expect(configureDezrez.body.integrationAccount.hasCredentials).toBe(true);

      const [integrationAccount] = await db
        .select()
        .from(schema.integrationAccounts)
        .where(eq(schema.integrationAccounts.tenantId, createTenant.body.tenant.id))
        .limit(1);

      expect(integrationAccount?.credentialsJsonEncrypted).toBeTruthy();
      expect(integrationAccount?.credentialsJsonEncrypted).not.toMatchObject({
        apiKey: 'tenant-api-key',
      });
      expect(
        decryptJsonPayload(
          integrationAccount?.credentialsJsonEncrypted,
          '0123456789abcdef0123456789abcdef',
        ),
      ).toMatchObject({
        apiKey: 'tenant-api-key',
        clientId: 'tenant-client-id',
        clientSecret: 'tenant-client-secret',
      });
    } finally {
      process.env.APP_ENCRYPTION_KEY = previousKey;
    }
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
      .where(eq(schema.outboxEvents.eventName, 'viewing.refreshed'));

    expect(refreshOutboxEvents).toHaveLength(1);
    expect(refreshOutboxEvents[0]?.payloadJson).toMatchObject({
      propertyRoleExternalId: '30026645',
      count: 0,
    });
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

  it('publishes worker-created outbox events to tenant sockets', async () => {
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
      email: 'outbox-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(runtimeApp).post('/api/v1/auth/login').send({
      email: 'outbox-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(runtimeApp)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Outbox Estates',
        slug: 'outbox-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;
    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId,
        displayAddress: '44 Bridge Street, Manchester',
        postcode: 'M3 3BW',
      })
      .returning();

    if (!property) {
      throw new Error('property_not_created');
    }

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

      await db.insert(schema.outboxEvents).values({
        tenantId,
        eventName: 'timeline.refreshed',
        entityType: 'timeline_event',
        entityId: property.id,
        mutationType: 'refreshed',
        channelKey: `tenant:${tenantId}`,
        payloadJson: {
          propertyRoleExternalId: '30029999',
          count: 2,
        },
      });

      const eventPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('socket_event_timeout')), 3000);
        socket.on('entity.changed', (event) => {
          clearTimeout(timeout);
          resolve(event as Record<string, unknown>);
        });
      });

      const published = await publishPendingOutboxEvents({
        db,
        io,
      });

      expect(published).toEqual({ publishedCount: 1 });

      const event = await eventPromise;
      expect(event.tenantId).toBe(tenantId);
      expect(event.entityType).toBe('timeline_event');
      expect(event.entityId).toBe(property.id);
      expect(event.mutationType).toBe('refreshed');
    } finally {
      socket.close();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
  });
});
