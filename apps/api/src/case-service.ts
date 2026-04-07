import { type createDbClient, schema } from '@vitalspace/db';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { listCaseCommunicationDispatches } from './communications-service';
import {
  buildProjectedCaseDates,
  calculateWorkflowStageRuntimes,
  mergeWorkflowStagesWithRuntime,
  transitionWorkflowStageRuntimes,
} from './scheduling-engine';

type DbClient = ReturnType<typeof createDbClient>['db'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function isTenantWorkflowAutostartEnabled(args: {
  db: DbClient;
  tenantId: string;
}) {
  const [tenant] = await args.db
    .select({
      settingsJson: schema.tenants.settingsJson,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, args.tenantId))
    .limit(1);

  const settings = asRecord(tenant?.settingsJson);
  return typeof settings.workflowAutostart === 'boolean' ? settings.workflowAutostart : true;
}

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
  side?: string | null;
  caseType?: 'sales' | 'lettings';
  status: string;
  isSystem: boolean;
  definition?: Record<string, unknown>;
  stages: Array<{
    legacyStageId?: string | null;
    key: string;
    name: string;
    stageOrder: number;
    isTerminal?: boolean;
    config?: Record<string, unknown>;
  }>;
  edges?: Array<{
    fromStageKey?: string | null;
    toStageKey: string;
    edgeType?: string;
    triggerOn?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  actions?: Array<{
    stageKey: string;
    legacyActionId?: string | null;
    actionOrder: number;
    triggerOn?: string;
    actionType: string;
    name?: string | null;
    templateReference?: string | null;
    targetLegacyStageId?: string | null;
    targetStageKey?: string | null;
    recipientGroups?: unknown;
    specificUserReference?: string | null;
    metadata?: Record<string, unknown>;
  }>;
}) {
  return args.db.transaction(async (tx) => {
    const existingTemplates = await tx
      .select()
      .from(schema.workflowTemplates)
      .where(
        and(
          eq(schema.workflowTemplates.tenantId, args.tenantId),
          eq(schema.workflowTemplates.key, args.key),
        ),
      )
      .orderBy(desc(schema.workflowTemplates.versionNumber), desc(schema.workflowTemplates.createdAt));

    const latestVersion = existingTemplates[0] ?? null;
    const versionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

    if (latestVersion) {
      await tx
        .update(schema.workflowTemplates)
        .set({
          isActiveVersion: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.workflowTemplates.tenantId, args.tenantId),
            eq(schema.workflowTemplates.key, args.key),
            eq(schema.workflowTemplates.isActiveVersion, true),
          ),
        );
    }

    const createdTemplates = await tx
      .insert(schema.workflowTemplates)
      .values({
        tenantId: args.tenantId,
        key: args.key,
        name: args.name,
        side: args.side ?? null,
        caseType: args.caseType ?? null,
        versionNumber,
        isActiveVersion: true,
        previousWorkflowTemplateId: latestVersion?.id ?? null,
        status: args.status,
        isSystem: args.isSystem,
        definitionJson: args.definition ?? null,
      })
      .returning();
    const workflowTemplate = requireValue(createdTemplates[0], 'workflow_template');

    const stagesToInsert = args.stages.map((stage) => ({
      workflowTemplateId: workflowTemplate.id,
      legacyStageId: stage.legacyStageId ?? null,
      key: stage.key,
      name: stage.name,
      stageOrder: stage.stageOrder,
      isTerminal: stage.isTerminal ?? false,
      configJson: stage.config ?? null,
    }));

    const workflowStages = await tx
      .insert(schema.workflowStages)
      .values(stagesToInsert)
      .returning();

    const stagesByKey = new Map(workflowStages.map((stage) => [stage.key, stage]));

    if (args.edges?.length) {
      const edgesToInsert = args.edges
        .map((edge) => {
          const toStage = stagesByKey.get(edge.toStageKey);
          if (!toStage) {
            return null;
          }

          const fromStage = edge.fromStageKey ? stagesByKey.get(edge.fromStageKey) ?? null : null;
          return {
            workflowTemplateId: workflowTemplate.id,
            fromWorkflowStageId: fromStage?.id ?? null,
            toWorkflowStageId: toStage.id,
            edgeType: edge.edgeType ?? 'trigger',
            triggerOn: edge.triggerOn ?? null,
            metadataJson: edge.metadata ?? null,
          };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

      if (edgesToInsert.length) {
        await tx.insert(schema.workflowStageEdges).values(edgesToInsert);
      }
    }

    if (args.actions?.length) {
      const actionsToInsert = args.actions
        .map((action) => {
          const stage = stagesByKey.get(action.stageKey);
          if (!stage) {
            return null;
          }

          const targetStage = action.targetStageKey
            ? stagesByKey.get(action.targetStageKey) ?? null
            : null;

          return {
            workflowTemplateId: workflowTemplate.id,
            workflowStageId: stage.id,
            legacyActionId: action.legacyActionId ?? null,
            actionOrder: action.actionOrder,
            triggerOn: action.triggerOn ?? 'Complete',
            actionType: action.actionType,
            name: action.name ?? null,
            templateReference: action.templateReference ?? null,
            targetLegacyStageId: action.targetLegacyStageId ?? null,
            targetWorkflowStageId: targetStage?.id ?? null,
            recipientGroupsJson: action.recipientGroups ?? null,
            specificUserReference: action.specificUserReference ?? null,
            metadataJson: action.metadata ?? null,
          };
        })
        .filter((action): action is NonNullable<typeof action> => action !== null);

      if (actionsToInsert.length) {
        await tx.insert(schema.workflowStageActions).values(actionsToInsert);
      }
    }

    return {
      workflowTemplate,
      workflowStages,
    };
  });
}

async function loadWorkflowTemplateGraph(args: {
  db: DbClient;
  workflowTemplateIds: string[];
}) {
  if (!args.workflowTemplateIds.length) {
    return {
      stagesByTemplateId: new Map<string, Array<typeof schema.workflowStages.$inferSelect>>(),
      edgesByTemplateId: new Map<string, Array<typeof schema.workflowStageEdges.$inferSelect>>(),
      actionsByTemplateId: new Map<string, Array<typeof schema.workflowStageActions.$inferSelect>>(),
    };
  }

  const templateIdPredicates = args.workflowTemplateIds.map((templateId) =>
    eq(schema.workflowStages.workflowTemplateId, templateId),
  );
  const workflowStages = await args.db
    .select()
    .from(schema.workflowStages)
    .where(or(...templateIdPredicates))
    .orderBy(asc(schema.workflowStages.stageOrder), asc(schema.workflowStages.createdAt));

  const workflowStageEdges = await args.db
    .select()
    .from(schema.workflowStageEdges)
    .where(
      or(
        ...args.workflowTemplateIds.map((templateId) =>
          eq(schema.workflowStageEdges.workflowTemplateId, templateId),
        ),
      ),
    )
    .orderBy(
      asc(schema.workflowStageEdges.createdAt),
      asc(schema.workflowStageEdges.toWorkflowStageId),
    );

  const workflowStageActions = await args.db
    .select()
    .from(schema.workflowStageActions)
    .where(
      or(
        ...args.workflowTemplateIds.map((templateId) =>
          eq(schema.workflowStageActions.workflowTemplateId, templateId),
        ),
      ),
    )
    .orderBy(
      asc(schema.workflowStageActions.workflowStageId),
      asc(schema.workflowStageActions.actionOrder),
      asc(schema.workflowStageActions.createdAt),
    );

  const stagesByTemplateId = new Map<string, Array<typeof schema.workflowStages.$inferSelect>>();
  for (const stage of workflowStages) {
    const existing = stagesByTemplateId.get(stage.workflowTemplateId) ?? [];
    existing.push(stage);
    stagesByTemplateId.set(stage.workflowTemplateId, existing);
  }

  const edgesByTemplateId = new Map<
    string,
    Array<typeof schema.workflowStageEdges.$inferSelect>
  >();
  for (const edge of workflowStageEdges) {
    const existing = edgesByTemplateId.get(edge.workflowTemplateId) ?? [];
    existing.push(edge);
    edgesByTemplateId.set(edge.workflowTemplateId, existing);
  }

  const actionsByTemplateId = new Map<
    string,
    Array<typeof schema.workflowStageActions.$inferSelect>
  >();
  for (const action of workflowStageActions) {
    const existing = actionsByTemplateId.get(action.workflowTemplateId) ?? [];
    existing.push(action);
    actionsByTemplateId.set(action.workflowTemplateId, existing);
  }

  return {
    stagesByTemplateId,
    edgesByTemplateId,
    actionsByTemplateId,
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
        eq(schema.workflowTemplates.isActiveVersion, true),
      ),
    )
    .orderBy(asc(schema.workflowTemplates.name), asc(schema.workflowTemplates.createdAt));

  const templateIds = templates.map((template) => template.id);
  const { stagesByTemplateId, edgesByTemplateId, actionsByTemplateId } = await loadWorkflowTemplateGraph(
    {
      db: args.db,
      workflowTemplateIds: templateIds,
    },
  );

  return templates.map((template) => ({
    ...template,
    stages: stagesByTemplateId.get(template.id) ?? [],
    edges: edgesByTemplateId.get(template.id) ?? [],
    actions: actionsByTemplateId.get(template.id) ?? [],
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

  const { stagesByTemplateId, edgesByTemplateId, actionsByTemplateId } = await loadWorkflowTemplateGraph(
    {
      db: args.db,
      workflowTemplateIds: [workflowTemplate.id],
    },
  );
  const workflowStages = stagesByTemplateId.get(workflowTemplate.id) ?? [];

  return {
    workflowTemplate,
    workflowStages,
    workflowEdges: edgesByTemplateId.get(workflowTemplate.id) ?? [],
    workflowActions: actionsByTemplateId.get(workflowTemplate.id) ?? [],
  };
}

async function syncCaseWorkflowStageRuntimeRows(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  runtimeSeedsByInstanceId?: Map<string, Array<typeof schema.workflowStageRuntimes.$inferSelect>>;
  calculatedAt?: Date;
}) {
  const workflowInstances = await args.db
    .select()
    .from(schema.workflowInstances)
    .where(
      and(
        eq(schema.workflowInstances.tenantId, args.tenantId),
        eq(schema.workflowInstances.caseId, args.caseId),
      ),
    )
    .orderBy(asc(schema.workflowInstances.track), asc(schema.workflowInstances.createdAt));

  if (!workflowInstances.length) {
    return new Map<string, Array<typeof schema.workflowStageRuntimes.$inferSelect>>();
  }

  const templateIds = [...new Set(workflowInstances.map((instance) => instance.workflowTemplateId))];
  const { stagesByTemplateId, edgesByTemplateId } = await loadWorkflowTemplateGraph({
    db: args.db,
    workflowTemplateIds: templateIds,
  });

  const existingRuntimes = await args.db
    .select()
    .from(schema.workflowStageRuntimes)
    .where(
      or(
        ...workflowInstances.map((workflowInstance) =>
          eq(schema.workflowStageRuntimes.workflowInstanceId, workflowInstance.id),
        ),
      ),
    )
    .orderBy(asc(schema.workflowStageRuntimes.createdAt));

  const runtimeMap = new Map<string, Array<typeof schema.workflowStageRuntimes.$inferSelect>>();
  for (const workflowInstance of workflowInstances) {
    runtimeMap.set(
      workflowInstance.id,
      args.runtimeSeedsByInstanceId?.get(workflowInstance.id) ??
        existingRuntimes.filter((runtime) => runtime.workflowInstanceId === workflowInstance.id),
    );
  }

  for (const workflowInstance of workflowInstances) {
    const stages = stagesByTemplateId.get(workflowInstance.workflowTemplateId) ?? [];
    const edges = edgesByTemplateId.get(workflowInstance.workflowTemplateId) ?? [];
    const computedRuntimes = calculateWorkflowStageRuntimes({
      workflowStartedAt: workflowInstance.startedAt,
      currentWorkflowStageId: workflowInstance.currentWorkflowStageId,
      stages,
      edges,
      existingRuntimes: runtimeMap.get(workflowInstance.id) ?? [],
      ...(args.calculatedAt !== undefined ? { calculatedAt: args.calculatedAt } : {}),
    });

    for (const runtime of computedRuntimes) {
      await args.db
        .insert(schema.workflowStageRuntimes)
        .values({
          tenantId: args.tenantId,
          workflowInstanceId: workflowInstance.id,
          workflowStageId: runtime.workflowStageId,
          status: runtime.status,
          dependencyState: runtime.dependencyState,
          isCurrent: runtime.isCurrent,
          estimatedStartAt: runtime.estimatedStartAt,
          estimatedCompleteAt: runtime.estimatedCompleteAt,
          targetStartAt: runtime.targetStartAt,
          targetCompleteAt: runtime.targetCompleteAt,
          actualStartedAt: runtime.actualStartedAt,
          actualCompletedAt: runtime.actualCompletedAt,
          scheduleSource: runtime.scheduleSource,
          lastRecalculatedAt: runtime.lastRecalculatedAt,
          manualOverrideAt: runtime.manualOverrideAt,
          manualOverrideReason: runtime.manualOverrideReason,
          metadataJson: runtime.metadataJson,
        })
        .onConflictDoUpdate({
          target: [
            schema.workflowStageRuntimes.workflowInstanceId,
            schema.workflowStageRuntimes.workflowStageId,
          ],
          set: {
            status: runtime.status,
            dependencyState: runtime.dependencyState,
            isCurrent: runtime.isCurrent,
            estimatedStartAt: runtime.estimatedStartAt,
            estimatedCompleteAt: runtime.estimatedCompleteAt,
            targetStartAt: runtime.targetStartAt,
            targetCompleteAt: runtime.targetCompleteAt,
            actualStartedAt: runtime.actualStartedAt,
            actualCompletedAt: runtime.actualCompletedAt,
            scheduleSource: runtime.scheduleSource,
            lastRecalculatedAt: runtime.lastRecalculatedAt,
            manualOverrideAt: runtime.manualOverrideAt,
            manualOverrideReason: runtime.manualOverrideReason,
            metadataJson: runtime.metadataJson,
            updatedAt: new Date(),
          },
        });
    }
  }

  return runtimeMap;
}

export async function recalculateCaseSchedules(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  calculatedAt?: Date;
}) {
  const caseRecord = await loadCaseRecord({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
  });

  if (!caseRecord) {
    throw new Error('case_not_found');
  }

  await syncCaseWorkflowStageRuntimeRows({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
    ...(args.calculatedAt !== undefined ? { calculatedAt: args.calculatedAt } : {}),
  });

  return syncProjectedCaseDates({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
    caseType: caseRecord.caseType as 'sales' | 'lettings',
  });
}

function getWorkflowTrackLabel(args: {
  requestedTrack?: string | null;
  templateSide?: string | null;
}) {
  return args.requestedTrack ?? args.templateSide ?? 'Primary';
}

async function resolveWorkflowInstanceForCase(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  workflowTrack?: string;
}) {
  const workflowInstances = await args.db
    .select()
    .from(schema.workflowInstances)
    .where(
      and(
        eq(schema.workflowInstances.tenantId, args.tenantId),
        eq(schema.workflowInstances.caseId, args.caseId),
        args.workflowTrack ? eq(schema.workflowInstances.track, args.workflowTrack) : undefined,
      ),
    );

  const workflowInstance =
    workflowInstances.length === 1
      ? workflowInstances[0]
      : args.workflowTrack
        ? workflowInstances[0]
        : null;

  if (!workflowInstance) {
    if (!args.workflowTrack && workflowInstances.length > 1) {
      throw new Error('workflow_track_required');
    }

    throw new Error('workflow_instance_not_found');
  }

  return workflowInstance;
}

