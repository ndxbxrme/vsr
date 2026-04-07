import type { schema } from '@vitalspace/db';

type WorkflowStageRecord = typeof schema.workflowStages.$inferSelect;
type WorkflowStageEdgeRecord = typeof schema.workflowStageEdges.$inferSelect;
type WorkflowStageRuntimeRecord = typeof schema.workflowStageRuntimes.$inferSelect;

function addCalendarDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type SchedulingAnchorType = 'start' | 'complete';

type StageScheduleRule = {
  anchorStageId?: string | null;
  anchorType: SchedulingAnchorType;
  offsetDays: number;
};

export type ComputedWorkflowStageRuntime = {
  workflowStageId: string;
  status: 'not_started' | 'active' | 'completed' | 'skipped' | 'blocked';
  dependencyState: 'pending' | 'ready' | 'satisfied';
  isCurrent: boolean;
  estimatedStartAt: Date | null;
  estimatedCompleteAt: Date | null;
  targetStartAt: Date | null;
  targetCompleteAt: Date | null;
  actualStartedAt: Date | null;
  actualCompletedAt: Date | null;
  scheduleSource: string;
  lastRecalculatedAt: Date;
  manualOverrideAt: Date | null;
  manualOverrideReason: string | null;
  metadataJson: Record<string, unknown> | null;
};

type RuntimeAnchor = Pick<
  ComputedWorkflowStageRuntime,
  | 'status'
  | 'actualStartedAt'
  | 'actualCompletedAt'
  | 'estimatedStartAt'
  | 'estimatedCompleteAt'
  | 'targetStartAt'
  | 'targetCompleteAt'
>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeAnchorType(value: unknown): SchedulingAnchorType {
  return value === 'start' ? 'start' : 'complete';
}

function normalizeProjectedTriggerAnchorType(): SchedulingAnchorType {
  // For forward scheduling, treat trigger edges as sequential handoffs even when
  // the legacy action was configured as "on start". This keeps projections
  // conservative and lets downstream milestones ripple from the current node
  // through to the end of the workflow.
  return 'complete';
}

function resolveStageRule(args: {
  stage: WorkflowStageRecord;
  previousStage?: WorkflowStageRecord | null;
  edges: WorkflowStageEdgeRecord[];
  stagesByLegacyId: Map<string, WorkflowStageRecord>;
}) {
  const config = asRecord(args.stage.configJson);
  const estAfter = asNullableString(config.estAfter);
  const estType = normalizeAnchorType(config.estType);
  const estDays = asNullableNumber(config.estDays) ?? 0;

  if (estAfter) {
    const anchorStage = args.stagesByLegacyId.get(estAfter) ?? null;
    if (anchorStage) {
      return {
        anchorStageId: anchorStage.id,
        anchorType: estType,
        offsetDays: estDays,
      } satisfies StageScheduleRule;
    }

    // Ignore cross-track or otherwise unresolved legacy anchors. Within a single
    // workflow track, fall back to the immediately preceding milestone so the
    // schedule still flows through the local chain.
    if (args.previousStage) {
      return {
        anchorStageId: args.previousStage.id,
        anchorType: 'complete',
        offsetDays: estDays,
      } satisfies StageScheduleRule;
    }
  }

  const estimatedAfterEdge =
    args.edges.find((edge) => edge.toWorkflowStageId === args.stage.id && edge.edgeType === 'estimated_after') ??
    null;

  if (estimatedAfterEdge) {
    const edgeMetadata = asRecord(estimatedAfterEdge.metadataJson);
    return {
      anchorStageId: estimatedAfterEdge.fromWorkflowStageId ?? null,
      anchorType: normalizeAnchorType(estimatedAfterEdge.triggerOn),
      offsetDays: asNullableNumber(edgeMetadata.estDays) ?? estDays,
    } satisfies StageScheduleRule;
  }

  return {
    anchorStageId: null,
    anchorType: 'start',
    offsetDays: estDays,
  } satisfies StageScheduleRule;
}

