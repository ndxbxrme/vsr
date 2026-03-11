<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';

type PilotReadinessResponse = {
  readiness: {
    counts: {
      propertyCount: number;
      emailTemplateCount: number;
      smsTemplateCount: number;
      salesWorkflowTemplateCount: number;
      lettingsWorkflowTemplateCount: number;
      salesCaseCount: number;
      lettingsCaseCount: number;
    };
  };
  checks: Array<{
    key: string;
    label: string;
    status: 'ready' | 'missing';
    detail: string;
  }>;
  pilotFlows: Array<{
    key: string;
    label: string;
    status: 'ready' | 'needs_setup';
    detail: string;
  }>;
  laterItems: string[];
  generatedAt: string;
};

const storageKeys = {
  tenantId: 'vitalspace.workspace.tenantId',
  accessToken: 'vitalspace.workspace.accessToken',
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1';
const tenantId = ref(localStorage.getItem(storageKeys.tenantId) ?? '');
const accessToken = ref(localStorage.getItem(storageKeys.accessToken) ?? '');

watch(tenantId, (value) => {
  localStorage.setItem(storageKeys.tenantId, value);
});

watch(accessToken, (value) => {
  localStorage.setItem(storageKeys.accessToken, value);
});

const canLoad = computed(() => tenantId.value.trim().length > 0 && accessToken.value.trim().length > 0);

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken.value.trim()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `request_failed_${response.status}`);
  }

  return (await response.json()) as T;
}

const readinessQuery = useQuery({
  queryKey: ['pilot-readiness', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<PilotReadinessResponse>(
      `/pilot-readiness?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const readiness = computed(() => readinessQuery.data.value ?? null);
const primaryError = computed(() => readinessQuery.error.value);

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
</script>

<template>
  <main class="explorer-shell">
    <section class="explorer-header workspace-header">
      <div>
        <RouterLink class="back-link" to="/">Back</RouterLink>
        <p class="eyebrow">Milestone B Closeout</p>
        <h1>Pilot readiness</h1>
        <p class="hero-copy">
          Use this view to confirm a tenant has enough data and configuration to start the first
          side-by-side pilot workflows.
        </p>
      </div>
      <div class="workspace-nav">
        <RouterLink class="ghost-button" to="/workspace/sales">Sales workspace</RouterLink>
        <RouterLink class="ghost-button" to="/workspace/lettings">Lettings workspace</RouterLink>
      </div>
    </section>

    <section class="control-panel">
      <label class="field" for="pilot-tenant-id">
        <span>Tenant ID</span>
        <input id="pilot-tenant-id" v-model="tenantId" type="text" placeholder="uuid" />
      </label>
      <label class="field field-wide" for="pilot-access-token">
        <span>Bearer token</span>
        <input
          id="pilot-access-token"
          v-model="accessToken"
          type="password"
          placeholder="paste access token"
        />
      </label>
      <div class="sync-panel">
        <span>Pilot snapshot</span>
        <button class="ghost-button" type="button" :disabled="!canLoad" @click="readinessQuery.refetch()">
          Refresh
        </button>
      </div>
    </section>

    <p v-if="primaryError" class="error-banner">
      {{ primaryError instanceof Error ? primaryError.message : String(primaryError) }}
    </p>

    <section v-if="readiness" class="status-ribbon">
      <article class="status-tile">
        <h2>Properties</h2>
        <p>{{ readiness.readiness.counts.propertyCount }}</p>
      </article>
      <article class="status-tile">
        <h2>Templates</h2>
        <p>email {{ readiness.readiness.counts.emailTemplateCount }}</p>
        <p>sms {{ readiness.readiness.counts.smsTemplateCount }}</p>
      </article>
      <article class="status-tile">
        <h2>Workflow templates</h2>
        <p>sales {{ readiness.readiness.counts.salesWorkflowTemplateCount }}</p>
        <p>lettings {{ readiness.readiness.counts.lettingsWorkflowTemplateCount }}</p>
      </article>
      <article class="status-tile">
        <h2>Cases</h2>
        <p>sales {{ readiness.readiness.counts.salesCaseCount }}</p>
        <p>lettings {{ readiness.readiness.counts.lettingsCaseCount }}</p>
      </article>
    </section>

    <section v-if="readiness" class="status-grid">
      <article class="status-card">
        <div class="panel-heading">
          <h2>Checks</h2>
          <span>{{ formatDate(readiness.generatedAt) }}</span>
        </div>
        <ul class="readiness-list">
          <li v-for="check in readiness.checks" :key="check.key" class="readiness-row">
            <div class="history-meta">
              <strong>{{ check.label }}</strong>
              <span class="history-status">{{ check.status }}</span>
            </div>
            <p class="muted-copy">{{ check.detail }}</p>
          </li>
        </ul>
      </article>

      <article class="status-card">
        <div class="panel-heading">
          <h2>Pilot flows</h2>
        </div>
        <ul class="readiness-list">
          <li v-for="flow in readiness.pilotFlows" :key="flow.key" class="readiness-row">
            <div class="history-meta">
              <strong>{{ flow.label }}</strong>
              <span class="history-status">{{ flow.status }}</span>
            </div>
            <p class="muted-copy">{{ flow.detail }}</p>
          </li>
        </ul>
      </article>
    </section>

    <section v-if="readiness" class="status-grid">
      <article class="status-card">
        <div class="panel-heading">
          <h2>Later items</h2>
        </div>
        <ul>
          <li v-for="item in readiness.laterItems" :key="item">{{ item }}</li>
        </ul>
      </article>
      <article class="status-card">
        <div class="panel-heading">
          <h2>Next move</h2>
        </div>
        <p class="muted-copy">
          Use the sales and lettings workspaces to run the first tenant through the two pilot flows,
          then capture only blocking parity gaps before starting Milestone C.
        </p>
      </article>
    </section>
  </main>
</template>