export function pickPrimaryWorkflow(args: {
  caseType: 'sales' | 'lettings';
  workflows: Array<{
    track: string;
    templateSide?: string | null;
  }>;
}) {
  const preferredTrack = args.caseType === 'sales' ? 'Seller' : 'Tenant';
  return (
    args.workflows.find((workflow) => workflow.track === preferredTrack) ??
    args.workflows.find((workflow) => workflow.templateSide === preferredTrack) ??
    args.workflows[0] ??
    null
  );
}

async function syncProjectedCaseDates(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  caseType: 'sales' | 'lettings';
}) {
  const workflowsByCaseId = await loadWorkflowSummariesForCaseIds({
    db: args.db,
    tenantId: args.tenantId,
    caseIds: [args.caseId],
  });
  const workflows = workflowsByCaseId.get(args.caseId) ?? [];
  const primaryWorkflow =
    pickPrimaryWorkflow({
      caseType: args.caseType,
      workflows: workflows as Array<{ track: string; templateSide?: string | null }>,
    }) as
      | {
          scheduleProjection?: {
            targetExchangeAt?: Date | null;
            targetCompletionAt?: Date | null;
            agreedLetAt?: Date | null;
            moveInAt?: Date | null;
          } | null;
        }
      | null;

  const projection = primaryWorkflow?.scheduleProjection ?? null;

  if (args.caseType === 'sales') {
    await args.db
      .update(schema.salesCases)
      .set({
        targetExchangeAt: projection?.targetExchangeAt ?? null,
        targetCompletionAt: projection?.targetCompletionAt ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.salesCases.tenantId, args.tenantId), eq(schema.salesCases.caseId, args.caseId)),
      );
  } else {
    await args.db
      .update(schema.lettingsCases)
      .set({
        agreedLetAt: projection?.agreedLetAt ?? null,
        moveInAt: projection?.moveInAt ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.lettingsCases.tenantId, args.tenantId),
          eq(schema.lettingsCases.caseId, args.caseId),
        ),
      );
  }

  return projection;
}

