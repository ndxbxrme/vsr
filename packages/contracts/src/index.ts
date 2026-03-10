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
  displayAddress: z.string().min(1),
  postcode: z.string().min(1).optional(),
  status: z.string().min(1).optional().default('active'),
  marketingStatus: z.string().min(1).optional(),
});

export const dezrezIntegrationSettingsSchema = z.object({
  seedProperties: z.array(dezrezSeedPropertySchema).default([]),
});

export const propertySyncRequestPayloadSchema = z.object({
  integrationAccountId: z.string().uuid(),
  requestedByUserId: z.string().uuid().nullable(),
});

export type DezrezSeedProperty = z.infer<typeof dezrezSeedPropertySchema>;
export type DezrezIntegrationSettings = z.infer<typeof dezrezIntegrationSettingsSchema>;
export type PropertySyncRequestPayload = z.infer<typeof propertySyncRequestPayloadSchema>;