function resolveAnchoredDate(args: {
  anchorType: SchedulingAnchorType;
  workflowStartedAt: Date;
  anchorRuntime?: RuntimeAnchor | null;
  hasExplicitAnchor?: boolean;
}) {
  if (args.hasExplicitAnchor && !args.anchorRuntime) {
    return null;
  }

  if (!args.anchorRuntime) {
    return args.workflowStartedAt;
  }

  if (args.anchorType === 'start') {
    return (
      args.anchorRuntime.actualStartedAt ??
      args.anchorRuntime.targetStartAt ??
      args.anchorRuntime.estimatedStartAt ??
      args.workflowStartedAt
    );
  }

  return (
    args.anchorRuntime.actualCompletedAt ??
    args.anchorRuntime.targetCompleteAt ??
    args.anchorRuntime.estimatedCompleteAt ??
    args.anchorRuntime.actualStartedAt ??
    args.anchorRuntime.targetStartAt ??
    args.anchorRuntime.estimatedStartAt ??
    args.workflowStartedAt
  );
}

function mergeRuntimeStatus(args: {
  stageId: string;
  currentWorkflowStageId?: string | null;
  existingRuntime?: WorkflowStageRuntimeRecord | null;
}) {
  if (args.existingRuntime) {
    return {
      status: args.existingRuntime.status as ComputedWorkflowStageRuntime['status'],
      isCurrent: args.existingRuntime.isCurrent,
      actualStartedAt: args.existingRuntime.actualStartedAt ?? null,
      actualCompletedAt: args.existingRuntime.actualCompletedAt ?? null,
      scheduleSource: args.existingRuntime.scheduleSource,
      manualOverrideAt: args.existingRuntime.manualOverrideAt ?? null,
      manualOverrideReason: args.existingRuntime.manualOverrideReason ?? null,
      metadataJson: asRecord(args.existingRuntime.metadataJson),
    };
  }

  const isCurrent = args.currentWorkflowStageId === args.stageId;
  return {
    status: isCurrent ? 'active' : 'not_started',
    isCurrent,
    actualStartedAt: null,
    actualCompletedAt: null,
    scheduleSource: 'calculated',
    manualOverrideAt: null,
    manualOverrideReason: null,
    metadataJson: null,
  } satisfies Pick<
    ComputedWorkflowStageRuntime,
    | 'status'
    | 'isCurrent'
    | 'actualStartedAt'
    | 'actualCompletedAt'
    | 'scheduleSource'
    | 'manualOverrideAt'
    | 'manualOverrideReason'
    | 'metadataJson'
  >;
}

function hasManualTargetOverride(runtime: WorkflowStageRuntimeRecord | null | undefined) {
  return Boolean(
    runtime &&
      (runtime.manualOverrideAt !== null || runtime.scheduleSource === 'manual_delay_request'),
  );
}