export async function loadWorkflowSummariesForCaseIds(args: {
  db: DbClient;
  tenantId: string;
  caseIds: string[];
}) {
  if (!args.caseIds.length) {
    return new Map<string, Array<Record<string, unknown>>>();
  }

  const workflowRows = await args.db
    .select({
      id: schema.workflowInstances.id,
      tenantId: schema.workflowInstances.tenantId,
      caseId: schema.workflowInstances.caseId,
      track: schema.workflowInstances.track,
      workflowTemplateId: schema.workflowInstances.workflowTemplateId,
      currentWorkflowStageId: schema.workflowInstances.currentWorkflowStageId,
      status: schema.workflowInstances.status,
      startedAt: schema.workflowInstances.startedAt,
      completedAt: schema.workflowInstances.completedAt,
      metadataJson: schema.workflowInstances.metadataJson,
      templateKey: schema.workflowTemplates.key,
      templateName: schema.workflowTemplates.name,
      templateCaseType: schema.workflowTemplates.caseType,
      templateSide: schema.workflowTemplates.side,
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
        or(...args.caseIds.map((caseId) => eq(schema.workflowInstances.caseId, caseId))),
      ),
    )
    .orderBy(
      asc(schema.workflowInstances.caseId),
      asc(schema.workflowInstances.track),
      asc(schema.workflowStages.stageOrder),
  );

  const templateIds = [...new Set(workflowRows.map((row) => row.workflowTemplateId))];
  const { stagesByTemplateId } = await loadWorkflowTemplateGraph({
    db: args.db,
    workflowTemplateIds: templateIds,
  });
  const workflowInstanceIds = workflowRows.map((row) => row.id);
  const workflowStageRuntimes = workflowInstanceIds.length
    ? await args.db
        .select()
        .from(schema.workflowStageRuntimes)
        .where(
          or(
            ...workflowInstanceIds.map((workflowInstanceId) =>
              eq(schema.workflowStageRuntimes.workflowInstanceId, workflowInstanceId),
            ),
          ),
        )
        .orderBy(asc(schema.workflowStageRuntimes.createdAt))
    : [];
  const runtimesByInstanceId = new Map<string, Array<typeof schema.workflowStageRuntimes.$inferSelect>>();
  for (const runtime of workflowStageRuntimes) {
    const existing = runtimesByInstanceId.get(runtime.workflowInstanceId) ?? [];
    existing.push(runtime);
    runtimesByInstanceId.set(runtime.workflowInstanceId, existing);
  }

  const workflowMap = new Map<string, Array<Record<string, unknown>>>();
  for (const workflowRow of workflowRows) {
    const existing = workflowMap.get(workflowRow.caseId) ?? [];
    const mergedStages = mergeWorkflowStagesWithRuntime({
      stages: stagesByTemplateId.get(workflowRow.workflowTemplateId) ?? [],
      runtimes: runtimesByInstanceId.get(workflowRow.id) ?? [],
    });
    existing.push({
      ...workflowRow,
      stages: mergedStages,
      scheduleProjection: buildProjectedCaseDates({
        caseType:
          workflowRow.templateCaseType === 'lettings' ? 'lettings' : 'sales',
        stages: mergedStages,
      }),
    });
    workflowMap.set(workflowRow.caseId, existing);
  }

  return workflowMap;
}

