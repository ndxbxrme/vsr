import {
  boolean,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    emailNormalized: text('email_normalized'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name'),
    phone: text('phone'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    emailNormalizedIdx: uniqueIndex('users_email_normalized_idx').on(table.emailNormalized),
  }),
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    passwordHash: text('password_hash').notNull(),
    passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
    mustReset: boolean('must_reset').notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    userIdx: uniqueIndex('credentials_user_id_idx').on(table.userId),
  }),
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    emailFromProvider: text('email_from_provider'),
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    profileJson: jsonb('profile_json'),
    ...timestamps,
  },
  (table) => ({
    providerIdx: uniqueIndex('oauth_accounts_provider_user_idx').on(
      table.provider,
      table.providerUserId,
    ),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    sessionTokenHash: text('session_token_hash').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionTokenIdx: uniqueIndex('sessions_token_hash_idx').on(table.sessionTokenHash),
    sessionUserIdx: index('sessions_user_idx').on(table.userId),
  }),
);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('active'),
    onboardingState: text('onboarding_state').notNull().default('created'),
    ...timestamps,
  },
  (table) => ({
    slugIdx: uniqueIndex('tenants_slug_idx').on(table.slug),
  }),
);

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    timezone: text('timezone'),
    ...timestamps,
  },
  (table) => ({
    tenantSlugIdx: uniqueIndex('branches_tenant_slug_idx').on(table.tenantId, table.slug),
  }),
);

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    domain: text('domain').notNull(),
    domainType: text('domain_type').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verificationStatus: text('verification_status').notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    domainIdx: uniqueIndex('tenant_domains_domain_idx').on(table.domain),
  }),
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    scopeType: text('scope_type').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    roleTenantKeyIdx: uniqueIndex('roles_tenant_key_idx').on(table.tenantId, table.key),
  }),
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (table) => ({
    permissionKeyIdx: uniqueIndex('permissions_key_idx').on(table.key),
  }),
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id),
    ...timestamps,
  },
  (table) => ({
    rolePermissionUniqueIdx: uniqueIndex('role_permissions_role_permission_idx').on(
      table.roleId,
      table.permissionId,
    ),
  }),
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    status: text('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    membershipUniqueIdx: uniqueIndex('memberships_tenant_branch_user_idx').on(
      table.tenantId,
      table.branchId,
      table.userId,
    ),
  }),
);

export const membershipRoles = pgTable(
  'membership_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id').notNull().references(() => memberships.id),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    ...timestamps,
  },
  (table) => ({
    membershipRoleUniqueIdx: uniqueIndex('membership_roles_membership_role_idx').on(
      table.membershipId,
      table.roleId,
    ),
  }),
);

export const fileObjects = pgTable('file_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  storageProvider: text('storage_provider').notNull(),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: text('size_bytes').notNull(),
  ...timestamps,
});

export const fileAttachments = pgTable(
  'file_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    fileObjectId: uuid('file_object_id').notNull().references(() => fileObjects.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    label: text('label'),
    ...timestamps,
  },
  (table) => ({
    fileAttachmentUniqueIdx: uniqueIndex('file_attachments_tenant_file_entity_idx').on(
      table.tenantId,
      table.fileObjectId,
      table.entityType,
      table.entityId,
    ),
    fileAttachmentEntityIdx: index('file_attachments_tenant_entity_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
  }),
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorType: text('actor_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    metadataJson: jsonb('metadata_json'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    auditEntityIdx: index('audit_logs_entity_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
  }),
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    eventName: text('event_name').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    mutationType: text('mutation_type').notNull(),
    channelKey: text('channel_key').notNull(),
    payloadJson: jsonb('payload_json'),
    status: text('status').notNull().default('pending'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    outboxStatusIdx: index('outbox_events_status_idx').on(table.status, table.availableAt),
  }),
);

