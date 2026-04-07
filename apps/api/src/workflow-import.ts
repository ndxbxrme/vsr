type LegacyWorkflowAction = {
  _id?: string;
  on?: string;
  type?: string;
  name?: string;
  template?: string;
  milestone?: string;
  to?: unknown;
  specificUser?: string;
  [key: string]: unknown;
};

type LegacyWorkflowMilestone = {
  _id: string;
  title: string;
  actions?: LegacyWorkflowAction[];
  notes?: unknown[];
  todos?: unknown[];
  estDays?: number;
  estAfter?: string;
  estType?: string;
  icon?: string;
  progressing?: boolean;
  [key: string]: unknown;
};

type LegacyWorkflowDefinition = {
  name: string;
  side?: string;
  milestones: LegacyWorkflowMilestone[][];
  [key: string]: unknown;
};

type ImportedWorkflowTemplate = {
  key: string;
  name: string;
  side: string | null;
  caseType: 'sales' | 'lettings';
  status: string;
  isSystem: boolean;
  definition: Record<string, unknown>;
  stages: Array<{
    legacyStageId: string;
    key: string;
    name: string;
    stageOrder: number;
    isTerminal: boolean;
    config: Record<string, unknown>;
  }>;
  edges: Array<{
    fromStageKey?: string | null;
    toStageKey: string;
    edgeType: string;
    triggerOn?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  actions: Array<{
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
};

function slugifyWorkflowKey(input: string) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function dedupeEdges(
  edges: ImportedWorkflowTemplate['edges'],
): ImportedWorkflowTemplate['edges'] {
  const seen = new Set<string>();
  const deduped: ImportedWorkflowTemplate['edges'] = [];

  for (const edge of edges) {
    const key = [
      edge.fromStageKey ?? 'start',
      edge.toStageKey,
      edge.edgeType,
      edge.triggerOn ?? '',
    ].join(':');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(edge);
  }

  return deduped;
}

export function buildImportedWorkflowTemplates(args: {
  caseType: 'sales' | 'lettings';
  workflows: LegacyWorkflowDefinition[];
}) {
  return args.workflows.map<ImportedWorkflowTemplate>((workflow) => {
    const flattenedStages = workflow.milestones.flatMap((column, columnIndex) =>
      column.map((milestone, laneIndex) => ({
        milestone,
        columnIndex,
        laneIndex,
      })),
    );

    const edges: ImportedWorkflowTemplate['edges'] = [];
    const actions: ImportedWorkflowTemplate['actions'] = [];

    for (const { milestone } of flattenedStages) {
      if (milestone.estAfter) {
        edges.push({
          fromStageKey: milestone.estAfter,
          toStageKey: milestone._id,
          edgeType: 'estimated_after',
          triggerOn: milestone.estType ?? 'complete',
          metadata: {
            estDays: milestone.estDays ?? null,
            estType: milestone.estType ?? null,
          },
        });
      }

      for (const [actionOrder, action] of (milestone.actions ?? []).entries()) {
        actions.push({
          stageKey: milestone._id,
          legacyActionId: action._id ?? null,
          actionOrder,
          triggerOn: action.on ?? 'Complete',
          actionType: action.type ?? 'Unknown',
          name: action.name ?? null,
          templateReference: typeof action.template === 'string' ? action.template : null,
          targetLegacyStageId: typeof action.milestone === 'string' ? action.milestone : null,
          targetStageKey: typeof action.milestone === 'string' ? action.milestone : null,
          recipientGroups: action.to ?? null,
          specificUserReference:
            typeof action.specificUser === 'string' ? action.specificUser : null,
          metadata: action,
        });

        if (action.type === 'Trigger' && typeof action.milestone === 'string') {
          edges.push({
            fromStageKey: milestone._id,
            toStageKey: action.milestone,
            edgeType: 'action_trigger',
            triggerOn: action.on ?? 'Complete',
            metadata: {
              legacyActionId: action._id ?? null,
              actionName: action.name ?? null,
            },
          });
        }
      }
    }

    const dedupedEdges = dedupeEdges(edges);
    const nonTerminalStageKeys = new Set(
      dedupedEdges
        .map((edge) => edge.fromStageKey)
        .filter((stageKey): stageKey is string => Boolean(stageKey)),
    );

    const stages = flattenedStages.map(({ milestone, columnIndex, laneIndex }, stageOrder) => ({
      legacyStageId: milestone._id,
      key: milestone._id,
      name: milestone.title,
      stageOrder,
      isTerminal: !nonTerminalStageKeys.has(milestone._id),
      config: {
        columnIndex,
        laneIndex,
        icon: milestone.icon ?? null,
        notes: milestone.notes ?? [],
        todos: milestone.todos ?? [],
        estDays: milestone.estDays ?? null,
        estAfter: milestone.estAfter ?? null,
        estType: milestone.estType ?? null,
        progressing: milestone.progressing ?? false,
        legacyStageId: milestone._id,
      },
    }));

    return {
      key: slugifyWorkflowKey(`${args.caseType}-${workflow.side ?? 'workflow'}-${workflow.name}`),
      name: workflow.name,
      side: workflow.side ?? null,
      caseType: args.caseType,
      status: 'active',
      isSystem: false,
      definition: {
        importSource: 'legacy_json',
        legacyWorkflow: workflow,
      },
      stages,
      edges: dedupedEdges,
      actions,
    };
  });
}