export async function createCaseRecord(args: {
  db: DbClient;
  tenantId: string;
  branchId?: string | null;
  propertyId?: string | null;
  ownerMembershipId?: string | null;
  workflowTemplateId?: string | null;
  workflowTemplates?: Array<{
    workflowTemplateId: string;
    track?: string | null;
  }>;
  caseType: 'sales' | 'lettings';
  status: 'open' | 'on_hold' | 'completed' | 'cancelled';
  closedReason?: string | null;
  reference?: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const workflowAutostart = await isTenantWorkflowAutostartEnabled({
    db: args.db,
    tenantId: args.tenantId,
  });

  if (args.ownerMembershipId) {
    const [membership] = await args.db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.id, args.ownerMembershipId),
          eq(schema.memberships.tenantId, args.tenantId),
        ),
      )
      .limit(1);

    if (!membership) {
      throw new Error('owner_membership_not_found');
    }
  }

  const createdCases = await args.db
    .insert(schema.cases)
    .values({
      tenantId: args.tenantId,
      branchId: args.branchId ?? null,
      propertyId: args.propertyId ?? null,
      ownerMembershipId: args.ownerMembershipId ?? null,
      caseType: args.caseType,
      status: args.status,
      closedReason: args.closedReason ?? null,
      reference: args.reference ?? null,
      title: args.title,
      description: args.description ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();
  const caseRecord = requireValue(createdCases[0], 'case');

  const requestedWorkflowTemplates =
    args.workflowTemplates ??
    (args.workflowTemplateId
      ? [
          {
            workflowTemplateId: args.workflowTemplateId,
          },
        ]
      : []);

  const createdWorkflowBundles: Array<{
    workflowTemplate: typeof schema.workflowTemplates.$inferSelect;
    workflowStages: Array<typeof schema.workflowStages.$inferSelect>;
    workflowInstance: typeof schema.workflowInstances.$inferSelect;
  }> = [];

  for (const requestedWorkflowTemplate of requestedWorkflowTemplates) {
    const workflowTemplateBundle = await loadWorkflowTemplateForCase({
      db: args.db,
      tenantId: args.tenantId,
      workflowTemplateId: requestedWorkflowTemplate.workflowTemplateId,
      caseType: args.caseType,
    });

    if (!workflowTemplateBundle) {
      throw new Error('workflow_template_not_found');
    }

    const initialStage = workflowTemplateBundle.workflowStages[0] ?? null;
    const createdInstances = await args.db
      .insert(schema.workflowInstances)
      .values({
        tenantId: args.tenantId,
        caseId: caseRecord.id,
        track: getWorkflowTrackLabel({
          requestedTrack: requestedWorkflowTemplate.track ?? null,
          templateSide: workflowTemplateBundle.workflowTemplate.side,
        }),
        workflowTemplateId: workflowTemplateBundle.workflowTemplate.id,
        currentWorkflowStageId:
          workflowAutostart
            ? (initialStage?.id ?? null)
            : null,
        status:
          workflowAutostart
            ? (initialStage?.isTerminal ? 'completed' : 'active')
            : 'not_started',
        completedAt: initialStage?.isTerminal ? new Date() : null,
      })
      .returning();

    const workflowInstance = requireValue(createdInstances[0], 'workflow_instance');
    createdWorkflowBundles.push({
      workflowTemplate: workflowTemplateBundle.workflowTemplate,
      workflowStages: workflowTemplateBundle.workflowStages,
      workflowInstance,
    });
  }

  if (createdWorkflowBundles.length) {
    await syncCaseWorkflowStageRuntimeRows({
      db: args.db,
      tenantId: args.tenantId,
      caseId: caseRecord.id,
      calculatedAt: caseRecord.openedAt,
    });

    await syncProjectedCaseDates({
      db: args.db,
      tenantId: args.tenantId,
      caseId: caseRecord.id,
      caseType: args.caseType,
    });
  }

  const primaryWorkflowBundle =
    pickPrimaryWorkflow({
      caseType: args.caseType,
      workflows: createdWorkflowBundles.map((bundle) => ({
        track: bundle.workflowInstance.track,
        templateSide: bundle.workflowTemplate.side,
      })),
    }) ?? null;
  const selectedPrimaryBundle =
    primaryWorkflowBundle
      ? createdWorkflowBundles.find(
          (bundle) =>
            bundle.workflowInstance.track === primaryWorkflowBundle.track &&
            bundle.workflowTemplate.side === (primaryWorkflowBundle.templateSide ?? bundle.workflowTemplate.side),
        ) ?? createdWorkflowBundles[0] ?? null
      : createdWorkflowBundles[0] ?? null;

  return {
    caseRecord,
    workflowTemplate: selectedPrimaryBundle?.workflowTemplate ?? null,
    workflowStages: selectedPrimaryBundle?.workflowStages ?? [],
    workflowInstance: selectedPrimaryBundle?.workflowInstance ?? null,
    workflows: createdWorkflowBundles.map((bundle) => ({
      ...bundle.workflowInstance,
      templateKey: bundle.workflowTemplate.key,
      templateName: bundle.workflowTemplate.name,
      templateCaseType: bundle.workflowTemplate.caseType,
      templateSide: bundle.workflowTemplate.side,
      currentStageKey: bundle.workflowStages[0]?.key ?? null,
      currentStageName: bundle.workflowStages[0]?.name ?? null,
      currentStageOrder: bundle.workflowStages[0]?.stageOrder ?? null,
      stages: bundle.workflowStages,
    })),
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
  workflowTrack?: string;
  fromStageKey?: string;
  toStageKey: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}) {
  const caseRecord = await loadCaseRecord({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
  });

  if (!caseRecord) {
    throw new Error('case_not_found');
  }

  const workflowInstance = await resolveWorkflowInstanceForCase({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
    ...(args.workflowTrack !== undefined ? { workflowTrack: args.workflowTrack } : {}),
  });

  const { stagesByTemplateId, actionsByTemplateId } = await loadWorkflowTemplateGraph({
    db: args.db,
    workflowTemplateIds: [workflowInstance.workflowTemplateId],
  });
  const workflowStages = stagesByTemplateId.get(workflowInstance.workflowTemplateId) ?? [];
  const workflowActions = actionsByTemplateId.get(workflowInstance.workflowTemplateId) ?? [];
  const workflowStageByKey = new Map(workflowStages.map((stage) => [stage.key, stage]));
  const workflowStageById = new Map(workflowStages.map((stage) => [stage.id, stage]));

  const targetStage = workflowStageByKey.get(args.toStageKey) ?? null;
  if (!targetStage) {
    throw new Error('workflow_stage_not_found');
  }

  const transitionOccurredAt = new Date();
  const existingStageRuntimes = await args.db
    .select()
    .from(schema.workflowStageRuntimes)
    .where(eq(schema.workflowStageRuntimes.workflowInstanceId, workflowInstance.id));
  const activeStageRuntimes = existingStageRuntimes.filter((runtime) => runtime.status === 'active');
  const currentStage = args.fromStageKey
    ? workflowStageByKey.get(args.fromStageKey) ?? null
    : activeStageRuntimes.length === 1
      ? workflowStageById.get(activeStageRuntimes[0]!.workflowStageId) ?? null
      : workflowInstance.currentWorkflowStageId
        ? workflowStageById.get(workflowInstance.currentWorkflowStageId) ?? null
        : null;

  if (args.fromStageKey && !currentStage) {
    throw new Error('workflow_stage_not_found');
  }

  if (args.fromStageKey) {
    const runtime = existingStageRuntimes.find(
      (item) => item.workflowStageId === currentStage?.id && item.status === 'active',
    );
    if (!runtime) {
      throw new Error('workflow_source_stage_not_active');
    }
  } else if (activeStageRuntimes.length > 1) {
    throw new Error('workflow_source_stage_required');
  }

  const isStartingWorkflow =
    !currentStage && (workflowInstance.currentWorkflowStageId === null || workflowInstance.status === 'not_started');
  const nextStartedAt = isStartingWorkflow ? transitionOccurredAt : workflowInstance.startedAt;
  const normalizedTriggerOn = (value: string | null | undefined) =>
    value?.trim().toLowerCase() === 'start' ? 'start' : 'complete';
  const triggerTargetStageIds = new Set<string>();

  if (!targetStage.isTerminal) {
    triggerTargetStageIds.add(targetStage.id);
  }

  for (const action of workflowActions) {
    if (action.actionType !== 'Trigger' || !action.targetWorkflowStageId) {
      continue;
    }

    if (
      currentStage &&
      action.workflowStageId === currentStage.id &&
      normalizedTriggerOn(action.triggerOn) === 'complete'
    ) {
      triggerTargetStageIds.add(action.targetWorkflowStageId);
    }

    if (
      action.workflowStageId === targetStage.id &&
      normalizedTriggerOn(action.triggerOn) === 'start'
    ) {
      triggerTargetStageIds.add(action.targetWorkflowStageId);
    }
  }

  triggerTargetStageIds.delete(currentStage?.id ?? '');

  const terminalWorkflowStageIds = targetStage.isTerminal ? [targetStage.id] : [];
  const activatedWorkflowStageIds = [...triggerTargetStageIds];
  const primaryActiveWorkflowStageId = activatedWorkflowStageIds.includes(targetStage.id)
    ? targetStage.id
    : activatedWorkflowStageIds[0] ?? null;

  const nextRuntimeSeeds = transitionWorkflowStageRuntimes({
    runtimes: existingStageRuntimes,
    fromWorkflowStageId: currentStage?.id ?? null,
    ...(primaryActiveWorkflowStageId ? { toWorkflowStageId: primaryActiveWorkflowStageId } : {}),
    activatedWorkflowStageIds,
    occurredAt: transitionOccurredAt,
    terminalWorkflowStageIds,
  });

  const nextActiveWorkflowStageIds = nextRuntimeSeeds
    .filter((runtime) => runtime.status === 'active')
    .map((runtime) => runtime.workflowStageId);
  const isWorkflowCompleted =
    nextRuntimeSeeds.length > 0 &&
    nextRuntimeSeeds.every((runtime) => runtime.status === 'completed' || runtime.status === 'skipped');
  const nextCurrentWorkflowStageId =
    (primaryActiveWorkflowStageId && nextActiveWorkflowStageIds.includes(primaryActiveWorkflowStageId)
      ? primaryActiveWorkflowStageId
      : nextActiveWorkflowStageIds[0] ?? null);
  const completedAt = isWorkflowCompleted ? transitionOccurredAt : null;

  await args.db
    .update(schema.workflowInstances)
    .set({
      currentWorkflowStageId: nextCurrentWorkflowStageId,
      status: isWorkflowCompleted ? 'completed' : 'active',
      startedAt: nextStartedAt,
      completedAt,
      updatedAt: transitionOccurredAt,
    })
    .where(eq(schema.workflowInstances.id, workflowInstance.id));

  await syncCaseWorkflowStageRuntimeRows({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
    runtimeSeedsByInstanceId: new Map([[workflowInstance.id, nextRuntimeSeeds]]),
    calculatedAt: completedAt ?? transitionOccurredAt,
  });

  if (isWorkflowCompleted) {
    const [remainingActiveWorkflows] = await args.db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(schema.workflowInstances)
      .where(
        and(
          eq(schema.workflowInstances.caseId, args.caseId),
          eq(schema.workflowInstances.tenantId, args.tenantId),
          eq(schema.workflowInstances.status, 'active'),
        ),
      );

    if (Number(remainingActiveWorkflows?.count ?? 0) === 0) {
      await args.db
        .update(schema.cases)
        .set({
          status: 'completed',
          closedAt: completedAt,
          closedReason: 'progression_completed',
          updatedAt: transitionOccurredAt,
        })
        .where(eq(schema.cases.id, args.caseId));
    }
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
      occurredAt: transitionOccurredAt,
      createdAt: transitionOccurredAt,
    })
    .returning();

  await syncProjectedCaseDates({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
    caseType: caseRecord.caseType as 'sales' | 'lettings',
  });

  return {
    workflowInstanceId: workflowInstance.id,
    currentStage,
    targetStage,
    transitionEvent: requireValue(createdTransitions[0], 'workflow_transition_event'),
    completedAt,
  };
}

export async function createWorkflowDelayRequestRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  requestedByUserId?: string | null;
  workflowTrack?: string;
  workflowStageId?: string;
  requestedTargetAt: Date;
  reason: string;
}) {
  const caseRecord = await loadCaseRecord({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
  });

  if (!caseRecord) {
    throw new Error('case_not_found');
  }

  const workflowInstance = await resolveWorkflowInstanceForCase({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
    ...(args.workflowTrack !== undefined ? { workflowTrack: args.workflowTrack } : {}),
  });
  const targetWorkflowStageId = args.workflowStageId ?? workflowInstance.currentWorkflowStageId ?? null;
  if (!targetWorkflowStageId) {
    throw new Error('workflow_stage_not_found');
  }

  if (workflowInstance.currentWorkflowStageId !== targetWorkflowStageId) {
    throw new Error('workflow_delay_stage_must_be_current');
  }

  const [workflowStageRuntime] = await args.db
    .select()
    .from(schema.workflowStageRuntimes)
    .where(
      and(
        eq(schema.workflowStageRuntimes.workflowInstanceId, workflowInstance.id),
        eq(schema.workflowStageRuntimes.workflowStageId, targetWorkflowStageId),
      ),
    )
    .limit(1);

  if (!workflowStageRuntime) {
    throw new Error('workflow_stage_runtime_not_found');
  }

  const oldTargetAt =
    workflowStageRuntime.targetCompleteAt ?? workflowStageRuntime.estimatedCompleteAt ?? null;

  const createdDelayRequests = await args.db
    .insert(schema.workflowDelayRequests)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      workflowInstanceId: workflowInstance.id,
      workflowStageId: targetWorkflowStageId,
      requestedByUserId: args.requestedByUserId ?? null,
      workflowTrack: workflowInstance.track,
      dateField: 'targetCompleteAt',
      reason: args.reason,
      oldTargetAt,
      requestedTargetAt: args.requestedTargetAt,
    })
    .returning();

  return {
    caseRecord,
    workflowInstance,
    delayRequest: requireValue(createdDelayRequests[0], 'workflow_delay_request'),
  };
}

export async function reviewWorkflowDelayRequestRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  delayRequestId: string;
  reviewedByUserId?: string | null;
  decision: 'approve' | 'reject';
  reviewNote?: string;
}) {
  const [delayRequest] = await args.db
    .select()
    .from(schema.workflowDelayRequests)
    .where(
      and(
        eq(schema.workflowDelayRequests.tenantId, args.tenantId),
        eq(schema.workflowDelayRequests.caseId, args.caseId),
        eq(schema.workflowDelayRequests.id, args.delayRequestId),
      ),
    )
    .limit(1);

  if (!delayRequest) {
    throw new Error('workflow_delay_request_not_found');
  }

  if (delayRequest.status !== 'pending') {
    throw new Error('workflow_delay_request_not_pending');
  }

  const [updatedDelayRequest] = await args.db
    .update(schema.workflowDelayRequests)
    .set({
      status: args.decision === 'approve' ? 'approved' : 'rejected',
      reviewNote: args.reviewNote ?? null,
      reviewedByUserId: args.reviewedByUserId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.workflowDelayRequests.id, delayRequest.id))
    .returning();
  const reviewedDelayRequest = requireValue(updatedDelayRequest, 'workflow_delay_request');

  if (args.decision === 'approve') {
    const caseRecord = await loadCaseRecord({
      db: args.db,
      tenantId: args.tenantId,
      caseId: args.caseId,
    });

    if (!caseRecord) {
      throw new Error('case_not_found');
    }

    const [workflowInstance] = await args.db
      .select()
      .from(schema.workflowInstances)
      .where(eq(schema.workflowInstances.id, reviewedDelayRequest.workflowInstanceId))
      .limit(1);

    if (!workflowInstance) {
      throw new Error('workflow_instance_not_found');
    }

    const existingRuntimes = await args.db
      .select()
      .from(schema.workflowStageRuntimes)
      .where(eq(schema.workflowStageRuntimes.workflowInstanceId, workflowInstance.id))
      .orderBy(asc(schema.workflowStageRuntimes.createdAt));

    const targetRuntime = existingRuntimes.find(
      (runtime) => runtime.workflowStageId === reviewedDelayRequest.workflowStageId,
    );

    if (!targetRuntime) {
      throw new Error('workflow_stage_runtime_not_found');
    }

    const now = reviewedDelayRequest.reviewedAt ?? new Date();
    const runtimeSeeds = existingRuntimes.map((runtime) =>
      runtime.id === targetRuntime.id
        ? {
            ...runtime,
            targetCompleteAt: reviewedDelayRequest.requestedTargetAt,
            scheduleSource: 'manual_delay_request',
            manualOverrideAt: now,
            manualOverrideReason: reviewedDelayRequest.reason,
            updatedAt: now,
          }
        : runtime,
    );

    await syncCaseWorkflowStageRuntimeRows({
      db: args.db,
      tenantId: args.tenantId,
      caseId: args.caseId,
      runtimeSeedsByInstanceId: new Map([[workflowInstance.id, runtimeSeeds]]),
      calculatedAt: now,
    });

    await syncProjectedCaseDates({
      db: args.db,
      tenantId: args.tenantId,
      caseId: args.caseId,
      caseType: caseRecord.caseType as 'sales' | 'lettings',
    });
  }

  return reviewedDelayRequest;
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
      ownerMembershipId: schema.cases.ownerMembershipId,
      caseType: schema.cases.caseType,
      status: schema.cases.status,
      closedReason: schema.cases.closedReason,
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
      ownerDisplayName: schema.users.displayName,
      ownerEmail: schema.users.email,
    })
    .from(schema.cases)
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .leftJoin(schema.memberships, eq(schema.memberships.id, schema.cases.ownerMembershipId))
    .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
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
      ownerMembershipId: schema.cases.ownerMembershipId,
      caseType: schema.cases.caseType,
      status: schema.cases.status,
      closedReason: schema.cases.closedReason,
      reference: schema.cases.reference,
      title: schema.cases.title,
      description: schema.cases.description,
      openedAt: schema.cases.openedAt,
      closedAt: schema.cases.closedAt,
      createdAt: schema.cases.createdAt,
      updatedAt: schema.cases.updatedAt,
      propertyDisplayAddress: schema.properties.displayAddress,
      ownerDisplayName: schema.users.displayName,
    })
    .from(schema.cases)
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .leftJoin(schema.memberships, eq(schema.memberships.id, schema.cases.ownerMembershipId))
    .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.cases.tenantId, args.tenantId),
        args.caseType ? eq(schema.cases.caseType, args.caseType) : undefined,
        args.status ? eq(schema.cases.status, args.status) : undefined,
        args.branchId ? eq(schema.cases.branchId, args.branchId) : undefined,
      ),
    )
    .orderBy(desc(schema.cases.updatedAt), desc(schema.cases.createdAt));

  const workflowsByCaseId = await loadWorkflowSummariesForCaseIds({
    db: args.db,
    tenantId: args.tenantId,
    caseIds: caseRows.map((caseRow) => caseRow.id),
  });

  return caseRows.map((caseRow) => {
    const workflows = workflowsByCaseId.get(caseRow.id) ?? [];
    const primaryWorkflow = pickPrimaryWorkflow({
      caseType: caseRow.caseType as 'sales' | 'lettings',
      workflows: workflows as Array<{ track: string; templateSide?: string | null }>,
    }) as Record<string, unknown> | null;

    return {
      ...caseRow,
      workflowInstanceId: (primaryWorkflow?.id as string | undefined) ?? null,
      workflowStatus: (primaryWorkflow?.status as string | undefined) ?? null,
      workflowTemplateId: (primaryWorkflow?.workflowTemplateId as string | undefined) ?? null,
      currentStageKey: (primaryWorkflow?.currentStageKey as string | undefined) ?? null,
      currentStageName: (primaryWorkflow?.currentStageName as string | undefined) ?? null,
      workflows,
    };
  });
}

