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

type ReconciliationResponse = {
  reconciliation: {
    generatedAt: string;
    summary: {
      properties: {
        totalCount: number;
        withExternalReferenceCount: number;
        withoutExternalReferenceCount: number;
        latestUpdatedAt: string | null;
      };
      cases: {
        sales: {
          totalCases: number;
          openCases: number;
          completedCases: number;
          offerAcceptedCases: number;
          acceptedOffers: number;
          acceptedOfferValue: number;
          casesWithoutProperty: number;
          casesWithoutWorkflow: number;
        };
        lettings: {
          totalCases: number;
          openCases: number;
          completedCases: number;
          agreedLets: number;
          acceptedApplications: number;
          totalRentOffered: number;
          casesWithoutProperty: number;
          casesWithoutWorkflow: number;
        };
      };
      workflow: {
        sales: {
          casesWithoutWorkflow: number;
          stageCounts: Array<{
            workflowStatus: string;
            currentStageKey: string;
            currentStageName: string;
            count: number;
          }>;
        };
        lettings: {
          casesWithoutWorkflow: number;
          stageCounts: Array<{
            workflowStatus: string;
            currentStageKey: string;
            currentStageName: string;
            count: number;
          }>;
        };
      };
      reports: {
        salesPipeline: {
          aligned: boolean;
          dashboardCounts: Record<string, number>;
          dashboardValues: Record<string, number>;
          actualCounts: Record<string, number>;
          actualValues: Record<string, number>;
        };
        agreedLets: {
          aligned: boolean;
          dashboardCounts: Record<string, number>;
          dashboardValues: Record<string, number>;
          actualCounts: Record<string, number>;
          actualValues: Record<string, number>;
        };
      };
    };
    checks: Array<{
      key: string;
      label: string;
      status: 'ready' | 'missing' | 'investigate';
      detail: string;
    }>;
    details: {
      propertiesWithoutExternalReference: Array<{
        id: string;
        displayAddress: string;
        postcode: string | null;
        syncState: string;
      }>;
      staleProperties: Array<{
        id: string;
        displayAddress: string;
        postcode: string | null;
        syncState: string;
        consecutiveMissCount: number;
        staleCandidateAt: string | null;
        delistedAt: string | null;
        delistedReason: string | null;
      }>;
      casesWithoutProperty: Array<{
        id: string;
        caseType: string;
        status: string;
        reference: string | null;
        title: string;
      }>;
      casesWithoutWorkflow: Array<{
        id: string;
        caseType: string;
        status: string;
        reference: string | null;
        title: string;
      }>;
      reportMismatches: Array<{
        key: string;
        label: string;
        aligned: boolean;
        dashboardCounts: Record<string, number>;
        actualCounts: Record<string, number>;
        dashboardValues: Record<string, number>;
        actualValues: Record<string, number>;
      }>;
    };
  };
};

