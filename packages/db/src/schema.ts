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
    settingsJson: jsonb('settings_json'),
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

export const propertySyncRuns = pgTable(
  'property_sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    integrationAccountId: uuid('integration_account_id')
      .notNull()
      .references(() => integrationAccounts.id),
    triggerSource: text('trigger_source').notNull().default('manual_api'),
    syncType: text('sync_type').notNull().default('full'),
    status: text('status').notNull().default('running'),
    anomalyStatus: text('anomaly_status').notNull().default('healthy'),
    anomalyReason: text('anomaly_reason'),
    propertyCount: integer('property_count').notNull().default(0),
    staleCandidateCount: integer('stale_candidate_count').notNull().default(0),
    delistedCount: integer('delisted_count').notNull().default(0),
    metadataJson: jsonb('metadata_json'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    propertySyncRunTenantStartedIdx: index('property_sync_runs_tenant_started_idx').on(
      table.tenantId,
      table.startedAt,
    ),
    propertySyncRunIntegrationStartedIdx: index('property_sync_runs_integration_started_idx').on(
      table.integrationAccountId,
      table.startedAt,
    ),
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
    syncState: text('sync_state').notNull().default('active'),
    consecutiveMissCount: integer('consecutive_miss_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSeenInSyncRunId: uuid('last_seen_in_sync_run_id'),
    missingSinceSyncRunId: uuid('missing_since_sync_run_id'),
    staleCandidateAt: timestamp('stale_candidate_at', { withTimezone: true }),
    delistedAt: timestamp('delisted_at', { withTimezone: true }),
    delistedReason: text('delisted_reason'),
    ...timestamps,
  },
  (table) => ({
    propertyTenantStatusIdx: index('properties_tenant_status_idx').on(table.tenantId, table.status),
    propertyTenantSyncStateIdx: index('properties_tenant_sync_state_idx').on(
      table.tenantId,
      table.syncState,
    ),
  }),
);

export const propertySyncInventory = pgTable(
  'property_sync_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    syncRunId: uuid('sync_run_id')
      .notNull()
      .references(() => propertySyncRuns.id),
    propertyId: uuid('property_id').references(() => properties.id),
    externalId: text('external_id').notNull(),
    providerPropertyId: text('provider_property_id'),
    displayAddress: text('display_address'),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    propertySyncInventoryRunExternalIdx: uniqueIndex('property_sync_inventory_run_external_idx').on(
      table.syncRunId,
      table.externalId,
    ),
    propertySyncInventoryRunPropertyIdx: index('property_sync_inventory_run_property_idx').on(
      table.syncRunId,
      table.providerPropertyId,
    ),
  }),
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    contactType: text('contact_type').notNull().default('person'),
    status: text('status').notNull().default('active'),
    displayName: text('display_name').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    organizationName: text('organization_name'),
    primaryEmail: text('primary_email'),
    primaryPhone: text('primary_phone'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    contactTenantStatusIdx: index('contacts_tenant_status_idx').on(table.tenantId, table.status),
    contactTenantNameIdx: index('contacts_tenant_name_idx').on(table.tenantId, table.displayName),
  }),
);

export const workflowTemplates = pgTable(
  'workflow_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    side: text('side'),
    caseType: text('case_type'),
    versionNumber: integer('version_number').notNull().default(1),
    isActiveVersion: boolean('is_active_version').notNull().default(true),
    previousWorkflowTemplateId: uuid('previous_workflow_template_id'),
    status: text('status').notNull().default('active'),
    isSystem: boolean('is_system').notNull().default(false),
    definitionJson: jsonb('definition_json'),
    ...timestamps,
  },
  (table) => ({
    workflowTemplateTenantKeyVersionIdx: uniqueIndex('workflow_templates_tenant_key_version_idx').on(
      table.tenantId,
      table.key,
      table.versionNumber,
    ),
    workflowTemplateTenantActiveIdx: index('workflow_templates_tenant_active_idx').on(
      table.tenantId,
      table.caseType,
      table.isActiveVersion,
      table.updatedAt,
    ),
    workflowTemplatePreviousIdx: index('workflow_templates_previous_idx').on(
      table.previousWorkflowTemplateId,
    ),
    workflowTemplateTenantKeyIdx: index('workflow_templates_tenant_key_idx').on(
      table.tenantId,
      table.key,
    ),
  }),
);

