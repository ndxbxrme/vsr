<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  product: 'sales' | 'lettings';
}>();

type WorkflowTemplateRecord = {
  id: string;
  key: string;
  name: string;
  side: string | null;
  caseType: 'sales' | 'lettings' | null;
  versionNumber: number;
  status: string;
  isSystem: boolean;
  definitionJson: Record<string, unknown> | null;
  stages: Array<{
    id: string;
    key: string;
    legacyStageId: string | null;
    name: string;
    stageOrder: number;
    isTerminal: boolean;
    configJson: Record<string, unknown> | null;
  }>;
  edges: Array<{
    id: string;
    fromWorkflowStageId: string | null;
    toWorkflowStageId: string;
    edgeType: string;
    triggerOn: string | null;
    metadataJson: Record<string, unknown> | null;
  }>;
  actions: Array<{
    id: string;
    workflowStageId: string;
    legacyActionId: string | null;
    actionOrder: number;
    triggerOn: string;
    actionType: string;
    name: string | null;
    templateReference: string | null;
    targetLegacyStageId: string | null;
    targetWorkflowStageId: string | null;
    recipientGroupsJson: unknown;
    specificUserReference: string | null;
    metadataJson: Record<string, unknown> | null;
  }>;
};

const storageKeys = {
  tenantId: 'vitalspace.workspace.tenantId',
  accessToken: 'vitalspace.workspace.accessToken',
};

const tenantId = ref(localStorage.getItem(storageKeys.tenantId) ?? '');
const accessToken = ref(localStorage.getItem(storageKeys.accessToken) ?? '');
const selectedTemplateId = ref('');

watch(tenantId, (value) => {
  localStorage.setItem(storageKeys.tenantId, value);
});

watch(accessToken, (value) => {
  localStorage.setItem(storageKeys.accessToken, value);
});

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1';