type IntegrationStatusResponse = {
  integrationAccount: {
    id: string;
    tenantId: string;
    provider: string;
    name: string;
    status: string;
    mode: string;
    hasCredentials: boolean;
    propertyCount: number;
    staleCandidatePropertyCount: number;
    delistedPropertyCount: number;
    pendingWebhookCount: number;
    pendingIntegrationJobCount: number;
    pendingPropertySyncCount: number;
    metrics: {
      failedWebhookCount: number;
      rejectedWebhookCount: number;
      unresolvedWebhookCount: number;
      ignoredWebhookCount: number;
      unknownWebhookCount: number;
    };
    latestSyncRun: {
      id: string;
      triggerSource: string;
      status: string;
      anomalyStatus: string;
      anomalyReason: string | null;
      baselineMedian: number | null;
      propertyCount: number;
      staleCandidateCount: number;
      delistedCount: number;
      startedAt: string;
      completedAt: string | null;
    } | null;
    diagnostics: {
      lastWebhookError: {
        id: string;
        receivedAt: string;
        eventType: string;
        errorMessage: string | null;
      } | null;
      lastIntegrationJobError: {
        id: string;
        failedAt: string | null;
        jobType: string;
        entityExternalId: string | null;
        errorMessage: string | null;
      } | null;
      lastSyncRequestError: {
        id: string;
        createdAt: string;
        errorMessage: string | null;
      } | null;
      lastSyncAnomaly: {
        id: string;
        completedAt: string | null;
        anomalyReason: string | null;
        baselineMedian: number | null;
        propertyCount: number;
      } | null;
    };
  } | null;
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

const reconciliationQuery = useQuery({
  queryKey: ['pilot-reconciliation', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<ReconciliationResponse>(
      `/reconciliation?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const integrationStatusQuery = useQuery({
  queryKey: ['pilot-integration-status', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<IntegrationStatusResponse>(
      `/integrations/dezrez/accounts?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const readiness = computed(() => readinessQuery.data.value ?? null);
const reconciliation = computed(() => reconciliationQuery.data.value?.reconciliation ?? null);
const integrationStatus = computed(() => integrationStatusQuery.data.value?.integrationAccount ?? null);

const queryErrors = computed(() => {
  const entries: Array<{ source: string; message: string }> = [];
  const add = (source: string, error: unknown) => {
    if (!error) {
      return;
    }
    entries.push({
      source,
      message: error instanceof Error ? error.message : String(error),
    });
  };

  add('pilot-readiness', readinessQuery.error.value);
  add('reconciliation', reconciliationQuery.error.value);
  add('integration-status', integrationStatusQuery.error.value);
  return entries;
});

const operatorAlerts = computed(() => {
  const alerts: Array<{ key: string; title: string; detail: string; severity: 'warning' | 'danger' }> = [];
  const trust = integrationStatus.value;
  const reconcile = reconciliation.value;

  if (trust?.latestSyncRun?.anomalyStatus === 'anomalous') {
    alerts.push({
      key: 'sync-anomaly',
      title: 'Sync anomaly detected',
      detail:
        trust.latestSyncRun.anomalyReason ??
        `Latest run refreshed ${trust.latestSyncRun.propertyCount} properties against a baseline median of ${trust.latestSyncRun.baselineMedian ?? 'unknown'}.`,
      severity: 'danger',
    });
  }

  if ((trust?.metrics.unresolvedWebhookCount ?? 0) > 0) {
    alerts.push({
      key: 'unresolved-webhooks',
      title: 'Unresolved webhooks need routing review',
      detail: `${trust?.metrics.unresolvedWebhookCount ?? 0} Dezrez webhook events could not be matched to a tenant integration account.`,
      severity: 'danger',
    });
  }

  if ((trust?.metrics.failedWebhookCount ?? 0) > 0 || trust?.diagnostics.lastWebhookError) {
    alerts.push({
      key: 'failed-webhooks',
      title: 'Webhook processing failures need attention',
      detail:
        trust?.diagnostics.lastWebhookError?.errorMessage ??
        `${trust?.metrics.failedWebhookCount ?? 0} webhook events have failed processing.`,
      severity: 'warning',
    });
  }

  if ((trust?.staleCandidatePropertyCount ?? 0) > 0 || (trust?.delistedPropertyCount ?? 0) > 0) {
    alerts.push({
      key: 'stale-properties',
      title: 'Property sync state needs review',
      detail: `${trust?.staleCandidatePropertyCount ?? 0} stale candidates and ${trust?.delistedPropertyCount ?? 0} delisted properties are currently flagged.`,
      severity: 'warning',
    });
  }

  for (const check of reconcile?.checks ?? []) {
    if (check.status === 'investigate' || check.status === 'missing') {
      alerts.push({
        key: `check-${check.key}`,
        title: check.label,
        detail: check.detail,
        severity: check.status === 'missing' ? 'danger' : 'warning',
      });
    }
  }

  return alerts;
});

function refreshAll() {
  void Promise.all([
    readinessQuery.refetch(),
    reconciliationQuery.refetch(),
    integrationStatusQuery.refetch(),
  ]);
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCaseReference(reference: string | null) {
  return reference ?? 'No reference';
}

function formatWorkflowSummary(caseType: string) {
  const rows =
    caseType === 'sales'
      ? (reconciliation.value?.summary.workflow.sales.stageCounts ?? [])
      : (reconciliation.value?.summary.workflow.lettings.stageCounts ?? []);

  if (!rows.length) {
    return 'No workflow stage data yet.';
  }

  return rows.map((row) => `${row.currentStageName} (${row.count})`).join(' • ');
}

function formatRecordCounts(values: Record<string, number>) {
  return JSON.stringify(values);
}

function formatRecordValues(values: Record<string, number>) {
  const numbers = Object.values(values);
  if (!numbers.some((value) => value > 0)) {
    return 'none';
  }

  return numbers.map((value) => formatMoney(value)).join(', ');
}
</script>

<template>
  <main class="explorer-shell">
    <section class="explorer-header workspace-header">
      <div>
        <RouterLink class="back-link" to="/">Back</RouterLink>
        <p class="eyebrow">Milestone C Operator View</p>
        <h1>Pilot operations</h1>
        <p class="hero-copy">
          Use this screen to decide whether a tenant is ready for side-by-side pilot work, then
          investigate stale syncs, incomplete records, and report mismatches without bouncing
          between tools.
        </p>
      </div>
      <div class="workspace-nav">
        <RouterLink class="ghost-button" to="/workspace/sales">Sales workspace</RouterLink>
        <RouterLink class="ghost-button" to="/workspace/lettings">Lettings workspace</RouterLink>
        <RouterLink class="ghost-button" to="/explorer">Property explorer</RouterLink>
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
        <span>Operator snapshot</span>
        <button class="ghost-button" type="button" :disabled="!canLoad" @click="refreshAll">
          Refresh
        </button>
      </div>
    </section>

    <div v-if="queryErrors.length" class="error-banner">
      <p v-for="entry in queryErrors" :key="entry.source">
        <strong>{{ entry.source }}:</strong> {{ entry.message }}
      </p>
    </div>

    <section
      v-if="operatorAlerts.length"
      class="status-grid"
      data-testid="pilot-operator-alerts"
    >
      <article
        v-for="alert in operatorAlerts"
        :key="alert.key"
        class="status-card trust-alert"
        :class="`trust-alert-${alert.severity}`"
      >
        <div class="panel-heading">
          <h2>{{ alert.title }}</h2>
          <span>{{ alert.severity }}</span>
        </div>
        <p class="muted-copy">{{ alert.detail }}</p>
      </article>
    </section>

    <section
      v-if="readiness && reconciliation"
      class="status-ribbon"
      data-testid="pilot-operator-summary"
    >
      <article class="status-tile">
        <h2>Setup counts</h2>
        <p>properties {{ readiness.readiness.counts.propertyCount }}</p>
        <p>sales cases {{ readiness.readiness.counts.salesCaseCount }}</p>
        <p>lettings cases {{ readiness.readiness.counts.lettingsCaseCount }}</p>
      </article>
      <article class="status-tile">
        <h2>Sync trust</h2>
        <template v-if="integrationStatus">
          <p>stale candidates {{ integrationStatus.staleCandidatePropertyCount }}</p>
          <p>delisted {{ integrationStatus.delistedPropertyCount }}</p>
          <p>pending jobs {{ integrationStatus.pendingIntegrationJobCount }}</p>
          <p>pending webhooks {{ integrationStatus.pendingWebhookCount }}</p>
        </template>
        <p v-else class="muted-copy">No Dezrez account configured.</p>
      </article>
      <article class="status-tile">
        <h2>Reconciliation</h2>
        <p>properties without refs {{ reconciliation.summary.properties.withoutExternalReferenceCount }}</p>
        <p>
          cases without property
          {{
            reconciliation.summary.cases.sales.casesWithoutProperty +
            reconciliation.summary.cases.lettings.casesWithoutProperty
          }}
        </p>
        <p>
          cases without workflow
          {{
            reconciliation.summary.cases.sales.casesWithoutWorkflow +
            reconciliation.summary.cases.lettings.casesWithoutWorkflow
          }}
        </p>
      </article>
      <article class="status-tile">
        <h2>Report health</h2>
        <p>
          sales pipeline
          {{ reconciliation.summary.reports.salesPipeline.aligned ? 'aligned' : 'investigate' }}
        </p>
        <p>
          agreed lets
          {{ reconciliation.summary.reports.agreedLets.aligned ? 'aligned' : 'investigate' }}
        </p>
      </article>
    </section>

    <section v-if="readiness && reconciliation" class="status-grid">
      <article class="status-card">
        <div class="panel-heading">
          <h2>Pilot readiness checks</h2>
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
          <h2>Reconciliation checks</h2>
          <span>{{ formatDate(reconciliation.generatedAt) }}</span>
        </div>
        <ul class="readiness-list">
          <li v-for="check in reconciliation.checks" :key="check.key" class="readiness-row">
            <div class="history-meta">
              <strong>{{ check.label }}</strong>
              <span class="history-status">{{ check.status }}</span>
            </div>
            <p class="muted-copy">{{ check.detail }}</p>
          </li>
        </ul>
      </article>
    </section>

    <section v-if="integrationStatus || reconciliation" class="status-grid" data-testid="pilot-operator-drilldown">
      <article class="status-card">
        <div class="panel-heading">
          <h2>Sync trust drilldown</h2>
          <span>{{ integrationStatus?.mode ?? 'no integration' }}</span>
        </div>
        <template v-if="integrationStatus">
          <p class="muted-copy">
            latest run
            {{
              integrationStatus.latestSyncRun
                ? `${integrationStatus.latestSyncRun.status} • ${integrationStatus.latestSyncRun.triggerSource}`
                : 'Unknown'
            }}
          </p>
          <p class="muted-copy">
            latest run health
            {{
              integrationStatus.latestSyncRun?.anomalyStatus === 'anomalous'
                ? `anomalous${integrationStatus.latestSyncRun.anomalyReason ? ` • ${integrationStatus.latestSyncRun.anomalyReason}` : ''}`
                : 'healthy'
            }}
          </p>
          <p class="muted-copy">failed webhooks {{ integrationStatus.metrics.failedWebhookCount }}</p>
          <p class="muted-copy">unresolved webhooks {{ integrationStatus.metrics.unresolvedWebhookCount }}</p>
          <p class="muted-copy">ignored webhooks {{ integrationStatus.metrics.ignoredWebhookCount }}</p>
          <p v-if="integrationStatus.diagnostics.lastWebhookError" class="history-error">
            latest webhook failure:
            {{
              integrationStatus.diagnostics.lastWebhookError.errorMessage ?? 'Unknown webhook failure'
            }}
          </p>
          <p v-if="integrationStatus.diagnostics.lastIntegrationJobError" class="history-error">
            latest job failure:
            {{
              integrationStatus.diagnostics.lastIntegrationJobError.errorMessage ?? 'Unknown integration job failure'
            }}
          </p>
          <p v-if="integrationStatus.diagnostics.lastSyncAnomaly" class="history-error">
            latest anomaly:
            {{
              integrationStatus.diagnostics.lastSyncAnomaly.anomalyReason ?? 'Anomalous sync volume detected'
            }}
          </p>
        </template>
        <p v-else class="muted-copy">No Dezrez integration account is configured for this tenant.</p>
      </article>

      <article class="status-card">
        <div class="panel-heading">
          <h2>Investigate now</h2>
          <span>
            {{
              (reconciliation?.details.staleProperties.length ?? 0) +
              (reconciliation?.details.propertiesWithoutExternalReference.length ?? 0) +
              (reconciliation?.details.casesWithoutProperty.length ?? 0) +
              (reconciliation?.details.casesWithoutWorkflow.length ?? 0)
            }}
          </span>
        </div>
        <template v-if="reconciliation">
          <div v-if="reconciliation.details.staleProperties.length" class="operator-block">
            <strong>Stale or delisted properties</strong>
            <ul class="compact-list">
              <li v-for="property in reconciliation.details.staleProperties" :key="property.id">
                {{ property.displayAddress }} • {{ property.syncState }} • misses
                {{ property.consecutiveMissCount }}
              </li>
            </ul>
          </div>
          <div
            v-if="reconciliation.details.propertiesWithoutExternalReference.length"
            class="operator-block"
          >
            <strong>Properties missing external refs</strong>
            <ul class="compact-list">
              <li
                v-for="property in reconciliation.details.propertiesWithoutExternalReference"
                :key="property.id"
              >
                {{ property.displayAddress }} • {{ property.postcode ?? 'No postcode' }}
              </li>
            </ul>
          </div>
          <div v-if="reconciliation.details.casesWithoutProperty.length" class="operator-block">
            <strong>Cases missing property links</strong>
            <ul class="compact-list">
              <li v-for="item in reconciliation.details.casesWithoutProperty" :key="item.id">
                {{ formatCaseReference(item.reference) }} • {{ item.title }}
              </li>
            </ul>
          </div>
          <div v-if="reconciliation.details.casesWithoutWorkflow.length" class="operator-block">
            <strong>Cases missing workflow</strong>
            <ul class="compact-list">
              <li v-for="item in reconciliation.details.casesWithoutWorkflow" :key="item.id">
                {{ formatCaseReference(item.reference) }} • {{ item.title }}
              </li>
            </ul>
          </div>
          <p
            v-if="
              !reconciliation.details.staleProperties.length &&
              !reconciliation.details.propertiesWithoutExternalReference.length &&
              !reconciliation.details.casesWithoutProperty.length &&
              !reconciliation.details.casesWithoutWorkflow.length
            "
            class="muted-copy"
          >
            No drilldown issues are currently flagged for this tenant.
          </p>
        </template>
      </article>
    </section>

    <section v-if="reconciliation" class="status-grid">
      <article class="status-card" data-testid="pilot-report-alignment">
        <div class="panel-heading">
          <h2>Report alignment</h2>
        </div>
        <div
          v-for="report in reconciliation.details.reportMismatches"
          :key="report.key"
          class="operator-block"
        >
          <div class="history-meta">
            <strong>{{ report.label }}</strong>
            <span class="history-status">{{ report.aligned ? 'aligned' : 'investigate' }}</span>
          </div>
          <p class="muted-copy">
            counts dashboard {{ formatRecordCounts(report.dashboardCounts) }} • actual
            {{ formatRecordCounts(report.actualCounts) }}
          </p>
          <p class="muted-copy">
            values dashboard {{ formatRecordValues(report.dashboardValues) }} • actual
            {{ formatRecordValues(report.actualValues) }}
          </p>
        </div>
      </article>

      <article class="status-card" data-testid="pilot-workflow-coverage">
        <div class="panel-heading">
          <h2>Workflow stage distribution</h2>
        </div>
        <div class="operator-block">
          <strong>Sales</strong>
          <p class="muted-copy">{{ formatWorkflowSummary('sales') }}</p>
        </div>
        <div class="operator-block">
          <strong>Lettings</strong>
          <p class="muted-copy">{{ formatWorkflowSummary('lettings') }}</p>
        </div>
      </article>
    </section>

    <section v-if="readiness" class="status-grid">
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

      <article class="status-card">
        <div class="panel-heading">
          <h2>Later items</h2>
        </div>
        <ul>
          <li v-for="item in readiness.laterItems" :key="item">{{ item }}</li>
        </ul>
      </article>
    </section>
  </main>
</template>