export const workflowStages = pgTable(
  'workflow_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    legacyStageId: text('legacy_stage_id'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    stageOrder: integer('stage_order').notNull(),
    isTerminal: boolean('is_terminal').notNull().default(false),
    configJson: jsonb('config_json'),
    ...timestamps,
  },
  (table) => ({
    workflowStageTemplateKeyIdx: uniqueIndex('workflow_stages_template_key_idx').on(
      table.workflowTemplateId,
      table.key,
    ),
    workflowStageTemplateOrderIdx: uniqueIndex('workflow_stages_template_order_idx').on(
      table.workflowTemplateId,
      table.stageOrder,
    ),
  }),
);

export const workflowStageEdges = pgTable(
  'workflow_stage_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    fromWorkflowStageId: uuid('from_workflow_stage_id').references(() => workflowStages.id),
    toWorkflowStageId: uuid('to_workflow_stage_id')
      .notNull()
      .references(() => workflowStages.id),
    edgeType: text('edge_type').notNull().default('trigger'),
    triggerOn: text('trigger_on'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    workflowStageEdgeUniqueIdx: uniqueIndex('workflow_stage_edges_unique_idx').on(
      table.workflowTemplateId,
      table.fromWorkflowStageId,
      table.toWorkflowStageId,
      table.edgeType,
      table.triggerOn,
    ),
    workflowStageEdgeTemplateIdx: index('workflow_stage_edges_template_idx').on(
      table.workflowTemplateId,
    ),
  }),
);

export const workflowStageActions = pgTable(
  'workflow_stage_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    workflowStageId: uuid('workflow_stage_id')
      .notNull()
      .references(() => workflowStages.id),
    legacyActionId: text('legacy_action_id'),
    actionOrder: integer('action_order').notNull().default(0),
    triggerOn: text('trigger_on').notNull().default('Complete'),
    actionType: text('action_type').notNull(),
    name: text('name'),
    templateReference: text('template_reference'),
    targetLegacyStageId: text('target_legacy_stage_id'),
    targetWorkflowStageId: uuid('target_workflow_stage_id').references(() => workflowStages.id),
    recipientGroupsJson: jsonb('recipient_groups_json'),
    specificUserReference: text('specific_user_reference'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    workflowStageActionTemplateStageIdx: index('workflow_stage_actions_template_stage_idx').on(
      table.workflowTemplateId,
      table.workflowStageId,
      table.actionOrder,
    ),
  }),
);

export const cases = pgTable(
  'cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    propertyId: uuid('property_id').references(() => properties.id),
    ownerMembershipId: uuid('owner_membership_id').references(() => memberships.id),
    caseType: text('case_type').notNull(),
    status: text('status').notNull().default('open'),
    closedReason: text('closed_reason'),
    reference: text('reference'),
    title: text('title').notNull(),
    description: text('description'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    caseTenantTypeStatusIdx: index('cases_tenant_type_status_idx').on(
      table.tenantId,
      table.caseType,
      table.status,
    ),
    caseTenantPropertyIdx: index('cases_tenant_property_idx').on(table.tenantId, table.propertyId),
    caseTenantOwnerIdx: index('cases_tenant_owner_idx').on(table.tenantId, table.ownerMembershipId),
    caseTenantReferenceIdx: uniqueIndex('cases_tenant_reference_idx').on(
      table.tenantId,
      table.reference,
    ),
  }),
);

export const caseParties = pgTable(
  'case_parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    partyRole: text('party_role').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    casePartyTenantCaseIdx: index('case_parties_tenant_case_idx').on(table.tenantId, table.caseId),
    casePartyTenantContactIdx: index('case_parties_tenant_contact_idx').on(
      table.tenantId,
      table.contactId,
    ),
  }),
);

export const caseNotes = pgTable(
  'case_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    authorUserId: uuid('author_user_id').references(() => users.id),
    noteType: text('note_type').notNull().default('internal'),
    body: text('body').notNull(),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    caseNoteTenantCaseIdx: index('case_notes_tenant_case_idx').on(table.tenantId, table.caseId),
  }),
);

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    subjectTemplate: text('subject_template').notNull(),
    bodyTextTemplate: text('body_text_template').notNull(),
    bodyHtmlTemplate: text('body_html_template'),
    status: text('status').notNull().default('active'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    emailTemplateTenantKeyIdx: uniqueIndex('email_templates_tenant_key_idx').on(
      table.tenantId,
      table.key,
    ),
  }),
);

export const messageProviderAccounts = pgTable(
  'message_provider_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    channel: text('channel').notNull(),
    providerKey: text('provider_key').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    credentialsJsonEncrypted: jsonb('credentials_json_encrypted'),
    settingsJson: jsonb('settings_json'),
    ...timestamps,
  },
  (table) => ({
    messageProviderAccountTenantNameIdx: uniqueIndex('message_provider_accounts_tenant_name_idx').on(
      table.tenantId,
      table.name,
    ),
    messageProviderAccountTenantChannelIdx: index('message_provider_accounts_tenant_channel_idx').on(
      table.tenantId,
      table.channel,
      table.status,
    ),
  }),
);