export const integrationAccounts = pgTable('integration_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  credentialsJsonEncrypted: jsonb('credentials_json_encrypted'),
  settingsJson: jsonb('settings_json'),
  ...timestamps,
},
  (table) => ({
    integrationAccountTenantProviderIdx: uniqueIndex('integration_accounts_tenant_provider_idx').on(
      table.tenantId,
      table.provider,
    ),
  }),
);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  integrationAccountId: uuid('integration_account_id').references(() => integrationAccounts.id),
  provider: text('provider').notNull(),
  eventType: text('event_type').notNull(),
  signatureValid: boolean('signature_valid').notNull().default(false),
  payloadJson: jsonb('payload_json').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingStatus: text('processing_status').notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const integrationJobs = pgTable(
  'integration_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    integrationAccountId: uuid('integration_account_id').references(() => integrationAccounts.id),
    webhookEventId: uuid('webhook_event_id').references(() => webhookEvents.id),
    provider: text('provider').notNull(),
    jobType: text('job_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityExternalId: text('entity_external_id'),
    dedupeKey: text('dedupe_key').notNull(),
    payloadJson: jsonb('payload_json'),
    status: text('status').notNull().default('pending'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    ...timestamps,
  },
  (table) => ({
    integrationJobDedupeIdx: uniqueIndex('integration_jobs_provider_dedupe_idx').on(
      table.provider,
      table.dedupeKey,
    ),
    integrationJobStatusIdx: index('integration_jobs_status_idx').on(table.status, table.availableAt),
  }),
);

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    displayAddress: text('display_address').notNull(),
    postcode: text('postcode'),
    status: text('status').notNull().default('active'),
    marketingStatus: text('marketing_status'),
    ...timestamps,
  },
  (table) => ({
    propertyTenantStatusIdx: index('properties_tenant_status_idx').on(table.tenantId, table.status),
  }),
);

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    propertyId: uuid('property_id').references(() => properties.id),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    propertyRoleExternalId: text('property_role_external_id'),
    applicantName: text('applicant_name'),
    applicantEmail: text('applicant_email'),
    applicantGrade: text('applicant_grade'),
    amount: integer('amount'),
    status: text('status'),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    rawPayload: jsonb('raw_payload'),
    ...timestamps,
  },
  (table) => ({
    offerProviderExternalIdx: uniqueIndex('offers_provider_external_idx').on(
      table.tenantId,
      table.provider,
      table.externalId,
    ),
    offerTenantPropertyIdx: index('offers_tenant_property_idx').on(table.tenantId, table.propertyId),
  }),
);

export const viewings = pgTable(
  'viewings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    propertyId: uuid('property_id').references(() => properties.id),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    propertyRoleExternalId: text('property_role_external_id'),
    applicantName: text('applicant_name'),
    applicantEmail: text('applicant_email'),
    applicantGrade: text('applicant_grade'),
    eventStatus: text('event_status'),
    feedbackCount: integer('feedback_count').notNull().default(0),
    notesCount: integer('notes_count').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    rawPayload: jsonb('raw_payload'),
    ...timestamps,
  },
  (table) => ({
    viewingProviderExternalIdx: uniqueIndex('viewings_provider_external_idx').on(
      table.tenantId,
      table.provider,
      table.externalId,
    ),
    viewingTenantPropertyIdx: index('viewings_tenant_property_idx').on(table.tenantId, table.propertyId),
  }),
);

export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').references(() => properties.id),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    propertyRoleExternalId: text('property_role_external_id'),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    actorType: text('actor_type').notNull().default('external_system'),
    metadataJson: jsonb('metadata_json'),
    rawPayload: jsonb('raw_payload'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timelineProviderExternalIdx: uniqueIndex('timeline_events_provider_external_idx').on(
      table.tenantId,
      table.provider,
      table.externalId,
    ),
    timelineTenantSubjectOccurredIdx: index('timeline_events_tenant_subject_occurred_idx').on(
      table.tenantId,
      table.subjectType,
      table.subjectId,
      table.occurredAt,
    ),
    timelineTenantRoleIdx: index('timeline_events_tenant_role_idx').on(
      table.tenantId,
      table.propertyRoleExternalId,
    ),
  }),
);

export const externalReferences = pgTable(
  'external_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    provider: text('provider').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    externalType: text('external_type').notNull(),
    externalId: text('external_id').notNull(),
    metadataJson: jsonb('metadata_json'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    externalRefIdx: uniqueIndex('external_references_provider_entity_external_idx').on(
      table.tenantId,
      table.provider,
      table.entityType,
      table.externalId,
    ),
  }),
);
