import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createDbClient, migrateDb, schema } from '@vitalspace/db';
import {
  processPendingDezrezWebhookEvents,
  processPendingIntegrationJobs,
  processPendingPropertySyncs,
} from '@vitalspace/integrations';
import { buildTenantRoom } from '@vitalspace/realtime';
import { runWorkerCycle } from './worker';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

const { db } = createDbClient(DATABASE_URL);

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
      "offers",
      "viewings",
      "timeline_events",
      "external_references",
      "tenants",
      "users"
    RESTART IDENTITY CASCADE
  `);
}

describe('processPendingPropertySyncs', () => {
  beforeAll(async () => {
    await migrateDb(DATABASE_URL);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  it('upserts seeded Dezrez properties and marks the sync request as published', async () => {
    const createdTenants = await db
      .insert(schema.tenants)
      .values({
        name: 'Worker Estates',
        slug: 'worker-estates',
      })
      .returning();
    const tenant = createdTenants[0];
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const createdIntegrationAccounts = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Primary Dezrez',
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-100',
              displayAddress: '1 Albert Square, Manchester',
              postcode: 'M2 5DB',
              marketingStatus: 'for_sale',
            },
            {
              externalId: 'DRZ-200',
              displayAddress: '2 King Street, Manchester',
              postcode: 'M2 4WU',
              marketingStatus: 'under_offer',
            },
          ],
        },
      })
      .returning();
    const integrationAccount = createdIntegrationAccounts[0];
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.outboxEvents).values({
      tenantId: tenant.id,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: '00000000-0000-0000-0000-000000000000',
      mutationType: 'sync_requested',
      channelKey: buildTenantRoom(tenant.id),
      payloadJson: {
        integrationAccountId: integrationAccount.id,
        requestedByUserId: null,
      },
    });

    const firstRun = await processPendingPropertySyncs({ db });
    expect(firstRun).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 2,
    });

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const externalReferences = await db
      .select()
      .from(schema.externalReferences)
      .where(eq(schema.externalReferences.tenantId, tenant.id));
    const syncRequests = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.sync_requested'));

    expect(properties).toHaveLength(2);
    expect(externalReferences).toHaveLength(2);
    expect(syncRequests[0]?.status).toBe('published');

    await db
      .update(schema.integrationAccounts)
      .set({
        settingsJson: {
          seedProperties: [
            {
              externalId: 'DRZ-100',
              displayAddress: '1 Albert Square, Manchester',
              postcode: 'M2 5DB',
              marketingStatus: 'exchanged',
            },
            {
              externalId: 'DRZ-300',
              displayAddress: '3 Deansgate, Manchester',
              postcode: 'M3 2BA',
              marketingStatus: 'for_sale',
            },
          ],
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationAccounts.id, integrationAccount.id));

    await db.insert(schema.outboxEvents).values({
      tenantId: tenant.id,
      eventName: 'property.sync_requested',
      entityType: 'property',
      entityId: '00000000-0000-0000-0000-000000000000',
      mutationType: 'sync_requested',
      channelKey: buildTenantRoom(tenant.id),
      payloadJson: {
        integrationAccountId: integrationAccount.id,
        requestedByUserId: null,
      },
    });

    const secondRun = await processPendingPropertySyncs({ db });
    expect(secondRun).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 2,
    });

    const updatedProperties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    const createdEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.created'));
    const updatedEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.updated'));

    expect(updatedProperties).toHaveLength(3);
    expect(updatedProperties.some((property) => property.marketingStatus === 'exchanged')).toBe(true);
    expect(createdEvents).toHaveLength(3);
    expect(updatedEvents).toHaveLength(1);
  });

  it('classifies Dezrez webhooks into durable jobs and fans property refresh into sync requests', async () => {
    const createdTenants = await db
      .insert(schema.tenants)
      .values({
        name: 'Webhook Worker Estates',
        slug: 'webhook-worker-estates',
      })
      .returning();
    const tenant = createdTenants[0];
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const createdIntegrationAccounts = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Webhook Dezrez',
        settingsJson: {
          seedProperties: [],
        },
      })
      .returning();
    const integrationAccount = createdIntegrationAccounts[0];
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.webhookEvents).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      eventType: 'InstructionToSell',
      signatureValid: true,
      payloadJson: {
        EventName: 'InstructionToSell',
        PropertyId: 3671906,
        PropertyRoleId: 30026645,
        RootEntityId: 88991,
      },
      processingStatus: 'pending',
    });

    const classified = await processPendingDezrezWebhookEvents({ db });
    expect(classified).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      createdJobs: 1,
    });

    const jobs = await db.select().from(schema.integrationJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobType).toBe('property.role.refresh');

    const completed = await processPendingIntegrationJobs({ db });
    expect(completed).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });

    const propertySyncRequests = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'property.sync_requested'));

    expect(propertySyncRequests).toHaveLength(1);
    expect(propertySyncRequests[0]?.tenantId).toBe(tenant.id);
  });

  it('normalizes seeded Dezrez offers and viewings into first-class tables', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Offer Viewing Estates',
        slug: 'offer-viewing-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: tenant.id,
        displayAddress: '1 Albert Square, Manchester',
        postcode: 'M2 5DB',
      })
      .returning();
    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values({
      tenantId: tenant.id,
      provider: 'dezrez',
      entityType: 'property',
      entityId: property.id,
      externalType: 'property_role',
      externalId: '30026645',
      metadataJson: {
        propertyId: '3671906',
      },
      lastSeenAt: new Date(),
    });

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Normalized Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
          seedOffersByRoleId: {
            '30026645': [
              {
                Id: 91001,
                MarketingRoleId: 30026645,
                DateTime: '2026-03-10T10:00:00.000Z',
                Value: 275000,
                ApplicantGroup: {
                  PrimaryMember: {
                    ContactName: 'Alex Buyer',
                    PrimaryEmail: 'alex@example.com',
                  },
                  Grade: {
                    Name: 'Hot Buyer',
                  },
                },
                Response: {
                  ResponseType: {
                    Name: 'Accepted',
                  },
                },
              },
            ],
          },
          seedViewingsByRoleId: {
            '30026645': [
              {
                Id: 82001,
                MarketingRoleId: 30026645,
                StartDate: '2026-03-11T14:30:00.000Z',
              },
            ],
          },
          seedViewingDetailsByRoleId: {
            '30026645': [
              {
                Id: 82001,
                MarketingRoleId: 30026645,
                StartDate: '2026-03-11T14:30:00.000Z',
                EventStatus: {
                  Name: 'Completed',
                },
                Grade: {
                  Name: 'First Time Buyer',
                },
                MainContact: {
                  name: 'Jamie Viewer',
                  email: 'jamie@example.com',
                },
                Feedback: [{ Id: 1 }],
                Notes: [{ Id: 1 }, { Id: 2 }],
              },
            ],
          },
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values([
      {
        tenantId: tenant.id,
        integrationAccountId: integrationAccount.id,
        provider: 'dezrez',
        jobType: 'offer.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30026645',
        dedupeKey: 'offer-role-refresh-30026645',
        payloadJson: {
          webhookEventId: '00000000-0000-0000-0000-000000000000',
          eventName: 'Offer',
          propertyId: '3671906',
          propertyRoleId: '30026645',
          rootEntityId: null,
          rawEvent: {
            EventName: 'Offer',
            PropertyRoleId: '30026645',
          },
        },
      },
      {
        tenantId: tenant.id,
        integrationAccountId: integrationAccount.id,
        provider: 'dezrez',
        jobType: 'viewing.role.refresh',
        entityType: 'property_role',
        entityExternalId: '30026645',
        dedupeKey: 'viewing-role-refresh-30026645',
        payloadJson: {
          webhookEventId: '00000000-0000-0000-0000-000000000000',
          eventName: 'ViewingFeedback',
          propertyId: '3671906',
          propertyRoleId: '30026645',
          rootEntityId: null,
          rawEvent: {
            EventName: 'ViewingFeedback',
            PropertyRoleId: '30026645',
          },
        },
      },
    ]);

    const result = await processPendingIntegrationJobs({ db });
    expect(result).toEqual({
      completedJobs: 2,
      failedJobs: 0,
    });

    const offers = await db.select().from(schema.offers);
    const viewings = await db.select().from(schema.viewings);

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      tenantId: tenant.id,
      propertyId: property.id,
      externalId: '91001',
      applicantName: 'Alex Buyer',
      applicantEmail: 'alex@example.com',
      applicantGrade: 'Hot Buyer',
      amount: 275000,
      status: 'Accepted',
    });

    expect(viewings).toHaveLength(1);
    expect(viewings[0]).toMatchObject({
      tenantId: tenant.id,
      propertyId: property.id,
      externalId: '82001',
      applicantName: 'Jamie Viewer',
      applicantEmail: 'jamie@example.com',
      applicantGrade: 'First Time Buyer',
      eventStatus: 'Completed',
      feedbackCount: 1,
      notesCount: 2,
    });
  });

  it('normalizes seeded Dezrez timeline events into shared timeline rows', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Timeline Estates',
        slug: 'timeline-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [property] = await db
      .insert(schema.properties)
      .values({
        tenantId: tenant.id,
        displayAddress: '9 Deansgate, Manchester',
        postcode: 'M3 1AZ',
      })
      .returning();
    if (!property) {
      throw new Error('property_not_created');
    }

    await db.insert(schema.externalReferences).values({
      tenantId: tenant.id,
      provider: 'dezrez',
      entityType: 'property',
      entityId: property.id,
      externalType: 'property_role',
      externalId: '30029999',
      metadataJson: {
        propertyId: '3999001',
      },
      lastSeenAt: new Date(),
    });

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Timeline Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [],
          seedEventsByRoleId: {
            '30029999': [
              {
                Id: 70001,
                MarketingRoleId: 30029999,
                DateTime: '2026-03-12T09:15:00.000Z',
                Title: 'Offer chased',
                Description: 'Buyer solicitor asked for an update.',
                EventType: {
                  Name: 'Note',
                  SystemName: 'note',
                },
                Negotiator: {
                  ContactName: 'Case Handler',
                  PrimaryEmail: 'handler@example.com',
                },
              },
              {
                Id: 70002,
                MarketingRoleId: 30029999,
                DateTime: '2026-03-12T11:00:00.000Z',
                Subject: 'Mailout',
                Body: 'Property sent to applicants.',
                EventType: {
                  Name: 'Mailout',
                  SystemName: 'mailout',
                },
              },
            ],
          },
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.integrationJobs).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      jobType: 'timeline.role.refresh',
      entityType: 'property_role',
      entityExternalId: '30029999',
      dedupeKey: 'timeline-role-refresh-30029999',
      payloadJson: {
        webhookEventId: '00000000-0000-0000-0000-000000000000',
        eventName: 'GenericEvent',
        propertyId: '3999001',
        propertyRoleId: '30029999',
        rootEntityId: null,
        rawEvent: {
          EventName: 'GenericEvent',
          PropertyRoleId: '30029999',
        },
      },
    });

    const result = await processPendingIntegrationJobs({ db });
    expect(result).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });

    const timelineEvents = await db.select().from(schema.timelineEvents);
    const realtimeEvents = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventName, 'timeline.refreshed'));

    expect(timelineEvents).toHaveLength(2);
    expect(timelineEvents[0]).toMatchObject({
      tenantId: tenant.id,
      subjectType: 'property',
      subjectId: property.id,
      provider: 'dezrez',
      externalId: '70001',
      propertyRoleExternalId: '30029999',
      eventType: 'note',
      title: 'Offer chased',
      body: 'Buyer solicitor asked for an update.',
      actorType: 'external_user',
    });
    expect(timelineEvents[1]).toMatchObject({
      tenantId: tenant.id,
      subjectId: property.id,
      externalId: '70002',
      eventType: 'mailout',
      title: 'Mailout',
      body: 'Property sent to applicants.',
      actorType: 'external_system',
    });
    expect(realtimeEvents).toHaveLength(1);
    expect(realtimeEvents[0]?.payloadJson).toMatchObject({
      propertyRoleExternalId: '30029999',
      count: 2,
    });
  });

  it('runs the webhook to job to property sync chain in one worker cycle', async () => {
    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        name: 'Cycle Estates',
        slug: 'cycle-estates',
      })
      .returning();
    if (!tenant) {
      throw new Error('tenant_not_created');
    }

    const [integrationAccount] = await db
      .insert(schema.integrationAccounts)
      .values({
        tenantId: tenant.id,
        provider: 'dezrez',
        name: 'Cycle Dezrez',
        settingsJson: {
          mode: 'seed',
          seedProperties: [
            {
              externalId: 'role-cycle-1',
              propertyId: 'property-cycle-1',
              displayAddress: '100 Deansgate, Manchester',
              postcode: 'M3 2BB',
              marketingStatus: 'for_sale',
            },
          ],
        },
      })
      .returning();
    if (!integrationAccount) {
      throw new Error('integration_account_not_created');
    }

    await db.insert(schema.webhookEvents).values({
      tenantId: tenant.id,
      integrationAccountId: integrationAccount.id,
      provider: 'dezrez',
      eventType: 'InstructionToSell',
      signatureValid: true,
      payloadJson: {
        EventName: 'InstructionToSell',
        PropertyId: 'property-cycle-1',
        PropertyRoleId: 'role-cycle-1',
        RootEntityId: 'event-cycle-1',
      },
      processingStatus: 'pending',
    });

    const result = await runWorkerCycle({
      databaseUrl: DATABASE_URL,
    });

    expect(result.webhookResult).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      createdJobs: 1,
    });
    expect(result.integrationJobResult).toEqual({
      completedJobs: 1,
      failedJobs: 0,
    });
    expect(result.propertySyncResult).toEqual({
      processedEvents: 1,
      failedEvents: 0,
      upsertedProperties: 1,
    });

    const properties = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.id));
    expect(properties).toHaveLength(1);
    expect(properties[0]?.displayAddress).toBe('100 Deansgate, Manchester');
  });
});