export function calculateWorkflowStageRuntimes(args: {
  workflowStartedAt: Date;
  currentWorkflowStageId?: string | null;
  stages: WorkflowStageRecord[];
  edges: WorkflowStageEdgeRecord[];
  existingRuntimes?: WorkflowStageRuntimeRecord[];
  calculatedAt?: Date;
}) {
  const calculatedAt = args.calculatedAt ?? new Date();
  const stagesInOrder = [...args.stages].sort((left, right) => left.stageOrder - right.stageOrder);
  const stagesByLegacyId = new Map(
    stagesInOrder.flatMap((stage) => {
      const config = asRecord(stage.configJson);
      const legacyStageId = asNullableString(config.legacyStageId);
      return legacyStageId ? [[legacyStageId, stage] as const] : [];
    }),
  );
  const existingRuntimeByStageId = new Map(
    (args.existingRuntimes ?? []).map((runtime) => [runtime.workflowStageId, runtime]),
  );

  const computedByStageId = new Map<string, ComputedWorkflowStageRuntime>();

  for (const [index, stage] of stagesInOrder.entries()) {
    const existingRuntime = existingRuntimeByStageId.get(stage.id) ?? null;
    const rule = resolveStageRule({
      stage,
      previousStage: stagesInOrder[index - 1] ?? null,
      edges: args.edges,
      stagesByLegacyId,
    });
    const anchorRuntime = rule.anchorStageId
      ? computedByStageId.get(rule.anchorStageId) ?? null
      : null;
    const triggerEdges = args.edges.filter(
      (edge) => edge.toWorkflowStageId === stage.id && edge.edgeType === 'action_trigger',
    );
    const triggerAnchors = triggerEdges.map((edge) => {
      const triggerAnchorRuntime = edge.fromWorkflowStageId
        ? computedByStageId.get(edge.fromWorkflowStageId) ?? null
        : null;
      const projectedTriggerAnchorType = normalizeProjectedTriggerAnchorType();
      return {
        anchorType: projectedTriggerAnchorType,
        anchorRuntime: triggerAnchorRuntime,
        anchorDate: resolveAnchoredDate({
          anchorType: projectedTriggerAnchorType,
          workflowStartedAt: args.workflowStartedAt,
          anchorRuntime: triggerAnchorRuntime,
          hasExplicitAnchor: true,
        }),
      };
    });
    const baseAnchorDate = resolveAnchoredDate({
      anchorType: rule.anchorType,
      workflowStartedAt: args.workflowStartedAt,
      anchorRuntime,
      hasExplicitAnchor: Boolean(rule.anchorStageId),
    });
    const estimatedStartAt = [baseAnchorDate, ...triggerAnchors.map((anchor) => anchor.anchorDate)]
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => left.getTime() - right.getTime())
      .at(-1) ?? null;
    const estimatedCompleteAt = estimatedStartAt
      ? addCalendarDays(estimatedStartAt, Math.max(rule.offsetDays, 0))
      : null;
    const statusSeed = mergeRuntimeStatus({
      stageId: stage.id,
      ...(args.currentWorkflowStageId !== undefined
        ? { currentWorkflowStageId: args.currentWorkflowStageId }
        : {}),
      ...(existingRuntime !== null ? { existingRuntime } : {}),
    });
    const targetStartAt = hasManualTargetOverride(existingRuntime)
      ? (existingRuntime?.targetStartAt ?? estimatedStartAt)
      : estimatedStartAt;
    const targetCompleteAt = hasManualTargetOverride(existingRuntime)
      ? (existingRuntime?.targetCompleteAt ?? estimatedCompleteAt)
      : estimatedCompleteAt;

    computedByStageId.set(stage.id, {
      workflowStageId: stage.id,
      status: statusSeed.status,
      dependencyState:
        (!rule.anchorStageId || baseAnchorDate !== null) &&
        triggerAnchors.every((anchor) => anchor.anchorDate !== null)
          ? 'ready'
          : 'pending',
      isCurrent: statusSeed.isCurrent,
      estimatedStartAt,
      estimatedCompleteAt,
      targetStartAt,
      targetCompleteAt,
      actualStartedAt:
        statusSeed.actualStartedAt ??
        (statusSeed.isCurrent ? args.workflowStartedAt : null),
      actualCompletedAt: statusSeed.actualCompletedAt,
      scheduleSource: statusSeed.scheduleSource,
      lastRecalculatedAt: calculatedAt,
      manualOverrideAt: statusSeed.manualOverrideAt,
      manualOverrideReason: statusSeed.manualOverrideReason,
      metadataJson: statusSeed.metadataJson,
    });
  }

  for (const runtime of computedByStageId.values()) {
    if (runtime.status === 'completed') {
      runtime.dependencyState = 'satisfied';
      continue;
    }

    if (runtime.status === 'active' || runtime.isCurrent) {
      runtime.status = 'active';
      runtime.dependencyState = 'ready';
      continue;
    }

    if (runtime.dependencyState === 'pending') {
      runtime.status = 'blocked';
      continue;
    }

    runtime.status = 'not_started';
  }

  return stagesInOrder
    .map((stage) => computedByStageId.get(stage.id))
    .filter((runtime): runtime is ComputedWorkflowStageRuntime => Boolean(runtime));
}