export async function loadCaseDetail(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const requestedByUser = alias(schema.users, 'requested_by');
  const reviewedByUser = alias(schema.users, 'reviewed_by');

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

  const workflowsByCaseId = await loadWorkflowSummariesForCaseIds({
    db: args.db,
    tenantId: args.tenantId,
    caseIds: [args.caseId],
  });
  const workflows = workflowsByCaseId.get(args.caseId) ?? [];
  const workflowInstance =
    pickPrimaryWorkflow({
      caseType: caseRecord.caseType as 'sales' | 'lettings',
      workflows: workflows as Array<{ track: string; templateSide?: string | null }>,
    }) as Record<string, unknown> | null;

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

  const workflowDelayRequests = await args.db
    .select({
      id: schema.workflowDelayRequests.id,
      workflowInstanceId: schema.workflowDelayRequests.workflowInstanceId,
      workflowStageId: schema.workflowDelayRequests.workflowStageId,
      workflowStageKey: schema.workflowStages.key,
      workflowStageName: schema.workflowStages.name,
      workflowTrack: schema.workflowDelayRequests.workflowTrack,
      dateField: schema.workflowDelayRequests.dateField,
      status: schema.workflowDelayRequests.status,
      reason: schema.workflowDelayRequests.reason,
      reviewNote: schema.workflowDelayRequests.reviewNote,
      oldTargetAt: schema.workflowDelayRequests.oldTargetAt,
      requestedTargetAt: schema.workflowDelayRequests.requestedTargetAt,
      requestedByUserId: schema.workflowDelayRequests.requestedByUserId,
      reviewedByUserId: schema.workflowDelayRequests.reviewedByUserId,
      reviewedAt: schema.workflowDelayRequests.reviewedAt,
      createdAt: schema.workflowDelayRequests.createdAt,
      requestedByDisplayName: requestedByUser.displayName,
      reviewedByDisplayName: reviewedByUser.displayName,
    })
    .from(schema.workflowDelayRequests)
    .leftJoin(
      schema.workflowStages,
      eq(schema.workflowStages.id, schema.workflowDelayRequests.workflowStageId),
    )
    .leftJoin(requestedByUser, eq(requestedByUser.id, schema.workflowDelayRequests.requestedByUserId))
    .leftJoin(reviewedByUser, eq(reviewedByUser.id, schema.workflowDelayRequests.reviewedByUserId))
    .where(
      and(
        eq(schema.workflowDelayRequests.tenantId, args.tenantId),
        eq(schema.workflowDelayRequests.caseId, args.caseId),
      ),
    )
    .orderBy(desc(schema.workflowDelayRequests.createdAt), desc(schema.workflowDelayRequests.updatedAt));

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
    ...workflowDelayRequests.map((delayRequest) => ({
      source: 'workflow_delay_request',
      id: delayRequest.id,
      title: `delay_request.${delayRequest.status}`,
      body:
        delayRequest.status === 'pending'
          ? `${delayRequest.workflowTrack} requested a delay for ${delayRequest.workflowStageName ?? 'current milestone'} to ${delayRequest.requestedTargetAt.toISOString()}`
          : `${delayRequest.workflowTrack} ${delayRequest.status} a delay for ${delayRequest.workflowStageName ?? 'current milestone'} to ${delayRequest.requestedTargetAt.toISOString()}`,
      occurredAt: delayRequest.reviewedAt ?? delayRequest.createdAt,
      actor:
        delayRequest.status === 'pending'
          ? delayRequest.requestedByDisplayName ?? null
          : delayRequest.reviewedByDisplayName ?? delayRequest.requestedByDisplayName ?? null,
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
      title: `${dispatch.channel}.${dispatch.status}`,
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
    delayRequests: workflowDelayRequests,
    workflow: workflowInstance
      ? {
          ...workflowInstance,
        }
      : null,
    workflows,
    timelineEntries,
  };
}