async function apiGet<T>(path: string): Promise<T> {
  const trimmedToken = accessToken.value.trim();
  const requestOptions: RequestInit = {};
  if (trimmedToken) {
    requestOptions.headers = {
      Authorization: `Bearer ${trimmedToken}`,
    };
  }

  const response = await fetch(`${apiBaseUrl}${path}`, requestOptions);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

const workflowTemplatesQuery = useQuery({
  queryKey: computed(() => ['workflow-library', props.product, tenantId.value.trim()]),
  enabled: computed(() => tenantId.value.trim().length > 0 && accessToken.value.trim().length > 0),
  queryFn: () =>
    apiGet<{ workflowTemplates: WorkflowTemplateRecord[] }>(
      `/workflow-templates?tenantId=${encodeURIComponent(tenantId.value.trim())}&caseType=${props.product}`,
    ),
});

const workflowTemplates = computed(() => workflowTemplatesQuery.data.value?.workflowTemplates ?? []);

watch(
  workflowTemplates,
  (templates) => {
    if (!templates.length) {
      selectedTemplateId.value = '';
      return;
    }

    if (!templates.some((template) => template.id === selectedTemplateId.value)) {
      selectedTemplateId.value = templates[0]?.id ?? '';
    }
  },
  { immediate: true },
);

const selectedTemplate = computed(
  () => workflowTemplates.value.find((template) => template.id === selectedTemplateId.value) ?? null,
);

const stageLookup = computed(() => {
  const entries = (selectedTemplate.value?.stages ?? []).map((stage) => [stage.id, stage] as const);
  return new Map(entries);
});

const sortedEdges = computed(() =>
  [...(selectedTemplate.value?.edges ?? [])].sort((left, right) => {
    const leftTo = stageLookup.value.get(left.toWorkflowStageId)?.stageOrder ?? 999;
    const rightTo = stageLookup.value.get(right.toWorkflowStageId)?.stageOrder ?? 999;
    return leftTo - rightTo;
  }),
);

const actionsByStageId = computed(() => {
  const grouped = new Map<string, WorkflowTemplateRecord['actions']>();
  for (const action of selectedTemplate.value?.actions ?? []) {
    const existing = grouped.get(action.workflowStageId) ?? [];
    existing.push(action);
    grouped.set(action.workflowStageId, existing);
  }

  for (const [stageId, actions] of grouped.entries()) {
    grouped.set(
      stageId,
      [...actions].sort((left, right) => left.actionOrder - right.actionOrder),
    );
  }

  return grouped;
});

function formatRecipientGroups(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${key}:${String(nestedValue)}`)
      .join(', ');
  }

  return 'None';
}

function formatEdgeLabel(edge: WorkflowTemplateRecord['edges'][number]) {
  const fromStage = edge.fromWorkflowStageId ? stageLookup.value.get(edge.fromWorkflowStageId) : null;
  const toStage = stageLookup.value.get(edge.toWorkflowStageId);
  return `${fromStage?.name ?? 'Start'} -> ${toStage?.name ?? 'Unknown stage'}`;
}

function summariseDefinition(definitionJson: Record<string, unknown> | null) {
  if (!definitionJson) {
    return 'No definition metadata';
  }

  const importSource =
    typeof definitionJson.importSource === 'string' ? definitionJson.importSource : null;
  const legacyWorkflow =
    definitionJson.legacyWorkflow && typeof definitionJson.legacyWorkflow === 'object'
      ? (definitionJson.legacyWorkflow as Record<string, unknown>)
      : null;
  const workflowName = typeof legacyWorkflow?.name === 'string' ? legacyWorkflow.name : null;

  if (importSource && workflowName) {
    return `${importSource} • ${workflowName}`;
  }

  if (importSource) {
    return importSource;
  }

  return 'Custom workflow definition';
}
</script>

<template>
  <main class="workflow-shell">
    <section class="hero-panel">
      <p class="eyebrow">Workflow Library</p>
      <h1>{{ props.product === 'sales' ? 'Sales' : 'Lettings' }} progression templates</h1>
      <p class="hero-copy">
        Inspect the active workflow versions attached to new cases, including imported legacy
        stages, edges, and action hooks.
      </p>
      <div class="hero-actions">
        <RouterLink class="primary-link" :to="`/workspace/${props.product}`">
          Open {{ props.product === 'sales' ? 'Sales' : 'Lettings' }} Workspace
        </RouterLink>
        <RouterLink
          class="ghost-button"
          :to="props.product === 'sales' ? '/workflows/lettings' : '/workflows/sales'"
        >
          Open {{ props.product === 'sales' ? 'Lettings' : 'Sales' }} Library
        </RouterLink>
        <RouterLink class="ghost-button" to="/">Back Home</RouterLink>
      </div>
    </section>

    <section class="control-panel workflow-auth-panel">
      <label>
        <span>Tenant ID</span>
        <input v-model="tenantId" type="text" placeholder="Tenant UUID" />
      </label>
      <label>
        <span>Access token</span>
        <textarea v-model="accessToken" rows="3" placeholder="Bearer token"></textarea>
      </label>
    </section>

    <section class="workflow-layout">
      <aside class="rail-panel workflow-list-panel">
        <div class="panel-header">
          <div>
            <h2>Active templates</h2>
            <p class="muted-copy">{{ workflowTemplates.length }} active versions for {{ props.product }}</p>
          </div>
        </div>
        <p v-if="workflowTemplatesQuery.isLoading.value" class="muted-copy">Loading workflows...</p>
        <p v-else-if="workflowTemplatesQuery.isError.value" class="error-copy">
          {{
            workflowTemplatesQuery.error.value instanceof Error
              ? workflowTemplatesQuery.error.value.message
              : 'Workflow templates failed to load.'
          }}
        </p>
        <div v-else class="workflow-list">
          <button
            v-for="template in workflowTemplates"
            :key="template.id"
            class="workflow-card"
            :class="{ selected: template.id === selectedTemplateId }"
            type="button"
            @click="selectedTemplateId = template.id"
          >
            <div class="workflow-card-header">
              <strong>{{ template.name }}</strong>
              <span class="history-status">v{{ template.versionNumber }}</span>
            </div>
            <p class="muted-copy">{{ template.key }}</p>
            <div class="workflow-chip-row">
              <span class="workflow-chip">{{ template.side ?? 'Shared' }}</span>
              <span class="workflow-chip">{{ template.stages.length }} stages</span>
              <span class="workflow-chip">{{ template.actions.length }} actions</span>
            </div>
          </button>
        </div>
      </aside>

      <section class="detail-panel workflow-detail-panel">
        <template v-if="selectedTemplate">
          <header class="panel-header">
            <div>
              <p class="eyebrow">Template detail</p>
              <h2>{{ selectedTemplate.name }}</h2>
              <p class="muted-copy">{{ summariseDefinition(selectedTemplate.definitionJson) }}</p>
            </div>
            <div class="workflow-chip-row">
              <span class="workflow-chip">v{{ selectedTemplate.versionNumber }}</span>
              <span class="workflow-chip">{{ selectedTemplate.side ?? 'Shared' }}</span>
              <span class="workflow-chip">{{ selectedTemplate.status }}</span>
            </div>
          </header>

          <div class="status-ribbon workflow-summary-ribbon">
            <article class="status-tile">
              <p class="eyebrow">Stages</p>
              <strong>{{ selectedTemplate.stages.length }}</strong>
            </article>
            <article class="status-tile">
              <p class="eyebrow">Edges</p>
              <strong>{{ selectedTemplate.edges.length }}</strong>
            </article>
            <article class="status-tile">
              <p class="eyebrow">Actions</p>
              <strong>{{ selectedTemplate.actions.length }}</strong>
            </article>
            <article class="status-tile">
              <p class="eyebrow">Source</p>
              <strong>{{ selectedTemplate.isSystem ? 'System' : 'Tenant' }}</strong>
            </article>
          </div>

          <div class="workflow-sections">
            <section class="info-card workflow-section">
              <div class="panel-header">
                <h3>Stages</h3>
              </div>
              <ol class="workflow-stage-list">
                <li v-for="stage in selectedTemplate.stages" :key="stage.id" class="workflow-stage-row">
                  <div>
                    <strong>{{ stage.stageOrder + 1 }}. {{ stage.name }}</strong>
                    <p class="muted-copy">{{ stage.key }}</p>
                  </div>
                  <div class="workflow-chip-row">
                    <span v-if="stage.legacyStageId" class="workflow-chip">
                      legacy {{ stage.legacyStageId }}
                    </span>
                    <span v-if="stage.isTerminal" class="workflow-chip workflow-chip-terminal">
                      terminal
                    </span>
                  </div>
                </li>
              </ol>
            </section>

            <section class="info-card workflow-section">
              <div class="panel-header">
                <h3>Dependencies</h3>
              </div>
              <ul class="compact-list" v-if="sortedEdges.length">
                <li v-for="edge in sortedEdges" :key="edge.id">
                  <strong>{{ formatEdgeLabel(edge) }}</strong>
                  <p class="muted-copy">
                    {{ edge.edgeType }}
                    <template v-if="edge.triggerOn"> • on {{ edge.triggerOn }}</template>
                  </p>
                </li>
              </ul>
              <p v-else class="muted-copy">No explicit edges stored on this version.</p>
            </section>

            <section class="info-card workflow-section">
              <div class="panel-header">
                <h3>Actions by stage</h3>
              </div>
              <div class="workflow-action-groups">
                <article
                  v-for="stage in selectedTemplate.stages"
                  :key="stage.id"
                  class="workflow-action-group"
                >
                  <header class="workflow-action-group-header">
                    <strong>{{ stage.name }}</strong>
                    <span class="workflow-chip">
                      {{ actionsByStageId.get(stage.id)?.length ?? 0 }} actions
                    </span>
                  </header>
                  <ul v-if="actionsByStageId.get(stage.id)?.length" class="compact-list">
                    <li
                      v-for="action in actionsByStageId.get(stage.id)"
                      :key="action.id"
                      class="workflow-action-row"
                    >
                      <strong>{{ action.actionType }}</strong>
                      <p class="muted-copy">
                        on {{ action.triggerOn }}
                        <template v-if="action.templateReference">
                          • template {{ action.templateReference }}
                        </template>
                        <template v-if="action.targetWorkflowStageId">
                          • target
                          {{ stageLookup.get(action.targetWorkflowStageId)?.name ?? action.targetWorkflowStageId }}
                        </template>
                        <template
                          v-else-if="
                            action.targetLegacyStageId &&
                            !action.targetWorkflowStageId
                          "
                        >
                          • target legacy {{ action.targetLegacyStageId }}
                        </template>
                      </p>
                      <p class="muted-copy">
                        recipients: {{ formatRecipientGroups(action.recipientGroupsJson) }}
                      </p>
                    </li>
                  </ul>
                  <p v-else class="muted-copy">No actions on this stage.</p>
                </article>
              </div>
            </section>
          </div>
        </template>

        <template v-else>
          <div class="empty-state">
            <h2>No workflow template selected</h2>
            <p class="muted-copy">
              Enter a tenant ID and access token to inspect the imported workflow versions.
            </p>
          </div>
        </template>
      </section>
    </section>
  </main>
</template>