export const smsTemplates = pgTable(
  'sms_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    bodyTemplate: text('body_template').notNull(),
    status: text('status').notNull().default('active'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    smsTemplateTenantKeyIdx: uniqueIndex('sms_templates_tenant_key_idx').on(
      table.tenantId,
      table.key,
    ),
  }),
);

export const communicationDispatches = pgTable(
  'communication_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    channel: text('channel').notNull(),
    templateType: text('template_type').notNull(),
    templateId: uuid('template_id').notNull(),
    providerAccountId: uuid('provider_account_id').references(() => messageProviderAccounts.id),
    providerKey: text('provider_key'),
    deliveryMode: text('delivery_mode').notNull().default('log_only'),
    sentByUserId: uuid('sent_by_user_id').references(() => users.id),
    recipientName: text('recipient_name'),
    originalRecipientEmail: text('original_recipient_email'),
    originalRecipientPhone: text('original_recipient_phone'),
    recipientEmail: text('recipient_email'),
    recipientPhone: text('recipient_phone'),
    subject: text('subject'),
    body: text('body').notNull(),
    status: text('status').notNull().default('sent'),
    providerMessageId: text('provider_message_id'),
    errorMessage: text('error_message'),
    metadataJson: jsonb('metadata_json'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => ({
    communicationDispatchTenantCaseIdx: index('communication_dispatches_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
    ),
    communicationDispatchTenantStatusIdx: index('communication_dispatches_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);

export const communicationAttempts = pgTable(
  'communication_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    dispatchId: uuid('dispatch_id').notNull().references(() => communicationDispatches.id),
    providerAccountId: uuid('provider_account_id').references(() => messageProviderAccounts.id),
    providerKey: text('provider_key'),
    requestPayloadJson: jsonb('request_payload_json'),
    responsePayloadJson: jsonb('response_payload_json'),
    providerMessageId: text('provider_message_id'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => ({
    communicationAttemptDispatchIdx: index('communication_attempts_dispatch_idx').on(table.dispatchId),
    communicationAttemptTenantStatusIdx: index('communication_attempts_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);

export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    track: text('track').notNull().default('Primary'),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    currentWorkflowStageId: uuid('current_workflow_stage_id').references(() => workflowStages.id),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    workflowInstanceCaseTrackIdx: uniqueIndex('workflow_instances_case_track_idx').on(
      table.caseId,
      table.track,
    ),
    workflowInstanceTenantStatusIdx: index('workflow_instances_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);

export const workflowStageRuntimes = pgTable(
  'workflow_stage_runtimes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    workflowInstanceId: uuid('workflow_instance_id')
      .notNull()
      .references(() => workflowInstances.id),
    workflowStageId: uuid('workflow_stage_id')
      .notNull()
      .references(() => workflowStages.id),
    status: text('status').notNull().default('not_started'),
    dependencyState: text('dependency_state').notNull().default('pending'),
    isCurrent: boolean('is_current').notNull().default(false),
    estimatedStartAt: timestamp('estimated_start_at', { withTimezone: true }),
    estimatedCompleteAt: timestamp('estimated_complete_at', { withTimezone: true }),
    targetStartAt: timestamp('target_start_at', { withTimezone: true }),
    targetCompleteAt: timestamp('target_complete_at', { withTimezone: true }),
    actualStartedAt: timestamp('actual_started_at', { withTimezone: true }),
    actualCompletedAt: timestamp('actual_completed_at', { withTimezone: true }),
    scheduleSource: text('schedule_source').notNull().default('calculated'),
    lastRecalculatedAt: timestamp('last_recalculated_at', { withTimezone: true }),
    manualOverrideAt: timestamp('manual_override_at', { withTimezone: true }),
    manualOverrideReason: text('manual_override_reason'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    workflowStageRuntimeInstanceStageIdx: uniqueIndex(
      'workflow_stage_runtimes_instance_stage_idx',
    ).on(table.workflowInstanceId, table.workflowStageId),
    workflowStageRuntimeTenantStatusIdx: index('workflow_stage_runtimes_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
    workflowStageRuntimeTenantCurrentIdx: index('workflow_stage_runtimes_tenant_current_idx').on(
      table.tenantId,
      table.isCurrent,
    ),
  }),
);

export const workflowTransitionEvents = pgTable(
  'workflow_transition_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    workflowInstanceId: uuid('workflow_instance_id')
      .notNull()
      .references(() => workflowInstances.id),
    fromWorkflowStageId: uuid('from_workflow_stage_id').references(() => workflowStages.id),
    toWorkflowStageId: uuid('to_workflow_stage_id').references(() => workflowStages.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    transitionKey: text('transition_key').notNull(),
    summary: text('summary').notNull(),
    metadataJson: jsonb('metadata_json'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowTransitionTenantCaseOccurredIdx: index(
      'workflow_transition_events_tenant_case_occurred_idx',
    ).on(table.tenantId, table.caseId, table.occurredAt),
    workflowTransitionInstanceIdx: index('workflow_transition_events_instance_idx').on(
      table.workflowInstanceId,
    ),
  }),
);

export const workflowDelayRequests = pgTable(
  'workflow_delay_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    workflowInstanceId: uuid('workflow_instance_id')
      .notNull()
      .references(() => workflowInstances.id),
    workflowStageId: uuid('workflow_stage_id').references(() => workflowStages.id),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    workflowTrack: text('workflow_track').notNull(),
    dateField: text('date_field').notNull(),
    status: text('status').notNull().default('pending'),
    reason: text('reason').notNull(),
    reviewNote: text('review_note'),
    oldTargetAt: timestamp('old_target_at', { withTimezone: true }),
    requestedTargetAt: timestamp('requested_target_at', { withTimezone: true }).notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowDelayRequestTenantCaseIdx: index('workflow_delay_requests_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
      table.createdAt,
    ),
    workflowDelayRequestTenantStatusIdx: index('workflow_delay_requests_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
    workflowDelayRequestInstanceIdx: index('workflow_delay_requests_instance_idx').on(
      table.workflowInstanceId,
      table.createdAt,
    ),
  }),
);

export const salesCases = pgTable(
  'sales_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    askingPrice: integer('asking_price'),
    agreedPrice: integer('agreed_price'),
    saleStatus: text('sale_status').notNull().default('instruction'),
    memorandumSentAt: timestamp('memorandum_sent_at', { withTimezone: true }),
    targetExchangeAt: timestamp('target_exchange_at', { withTimezone: true }),
    targetCompletionAt: timestamp('target_completion_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    salesCaseCaseIdx: uniqueIndex('sales_cases_case_idx').on(table.caseId),
    salesCaseTenantStatusIdx: index('sales_cases_tenant_status_idx').on(
      table.tenantId,
      table.saleStatus,
    ),
  }),
);

export const salesOffers = pgTable(
  'sales_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    salesCaseId: uuid('sales_case_id').notNull().references(() => salesCases.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    amount: integer('amount').notNull(),
    status: text('status').notNull().default('submitted'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    notes: text('notes'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    salesOfferTenantCaseIdx: index('sales_offers_tenant_case_idx').on(table.tenantId, table.caseId),
    salesOfferTenantStatusIdx: index('sales_offers_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);

export const lettingsCases = pgTable(
  'lettings_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    monthlyRent: integer('monthly_rent'),
    depositAmount: integer('deposit_amount'),
    lettingStatus: text('letting_status').notNull().default('application'),
    agreedAt: timestamp('agreed_at', { withTimezone: true }),
    moveInAt: timestamp('move_in_at', { withTimezone: true }),
    agreedLetAt: timestamp('agreed_let_at', { withTimezone: true }),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    lettingsCaseCaseIdx: uniqueIndex('lettings_cases_case_idx').on(table.caseId),
    lettingsCaseTenantStatusIdx: index('lettings_cases_tenant_status_idx').on(
      table.tenantId,
      table.lettingStatus,
    ),
  }),
);

export const lettingsApplications = pgTable(
  'lettings_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    caseId: uuid('case_id').notNull().references(() => cases.id),
    lettingsCaseId: uuid('lettings_case_id').notNull().references(() => lettingsCases.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    monthlyRentOffered: integer('monthly_rent_offered'),
    status: text('status').notNull().default('submitted'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    notes: text('notes'),
    metadataJson: jsonb('metadata_json'),
    ...timestamps,
  },
  (table) => ({
    lettingsApplicationTenantCaseIdx: index('lettings_applications_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
    ),
    lettingsApplicationTenantStatusIdx: index('lettings_applications_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
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
    isCurrent: boolean('is_current').notNull().default(true),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    externalRefIdx: uniqueIndex('external_references_provider_entity_external_idx').on(
      table.tenantId,
      table.provider,
      table.entityType,
      table.externalType,
      table.externalId,
    ),
  }),
);
