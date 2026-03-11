import { type createDbClient, schema } from '@vitalspace/db';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { listCaseCommunicationDispatches } from './communications-service';

type DbClient = ReturnType<typeof createDbClient>['db'];

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label}_not_found`);
  }

  return value;
}

export async function createContactRecord(args: {
  db: DbClient;
  tenantId: string;
  branchId?: string | null;
  contactType: 'person' | 'company' | 'organization';
  displayName: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  metadata?: Record<string, unknown>;
}) {
  const createdContacts = await args.db
    .insert(schema.contacts)
    .values({
      tenantId: args.tenantId,
      branchId: args.branchId ?? null,
      contactType: args.contactType,
      displayName: args.displayName,
      firstName: args.firstName ?? null,
      lastName: args.lastName ?? null,
      organizationName: args.organizationName ?? null,
      primaryEmail: args.primaryEmail ?? null,
      primaryPhone: args.primaryPhone ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return requireValue(createdContacts[0], 'contact');
}

export async function listContacts(args: { db: DbClient; tenantId: string }) {
  return args.db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.tenantId, args.tenantId))
    .orderBy(asc(schema.contacts.displayName), asc(schema.contacts.createdAt));
}

export async function createWorkflowTemplateRecord(args: {
  db: DbClient;
  tenantId: string;
  key: string;
  name: string;
  caseType?: 'sales' | 'lettings';
  status: string;
  isSystem: boolean;
  definition?: Record<string, unknown>;
  stages: Array<{
    key: string;
    name: string;
    stageOrder: number;
    isTerminal?: boolean;
    config?: Record<string, unknown>;
  }>;
}) {
  const createdTemplates = await args.db
    .insert(schema.workflowTemplates)
    .values({
      tenantId: args.tenantId,
      key: args.key,
      name: args.name,
      caseType: args.caseType ?? null,
      status: args.status,
      isSystem: args.isSystem,
      definitionJson: args.definition ?? null,
    })
    .returning();
  const workflowTemplate = requireValue(createdTemplates[0], 'workflow_template');

  const stagesToInsert = args.stages.map((stage) => ({
    workflowTemplateId: workflowTemplate.id,
    key: stage.key,
    name: stage.name,
    stageOrder: stage.stageOrder,
    isTerminal: stage.isTerminal ?? false,
    configJson: stage.config ?? null,
  }));

  const workflowStages = await args.db
    .insert(schema.workflowStages)
    .values(stagesToInsert)
    .returning();

  return {
    workflowTemplate,
    workflowStages,
  };
}

export async function listWorkflowTemplates(args: {
  db: DbClient;
  tenantId: string;
  caseType?: 'sales' | 'lettings';
}) {
  const templates = await args.db
    .select()
    .from(schema.workflowTemplates)
    .where(
      and(
        or(
          eq(schema.workflowTemplates.tenantId, args.tenantId),
          isNull(schema.workflowTemplates.tenantId),
        ),
        args.caseType ? eq(schema.workflowTemplates.caseType, args.caseType) : undefined,
      ),
    )
    .orderBy(asc(schema.workflowTemplates.name), asc(schema.workflowTemplates.createdAt));

  const templateIds = templates.map((template) => template.id);
  const workflowStages = templateIds.length
    ? await args.db
        .select()
        .from(schema.workflowStages)
        .where(
          or(...templateIds.map((templateId) => eq(schema.workflowStages.workflowTemplateId, templateId))),
        )
        .orderBy(asc(schema.workflowStages.stageOrder), asc(schema.workflowStages.createdAt))
    : [];

  const stagesByTemplateId = new Map<string, typeof workflowStages>();
  for (const stage of workflowStages) {
    const existing = stagesByTemplateId.get(stage.workflowTemplateId) ?? [];
    existing.push(stage);
    stagesByTemplateId.set(stage.workflowTemplateId, existing);
  }

  return templates.map((template) => ({
    ...template,
    stages: stagesByTemplateId.get(template.id) ?? [],
  }));
}

async function loadWorkflowTemplateForCase(args: {
  db: DbClient;
  tenantId: string;
  workflowTemplateId: string;
  caseType: 'sales' | 'lettings';
}) {
  const [workflowTemplate] = await args.db
    .select()
    .from(schema.workflowTemplates)
    .where(
      and(
        eq(schema.workflowTemplates.id, args.workflowTemplateId),
        or(
          eq(schema.workflowTemplates.tenantId, args.tenantId),
          isNull(schema.workflowTemplates.tenantId),
        ),
      ),
    )
    .limit(1);

  if (!workflowTemplate) {
    return null;
  }

  if (workflowTemplate.caseType && workflowTemplate.caseType !== args.caseType) {
    throw new Error('workflow_template_case_type_mismatch');
  }

  const workflowStages = await args.db
    .select()
    .from(schema.workflowStages)
    .where(eq(schema.workflowStages.workflowTemplateId, workflowTemplate.id))
    .orderBy(asc(schema.workflowStages.stageOrder), asc(schema.workflowStages.createdAt));

  return {
    workflowTemplate,
    workflowStages,
  };
}

export async function createCaseRecord(args: {
  db: DbClient;
  tenantId: string;
  branchId?: string | null;
  propertyId?: string | null;
  workflowTemplateId?: string | null;
  caseType: 'sales' | 'lettings';
  status: 'open' | 'on_hold' | 'completed' | 'cancelled';
  reference?: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const createdCases = await args.db
    .insert(schema.cases)
    .values({
      tenantId: args.tenantId,
      branchId: args.branchId ?? null,
      propertyId: args.propertyId ?? null,
      caseType: args.caseType,
      status: args.status,
      reference: args.reference ?? null,
      title: args.title,
      description: args.description ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();
  const caseRecord = requireValue(createdCases[0], 'case');

  let workflowTemplate: typeof schema.workflowTemplates.$inferSelect | null = null;
  let workflowStages: Array<typeof schema.workflowStages.$inferSelect> = [];
  let workflowInstance: typeof schema.workflowInstances.$inferSelect | null = null;

  if (args.workflowTemplateId) {
    const workflowTemplateBundle = await loadWorkflowTemplateForCase({
      db: args.db,
      tenantId: args.tenantId,
      workflowTemplateId: args.workflowTemplateId,
      caseType: args.caseType,
    });

    if (!workflowTemplateBundle) {
      throw new Error('workflow_template_not_found');
    }

    workflowTemplate = workflowTemplateBundle.workflowTemplate;
    workflowStages = workflowTemplateBundle.workflowStages;
    const initialStage = workflowStages[0] ?? null;

    const createdInstances = await args.db
      .insert(schema.workflowInstances)
      .values({
        tenantId: args.tenantId,
        caseId: caseRecord.id,
        workflowTemplateId: workflowTemplate.id,
        currentWorkflowStageId: initialStage?.id ?? null,
        status: initialStage?.isTerminal ? 'completed' : 'active',
        completedAt: initialStage?.isTerminal ? new Date() : null,
      })
      .returning();

    workflowInstance = requireValue(createdInstances[0], 'workflow_instance');
  }

  return {
    caseRecord,
    workflowTemplate,
    workflowStages,
    workflowInstance,
  };
}

export async function addCasePartyRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  contactId?: string | null;
  partyRole: string;
  displayName: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
  metadata?: Record<string, unknown>;
}) {
  if (args.contactId) {
    const [contact] = await args.db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.id, args.contactId),
          eq(schema.contacts.tenantId, args.tenantId),
        ),
      )
      .limit(1);

    if (!contact) {
      throw new Error('contact_not_found');
    }
  }

  const createdParties = await args.db
    .insert(schema.caseParties)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      contactId: args.contactId ?? null,
      partyRole: args.partyRole,
      displayName: args.displayName,
      email: args.email ?? null,
      phone: args.phone ?? null,
      isPrimary: args.isPrimary,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return requireValue(createdParties[0], 'case_party');
}

export async function addCaseNoteRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  authorUserId?: string | null;
  noteType: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  const createdNotes = await args.db
    .insert(schema.caseNotes)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      authorUserId: args.authorUserId ?? null,
      noteType: args.noteType,
      body: args.body,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return requireValue(createdNotes[0], 'case_note');
}

export async function transitionWorkflowInstance(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  actorUserId?: string | null;
  toStageKey: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}) {
  const [workflowInstance] = await args.db
    .select()
    .from(schema.workflowInstances)
    .where(
      and(
        eq(schema.workflowInstances.tenantId, args.tenantId),
        eq(schema.workflowInstances.caseId, args.caseId),
      ),
    )
    .limit(1);

  if (!workflowInstance) {
    throw new Error('workflow_instance_not_found');
  }

  const [targetStage] = await args.db
    .select()
    .from(schema.workflowStages)
    .where(
      and(
        eq(schema.workflowStages.workflowTemplateId, workflowInstance.workflowTemplateId),
        eq(schema.workflowStages.key, args.toStageKey),
      ),
    )
    .limit(1);

  if (!targetStage) {
    throw new Error('workflow_stage_not_found');
  }

  const [currentStage] = workflowInstance.currentWorkflowStageId
    ? await args.db
        .select()
        .from(schema.workflowStages)
        .where(eq(schema.workflowStages.id, workflowInstance.currentWorkflowStageId))
        .limit(1)
    : [];

  const completedAt = targetStage.isTerminal ? new Date() : null;

  await args.db
    .update(schema.workflowInstances)
    .set({
      currentWorkflowStageId: targetStage.id,
      status: targetStage.isTerminal ? 'completed' : 'active',
      completedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.workflowInstances.id, workflowInstance.id));

  if (targetStage.isTerminal) {
    await args.db
      .update(schema.cases)
      .set({
        status: 'completed',
        closedAt: completedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.cases.id, args.caseId));
  }

  const createdTransitions = await args.db
    .insert(schema.workflowTransitionEvents)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      workflowInstanceId: workflowInstance.id,
      fromWorkflowStageId: currentStage?.id ?? null,
      toWorkflowStageId: targetStage.id,
      actorUserId: args.actorUserId ?? null,
      transitionKey: `${currentStage?.key ?? 'start'}->${targetStage.key}`,
      summary:
        args.summary ??
        `Moved workflow from ${currentStage?.name ?? 'Start'} to ${targetStage.name}`,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return {
    workflowInstanceId: workflowInstance.id,
    currentStage,
    targetStage,
    transitionEvent: requireValue(createdTransitions[0], 'workflow_transition_event'),
    completedAt,
  };
}

export async function loadCaseRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const [caseRow] = await args.db
    .select({
      id: schema.cases.id,
      tenantId: schema.cases.tenantId,
      branchId: schema.cases.branchId,
      propertyId: schema.cases.propertyId,
      caseType: schema.cases.caseType,
      status: schema.cases.status,
      reference: schema.cases.reference,
      title: schema.cases.title,
      description: schema.cases.description,
      openedAt: schema.cases.openedAt,
      closedAt: schema.cases.closedAt,
      metadataJson: schema.cases.metadataJson,
      createdAt: schema.cases.createdAt,
      updatedAt: schema.cases.updatedAt,
      propertyDisplayAddress: schema.properties.displayAddress,
      propertyPostcode: schema.properties.postcode,
      propertyStatus: schema.properties.status,
    })
    .from(schema.cases)
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .where(and(eq(schema.cases.tenantId, args.tenantId), eq(schema.cases.id, args.caseId)))
    .limit(1);

  return caseRow ?? null;
}

export async function listCaseRecords(args: {
  db: DbClient;
  tenantId: string;
  caseType?: 'sales' | 'lettings';
  status?: 'open' | 'on_hold' | 'completed' | 'cancelled';
  branchId?: string;
}) {
  const caseRows = await args.db
    .select({
      id: schema.cases.id,
      tenantId: schema.cases.tenantId,
      branchId: schema.cases.branchId,
      propertyId: schema.cases.propertyId,
      caseType: schema.cases.caseType,
      status: schema.cases.status,
      reference: schema.cases.reference,
      title: schema.cases.title,
      description: schema.cases.description,
      openedAt: schema.cases.openedAt,
      closedAt: schema.cases.closedAt,
      createdAt: schema.cases.createdAt,
      updatedAt: schema.cases.updatedAt,
      propertyDisplayAddress: schema.properties.displayAddress,
      workflowInstanceId: schema.workflowInstances.id,
      workflowStatus: schema.workflowInstances.status,
      workflowTemplateId: schema.workflowInstances.workflowTemplateId,
      currentStageKey: schema.workflowStages.key,
      currentStageName: schema.workflowStages.name,
    })
    .from(schema.cases)
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .leftJoin(schema.workflowInstances, eq(schema.workflowInstances.caseId, schema.cases.id))
    .leftJoin(
      schema.workflowStages,
      eq(schema.workflowStages.id, schema.workflowInstances.currentWorkflowStageId),
    )
    .where(
      and(
        eq(schema.cases.tenantId, args.tenantId),
        args.caseType ? eq(schema.cases.caseType, args.caseType) : undefined,
        args.status ? eq(schema.cases.status, args.status) : undefined,
        args.branchId ? eq(schema.cases.branchId, args.branchId) : undefined,
      ),
    )
    .orderBy(desc(schema.cases.updatedAt), desc(schema.cases.createdAt));

  return caseRows;
}

export async function loadCaseDetail(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const caseRecord = await loadCaseRecord(args);
  if (!caseRecord) {
    return null;
  }

  const parties = await args.db
    .select({
      id: schema.caseParties.id,
      tenantId: schema.caseParties.tenantId,
      caseId: schema.caseParties.caseId,
      contactId: schema.caseParties.contactId,
      partyRole: schema.caseParties.partyRole,
      displayName: schema.caseParties.displayName,
      email: schema.caseParties.email,
      phone: schema.caseParties.phone,
      isPrimary: schema.caseParties.isPrimary,
      metadataJson: schema.caseParties.metadataJson,
      createdAt: schema.caseParties.createdAt,
      updatedAt: schema.caseParties.updatedAt,
      contactType: schema.contacts.contactType,
      contactDisplayName: schema.contacts.displayName,
    })
    .from(schema.caseParties)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.caseParties.contactId))
    .where(
      and(
        eq(schema.caseParties.tenantId, args.tenantId),
        eq(schema.caseParties.caseId, args.caseId),
      ),
    )
    .orderBy(asc(schema.caseParties.createdAt));

  const notes = await args.db
    .select({
      id: schema.caseNotes.id,
      tenantId: schema.caseNotes.tenantId,
      caseId: schema.caseNotes.caseId,
      authorUserId: schema.caseNotes.authorUserId,
      noteType: schema.caseNotes.noteType,
      body: schema.caseNotes.body,
      metadataJson: schema.caseNotes.metadataJson,
      createdAt: schema.caseNotes.createdAt,
      updatedAt: schema.caseNotes.updatedAt,
      authorDisplayName: schema.users.displayName,
      authorEmail: schema.users.email,
    })
    .from(schema.caseNotes)
    .leftJoin(schema.users, eq(schema.users.id, schema.caseNotes.authorUserId))
    .where(and(eq(schema.caseNotes.tenantId, args.tenantId), eq(schema.caseNotes.caseId, args.caseId)))
    .orderBy(desc(schema.caseNotes.createdAt));

  const files = await args.db
    .select({
      id: schema.fileObjects.id,
      tenantId: schema.fileObjects.tenantId,
      label: schema.fileAttachments.label,
      originalName: schema.fileObjects.originalName,
      contentType: schema.fileObjects.contentType,
      sizeBytes: schema.fileObjects.sizeBytes,
      createdAt: schema.fileObjects.createdAt,
    })
    .from(schema.fileAttachments)
    .innerJoin(schema.fileObjects, eq(schema.fileObjects.id, schema.fileAttachments.fileObjectId))
    .where(
      and(
        eq(schema.fileAttachments.tenantId, args.tenantId),
        eq(schema.fileAttachments.entityType, 'case'),
        eq(schema.fileAttachments.entityId, args.caseId),
      ),
    )
    .orderBy(desc(schema.fileObjects.createdAt));

  const [workflowInstance] = await args.db
    .select({
      id: schema.workflowInstances.id,
      tenantId: schema.workflowInstances.tenantId,
      caseId: schema.workflowInstances.caseId,
      workflowTemplateId: schema.workflowInstances.workflowTemplateId,
      currentWorkflowStageId: schema.workflowInstances.currentWorkflowStageId,
      status: schema.workflowInstances.status,
      startedAt: schema.workflowInstances.startedAt,
      completedAt: schema.workflowInstances.completedAt,
      metadataJson: schema.workflowInstances.metadataJson,
      templateKey: schema.workflowTemplates.key,
      templateName: schema.workflowTemplates.name,
      templateCaseType: schema.workflowTemplates.caseType,
      currentStageKey: schema.workflowStages.key,
      currentStageName: schema.workflowStages.name,
      currentStageOrder: schema.workflowStages.stageOrder,
    })
    .from(schema.workflowInstances)
    .innerJoin(
      schema.workflowTemplates,
      eq(schema.workflowTemplates.id, schema.workflowInstances.workflowTemplateId),
    )
    .leftJoin(
      schema.workflowStages,
      eq(schema.workflowStages.id, schema.workflowInstances.currentWorkflowStageId),
    )
    .where(
      and(
        eq(schema.workflowInstances.tenantId, args.tenantId),
        eq(schema.workflowInstances.caseId, args.caseId),
      ),
    )
    .limit(1);

  const workflowStages =
    workflowInstance
      ? await args.db
          .select()
          .from(schema.workflowStages)
          .where(eq(schema.workflowStages.workflowTemplateId, workflowInstance.workflowTemplateId))
          .orderBy(asc(schema.workflowStages.stageOrder), asc(schema.workflowStages.createdAt))
      : [];

  const workflowTransitions = await args.db
    .select({
      id: schema.workflowTransitionEvents.id,
      workflowInstanceId: schema.workflowTransitionEvents.workflowInstanceId,
      transitionKey: schema.workflowTransitionEvents.transitionKey,
      summary: schema.workflowTransitionEvents.summary,
      metadataJson: schema.workflowTransitionEvents.metadataJson,
      occurredAt: schema.workflowTransitionEvents.occurredAt,
      actorDisplayName: schema.users.displayName,
      fromStageId: schema.workflowTransitionEvents.fromWorkflowStageId,
      toStageId: schema.workflowTransitionEvents.toWorkflowStageId,
    })
    .from(schema.workflowTransitionEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.workflowTransitionEvents.actorUserId))
    .where(
      and(
        eq(schema.workflowTransitionEvents.tenantId, args.tenantId),
        eq(schema.workflowTransitionEvents.caseId, args.caseId),
      ),
    )
    .orderBy(desc(schema.workflowTransitionEvents.occurredAt), desc(schema.workflowTransitionEvents.createdAt));

  const caseAudit = await args.db
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.tenantId, args.tenantId),
        eq(schema.auditLogs.entityType, 'case'),
        eq(schema.auditLogs.entityId, args.caseId),
      ),
    )
    .orderBy(desc(schema.auditLogs.occurredAt), desc(schema.auditLogs.createdAt));

  const communications = await listCaseCommunicationDispatches({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
  });

  const timelineEntries = [
    ...notes.map((note) => ({
      source: 'case_note',
      id: note.id,
      title: note.noteType,
      body: note.body,
      occurredAt: note.createdAt,
      actor: note.authorDisplayName ?? note.authorEmail ?? null,
    })),
    ...workflowTransitions.map((transition) => ({
      source: 'workflow_transition',
      id: transition.id,
      title: transition.transitionKey,
      body: transition.summary,
      occurredAt: transition.occurredAt,
      actor: transition.actorDisplayName ?? null,
    })),
    ...caseAudit.map((auditRow) => ({
      source: 'audit',
      id: auditRow.id,
      title: auditRow.action,
      body: auditRow.summary,
      occurredAt: auditRow.occurredAt,
      actor: auditRow.actorType,
    })),
    ...communications.map((dispatch) => ({
      source: 'communication',
      id: dispatch.id,
      title: `${dispatch.channel}.sent`,
      body:
        dispatch.channel === 'email'
          ? dispatch.subject ?? dispatch.body
          : dispatch.body,
      occurredAt: dispatch.sentAt,
      actor: dispatch.sentByDisplayName ?? null,
    })),
  ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime());

  return {
    caseRecord,
    parties,
    notes,
    files: files.map((file) => ({
      ...file,
      sizeBytes: Number(file.sizeBytes),
    })),
    communications,
    workflow: workflowInstance
      ? {
          ...workflowInstance,
          stages: workflowStages,
        }
      : null,
    timelineEntries,
  };
}
