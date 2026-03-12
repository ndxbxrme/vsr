<script setup lang="ts">
import type { EntityChangedEvent } from '@vitalspace/contracts';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { io, type Socket } from 'socket.io-client';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

type PropertySummary = {
  id: string;
  branchId: string | null;
  displayAddress: string;
  postcode: string | null;
  status: string;
  marketingStatus: string | null;
  syncState: string;
  consecutiveMissCount: number;
  lastSeenAt: string | null;
  staleCandidateAt: string | null;
  delistedAt: string | null;
  delistedReason: string | null;
  externalId: string | null;
};

type PropertyDetail = PropertySummary & {
  tenantId: string;
  provider: string | null;
  propertyExternalMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    offers: number;
    viewings: number;
    timelineEvents: number;
  };
};

type PropertyOffer = {
  id: string;
  externalId: string;
  propertyRoleExternalId: string | null;
  applicantName: string | null;
  applicantEmail: string | null;
  applicantGrade: string | null;
  amount: number | null;
  status: string | null;
  offeredAt: string | null;
};

type PropertyViewing = {
  id: string;
  externalId: string;
  propertyRoleExternalId: string | null;
  applicantName: string | null;
  applicantEmail: string | null;
  applicantGrade: string | null;
  eventStatus: string | null;
  feedbackCount: number;
  notesCount: number;
  startsAt: string | null;
};

type PropertyTimelineEvent = {
  id: string;
  externalId: string;
  propertyRoleExternalId: string | null;
  eventType: string;
  title: string;
  body: string | null;
  actorType: string;
  metadataJson: Record<string, unknown> | null;
  occurredAt: string;
};

type PropertyFile = {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  label: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

type IntegrationStatus = {
  id: string;
  tenantId: string;
  provider: string;
  name: string;
  status: string;
  mode: string;
  hasCredentials: boolean;
  seedPropertyCount: number;
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
  lastSyncRequestedAt: string | null;
  lastSyncRequestedPublishedAt: string | null;
  lastSyncRequestedStatus: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncCompletedPropertyCount: number | null;
  latestWebhookReceivedAt: string | null;
  latestWebhookStatus: string | null;
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
  history: {
    recentActivity: {
      id: string;
      source: 'webhook' | 'integration_job' | 'sync_request' | 'sync_completion';
      status: string;
      occurredAt: string;
      title: string;
      subtitle: string | null;
      errorMessage: string | null;
    }[];
    recentWebhooks: {
      id: string;
      eventType: string;
      status: string;
      receivedAt: string;
      errorMessage: string | null;
      summary: {
        agencyId: string | null;
        branchId: string | null;
        propertyId: string | null;
        propertyRoleId: string | null;
        rootEntityId: string | null;
        documentId: string | null;
        changedByPersonId: string | null;
        personId: string | null;
        changeType: string | null;
        occurredAt: string | null;
      };
      payloadJson: Record<string, unknown>;
    }[];
  };
  updatedAt: string;
};

const storageKeys = {
  tenantId: 'vitalspace.explorer.tenantId',
  accessToken: 'vitalspace.explorer.accessToken',
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1';
const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? new URL(apiBaseUrl).origin;
const queryClient = useQueryClient();

const tenantId = ref(localStorage.getItem(storageKeys.tenantId) ?? '');
const accessToken = ref(localStorage.getItem(storageKeys.accessToken) ?? '');
const selectedPropertyId = ref<string>('');
const connectionState = ref<'disconnected' | 'connecting' | 'connected'>('disconnected');
const lastRealtimeEvent = ref<EntityChangedEvent | null>(null);
const syncState = ref<'idle' | 'requesting' | 'requested' | 'failed'>('idle');
const syncMessage = ref('No sync requested in this session.');
const propertyRefreshState = ref<'idle' | 'requesting' | 'requested' | 'failed'>('idle');
const propertyRefreshMessage = ref('No property refresh requested in this session.');
const retryState = ref<'idle' | 'retrying' | 'retried' | 'failed'>('idle');
const retryMessage = ref('No retry attempted in this session.');
const replayState = ref<'idle' | 'replaying' | 'replayed' | 'failed'>('idle');
const replayMessage = ref('No webhook replay attempted in this session.');
const fileUploadState = ref<'idle' | 'uploading' | 'uploaded' | 'failed'>('idle');
const fileUploadMessage = ref('No file uploaded in this session.');
const selectedUploadFile = ref<File | null>(null);
const activityFeedCollapsed = ref(false);
const webhookFeedCollapsed = ref(false);
let socket: Socket | null = null;

watch(tenantId, (value) => {
  localStorage.setItem(storageKeys.tenantId, value);
});

watch(accessToken, (value) => {
  localStorage.setItem(storageKeys.accessToken, value);
});

watch([tenantId, accessToken], ([nextTenantId, nextAccessToken], [previousTenantId, previousAccessToken]) => {
  if (
    nextTenantId.trim() === previousTenantId.trim() &&
    nextAccessToken.trim() === previousAccessToken.trim()
  ) {
    return;
  }

  selectedPropertyId.value = '';
  lastRealtimeEvent.value = null;

  if (!nextTenantId.trim() || !nextAccessToken.trim()) {
    return;
  }

  refreshAll();
});

const canLoad = computed(() => tenantId.value.trim().length > 0 && accessToken.value.trim().length > 0);
const selectedPropertyIdValue = computed(() => selectedPropertyId.value.trim());

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken.value.trim()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `request_failed_${response.status}`);
  }

  return (await response.json()) as T;
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.value.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `request_failed_${response.status}`);
  }

  return (await response.json()) as T;
}