export function mergeWorkflowStagesWithRuntime(args: {
  stages: WorkflowStageRecord[];
  runtimes: WorkflowStageRuntimeRecord[];
}) {
  const runtimeByStageId = new Map(args.runtimes.map((runtime) => [runtime.workflowStageId, runtime]));

  return args.stages.map((stage) => {
    const runtime = runtimeByStageId.get(stage.id) ?? null;
    return {
      ...stage,
      runtimeStatus: runtime?.status ?? 'not_started',
      dependencyState: runtime?.dependencyState ?? 'pending',
      isCurrent: runtime?.isCurrent ?? false,
      estimatedStartAt: runtime?.estimatedStartAt ?? null,
      estimatedCompleteAt: runtime?.estimatedCompleteAt ?? null,
      targetStartAt: runtime?.targetStartAt ?? null,
      targetCompleteAt: runtime?.targetCompleteAt ?? null,
      actualStartedAt: runtime?.actualStartedAt ?? null,
      actualCompletedAt: runtime?.actualCompletedAt ?? null,
      scheduleSource: runtime?.scheduleSource ?? 'calculated',
    };
  });
}

export function buildProjectedCaseDates(args: {
  caseType: 'sales' | 'lettings';
  stages: Array<
    ReturnType<typeof mergeWorkflowStagesWithRuntime>[number]
  >;
}) {
  const normalizedStages = args.stages.map((stage) => ({
    name: stage.name.toLowerCase(),
    targetCompleteAt: stage.targetCompleteAt,
  }));

  if (args.caseType === 'sales') {
    const exchangeStage =
      normalizedStages.find((stage) => stage.name.includes('exchange')) ?? null;
    const completionStage =
      normalizedStages.find(
        (stage) => stage.name.includes('completion') || stage.name.includes('completed'),
      ) ?? null;

    return {
      targetExchangeAt: exchangeStage?.targetCompleteAt ?? null,
      targetCompletionAt: completionStage?.targetCompleteAt ?? null,
    };
  }

  const agreedLetStage =
    normalizedStages.find((stage) => stage.name.includes('agreed let')) ?? null;
  const moveInStage =
    normalizedStages.find(
      (stage) => stage.name.includes('move in') || stage.name.includes('move-in'),
    ) ?? null;

  return {
    agreedLetAt: agreedLetStage?.targetCompleteAt ?? null,
    moveInAt: moveInStage?.targetCompleteAt ?? null,
  };
}

export function transitionWorkflowStageRuntimes(args: {
  runtimes: WorkflowStageRuntimeRecord[];
  fromWorkflowStageId?: string | null;
  toWorkflowStageId?: string | null;
  activatedWorkflowStageIds?: string[];
  occurredAt: Date;
  terminalWorkflowStageIds?: string[];
}) {
  const primaryActiveStageId = args.toWorkflowStageId ?? null;
  const activatedStageIds = new Set(args.activatedWorkflowStageIds ?? []);
  const terminalStageIds = new Set(args.terminalWorkflowStageIds ?? []);

  return args.runtimes.map((runtime) => {
    if (runtime.workflowStageId === args.fromWorkflowStageId && runtime.status !== 'completed') {
      return {
        ...runtime,
        status: 'completed',
        isCurrent: false,
        actualStartedAt: runtime.actualStartedAt ?? args.occurredAt,
        actualCompletedAt: args.occurredAt,
      };
    }

    if (terminalStageIds.has(runtime.workflowStageId)) {
      return {
        ...runtime,
        status: 'completed',
        isCurrent: false,
        actualStartedAt: runtime.actualStartedAt ?? args.occurredAt,
        actualCompletedAt: args.occurredAt,
      };
    }

    if (activatedStageIds.has(runtime.workflowStageId)) {
      return {
        ...runtime,
        status: 'active',
        isCurrent: runtime.workflowStageId === primaryActiveStageId,
        actualStartedAt: runtime.actualStartedAt ?? args.occurredAt,
      };
    }

    if (runtime.isCurrent) {
      return {
        ...runtime,
        isCurrent: false,
      };
    }

    return runtime;
  });
}
