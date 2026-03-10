import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDbClient, migrateDb } from '@vitalspace/db';
import { createApp } from './app';

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
});
