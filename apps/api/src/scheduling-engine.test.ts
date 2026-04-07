import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateWorkflowStageRuntimes,
  type ComputedWorkflowStageRuntime,
} from './scheduling-engine';
import { buildImportedWorkflowTemplates } from './workflow-import';

function createStage(args: {
  id: string;
  key: string;
  name: string;
  stageOrder: number;
  isTerminal?: boolean;
  configJson?: Record<string, unknown>;
}) {
  const now = new Date('2026-03-26T09:00:00.000Z');
  return {
    id: args.id,
    workflowTemplateId: 'template-1',
    legacyStageId: args.id,
    key: args.key,
    name: args.name,
    stageOrder: args.stageOrder,
    isTerminal: args.isTerminal ?? false,
    configJson: args.configJson ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

function createEdge(args: {
  id: string;
  fromWorkflowStageId?: string | null;
  toWorkflowStageId: string;
  edgeType: string;
  triggerOn?: string | null;
  metadataJson?: Record<string, unknown>;
}) {
  const now = new Date('2026-03-26T09:00:00.000Z');
  return {
    id: args.id,
    workflowTemplateId: 'template-1',
    fromWorkflowStageId: args.fromWorkflowStageId ?? null,
    toWorkflowStageId: args.toWorkflowStageId,
    edgeType: args.edgeType,
    triggerOn: args.triggerOn ?? null,
    metadataJson: args.metadataJson ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function createRuntime(args: {
  workflowStageId: string;
  status: string;
  isCurrent?: boolean;
  actualStartedAt?: Date | null;
  actualCompletedAt?: Date | null;
}) {
  const now = new Date('2026-03-26T09:00:00.000Z');
  return {
    id: `runtime-${args.workflowStageId}`,
    tenantId: 'tenant-1',
    workflowInstanceId: 'instance-1',
    workflowStageId: args.workflowStageId,
    status: args.status,
    dependencyState: 'ready',
    isCurrent: args.isCurrent ?? false,
    estimatedStartAt: null,
    estimatedCompleteAt: null,
    targetStartAt: null,
    targetCompleteAt: null,
    actualStartedAt: args.actualStartedAt ?? null,
    actualCompletedAt: args.actualCompletedAt ?? null,
    scheduleSource: 'calculated',
    lastRecalculatedAt: now,
    manualOverrideAt: null,
    manualOverrideReason: null,
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
  };
}

function byStageId(
  runtimes: ComputedWorkflowStageRuntime[],
  workflowStageId: string,
) {
  const runtime = runtimes.find((item) => item.workflowStageId === workflowStageId);
  if (!runtime) {
    throw new Error(`runtime_not_found:${workflowStageId}`);
  }

  return runtime;
}

describe('scheduling engine', () => {
  it('calculates linear milestone estimates from estAfter and estDays', () => {
    const workflowStartedAt = new Date('2026-04-01T09:00:00.000Z');
    const stages = [
      createStage({
        id: 'start',
        key: 'start',
        name: 'Start',
        stageOrder: 0,
        configJson: { legacyStageId: 'start' },
      }),
      createStage({
        id: 'contract',
        key: 'contract',
        name: 'Draft Contract',
        stageOrder: 1,
        configJson: { legacyStageId: 'contract', estAfter: 'start', estType: 'complete', estDays: 3 },
      }),
      createStage({
        id: 'completion',
        key: 'completion',
        name: 'Completion',
        stageOrder: 2,
        isTerminal: true,
        configJson: {
          legacyStageId: 'completion',
          estAfter: 'contract',
          estType: 'complete',
          estDays: 2,
        },
      }),
    ];

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt,
      currentWorkflowStageId: 'start',
      stages,
      edges: [],
      calculatedAt: workflowStartedAt,
    });

    expect(byStageId(runtimes, 'start')).toMatchObject({
      status: 'active',
      isCurrent: true,
      dependencyState: 'ready',
    });
    expect(byStageId(runtimes, 'contract').estimatedStartAt?.toISOString()).toBe(
      '2026-04-01T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'contract').estimatedCompleteAt?.toISOString()).toBe(
      '2026-04-04T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'completion').estimatedCompleteAt?.toISOString()).toBe(
      '2026-04-06T09:00:00.000Z',
    );
  });

  it('ripples downstream estimates from actual upstream completion dates', () => {
    const workflowStartedAt = new Date('2026-04-01T09:00:00.000Z');
    const stages = [
      createStage({
        id: 'start',
        key: 'start',
        name: 'Start',
        stageOrder: 0,
        configJson: { legacyStageId: 'start' },
      }),
      createStage({
        id: 'survey',
        key: 'survey',
        name: 'Survey Arranged',
        stageOrder: 1,
        configJson: { legacyStageId: 'survey', estAfter: 'start', estType: 'complete', estDays: 7 },
      }),
      createStage({
        id: 'offer',
        key: 'offer',
        name: 'Mortgage Offer',
        stageOrder: 2,
        configJson: { legacyStageId: 'offer', estAfter: 'survey', estType: 'complete', estDays: 5 },
      }),
    ];

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt,
      currentWorkflowStageId: 'survey',
      stages,
      edges: [],
      existingRuntimes: [
        createRuntime({
          workflowStageId: 'start',
          status: 'completed',
          actualStartedAt: workflowStartedAt,
          actualCompletedAt: new Date('2026-04-03T10:00:00.000Z'),
        }),
      ],
      calculatedAt: new Date('2026-04-03T10:00:00.000Z'),
    });

    expect(byStageId(runtimes, 'survey').estimatedStartAt?.toISOString()).toBe(
      '2026-04-03T10:00:00.000Z',
    );
    expect(byStageId(runtimes, 'survey').estimatedCompleteAt?.toISOString()).toBe(
      '2026-04-10T10:00:00.000Z',
    );
    expect(byStageId(runtimes, 'offer').estimatedCompleteAt?.toISOString()).toBe(
      '2026-04-15T10:00:00.000Z',
    );
  });

  it('ripples downstream target dates from a manual milestone override', () => {
    const workflowStartedAt = new Date('2026-04-01T09:00:00.000Z');
    const stages = [
      createStage({
        id: 'instruction',
        key: 'instruction',
        name: 'Instruction',
        stageOrder: 0,
        configJson: { legacyStageId: 'instruction', estDays: 2 },
      }),
      createStage({
        id: 'conveyancing',
        key: 'conveyancing',
        name: 'Conveyancing',
        stageOrder: 1,
        configJson: {
          legacyStageId: 'conveyancing',
          estAfter: 'instruction',
          estType: 'complete',
          estDays: 3,
        },
      }),
      createStage({
        id: 'completion',
        key: 'completion',
        name: 'Completion',
        stageOrder: 2,
        configJson: {
          legacyStageId: 'completion',
          estAfter: 'conveyancing',
          estType: 'complete',
          estDays: 4,
        },
      }),
    ];

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt,
      currentWorkflowStageId: 'instruction',
      stages,
      edges: [],
      existingRuntimes: [
        {
          ...createRuntime({
            workflowStageId: 'instruction',
            status: 'active',
            isCurrent: true,
            actualStartedAt: workflowStartedAt,
          }),
          targetCompleteAt: new Date('2026-04-10T09:00:00.000Z'),
          scheduleSource: 'manual_delay_request',
          manualOverrideAt: new Date('2026-04-02T09:00:00.000Z'),
          manualOverrideReason: 'Buyer requested a one week delay.',
        },
      ],
      calculatedAt: new Date('2026-04-02T09:00:00.000Z'),
    });

    expect(byStageId(runtimes, 'instruction').targetCompleteAt?.toISOString()).toBe(
      '2026-04-10T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'conveyancing').targetCompleteAt?.toISOString()).toBe(
      '2026-04-13T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'completion').targetCompleteAt?.toISOString()).toBe(
      '2026-04-17T09:00:00.000Z',
    );
  });

  it('uses imported legacy workflow graphs to calculate parallel milestone dates', () => {
    const salesJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'sources/data/workflow-sales.json'), 'utf8'),
    );
    const [buyerWorkflow] = buildImportedWorkflowTemplates({
      caseType: 'sales',
      workflows: salesJson,
    });

    if (!buyerWorkflow) {
      throw new Error('buyer_workflow_not_imported');
    }

    const now = new Date('2026-04-01T09:00:00.000Z');
    const stages = buyerWorkflow.stages.map((stage) => ({
      id: stage.key,
      workflowTemplateId: 'template-1',
      legacyStageId: stage.legacyStageId,
      key: stage.key,
      name: stage.name,
      stageOrder: stage.stageOrder,
      isTerminal: stage.isTerminal,
      configJson: stage.config,
      createdAt: now,
      updatedAt: now,
    }));
    const edges = buyerWorkflow.edges.map((edge, index) =>
      createEdge({
        id: `edge-${index}`,
        fromWorkflowStageId: edge.fromStageKey ?? null,
        toWorkflowStageId: edge.toStageKey,
        edgeType: edge.edgeType,
        triggerOn: edge.triggerOn ?? null,
        metadataJson: edge.metadata ?? {},
      }),
    );

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt: now,
      currentWorkflowStageId: 'p1gunxk4',
      stages,
      edges,
      existingRuntimes: [
        createRuntime({
          workflowStageId: '8forob3s',
          status: 'completed',
          actualStartedAt: now,
          actualCompletedAt: now,
        }),
      ],
      calculatedAt: now,
    });

    expect(byStageId(runtimes, 'vt26ftq2').estimatedCompleteAt?.toISOString()).toBe(
      '2026-04-02T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'p1gunxk4').estimatedCompleteAt?.toISOString()).toBe(
      '2026-04-17T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'p1gunxk4')).toMatchObject({
      status: 'active',
      isCurrent: true,
    });
  });

  it('falls back to the local previous milestone when estAfter points outside the current workflow', () => {
    const workflowStartedAt = new Date('2026-04-01T09:00:00.000Z');
    const stages = [
      createStage({
        id: 'seller-start',
        key: 'seller-start',
        name: 'Seller Start',
        stageOrder: 0,
        configJson: { legacyStageId: 'seller-start' },
      }),
      createStage({
        id: 'seller-report',
        key: 'seller-report',
        name: 'Seller Report To Client',
        stageOrder: 1,
        configJson: {
          legacyStageId: 'seller-report',
          estAfter: 'buyer-enquiries',
          estType: 'complete',
          estDays: 3,
        },
      }),
    ];

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt,
      currentWorkflowStageId: 'seller-start',
      stages,
      edges: [],
      calculatedAt: workflowStartedAt,
    });

    expect(byStageId(runtimes, 'seller-report').targetCompleteAt?.toISOString()).toBe(
      '2026-04-04T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'seller-report').dependencyState).toBe('ready');
  });

  it('projects trigger-on-start edges from predecessor completion for downstream scheduling', () => {
    const workflowStartedAt = new Date('2026-04-01T09:00:00.000Z');
    const stages = [
      createStage({
        id: 'start',
        key: 'start',
        name: 'Start',
        stageOrder: 0,
        configJson: { legacyStageId: 'start' },
      }),
      createStage({
        id: 'upstream',
        key: 'upstream',
        name: 'Upstream milestone',
        stageOrder: 1,
        configJson: {
          legacyStageId: 'upstream',
          estAfter: 'start',
          estType: 'complete',
          estDays: 5,
        },
      }),
      createStage({
        id: 'downstream',
        key: 'downstream',
        name: 'Downstream milestone',
        stageOrder: 2,
        configJson: {
          legacyStageId: 'downstream',
          estDays: 2,
        },
      }),
    ];
    const edges = [
      createEdge({
        id: 'edge-upstream-trigger',
        fromWorkflowStageId: 'upstream',
        toWorkflowStageId: 'downstream',
        edgeType: 'action_trigger',
        triggerOn: 'start',
      }),
    ];

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt,
      currentWorkflowStageId: 'start',
      stages,
      edges,
      calculatedAt: workflowStartedAt,
    });

    expect(byStageId(runtimes, 'upstream').targetCompleteAt?.toISOString()).toBe(
      '2026-04-06T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'downstream').targetCompleteAt?.toISOString()).toBe(
      '2026-04-08T09:00:00.000Z',
    );
  });

  it('uses the longest triggered branch when a downstream milestone depends on multiple paths', () => {
    const workflowStartedAt = new Date('2026-04-01T09:00:00.000Z');
    const stages = [
      createStage({
        id: 'start',
        key: 'start',
        name: 'Start',
        stageOrder: 0,
        configJson: { legacyStageId: 'start' },
      }),
      createStage({
        id: 'fast-branch',
        key: 'fast-branch',
        name: 'Fast branch',
        stageOrder: 1,
        configJson: {
          legacyStageId: 'fast-branch',
          estAfter: 'start',
          estType: 'complete',
          estDays: 2,
        },
      }),
      createStage({
        id: 'slow-branch',
        key: 'slow-branch',
        name: 'Slow branch',
        stageOrder: 2,
        configJson: {
          legacyStageId: 'slow-branch',
          estAfter: 'start',
          estType: 'complete',
          estDays: 9,
        },
      }),
      createStage({
        id: 'after-merge',
        key: 'after-merge',
        name: 'After merge',
        stageOrder: 3,
        configJson: {
          legacyStageId: 'after-merge',
          estDays: 4,
        },
      }),
    ];
    const edges = [
      createEdge({
        id: 'edge-fast',
        fromWorkflowStageId: 'fast-branch',
        toWorkflowStageId: 'after-merge',
        edgeType: 'action_trigger',
        triggerOn: 'complete',
      }),
      createEdge({
        id: 'edge-slow',
        fromWorkflowStageId: 'slow-branch',
        toWorkflowStageId: 'after-merge',
        edgeType: 'action_trigger',
        triggerOn: 'complete',
      }),
    ];

    const runtimes = calculateWorkflowStageRuntimes({
      workflowStartedAt,
      currentWorkflowStageId: 'start',
      stages,
      edges,
      calculatedAt: workflowStartedAt,
    });

    expect(byStageId(runtimes, 'fast-branch').targetCompleteAt?.toISOString()).toBe(
      '2026-04-03T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'slow-branch').targetCompleteAt?.toISOString()).toBe(
      '2026-04-10T09:00:00.000Z',
    );
    expect(byStageId(runtimes, 'after-merge').targetCompleteAt?.toISOString()).toBe(
      '2026-04-14T09:00:00.000Z',
    );
  });
});