const propertiesQuery = useQuery({
  queryKey: ['properties', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ properties: PropertySummary[] }>(
      `/properties?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const integrationStatusQuery = useQuery({
  queryKey: ['integration-status', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ integrationAccount: IntegrationStatus | null }>(
      `/integrations/dezrez/accounts?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

watch(
  () => propertiesQuery.data.value?.properties,
  (properties) => {
    if (!properties?.length) {
      selectedPropertyId.value = '';
      return;
    }

    if (!properties.some((property) => property.id === selectedPropertyId.value)) {
      selectedPropertyId.value = properties[0]?.id ?? '';
    }
  },
  { immediate: true },
);

const selectedPropertyReady = computed(
  () => canLoad.value && selectedPropertyIdValue.value.length > 0,
);

const propertyDetailQuery = useQuery({
  queryKey: ['property-detail', tenantId, selectedPropertyIdValue],
  enabled: selectedPropertyReady,
  queryFn: () =>
    apiGet<{ property: PropertyDetail }>(
      `/properties/${selectedPropertyIdValue.value}?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const offersQuery = useQuery({
  queryKey: ['property-offers', tenantId, selectedPropertyIdValue],
  enabled: selectedPropertyReady,
  queryFn: () =>
    apiGet<{ offers: PropertyOffer[] }>(
      `/properties/${selectedPropertyIdValue.value}/offers?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const viewingsQuery = useQuery({
  queryKey: ['property-viewings', tenantId, selectedPropertyIdValue],
  enabled: selectedPropertyReady,
  queryFn: () =>
    apiGet<{ viewings: PropertyViewing[] }>(
      `/properties/${selectedPropertyIdValue.value}/viewings?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const timelineQuery = useQuery({
  queryKey: ['property-timeline', tenantId, selectedPropertyIdValue],
  enabled: selectedPropertyReady,
  queryFn: () =>
    apiGet<{ timelineEvents: PropertyTimelineEvent[] }>(
      `/properties/${selectedPropertyIdValue.value}/timeline?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const filesQuery = useQuery({
  queryKey: ['property-files', tenantId, selectedPropertyIdValue],
  enabled: selectedPropertyReady,
  queryFn: () =>
    apiGet<{ files: PropertyFile[] }>(
      `/files?tenantId=${encodeURIComponent(tenantId.value.trim())}&entityType=property&entityId=${selectedPropertyIdValue.value}`,
    ),
});

const propertyList = computed(() => propertiesQuery.data.value?.properties ?? []);
const integrationStatus = computed(() => integrationStatusQuery.data.value?.integrationAccount ?? null);
const hasPendingSyncRequest = computed(
  () => (integrationStatus.value?.pendingPropertySyncCount ?? 0) > 0,
);
const integrationHistory = computed(() => integrationStatus.value?.history.recentActivity ?? []);
const recentWebhookHistory = computed(() => integrationStatus.value?.history.recentWebhooks ?? []);
const hasDiagnostics = computed(() => {
  return Boolean(
    integrationStatus.value?.diagnostics.lastWebhookError ||
      integrationStatus.value?.diagnostics.lastIntegrationJobError ||
      integrationStatus.value?.diagnostics.lastSyncRequestError ||
      integrationStatus.value?.diagnostics.lastSyncAnomaly,
  );
});
const propertyDetail = computed(() => propertyDetailQuery.data.value?.property ?? null);
const offers = computed(() => offersQuery.data.value?.offers ?? []);
const viewings = computed(() => viewingsQuery.data.value?.viewings ?? []);
const timelineEvents = computed(() => timelineQuery.data.value?.timelineEvents ?? []);
const files = computed(() => filesQuery.data.value?.files ?? []);

const queryErrors = computed(() => {
  const entries: Array<{ source: string; message: string }> = [];

  const pushError = (source: string, error: unknown) => {
    if (!error) {
      return;
    }

    entries.push({
      source,
      message: error instanceof Error ? error.message : String(error),
    });
  };

  pushError('properties', propertiesQuery.error.value);
  pushError('integration-status', integrationStatusQuery.error.value);

  if (selectedPropertyReady.value) {
    pushError('property-detail', propertyDetailQuery.error.value);
    pushError('property-offers', offersQuery.error.value);
    pushError('property-viewings', viewingsQuery.error.value);
    pushError('property-timeline', timelineQuery.error.value);
    pushError('property-files', filesQuery.error.value);
  }

  return entries;
});

const primaryError = computed(() => queryErrors.value[0] ?? null);

function formatMoney(value: number | null) {
  if (value === null) {
    return 'No amount';
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
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

function formatActivitySource(value: IntegrationStatus['history']['recentActivity'][number]['source']) {
  switch (value) {
    case 'webhook':
      return 'Webhook';
    case 'integration_job':
      return 'Job';
    case 'sync_request':
      return 'Sync request';
    case 'sync_completion':
      return 'Sync complete';
  }
}

function formatWebhookSummaryValue(value: string | null) {
  return value ?? 'n/a';
}

function prettyJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function refreshAll() {
  void Promise.all([
    integrationStatusQuery.refetch(),
    propertiesQuery.refetch(),
    propertyDetailQuery.refetch(),
    offersQuery.refetch(),
    viewingsQuery.refetch(),
    timelineQuery.refetch(),
    filesQuery.refetch(),
  ]);
}

async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string' || !result.includes(',')) {
        reject(new Error('file_read_failed'));
        return;
      }
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedUploadFile.value = input.files?.[0] ?? null;
}

async function uploadSelectedFile() {
  if (!selectedPropertyId.value || !selectedUploadFile.value) {
    fileUploadState.value = 'failed';
    fileUploadMessage.value = 'Pick a property and choose a file before uploading.';
    return;
  }

  fileUploadState.value = 'uploading';
  fileUploadMessage.value = `Uploading ${selectedUploadFile.value.name}...`;

  try {
    const base64Data = await fileToBase64(selectedUploadFile.value);
    await apiPost<{ file: PropertyFile }>('/files', {
      tenantId: tenantId.value.trim(),
      entityType: 'property',
      entityId: selectedPropertyId.value,
      label: 'Explorer upload',
      originalName: selectedUploadFile.value.name,
      contentType: selectedUploadFile.value.type || 'application/octet-stream',
      base64Data,
    });
    fileUploadState.value = 'uploaded';
    fileUploadMessage.value = `${selectedUploadFile.value.name} uploaded successfully.`;
    selectedUploadFile.value = null;
    refreshAll();
  } catch (error) {
    fileUploadState.value = 'failed';
    fileUploadMessage.value = error instanceof Error ? error.message : 'File upload failed.';
  }
}

async function downloadFile(file: PropertyFile) {
  const response = await fetch(
    `${apiBaseUrl}/files/${file.id}/download?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken.value.trim()}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`download_failed_${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = file.originalName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function requestSync() {
  if (!canLoad.value) {
    syncState.value = 'failed';
    syncMessage.value = 'Tenant ID and bearer token are required before requesting a sync.';
    return;
  }

  if (hasPendingSyncRequest.value) {
    syncState.value = 'requested';
    syncMessage.value = 'A sync request is already pending for this tenant.';
    return;
  }

  syncState.value = 'requesting';
  syncMessage.value = 'Requesting Dezrez sync...';

  try {
    const response = await apiPost<{ accepted: boolean; deduplicated?: boolean }>(
      '/integrations/dezrez/sync',
      {
      tenantId: tenantId.value.trim(),
      },
    );
    syncState.value = 'requested';
    syncMessage.value = response.deduplicated
      ? 'A matching sync request is already queued. Waiting for the worker to pick it up.'
      : 'Sync accepted. If the worker is running, realtime updates should begin arriving shortly.';
    void queryClient.invalidateQueries({
      queryKey: ['integration-status', tenantId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['properties', tenantId],
    });
  } catch (error) {
    syncState.value = 'failed';
    syncMessage.value = error instanceof Error ? error.message : 'Sync request failed.';
  }
}

async function refreshSelectedProperty() {
  if (!selectedPropertyIdValue.value || !canLoad.value) {
    propertyRefreshState.value = 'failed';
    propertyRefreshMessage.value = 'Select a property first.';
    return;
  }

  propertyRefreshState.value = 'requesting';
  propertyRefreshMessage.value = 'Requesting offers, viewings, and timeline refresh...';

  try {
    await apiPost<{ accepted: boolean }>(
      `/properties/${selectedPropertyIdValue.value}/refresh-related?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
      {},
    );
    propertyRefreshState.value = 'requested';
    propertyRefreshMessage.value =
      'Property refresh accepted. The worker should fill offers, viewings, and timeline shortly.';
    refreshAll();
  } catch (error) {
    propertyRefreshState.value = 'failed';
    propertyRefreshMessage.value =
      error instanceof Error ? error.message : 'Property refresh failed.';
  }
}

async function retryFailedSyncRequest() {
  if (!integrationStatus.value?.diagnostics.lastSyncRequestError?.id) {
    retryState.value = 'failed';
    retryMessage.value = 'No failed sync request is available to retry.';
    return;
  }

  retryState.value = 'retrying';
  retryMessage.value = 'Retrying failed sync request...';

  try {
    await apiPost<{ retried: boolean }>('/integrations/dezrez/retry-sync-request', {
      tenantId: tenantId.value.trim(),
      outboxEventId: integrationStatus.value.diagnostics.lastSyncRequestError.id,
    });
    retryState.value = 'retried';
    retryMessage.value = 'Failed sync request queued again. The worker should pick it up shortly.';
    refreshAll();
  } catch (error) {
    retryState.value = 'failed';
    retryMessage.value = error instanceof Error ? error.message : 'Retry failed.';
  }
}

async function retryFailedIntegrationJob() {
  if (!integrationStatus.value?.diagnostics.lastIntegrationJobError?.id) {
    retryState.value = 'failed';
    retryMessage.value = 'No failed integration job is available to retry.';
    return;
  }

  retryState.value = 'retrying';
  retryMessage.value = 'Retrying failed integration job...';

  try {
    await apiPost<{ retried: boolean }>('/integrations/dezrez/retry-job', {
      tenantId: tenantId.value.trim(),
      integrationJobId: integrationStatus.value.diagnostics.lastIntegrationJobError.id,
    });
    retryState.value = 'retried';
    retryMessage.value = 'Failed integration job queued again. The worker should pick it up shortly.';
    refreshAll();
  } catch (error) {
    retryState.value = 'failed';
    retryMessage.value = error instanceof Error ? error.message : 'Retry failed.';
  }
}

async function replayFailedWebhook() {
  if (!integrationStatus.value?.diagnostics.lastWebhookError?.id) {
    replayState.value = 'failed';
    replayMessage.value = 'No failed webhook is available to replay.';
    return;
  }

  replayState.value = 'replaying';
  replayMessage.value = 'Replaying failed webhook...';

  try {
    await apiPost<{ replayed: boolean }>('/integrations/dezrez/replay-webhook', {
      tenantId: tenantId.value.trim(),
      webhookEventId: integrationStatus.value.diagnostics.lastWebhookError.id,
    });
    replayState.value = 'replayed';
    replayMessage.value = 'Webhook reset to pending. The worker should classify it again shortly.';
    refreshAll();
  } catch (error) {
    replayState.value = 'failed';
    replayMessage.value = error instanceof Error ? error.message : 'Webhook replay failed.';
  }
}

function invalidateExplorerQueries(event: EntityChangedEvent) {
  if (event.tenantId !== tenantId.value.trim()) {
    return;
  }

  lastRealtimeEvent.value = event;
  void queryClient.invalidateQueries({
    queryKey: ['integration-status', tenantId],
  });
  void queryClient.invalidateQueries({
    queryKey: ['properties', tenantId],
  });

  if (!selectedPropertyIdValue.value) {
    return;
  }

  const shouldInvalidateDetail =
    event.entityType === 'property' &&
    (event.entityId === selectedPropertyIdValue.value ||
      event.payload?.externalId !== undefined ||
      event.entityId === '00000000-0000-0000-0000-000000000000');

  if (shouldInvalidateDetail) {
    void queryClient.invalidateQueries({
      queryKey: ['property-detail', tenantId, selectedPropertyIdValue],
    });
  }

  if (['offer', 'viewing', 'timeline_event', 'property', 'file_object'].includes(event.entityType)) {
    void queryClient.invalidateQueries({
      queryKey: ['property-detail', tenantId, selectedPropertyIdValue],
    });
    void queryClient.invalidateQueries({
      queryKey: ['property-offers', tenantId, selectedPropertyIdValue],
    });
    void queryClient.invalidateQueries({
      queryKey: ['property-viewings', tenantId, selectedPropertyIdValue],
    });
    void queryClient.invalidateQueries({
      queryKey: ['property-timeline', tenantId, selectedPropertyIdValue],
    });
    void queryClient.invalidateQueries({
      queryKey: ['property-files', tenantId, selectedPropertyIdValue],
    });
  }
}

watch(
  [canLoad, accessToken],
  ([ready, token]) => {
    if (socket) {
      socket.off('entity.changed', invalidateExplorerQueries);
      socket.disconnect();
      socket = null;
    }

    if (!ready) {
      connectionState.value = 'disconnected';
      return;
    }

    connectionState.value = 'connecting';
    socket = io(apiOrigin, {
      auth: {
        token: token.trim(),
      },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      connectionState.value = 'connected';
    });

    socket.on('disconnect', () => {
      connectionState.value = 'disconnected';
    });

    socket.on('connect_error', () => {
      connectionState.value = 'disconnected';
    });

    socket.on('entity.changed', invalidateExplorerQueries);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (!socket) {
    return;
  }

  socket.off('entity.changed', invalidateExplorerQueries);
  socket.disconnect();
  socket = null;
});
</script>

<template>
  <main class="explorer-shell">
    <section class="explorer-header">
      <div>
        <RouterLink class="back-link" to="/">Back</RouterLink>
        <p class="eyebrow">Milestone A Explorer</p>
        <h1>Property read model validation</h1>
        <p class="hero-copy">
          Use a tenant ID and bearer token from the API auth flow, then inspect property detail,
          offers, viewings, and timeline against the new normalized backend.
        </p>
        <p class="hero-meta">
          Realtime:
          <strong>{{ connectionState }}</strong>
          <template v-if="lastRealtimeEvent">
            • last event {{ lastRealtimeEvent.entityType }}.{{ lastRealtimeEvent.mutationType }}
          </template>
        </p>
      </div>
      <button class="ghost-button" type="button" :disabled="!canLoad" @click="refreshAll">
        Refresh
      </button>
    </section>

    <section class="control-panel">
      <label class="field" for="explorer-tenant-id">
        <span>Tenant ID</span>
        <input id="explorer-tenant-id" v-model="tenantId" type="text" placeholder="uuid" />
      </label>
      <label class="field field-wide" for="explorer-access-token">
        <span>Bearer token</span>
        <input
          id="explorer-access-token"
          v-model="accessToken"
          type="password"
          placeholder="paste access token"
        />
      </label>
      <div class="sync-panel">
        <span>Dezrez sync</span>
        <button
          class="primary-link sync-button"
          type="button"
          :disabled="!canLoad || syncState === 'requesting' || hasPendingSyncRequest"
          @click="requestSync"
        >
          {{ syncState === 'requesting' ? 'Requesting…' : 'Request sync' }}
        </button>
        <small class="sync-copy" :class="`sync-${syncState}`">{{ syncMessage }}</small>
      </div>
      <div class="sync-panel">
        <span>Selected property</span>
        <button
          class="primary-link sync-button"
          type="button"
          :disabled="!selectedPropertyReady || propertyRefreshState === 'requesting'"
          @click="refreshSelectedProperty"
        >
          {{ propertyRefreshState === 'requesting' ? 'Refreshing…' : 'Refresh related data' }}
        </button>
        <small class="sync-copy" :class="`sync-${propertyRefreshState}`">
          {{ propertyRefreshMessage }}
        </small>
      </div>
    </section>

    <section class="status-ribbon">
      <article class="status-tile">
        <h2>Integration</h2>
        <template v-if="integrationStatus">
          <p><strong>{{ integrationStatus.name }}</strong> • {{ integrationStatus.mode }} mode</p>
          <p>
            credentials {{ integrationStatus.hasCredentials ? 'present' : 'missing' }} • status
            {{ integrationStatus.status }}
          </p>
        </template>
        <p v-else class="muted-copy">No Dezrez account configured for this tenant yet.</p>
      </article>
      <article class="status-tile">
        <h2>Current counts</h2>
        <template v-if="integrationStatus">
          <p>properties {{ integrationStatus.propertyCount }}</p>
          <p>stale candidates {{ integrationStatus.staleCandidatePropertyCount }}</p>
          <p>delisted {{ integrationStatus.delistedPropertyCount }}</p>
          <p>pending webhooks {{ integrationStatus.pendingWebhookCount }}</p>
          <p>pending jobs {{ integrationStatus.pendingIntegrationJobCount }}</p>
          <p>pending sync requests {{ integrationStatus.pendingPropertySyncCount }}</p>
          <p>failed webhooks {{ integrationStatus.metrics.failedWebhookCount }}</p>
          <p>ignored webhooks {{ integrationStatus.metrics.ignoredWebhookCount }}</p>
          <p>unresolved webhooks {{ integrationStatus.metrics.unresolvedWebhookCount }}</p>
          <p>unknown webhooks {{ integrationStatus.metrics.unknownWebhookCount }}</p>
        </template>
        <p v-else class="muted-copy">Counts will appear after configuration.</p>
      </article>
      <article class="status-tile">
        <h2>Last sync</h2>
        <template v-if="integrationStatus">
          <p>latest webhook {{ formatDate(integrationStatus.latestWebhookReceivedAt) }}</p>
          <p>latest webhook status {{ integrationStatus.latestWebhookStatus ?? 'Unknown' }}</p>
          <p>requested {{ formatDate(integrationStatus.lastSyncRequestedAt) }}</p>
          <p>completed {{ formatDate(integrationStatus.lastSyncCompletedAt) }}</p>
          <p>
            completed property count
            {{ integrationStatus.lastSyncCompletedPropertyCount ?? 'Unknown' }}
          </p>
          <p>
            latest run
            {{
              integrationStatus.latestSyncRun
                ? `${integrationStatus.latestSyncRun.status} • ${integrationStatus.latestSyncRun.triggerSource}`
                : 'Unknown'
            }}
          </p>
          <p v-if="integrationStatus.latestSyncRun">
            run health
            {{
              integrationStatus.latestSyncRun.anomalyStatus === 'anomalous'
                ? `anomalous${integrationStatus.latestSyncRun.anomalyReason ? ` • ${integrationStatus.latestSyncRun.anomalyReason}` : ''}`
                : 'healthy'
            }}
          </p>
        </template>
        <p v-else class="muted-copy">No sync history available yet.</p>
      </article>
      <article class="status-tile diagnostics-tile">
        <h2>Diagnostics</h2>
        <template v-if="integrationStatus && hasDiagnostics">
          <div v-if="integrationStatus.diagnostics.lastWebhookError" class="diagnostic-block">
            <strong>Webhook failure</strong>
            <p>
              {{ integrationStatus.diagnostics.lastWebhookError.eventType }} •
              {{ formatDate(integrationStatus.diagnostics.lastWebhookError.receivedAt) }}
            </p>
            <p>{{ integrationStatus.diagnostics.lastWebhookError.errorMessage ?? 'Unknown error' }}</p>
            <button class="ghost-button retry-button" type="button" @click="replayFailedWebhook">
              Replay webhook
            </button>
          </div>
          <div
            v-if="integrationStatus.diagnostics.lastIntegrationJobError"
            class="diagnostic-block"
          >
            <strong>Integration job failure</strong>
            <p>
              {{ integrationStatus.diagnostics.lastIntegrationJobError.jobType }} •
              {{ integrationStatus.diagnostics.lastIntegrationJobError.entityExternalId ?? 'No entity id' }}
            </p>
            <p>
              {{ integrationStatus.diagnostics.lastIntegrationJobError.errorMessage ?? 'Unknown error' }}
            </p>
            <button class="ghost-button retry-button" type="button" @click="retryFailedIntegrationJob">
              Retry job
            </button>
          </div>
          <div v-if="integrationStatus.diagnostics.lastSyncRequestError" class="diagnostic-block">
            <strong>Sync request failure</strong>
            <p>{{ formatDate(integrationStatus.diagnostics.lastSyncRequestError.createdAt) }}</p>
            <p>{{ integrationStatus.diagnostics.lastSyncRequestError.errorMessage ?? 'Unknown error' }}</p>
            <button class="ghost-button retry-button" type="button" @click="retryFailedSyncRequest">
              Retry sync request
            </button>
          </div>
          <div v-if="integrationStatus.diagnostics.lastSyncAnomaly" class="diagnostic-block">
            <strong>Sync anomaly</strong>
            <p>
              {{ formatDate(integrationStatus.diagnostics.lastSyncAnomaly.completedAt) }} •
              {{ integrationStatus.diagnostics.lastSyncAnomaly.propertyCount }} properties
            </p>
            <p>
              {{
                integrationStatus.diagnostics.lastSyncAnomaly.anomalyReason ?? 'Anomalous sync volume detected'
              }}
              <template v-if="integrationStatus.diagnostics.lastSyncAnomaly.baselineMedian !== null">
                • baseline median {{ integrationStatus.diagnostics.lastSyncAnomaly.baselineMedian }}
              </template>
            </p>
          </div>
          <p class="retry-copy" :class="`retry-${retryState}`">{{ retryMessage }}</p>
          <p class="retry-copy" :class="`retry-${replayState}`">{{ replayMessage }}</p>
        </template>
        <p v-else class="muted-copy">No recent webhook, job, or sync request errors.</p>
      </article>
    </section>

    <article class="history-panel">
      <div class="panel-heading">
        <h2>Recent activity</h2>
        <div class="panel-actions">
          <span>{{ integrationHistory.length }}</span>
          <button
            class="ghost-button panel-toggle"
            type="button"
            @click="activityFeedCollapsed = !activityFeedCollapsed"
          >
            {{ activityFeedCollapsed ? 'Expand' : 'Collapse' }}
          </button>
        </div>
      </div>
      <p v-if="activityFeedCollapsed" class="muted-copy">Activity feed collapsed.</p>
      <p v-else-if="!integrationStatus" class="muted-copy">Configure Dezrez to see tenant activity.</p>
      <ol v-else-if="integrationHistory.length" class="history-list">
        <li
          v-for="activity in integrationHistory"
          :key="`${activity.source}-${activity.id}`"
          class="history-row"
        >
          <div class="history-meta">
            <span class="history-source">{{ formatActivitySource(activity.source) }}</span>
            <strong>{{ activity.title }}</strong>
            <span class="history-status">{{ activity.status }}</span>
          </div>
          <p>{{ formatDate(activity.occurredAt) }}</p>
          <p v-if="activity.subtitle" class="muted-copy">{{ activity.subtitle }}</p>
          <p v-if="activity.errorMessage" class="history-error">{{ activity.errorMessage }}</p>
        </li>
      </ol>
      <p v-else class="muted-copy">No webhook, job, or sync history available yet.</p>
    </article>

    <article class="history-panel">
      <div class="panel-heading">
        <h2>Recent webhooks</h2>
        <div class="panel-actions">
          <span>{{ recentWebhookHistory.length }}</span>
          <button
            class="ghost-button panel-toggle"
            type="button"
            @click="webhookFeedCollapsed = !webhookFeedCollapsed"
          >
            {{ webhookFeedCollapsed ? 'Expand' : 'Collapse' }}
          </button>
        </div>
      </div>
      <p v-if="webhookFeedCollapsed" class="muted-copy">Webhook feed collapsed.</p>
      <p v-else-if="!integrationStatus" class="muted-copy">Configure Dezrez to inspect webhook payloads.</p>
      <ol v-else-if="recentWebhookHistory.length" class="history-list">
        <li
          v-for="webhook in recentWebhookHistory"
          :key="`webhook-${webhook.id}`"
          class="history-row webhook-row"
        >
          <div class="history-meta">
            <span class="history-source">Webhook</span>
            <strong>{{ webhook.eventType }}</strong>
            <span class="history-status">{{ webhook.status }}</span>
          </div>
          <p>{{ formatDate(webhook.receivedAt) }}</p>
          <p class="muted-copy">
            agency {{ formatWebhookSummaryValue(webhook.summary.agencyId) }} • branch
            {{ formatWebhookSummaryValue(webhook.summary.branchId) }} • role
            {{ formatWebhookSummaryValue(webhook.summary.propertyRoleId) }}
          </p>
          <p class="muted-copy">
            property {{ formatWebhookSummaryValue(webhook.summary.propertyId) }} • root
            {{ formatWebhookSummaryValue(webhook.summary.rootEntityId) }} • change
            {{ formatWebhookSummaryValue(webhook.summary.changeType) }}
          </p>
          <p v-if="webhook.errorMessage" class="history-error">{{ webhook.errorMessage }}</p>
          <details class="webhook-payload">
            <summary>Payload</summary>
            <pre>{{ prettyJson(webhook.payloadJson) }}</pre>
          </details>
        </li>
      </ol>
      <p v-else class="muted-copy">No stored webhook payloads yet.</p>
    </article>

    <div v-if="queryErrors.length" class="error-banner">
      <p v-for="entry in queryErrors" :key="entry.source">
        <strong>{{ entry.source }}:</strong> {{ entry.message }}
      </p>
    </div>

    <section class="explorer-grid">
      <aside class="rail-panel">
        <div class="panel-heading">
          <h2>Properties</h2>
          <span>{{ propertyList.length }}</span>
        </div>
        <p v-if="propertiesQuery.isLoading.value" class="muted-copy">Loading properties…</p>
        <p v-else-if="!propertyList.length" class="muted-copy">
          Add credentials, run a sync, then reload here.
        </p>
        <button
          v-for="property in propertyList"
          :key="property.id"
          class="property-row"
          :class="{ selected: property.id === selectedPropertyId }"
          type="button"
          @click="selectedPropertyId = property.id"
        >
          <strong>{{ property.displayAddress }}</strong>
          <span>{{ property.marketingStatus ?? property.status }} • {{ property.syncState }}</span>
          <small>{{ property.externalId ?? 'No external id' }}</small>
        </button>
      </aside>

      <section class="detail-panel">
        <div v-if="!selectedPropertyId" class="empty-state">
          Pick a property to inspect the normalized read model.
        </div>

        <template v-else>
          <p v-if="propertyDetailQuery.isLoading.value" class="muted-copy">Loading property detail…</p>

          <header v-else-if="propertyDetail" class="detail-hero">
            <div>
              <p class="eyebrow">Selected property</p>
              <h2>{{ propertyDetail.displayAddress }}</h2>
              <p>{{ propertyDetail.postcode ?? 'No postcode' }}</p>
              <p class="muted-copy">
                sync {{ propertyDetail.syncState }} • last seen {{ formatDate(propertyDetail.lastSeenAt) }}
              </p>
              <p v-if="propertyDetail.delistedAt || propertyDetail.staleCandidateAt" class="muted-copy">
                {{
                  propertyDetail.delistedAt
                    ? `delisted ${formatDate(propertyDetail.delistedAt)}${propertyDetail.delistedReason ? ` • ${propertyDetail.delistedReason}` : ''}`
                    : `stale candidate since ${formatDate(propertyDetail.staleCandidateAt)}`
                }}
              </p>
            </div>
            <dl class="metric-strip">
              <div>
                <dt>Offers</dt>
                <dd>{{ propertyDetail.counts.offers }}</dd>
              </div>
              <div>
                <dt>Viewings</dt>
                <dd>{{ propertyDetail.counts.viewings }}</dd>
              </div>
              <div>
                <dt>Timeline</dt>
                <dd>{{ propertyDetail.counts.timelineEvents }}</dd>
              </div>
              <div>
                <dt>Misses</dt>
                <dd>{{ propertyDetail.consecutiveMissCount }}</dd>
              </div>
            </dl>
          </header>

          <section class="card-grid">
            <article class="info-card">
              <div class="panel-heading">
                <h3>Offers</h3>
                <span>{{ offers.length }}</span>
              </div>
              <p v-if="offersQuery.isLoading.value" class="muted-copy">Loading offers…</p>
              <ul v-else class="record-list">
                <li v-for="offer in offers" :key="offer.id" class="record-card">
                  <strong>{{ offer.applicantName ?? 'Unnamed applicant' }}</strong>
                  <span>{{ formatMoney(offer.amount) }}</span>
                  <small>{{ offer.status ?? 'Unknown status' }} • {{ formatDate(offer.offeredAt) }}</small>
                </li>
              </ul>
            </article>

            <article class="info-card">
              <div class="panel-heading">
                <h3>Viewings</h3>
                <span>{{ viewings.length }}</span>
              </div>
              <p v-if="viewingsQuery.isLoading.value" class="muted-copy">Loading viewings…</p>
              <ul v-else class="record-list">
                <li v-for="viewing in viewings" :key="viewing.id" class="record-card">
                  <strong>{{ viewing.applicantName ?? 'Unnamed viewer' }}</strong>
                  <span>{{ viewing.eventStatus ?? 'Unknown status' }}</span>
                  <small>
                    {{ formatDate(viewing.startsAt) }} • feedback {{ viewing.feedbackCount }} • notes
                    {{ viewing.notesCount }}
                  </small>
                </li>
              </ul>
            </article>

            <article class="info-card">
              <div class="panel-heading">
                <h3>Files</h3>
                <span>{{ files.length }}</span>
              </div>
              <div class="file-upload-panel">
                <input
                  id="property-file-upload"
                  type="file"
                  @change="handleFileSelection"
                />
                <button
                  class="ghost-button"
                  type="button"
                  :disabled="!selectedUploadFile || fileUploadState === 'uploading'"
                  @click="uploadSelectedFile"
                >
                  {{ fileUploadState === 'uploading' ? 'Uploading…' : 'Upload file' }}
                </button>
                <small class="sync-copy" :class="`sync-${fileUploadState}`">{{ fileUploadMessage }}</small>
              </div>
              <p v-if="filesQuery.isLoading.value" class="muted-copy">Loading files…</p>
              <ul v-else class="record-list">
                <li v-for="file in files" :key="file.id" class="record-card">
                  <strong>{{ file.originalName }}</strong>
                  <span>{{ file.label ?? file.contentType }}</span>
                  <small>{{ formatDate(file.createdAt) }} • {{ file.sizeBytes }} bytes</small>
                  <button class="ghost-button file-download-button" type="button" @click="downloadFile(file)">
                    Download
                  </button>
                </li>
              </ul>
            </article>
          </section>

          <article class="timeline-panel">
            <div class="panel-heading">
              <h3>Timeline</h3>
              <span>{{ timelineEvents.length }}</span>
            </div>
            <p v-if="timelineQuery.isLoading.value" class="muted-copy">Loading timeline…</p>
            <ol v-else class="timeline-list">
              <li v-for="item in timelineEvents" :key="item.id" class="timeline-row">
                <div class="timeline-dot" />
                <div class="timeline-copy">
                  <div class="timeline-meta">
                    <strong>{{ item.title }}</strong>
                    <span>{{ item.eventType }}</span>
                    <time>{{ formatDate(item.occurredAt) }}</time>
                  </div>
                  <p v-if="item.body">{{ item.body }}</p>
                </div>
              </li>
            </ol>
          </article>
        </template>
      </section>
    </section>
  </main>
</template>
