import { z } from 'zod';

export const contactTypeSchema = z.enum(['person', 'company', 'organization']);
export const caseTypeSchema = z.enum(['sales', 'lettings']);
export const caseStatusSchema = z.enum(['open', 'on_hold', 'completed', 'cancelled']);

export const entityChangedEventSchema = z.object({
  tenantId: z.string().uuid(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  mutationType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().datetime(),
});

export type EntityChangedEvent = z.infer<typeof entityChangedEventSchema>;

export const contactSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  contactType: contactTypeSchema,
  status: z.string().min(1),
  displayName: z.string().min(1),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organizationName: z.string().nullable(),
  primaryEmail: z.string().email().nullable(),
  primaryPhone: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const createContactSchema = z.object({
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  contactType: contactTypeSchema.default('person'),
  displayName: z.string().min(1),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
  primaryEmail: z.string().email().optional(),
  primaryPhone: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const caseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  propertyId: z.string().uuid().nullable(),
  caseType: caseTypeSchema,
  status: caseStatusSchema,
  reference: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const createCaseSchema = z.object({
  tenantId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  propertyId: z.string().uuid().optional().nullable(),
  workflowTemplateId: z.string().uuid().optional().nullable(),
  caseType: caseTypeSchema,
  status: caseStatusSchema.default('open'),
  reference: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const casePartySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  partyRole: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const createCasePartySchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  partyRole: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  isPrimary: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const caseNoteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  authorUserId: z.string().uuid().nullable(),
  noteType: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const createCaseNoteSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  authorUserId: z.string().uuid().optional().nullable(),
  noteType: z.string().min(1).default('internal'),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const workflowStageDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  stageOrder: z.coerce.number().int().nonnegative(),
  isTerminal: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const createWorkflowTemplateSchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  key: z.string().min(1),
  name: z.string().min(1),
  caseType: caseTypeSchema.optional(),
  status: z.string().min(1).default('active'),
  isSystem: z.boolean().default(false),
  definition: z.record(z.string(), z.unknown()).optional(),
  stages: z.array(workflowStageDefinitionSchema).min(1),
});

export const workflowInstanceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  workflowTemplateId: z.string().uuid(),
  currentWorkflowStageId: z.string().uuid().nullable(),
  status: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const createWorkflowTransitionSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  toStageKey: z.string().min(1),
  summary: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const salesCaseStatusSchema = z.enum([
  'instruction',
  'offer_received',
  'offer_accepted',
  'conveyancing',
  'completed',
  'cancelled',
]);

export const createSalesCaseSchema = createCaseSchema.extend({
  caseType: z.literal('sales').default('sales'),
  askingPrice: z.number().int().positive().optional(),
  agreedPrice: z.number().int().positive().optional(),
  saleStatus: salesCaseStatusSchema.default('instruction'),
  memorandumSentAt: z.string().datetime().optional(),
  targetExchangeAt: z.string().datetime().optional(),
  targetCompletionAt: z.string().datetime().optional(),
});

export const updateSalesCaseSchema = z.object({
  tenantId: z.string().uuid(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: caseStatusSchema.optional(),
  askingPrice: z.number().int().positive().optional().nullable(),
  agreedPrice: z.number().int().positive().optional().nullable(),
  saleStatus: salesCaseStatusSchema.optional(),
  memorandumSentAt: z.string().datetime().optional().nullable(),
  targetExchangeAt: z.string().datetime().optional().nullable(),
  targetCompletionAt: z.string().datetime().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createSalesOfferSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  amount: z.number().int().positive(),
  status: z.string().min(1).default('submitted'),
  submittedAt: z.string().datetime().optional(),
  respondedAt: z.string().datetime().optional().nullable(),
  notes: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const lettingsCaseStatusSchema = z.enum([
  'application',
  'application_received',
  'application_accepted',
  'agreed_let',
  'move_in',
  'completed',
  'cancelled',
]);

export const createLettingsCaseSchema = createCaseSchema.extend({
  caseType: z.literal('lettings').default('lettings'),
  monthlyRent: z.number().int().positive().optional(),
  depositAmount: z.number().int().nonnegative().optional(),
  lettingStatus: lettingsCaseStatusSchema.default('application'),
  agreedAt: z.string().datetime().optional(),
  moveInAt: z.string().datetime().optional(),
  agreedLetAt: z.string().datetime().optional(),
});

export const updateLettingsCaseSchema = z.object({
  tenantId: z.string().uuid(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: caseStatusSchema.optional(),
  monthlyRent: z.number().int().positive().optional().nullable(),
  depositAmount: z.number().int().nonnegative().optional().nullable(),
  lettingStatus: lettingsCaseStatusSchema.optional(),
  agreedAt: z.string().datetime().optional().nullable(),
  moveInAt: z.string().datetime().optional().nullable(),
  agreedLetAt: z.string().datetime().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createLettingsApplicationSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  monthlyRentOffered: z.number().int().positive().optional().nullable(),
  status: z.string().min(1).default('submitted'),
  submittedAt: z.string().datetime().optional(),
  respondedAt: z.string().datetime().optional().nullable(),
  notes: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createEmailTemplateSchema = z.object({
  tenantId: z.string().uuid(),
  key: z.string().min(1),
  name: z.string().min(1),
  subjectTemplate: z.string().min(1),
  bodyTextTemplate: z.string().min(1),
  bodyHtmlTemplate: z.string().min(1).optional(),
  status: z.string().min(1).default('active'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createSmsTemplateSchema = z.object({
  tenantId: z.string().uuid(),
  key: z.string().min(1),
  name: z.string().min(1),
  bodyTemplate: z.string().min(1),
  status: z.string().min(1).default('active'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const sendCaseCommunicationSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  channel: z.enum(['email', 'sms']),
  templateId: z.string().uuid(),
  templateType: z.enum(['email', 'sms']),
  recipientName: z.string().min(1).optional(),
  recipientEmail: z.string().email().optional(),
  recipientPhone: z.string().min(1).optional(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Contact = z.infer<typeof contactSchema>;
export type CreateContact = z.infer<typeof createContactSchema>;
export type CaseRecord = z.infer<typeof caseSchema>;
export type CreateCase = z.infer<typeof createCaseSchema>;
export type CaseParty = z.infer<typeof casePartySchema>;
export type CreateCaseParty = z.infer<typeof createCasePartySchema>;
export type CaseNote = z.infer<typeof caseNoteSchema>;
export type CreateCaseNote = z.infer<typeof createCaseNoteSchema>;
export type CreateWorkflowTemplate = z.infer<typeof createWorkflowTemplateSchema>;
export type CreateWorkflowTransition = z.infer<typeof createWorkflowTransitionSchema>;
export type WorkflowInstance = z.infer<typeof workflowInstanceSchema>;
export type CreateSalesCase = z.infer<typeof createSalesCaseSchema>;
export type UpdateSalesCase = z.infer<typeof updateSalesCaseSchema>;
export type CreateSalesOffer = z.infer<typeof createSalesOfferSchema>;
export type CreateLettingsCase = z.infer<typeof createLettingsCaseSchema>;
export type UpdateLettingsCase = z.infer<typeof updateLettingsCaseSchema>;
export type CreateLettingsApplication = z.infer<typeof createLettingsApplicationSchema>;
export type CreateEmailTemplate = z.infer<typeof createEmailTemplateSchema>;
export type CreateSmsTemplate = z.infer<typeof createSmsTemplateSchema>;
export type SendCaseCommunication = z.infer<typeof sendCaseCommunicationSchema>;

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
  trigger: z
    .object({
      source: z.string().min(1),
      integrationJobId: z.string().uuid().optional(),
      webhookEventId: z.string().uuid().optional(),
      jobType: z.string().min(1).optional(),
      entityType: z.string().min(1).optional(),
      entityExternalId: z.string().min(1).optional(),
    })
    .optional(),
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
