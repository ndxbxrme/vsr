import { z } from 'zod';

export const entityChangedEventSchema = z.object({
  tenantId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  mutationType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().datetime(),
});

export type EntityChangedEvent = z.infer<typeof entityChangedEventSchema>;

export const dezrezSeedPropertySchema = z.object({
  externalId: z.string().min(1),
  propertyId: z.string().min(1).optional(),
  displayAddress: z.string().min(1),
  postcode: z.string().min(1).optional(),
  status: z.string().min(1).optional().default('active'),
  marketingStatus: z.string().min(1).optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});

export const dezrezIntegrationModeSchema = z.enum(['seed', 'live']);

export const dezrezIntegrationSettingsSchema = z.object({
  mode: dezrezIntegrationModeSchema.default('seed'),
  agencyId: z.coerce.number().int().positive().optional(),
  searchApiUrl: z.string().url().optional(),
  authUrl: z.string().url().optional(),
  coreApiUrl: z.string().url().optional(),
  branchIds: z.array(z.number().int().positive()).default([]),
  includeStc: z.boolean().default(true),
  pageSize: z.coerce.number().int().positive().max(2000).default(2000),
  seedProperties: z.array(dezrezSeedPropertySchema).default([]),
  seedOffersByRoleId: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  seedViewingsByRoleId: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  seedViewingDetailsByRoleId: z
    .record(z.string(), z.array(z.record(z.string(), z.unknown())))
    .default({}),
  seedEventsByRoleId: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
});

export const dezrezIntegrationCredentialsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
});

export const propertySyncRequestPayloadSchema = z.object({
  integrationAccountId: z.string().uuid(),
  requestedByUserId: z.string().uuid().nullable(),
});

export type DezrezSeedProperty = z.infer<typeof dezrezSeedPropertySchema>;
export type DezrezIntegrationSettings = z.infer<typeof dezrezIntegrationSettingsSchema>;
export type DezrezIntegrationCredentials = z.infer<typeof dezrezIntegrationCredentialsSchema>;
export type PropertySyncRequestPayload = z.infer<typeof propertySyncRequestPayloadSchema>;

const coercibleIdSchema = z.union([z.string(), z.number()]).transform((value) => String(value));

export const dezrezWebhookPayloadSchema = z
  .object({
    EventName: z.string().min(1).optional(),
    PropertyId: coercibleIdSchema.optional(),
    PropertyRoleId: coercibleIdSchema.optional(),
    MarketingRoleId: coercibleIdSchema.optional(),
    RootEntityId: coercibleIdSchema.optional(),
  })
  .passthrough();

export const integrationJobTypeSchema = z.enum([
  'property.role.refresh',
  'offer.role.refresh',
  'viewing.role.refresh',
  'timeline.role.refresh',
]);

export const dezrezRefreshJobPayloadSchema = z.object({
  webhookEventId: z.string().uuid(),
  eventName: z.string().min(1).nullable(),
  propertyId: z.string().nullable(),
  propertyRoleId: z.string().nullable(),
  rootEntityId: z.string().nullable(),
  rawEvent: z.record(z.string(), z.unknown()),
});

export type DezrezWebhookPayload = z.infer<typeof dezrezWebhookPayloadSchema>;
export type IntegrationJobType = z.infer<typeof integrationJobTypeSchema>;
export type DezrezRefreshJobPayload = z.infer<typeof dezrezRefreshJobPayloadSchema>;
