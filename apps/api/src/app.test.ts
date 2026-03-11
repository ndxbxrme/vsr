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
let oauthProviderServer: ReturnType<typeof createServer> | null = null;
let previousGoogleClientId: string | undefined;
let previousGoogleClientSecret: string | undefined;
let previousGoogleAuthUrl: string | undefined;
let previousGoogleTokenUrl: string | undefined;
let previousGoogleUserInfoUrl: string | undefined;
let previousEncryptionKey: string | undefined;

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

describe('api auth and tenancy', () => {
  beforeAll(async () => {
    await migrateDb(DATABASE_URL);

    oauthProviderServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/authorize') {
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        if (!redirectUri || !state) {
          res.writeHead(400).end('missing_redirect');
          return;
        }

        const redirectUrl = new URL(redirectUri);
        redirectUrl.searchParams.set('code', 'mock-google-code');
        redirectUrl.searchParams.set('state', state);
        res.writeHead(302, {
          Location: redirectUrl.toString(),
        });
        res.end();
        return;
      }

      if (url.pathname === '/token') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify({
            access_token: 'mock-google-access-token',
            refresh_token: 'mock-google-refresh-token',
            expires_in: 3600,
          }),
        );
        return;
      }

      if (url.pathname === '/userinfo') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify({
            sub: 'google-user-123',
            email: 'oauth-owner@example.com',
            given_name: 'OAuth',
            family_name: 'Owner',
            name: 'OAuth Owner',
          }),
        );
        return;
      }

      res.writeHead(404).end('not_found');
    });

    await new Promise<void>((resolve) => {
      oauthProviderServer!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = oauthProviderServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('oauth_provider_address_not_available');
    }

    previousGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    previousGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    previousGoogleAuthUrl = process.env.GOOGLE_AUTH_URL;
    previousGoogleTokenUrl = process.env.GOOGLE_TOKEN_URL;
    previousGoogleUserInfoUrl = process.env.GOOGLE_USERINFO_URL;
    previousEncryptionKey = process.env.APP_ENCRYPTION_KEY;

    process.env.GOOGLE_CLIENT_ID = 'mock-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'mock-google-client-secret';
    process.env.GOOGLE_AUTH_URL = `http://127.0.0.1:${address.port}/authorize`;
    process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${address.port}/token`;
    process.env.GOOGLE_USERINFO_URL = `http://127.0.0.1:${address.port}/userinfo`;
    process.env.APP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    process.env.GOOGLE_CLIENT_ID = previousGoogleClientId;
    process.env.GOOGLE_CLIENT_SECRET = previousGoogleClientSecret;
    process.env.GOOGLE_AUTH_URL = previousGoogleAuthUrl;
    process.env.GOOGLE_TOKEN_URL = previousGoogleTokenUrl;
    process.env.GOOGLE_USERINFO_URL = previousGoogleUserInfoUrl;
    process.env.APP_ENCRYPTION_KEY = previousEncryptionKey;
    if (oauthProviderServer) {
      await new Promise<void>((resolve) => {
        oauthProviderServer!.close(() => resolve());
      });
    }
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

  it('completes a google oauth login and creates an oauth account plus session', async () => {
    const start = await request(app)
      .get('/api/v1/auth/oauth/google/start')
      .query({
        redirectTo: 'http://127.0.0.1:4321/oauth/callback',
      });

    expect(start.status).toBe(302);
    expect(start.header.location).toContain('/authorize');

    const authorizeUrl = new URL(start.header.location as string);
    const authorize = await fetch(authorizeUrl, {
      redirect: 'manual',
    });

    expect(authorize.status).toBe(302);
    expect(authorize.headers.get('location')).toContain('/api/v1/auth/oauth/google/callback');

    const callbackUrl = new URL(authorize.headers.get('location') as string);
    const callback = await request(app).get(`${callbackUrl.pathname}${callbackUrl.search}`);

    expect(callback.status).toBe(302);
    const redirectUrl = new URL(callback.header.location as string);
    expect(redirectUrl.origin).toBe('http://127.0.0.1:4321');
    expect(redirectUrl.pathname).toBe('/oauth/callback');
    expect(redirectUrl.searchParams.get('provider')).toBe('google');
    expect(redirectUrl.searchParams.get('accessToken')).toBeTruthy();

    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${redirectUrl.searchParams.get('accessToken')}`);

    expect(me.status).toBe(200);
    expect(me.body.email).toBe('oauth-owner@example.com');

    const oauthAccounts = await db.select().from(schema.oauthAccounts);
    expect(oauthAccounts).toHaveLength(1);
    expect(oauthAccounts[0]).toMatchObject({
      provider: 'google',
      providerUserId: 'google-user-123',
      emailFromProvider: 'oauth-owner@example.com',
    });
  });

  it('resolves tenants from local subdomains in bootstrap', async () => {
    const createTenant = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        email: 'subdomain-admin@example.com',
        password: 'Secret123',
      });

    expect(createTenant.status).toBe(201);

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'subdomain-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const tenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Subdomain Estates',
        slug: 'subdomain-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    expect(tenant.status).toBe(201);

    const bootstrap = await request(app)
      .get('/api/v1/bootstrap')
      .set('Host', 'subdomain-estates.localhost:4220');

    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.resolvedTenant).toMatchObject({
      id: tenant.body.tenant.id,
      slug: 'subdomain-estates',
      strategy: 'subdomain',
    });
  });

  it('creates tenant domains and resolves verified custom domains in bootstrap', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'domain-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'domain-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Domain Estates',
        slug: 'domain-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const createDomain = await request(app)
      .post('/api/v1/tenant-domains')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        domain: 'brand.example.test',
        domainType: 'custom',
        verificationStatus: 'verified',
        isPrimary: true,
      });

    expect(createDomain.status).toBe(201);
    expect(createDomain.body.domain).toMatchObject({
      domain: 'brand.example.test',
      verificationStatus: 'verified',
    });

    const bootstrap = await request(app)
      .get('/api/v1/bootstrap')
      .set('Host', 'brand.example.test');

    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.resolvedTenant).toMatchObject({
      id: createTenant.body.tenant.id,
      slug: 'domain-estates',
      strategy: 'custom_domain',
      host: 'brand.example.test',
    });
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

  it('uploads, lists, and downloads tenant files for an attached entity', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'files-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'files-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Files Estates',
        slug: 'files-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: createTenant.body.tenant.id,
        displayAddress: '1 File Lane',
      })
      .returning();

    if (!property) {
      throw new Error('file_property_not_created');
    }

    const upload = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId: createTenant.body.tenant.id,
        entityType: 'property',
        entityId: property.id,
        label: 'Memorandum',
        originalName: 'memo.txt',
        contentType: 'text/plain',
        base64Data: Buffer.from('hello vitalspace', 'utf8').toString('base64'),
      });

    expect(upload.status).toBe(201);
    expect(upload.body.file).toMatchObject({
      tenantId: createTenant.body.tenant.id,
      entityType: 'property',
      entityId: property.id,
      label: 'Memorandum',
      originalName: 'memo.txt',
      contentType: 'text/plain',
      sizeBytes: 16,
    });

    const list = await request(app)
      .get('/api/v1/files')
      .query({
        tenantId: createTenant.body.tenant.id,
        entityType: 'property',
        entityId: property.id,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.files).toHaveLength(1);
    expect(list.body.files[0]).toMatchObject({
      label: 'Memorandum',
      originalName: 'memo.txt',
    });

    const download = await request(app)
      .get(`/api/v1/files/${upload.body.file.id}/download`)
      .query({
        tenantId: createTenant.body.tenant.id,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(download.status).toBe(200);
    expect(download.header['content-type']).toContain('text/plain');
    expect(download.text).toBe('hello vitalspace');
  });

  it('creates shared contacts, workflow templates, and cases with parties, notes, files, and transitions', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'cases-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'cases-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Case Estates',
        slug: 'case-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;
    const branchId = createTenant.body.branch.id as string;

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId,
        branchId,
        displayAddress: '22 Shared Core Avenue',
        postcode: 'M4 1AA',
        marketingStatus: 'for_sale',
      })
      .returning();

    if (!property) {
      throw new Error('case_property_not_created');
    }

    const createContact = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        contactType: 'person',
        displayName: 'Jane Seller',
        firstName: 'Jane',
        lastName: 'Seller',
        primaryEmail: 'jane.seller@example.com',
      });

    expect(createContact.status).toBe(201);

    const createWorkflowTemplate = await request(app)
      .post('/api/v1/workflow-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        key: 'sales-default',
        name: 'Sales Default',
        caseType: 'sales',
        stages: [
          {
            key: 'instruction',
            name: 'Instruction',
            stageOrder: 0,
          },
          {
            key: 'memo_sent',
            name: 'Memo Sent',
            stageOrder: 1,
          },
          {
            key: 'completed',
            name: 'Completed',
            stageOrder: 2,
            isTerminal: true,
          },
        ],
      });

    expect(createWorkflowTemplate.status).toBe(201);
    expect(createWorkflowTemplate.body.workflowStages).toHaveLength(3);

    const createCase = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        propertyId: property.id,
        workflowTemplateId: createWorkflowTemplate.body.workflowTemplate.id,
        caseType: 'sales',
        reference: 'SALE-001',
        title: '22 Shared Core Avenue Sale',
        description: 'Initial sales case for shared core testing',
      });

    expect(createCase.status).toBe(201);
    expect(createCase.body.case).toMatchObject({
      tenantId,
      propertyId: property.id,
      caseType: 'sales',
      status: 'open',
      reference: 'SALE-001',
    });
    expect(createCase.body.workflow.instance.currentWorkflowStageId).toBeTruthy();

    const caseId = createCase.body.case.id as string;

    const addParty = await request(app)
      .post(`/api/v1/cases/${caseId}/parties`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        contactId: createContact.body.contact.id,
        partyRole: 'seller',
        displayName: 'Jane Seller',
        email: 'jane.seller@example.com',
        isPrimary: true,
      });

    expect(addParty.status).toBe(201);
    expect(addParty.body.caseParty).toMatchObject({
      partyRole: 'seller',
      contactId: createContact.body.contact.id,
      isPrimary: true,
    });

    const addNote = await request(app)
      .post(`/api/v1/cases/${caseId}/notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        noteType: 'internal',
        body: 'Initial memo prepared for the seller.',
      });

    expect(addNote.status).toBe(201);
    expect(addNote.body.caseNote.noteType).toBe('internal');

    const upload = await request(app)
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        entityType: 'case',
        entityId: caseId,
        label: 'Sales Memo',
        originalName: 'sales-memo.txt',
        contentType: 'text/plain',
        base64Data: Buffer.from('shared case file', 'utf8').toString('base64'),
      });

    expect(upload.status).toBe(201);

    const transition = await request(app)
      .post(`/api/v1/cases/${caseId}/transitions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        toStageKey: 'completed',
        summary: 'Case completed successfully',
      });

    expect(transition.status).toBe(201);
    expect(transition.body.targetStage).toMatchObject({
      key: 'completed',
      isTerminal: true,
    });

    const workflowTemplates = await request(app)
      .get('/api/v1/workflow-templates')
      .query({
        tenantId,
        caseType: 'sales',
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(workflowTemplates.status).toBe(200);
    expect(workflowTemplates.body.workflowTemplates).toHaveLength(1);

    const contacts = await request(app)
      .get('/api/v1/contacts')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(contacts.status).toBe(200);
    expect(contacts.body.contacts).toHaveLength(1);

    const cases = await request(app)
      .get('/api/v1/cases')
      .query({
        tenantId,
        caseType: 'sales',
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(cases.status).toBe(200);
    expect(cases.body.cases).toHaveLength(1);
    expect(cases.body.cases[0]).toMatchObject({
      id: caseId,
      status: 'completed',
      propertyDisplayAddress: '22 Shared Core Avenue',
      currentStageKey: 'completed',
    });

    const detail = await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.case).toMatchObject({
      id: caseId,
      status: 'completed',
      propertyDisplayAddress: '22 Shared Core Avenue',
    });
    expect(detail.body.parties).toHaveLength(1);
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.files).toHaveLength(1);
    expect(detail.body.workflow).toMatchObject({
      status: 'completed',
      currentStageKey: 'completed',
      templateKey: 'sales-default',
    });
    expect(detail.body.timelineEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'case_note',
          body: 'Initial memo prepared for the seller.',
        }),
        expect.objectContaining({
          source: 'workflow_transition',
          body: 'Case completed successfully',
        }),
        expect.objectContaining({
          source: 'audit',
          title: 'case.created',
        }),
      ]),
    );
  });

  it('creates communication templates and sends case-aware email and SMS dispatches', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'comms-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'comms-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Comms Estates',
        slug: 'comms-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;
    const branchId = createTenant.body.branch.id as string;

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId,
        branchId,
        displayAddress: '44 Template Street',
        postcode: 'M1 2AB',
      })
      .returning();

    if (!property) {
      throw new Error('communications_property_not_created');
    }

    const createCase = await request(app)
      .post('/api/v1/cases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        propertyId: property.id,
        caseType: 'sales',
        reference: 'COMMS-001',
        title: '44 Template Street Sale',
      });

    expect(createCase.status).toBe(201);

    const caseId = createCase.body.case.id as string;

    const createEmailTemplate = await request(app)
      .post('/api/v1/email-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        key: 'sales-memo',
        name: 'Sales Memo',
        subjectTemplate: 'Update for {{case.reference}}',
        bodyTextTemplate:
          'Case {{case.title}} at {{property.displayAddress}} is now assigned to {{agent.name}}.',
      });

    expect(createEmailTemplate.status).toBe(201);
    expect(createEmailTemplate.body.emailTemplate).toMatchObject({
      key: 'sales-memo',
      status: 'active',
    });

    const createSmsTemplate = await request(app)
      .post('/api/v1/sms-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        key: 'sales-sms',
        name: 'Sales SMS',
        bodyTemplate: 'Case {{case.reference}} for {{property.postcode}} is with {{agent.name}}.',
      });

    expect(createSmsTemplate.status).toBe(201);
    expect(createSmsTemplate.body.smsTemplate).toMatchObject({
      key: 'sales-sms',
      status: 'active',
    });

    const emailTemplates = await request(app)
      .get('/api/v1/email-templates')
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(emailTemplates.status).toBe(200);
    expect(emailTemplates.body.emailTemplates).toHaveLength(1);

    const smsTemplates = await request(app)
      .get('/api/v1/sms-templates')
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(smsTemplates.status).toBe(200);
    expect(smsTemplates.body.smsTemplates).toHaveLength(1);

    const sendEmail = await request(app)
      .post(`/api/v1/cases/${caseId}/communications`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        channel: 'email',
        templateType: 'email',
        templateId: createEmailTemplate.body.emailTemplate.id,
        recipientName: 'Jane Seller',
        recipientEmail: 'jane.seller@example.com',
        variables: {
          'agent.name': 'Casey Operator',
        },
      });

    expect(sendEmail.status).toBe(201);
    expect(sendEmail.body.communication).toMatchObject({
      channel: 'email',
      recipientEmail: 'jane.seller@example.com',
      subject: 'Update for COMMS-001',
    });
    expect(sendEmail.body.communication.body).toContain('44 Template Street');
    expect(sendEmail.body.communication.body).toContain('Casey Operator');

    const sendSms = await request(app)
      .post(`/api/v1/cases/${caseId}/communications`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        channel: 'sms',
        templateType: 'sms',
        templateId: createSmsTemplate.body.smsTemplate.id,
        recipientName: 'Jane Seller',
        recipientPhone: '07123456789',
        variables: {
          'agent.name': 'Casey Operator',
        },
      });

    expect(sendSms.status).toBe(201);
    expect(sendSms.body.communication).toMatchObject({
      channel: 'sms',
      recipientPhone: '07123456789',
    });
    expect(sendSms.body.communication.body).toContain('COMMS-001');
    expect(sendSms.body.communication.body).toContain('Casey Operator');

    const communications = await request(app)
      .get(`/api/v1/cases/${caseId}/communications`)
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(communications.status).toBe(200);
    expect(communications.body.communications).toHaveLength(2);
    expect(communications.body.communications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'email',
          recipientEmail: 'jane.seller@example.com',
        }),
        expect.objectContaining({
          channel: 'sms',
          recipientPhone: '07123456789',
        }),
      ]),
    );

    const detail = await request(app)
      .get(`/api/v1/cases/${caseId}`)
      .query({ tenantId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.communications).toHaveLength(2);
    expect(detail.body.timelineEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'communication',
          title: 'email.sent',
        }),
        expect.objectContaining({
          source: 'communication',
          title: 'sms.sent',
        }),
        expect.objectContaining({
          source: 'audit',
          title: 'case.communication_sent',
        }),
      ]),
    );
  });

  it('creates and manages sales cases, offers, and dashboard metrics', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'sales-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'sales-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Sales Estates',
        slug: 'sales-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;
    const branchId = createTenant.body.branch.id as string;

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId,
        branchId,
        displayAddress: '31 Pipeline Road',
        postcode: 'M2 4AB',
        marketingStatus: 'for_sale',
      })
      .returning();

    if (!property) {
      throw new Error('sales_property_not_created');
    }

    const createWorkflowTemplate = await request(app)
      .post('/api/v1/workflow-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        key: 'sales-pipeline',
        name: 'Sales Pipeline',
        caseType: 'sales',
        stages: [
          {
            key: 'instruction',
            name: 'Instruction',
            stageOrder: 0,
          },
          {
            key: 'conveyancing',
            name: 'Conveyancing',
            stageOrder: 1,
          },
          {
            key: 'completed',
            name: 'Completed',
            stageOrder: 2,
            isTerminal: true,
          },
        ],
      });

    expect(createWorkflowTemplate.status).toBe(201);

    const createBuyer = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        displayName: 'Alex Buyer',
        firstName: 'Alex',
        lastName: 'Buyer',
        primaryEmail: 'alex.buyer@example.com',
      });

    expect(createBuyer.status).toBe(201);

    const createSalesCase = await request(app)
      .post('/api/v1/sales/cases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        propertyId: property.id,
        workflowTemplateId: createWorkflowTemplate.body.workflowTemplate.id,
        reference: 'SALES-001',
        title: '31 Pipeline Road Sale',
        description: 'Sales workflow test case',
        askingPrice: 325000,
        saleStatus: 'instruction',
      });

    expect(createSalesCase.status).toBe(201);
    expect(createSalesCase.body.salesCase).toMatchObject({
      saleStatus: 'instruction',
      askingPrice: 325000,
    });

    const caseId = createSalesCase.body.case.id as string;

    const updateSalesCase = await request(app)
      .patch(`/api/v1/sales/cases/${caseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        saleStatus: 'conveyancing',
        agreedPrice: 320000,
        targetCompletionAt: '2026-04-01T09:00:00.000Z',
      });

    expect(updateSalesCase.status).toBe(200);
    expect(updateSalesCase.body.salesCase).toMatchObject({
      saleStatus: 'conveyancing',
      agreedPrice: 320000,
    });

    const addOffer = await request(app)
      .post(`/api/v1/sales/cases/${caseId}/offers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        contactId: createBuyer.body.contact.id,
        amount: 322500,
        status: 'accepted',
        notes: 'Buyer approved after second viewing',
      });

    expect(addOffer.status).toBe(201);
    expect(addOffer.body.salesOffer).toMatchObject({
      amount: 322500,
      status: 'accepted',
      contactId: createBuyer.body.contact.id,
    });

    const transition = await request(app)
      .post(`/api/v1/cases/${caseId}/transitions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        toStageKey: 'completed',
        summary: 'Sale completed',
      });

    expect(transition.status).toBe(201);

    const salesCases = await request(app)
      .get('/api/v1/sales/cases')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(salesCases.status).toBe(200);
    expect(salesCases.body.cases).toHaveLength(1);
    expect(salesCases.body.cases[0]).toMatchObject({
      id: caseId,
      saleStatus: 'offer_accepted',
      agreedPrice: 322500,
      currentStageKey: 'completed',
      propertyDisplayAddress: '31 Pipeline Road',
    });

    const salesOffers = await request(app)
      .get(`/api/v1/sales/cases/${caseId}/offers`)
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(salesOffers.status).toBe(200);
    expect(salesOffers.body.salesOffers).toHaveLength(1);
    expect(salesOffers.body.salesOffers[0]).toMatchObject({
      amount: 322500,
      status: 'accepted',
      contactDisplayName: 'Alex Buyer',
    });

    const detail = await request(app)
      .get(`/api/v1/sales/cases/${caseId}`)
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.salesCase).toMatchObject({
      saleStatus: 'offer_accepted',
      agreedPrice: 322500,
    });
    expect(detail.body.salesOffers).toHaveLength(1);
    expect(detail.body.workflow).toMatchObject({
      currentStageKey: 'completed',
    });

    const dashboard = await request(app)
      .get('/api/v1/sales/dashboard')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(dashboard.status).toBe(200);
    expect(dashboard.body.dashboard.counts).toMatchObject({
      totalCases: 1,
      completedCases: 1,
      offerAcceptedCases: 1,
      totalOffers: 1,
      acceptedOffers: 1,
    });
    expect(dashboard.body.dashboard.values).toMatchObject({
      totalOfferValue: 322500,
      acceptedOfferValue: 322500,
    });
    expect(dashboard.body.dashboard.recentCases[0]).toMatchObject({
      id: caseId,
      saleStatus: 'offer_accepted',
    });

    const salesPipelineReport = await request(app)
      .get('/api/v1/reports/sales-pipeline')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(salesPipelineReport.status).toBe(200);
    expect(salesPipelineReport.body.report.counts).toMatchObject({
      totalCases: 1,
      offerAcceptedCases: 1,
      acceptedOffers: 1,
    });
    expect(salesPipelineReport.body.report.values).toMatchObject({
      acceptedOfferValue: 322500,
    });
    expect(salesPipelineReport.body.report.cases[0]).toMatchObject({
      id: caseId,
      saleStatus: 'offer_accepted',
    });
  });

  it('creates and manages lettings cases, applications, and agreed-let reporting', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'lettings-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'lettings-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Lettings Estates',
        slug: 'lettings-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;
    const branchId = createTenant.body.branch.id as string;

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId,
        branchId,
        displayAddress: '44 Rental Lane',
        postcode: 'M3 3AB',
        marketingStatus: 'to_let',
      })
      .returning();

    if (!property) {
      throw new Error('lettings_property_not_created');
    }

    const createWorkflowTemplate = await request(app)
      .post('/api/v1/workflow-templates')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        key: 'lettings-pipeline',
        name: 'Lettings Pipeline',
        caseType: 'lettings',
        stages: [
          {
            key: 'application',
            name: 'Application',
            stageOrder: 0,
          },
          {
            key: 'agreed_let',
            name: 'Agreed Let',
            stageOrder: 1,
          },
          {
            key: 'completed',
            name: 'Completed',
            stageOrder: 2,
            isTerminal: true,
          },
        ],
      });

    expect(createWorkflowTemplate.status).toBe(201);

    const createApplicant = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        displayName: 'Terry Tenant',
        firstName: 'Terry',
        lastName: 'Tenant',
        primaryEmail: 'terry.tenant@example.com',
      });

    expect(createApplicant.status).toBe(201);

    const createLettingsCase = await request(app)
      .post('/api/v1/lettings/cases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        branchId,
        propertyId: property.id,
        workflowTemplateId: createWorkflowTemplate.body.workflowTemplate.id,
        reference: 'LET-001',
        title: '44 Rental Lane Letting',
        description: 'Lettings workflow test case',
        monthlyRent: 1650,
        depositAmount: 1900,
        lettingStatus: 'application',
      });

    expect(createLettingsCase.status).toBe(201);
    expect(createLettingsCase.body.lettingsCase).toMatchObject({
      lettingStatus: 'application',
      monthlyRent: 1650,
      depositAmount: 1900,
    });

    const caseId = createLettingsCase.body.case.id as string;

    const updateLettingsCase = await request(app)
      .patch(`/api/v1/lettings/cases/${caseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        lettingStatus: 'move_in',
        moveInAt: '2026-04-10T09:00:00.000Z',
      });

    expect(updateLettingsCase.status).toBe(200);
    expect(updateLettingsCase.body.lettingsCase).toMatchObject({
      lettingStatus: 'move_in',
    });

    const addApplication = await request(app)
      .post(`/api/v1/lettings/cases/${caseId}/applications`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        contactId: createApplicant.body.contact.id,
        monthlyRentOffered: 1675,
        status: 'accepted',
        notes: 'Applicant accepted after references',
      });

    expect(addApplication.status).toBe(201);
    expect(addApplication.body.lettingsApplication).toMatchObject({
      monthlyRentOffered: 1675,
      status: 'accepted',
      contactId: createApplicant.body.contact.id,
    });

    const transition = await request(app)
      .post(`/api/v1/cases/${caseId}/transitions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        tenantId,
        caseId,
        toStageKey: 'completed',
        summary: 'Tenancy completed',
      });

    expect(transition.status).toBe(201);

    const lettingsCases = await request(app)
      .get('/api/v1/lettings/cases')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(lettingsCases.status).toBe(200);
    expect(lettingsCases.body.cases).toHaveLength(1);
    expect(lettingsCases.body.cases[0]).toMatchObject({
      id: caseId,
      lettingStatus: 'application_accepted',
      monthlyRent: 1675,
      currentStageKey: 'completed',
      propertyDisplayAddress: '44 Rental Lane',
    });

    const lettingsApplications = await request(app)
      .get(`/api/v1/lettings/cases/${caseId}/applications`)
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(lettingsApplications.status).toBe(200);
    expect(lettingsApplications.body.lettingsApplications).toHaveLength(1);
    expect(lettingsApplications.body.lettingsApplications[0]).toMatchObject({
      monthlyRentOffered: 1675,
      status: 'accepted',
      contactDisplayName: 'Terry Tenant',
    });

    const detail = await request(app)
      .get(`/api/v1/lettings/cases/${caseId}`)
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.lettingsCase).toMatchObject({
      lettingStatus: 'application_accepted',
      monthlyRent: 1675,
    });
    expect(detail.body.lettingsApplications).toHaveLength(1);
    expect(detail.body.workflow).toMatchObject({
      currentStageKey: 'completed',
    });

    const dashboard = await request(app)
      .get('/api/v1/lettings/dashboard')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(dashboard.status).toBe(200);
    expect(dashboard.body.dashboard.counts).toMatchObject({
      totalCases: 1,
      completedCases: 1,
      agreedLets: 1,
      totalApplications: 1,
      acceptedApplications: 1,
    });
    expect(dashboard.body.dashboard.values).toMatchObject({
      totalRentOffered: 1675,
    });
    expect(dashboard.body.dashboard.agreedLets[0]).toMatchObject({
      caseId,
      propertyDisplayAddress: '44 Rental Lane',
      monthlyRent: 1675,
      lettingStatus: 'application_accepted',
    });

    const agreedLetsReport = await request(app)
      .get('/api/v1/reports/agreed-lets')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(agreedLetsReport.status).toBe(200);
    expect(agreedLetsReport.body.report.counts).toMatchObject({
      totalCases: 1,
      agreedLets: 1,
      acceptedApplications: 1,
    });
    expect(agreedLetsReport.body.report.values).toMatchObject({
      totalRentOffered: 1675,
    });
    expect(agreedLetsReport.body.report.agreedLets[0]).toMatchObject({
      caseId,
      propertyDisplayAddress: '44 Rental Lane',
      monthlyRent: 1675,
      lettingStatus: 'application_accepted',
    });
  });

  it('returns a tenant pilot readiness snapshot for side-by-side rollout checks', async () => {
    await request(app).post('/api/v1/auth/signup').send({
      email: 'pilot-admin@example.com',
      password: 'Secret123',
    });

    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'pilot-admin@example.com',
      password: 'Secret123',
    });

    const accessToken = login.body.accessToken as string;

    const createTenant = await request(app)
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Pilot Estates',
        slug: 'pilot-estates',
        branchName: 'Main',
        branchSlug: 'main',
      });

    const tenantId = createTenant.body.tenant.id as string;

    await db.insert(schema.properties).values({
      tenantId,
      displayAddress: '90 Pilot Road',
      postcode: 'M1 9AA',
      marketingStatus: 'for_sale',
    });

    await db.insert(schema.emailTemplates).values({
      tenantId,
      key: 'pilot-email',
      name: 'Pilot Email',
      subjectTemplate: 'Pilot {{case.reference}}',
      bodyTextTemplate: 'Pilot email body',
    });

    await db.insert(schema.smsTemplates).values({
      tenantId,
      key: 'pilot-sms',
      name: 'Pilot SMS',
      bodyTemplate: 'Pilot SMS body',
    });

    const [salesWorkflowTemplate] = await db
      .insert(schema.workflowTemplates)
      .values({
        tenantId,
        key: 'pilot-sales',
        name: 'Pilot Sales',
        caseType: 'sales',
        status: 'active',
        isSystem: false,
      })
      .returning();

    const [lettingsWorkflowTemplate] = await db
      .insert(schema.workflowTemplates)
      .values({
        tenantId,
        key: 'pilot-lettings',
        name: 'Pilot Lettings',
        caseType: 'lettings',
        status: 'active',
        isSystem: false,
      })
      .returning();

    if (!salesWorkflowTemplate || !lettingsWorkflowTemplate) {
      throw new Error('pilot_workflow_templates_not_created');
    }

    const [salesCase] = await db
      .insert(schema.cases)
      .values({
        tenantId,
        caseType: 'sales',
        status: 'open',
        title: 'Pilot sales case',
      })
      .returning();

    const [lettingsCase] = await db
      .insert(schema.cases)
      .values({
        tenantId,
        caseType: 'lettings',
        status: 'open',
        title: 'Pilot lettings case',
      })
      .returning();

    if (!salesCase || !lettingsCase) {
      throw new Error('pilot_cases_not_created');
    }

    await db.insert(schema.salesCases).values({
      tenantId,
      caseId: salesCase.id,
      saleStatus: 'instruction',
    });

    await db.insert(schema.lettingsCases).values({
      tenantId,
      caseId: lettingsCase.id,
      lettingStatus: 'application',
    });

    const readiness = await request(app)
      .get('/api/v1/pilot-readiness')
      .query({
        tenantId,
      })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(readiness.status).toBe(200);
    expect(readiness.body.readiness.counts).toMatchObject({
      propertyCount: 1,
      emailTemplateCount: 1,
      smsTemplateCount: 1,
      salesWorkflowTemplateCount: 1,
      lettingsWorkflowTemplateCount: 1,
      salesCaseCount: 1,
      lettingsCaseCount: 1,
    });
    expect(readiness.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'properties_seeded',
          status: 'ready',
        }),
        expect.objectContaining({
          key: 'communication_templates',
          status: 'ready',
        }),
      ]),
    );
    expect(readiness.body.pilotFlows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'sales_case_progression',
          status: 'ready',
        }),
        expect.objectContaining({
          key: 'lettings_agreed_let',
          status: 'ready',
        }),
      ]),
    );
    expect(readiness.body.laterItems).toContain(
      'Birthdays and wider CRM screens remain out of Milestone B.',
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
