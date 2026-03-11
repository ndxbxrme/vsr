<script setup lang="ts">
import type { EntityChangedEvent } from '@vitalspace/contracts';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { io, type Socket } from 'socket.io-client';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{
  product: 'sales' | 'lettings';
}>();

type PropertySummary = {
  id: string;
  displayAddress: string;
  postcode: string | null;
};

type WorkflowTemplateSummary = {
  id: string;
  key: string;
  name: string;
  stages: Array<{
    id: string;
    key: string;
    name: string;
    stageOrder: number;
    isTerminal: boolean;
  }>;
};

type EmailTemplate = {
  id: string;
  key: string;
  name: string;
  status: string;
};

type SmsTemplate = {
  id: string;
  key: string;
  name: string;
  status: string;
};

type CaseListRow = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  propertyDisplayAddress: string | null;
  currentStageKey: string | null;
  currentStageName: string | null;
  saleStatus?: string;
  askingPrice?: number | null;
  agreedPrice?: number | null;
  lettingStatus?: string;
  monthlyRent?: number | null;
  depositAmount?: number | null;
};

type WorkflowDetail = {
  currentStageKey: string | null;
  currentStageName: string | null;
  stages: Array<{
    id: string;
    key: string;
    name: string;
    stageOrder: number;
    isTerminal: boolean;
  }>;
} | null;

type NoteRecord = {
  id: string;
  noteType: string;
  body: string;
  authorDisplayName: string | null;
  createdAt: string;
};

type FileRecord = {
  id: string;
  label: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

type CommunicationRecord = {
  id: string;
  channel: 'email' | 'sms';
  recipientEmail: string | null;
  recipientPhone: string | null;
  subject: string | null;
  body: string;
  sentByDisplayName: string | null;
  sentAt: string;
};

type TimelineEntry = {
  id: string;
  source: 'case_note' | 'workflow_transition' | 'audit' | 'communication';
  title: string;
  body: string;
  occurredAt: string;
  actor: string | null;
};

type SalesOfferRecord = {
  id: string;
  amount: number;
  status: string;
  contactDisplayName: string | null;
  submittedAt: string | null;
};

type LettingsApplicationRecord = {
  id: string;
  monthlyRentOffered: number | null;
  status: string;
  contactDisplayName: string | null;
  submittedAt: string | null;
};

type SalesCaseDetailResponse = {
  case: {
    id: string;
    title: string;
    reference: string | null;
    propertyDisplayAddress: string | null;
  };
  salesCase: {
    saleStatus: string;
    askingPrice: number | null;
    agreedPrice: number | null;
  };
  salesOffers: SalesOfferRecord[];
  notes: NoteRecord[];
  files: FileRecord[];
  communications: CommunicationRecord[];
  workflow: WorkflowDetail;
  timelineEntries: TimelineEntry[];
};

type LettingsCaseDetailResponse = {
  case: {
    id: string;
    title: string;
    reference: string | null;
    propertyDisplayAddress: string | null;
  };
  lettingsCase: {
    lettingStatus: string;
    monthlyRent: number | null;
    depositAmount: number | null;
  };
  lettingsApplications: LettingsApplicationRecord[];
  notes: NoteRecord[];
  files: FileRecord[];
  communications: CommunicationRecord[];
  workflow: WorkflowDetail;
  timelineEntries: TimelineEntry[];
};

type SalesDashboard = {
  counts: {
    totalCases: number;
    openCases: number;
    completedCases: number;
    offerAcceptedCases: number;
    conveyancingCases: number;
    totalOffers: number;
    acceptedOffers: number;
  };
  values: {
    totalOfferValue: number;
    acceptedOfferValue: number;
  };
  recentCases: CaseListRow[];
};

type LettingsDashboard = {
  counts: {
    totalCases: number;
    openCases: number;
    completedCases: number;
    agreedLets: number;
    moveIns: number;
    totalApplications: number;
    acceptedApplications: number;
  };
  values: {
    totalRentOffered: number;
  };
  recentCases: CaseListRow[];
};

type SalesPipelineReport = {
  counts: SalesDashboard['counts'];
  values: SalesDashboard['values'];
  cases: CaseListRow[];
  generatedAt: string;
};

type AgreedLetsReport = {
  counts: LettingsDashboard['counts'];
  values: LettingsDashboard['values'];
  agreedLets: Array<{
    caseId: string;
    title: string;
    reference: string | null;
    propertyDisplayAddress: string | null;
    monthlyRent: number | null;
    agreedLetAt: string | null;
    moveInAt: string | null;
    lettingStatus: string;
  }>;
  generatedAt: string;
};

const storageKeys = {
  tenantId: 'vitalspace.workspace.tenantId',
  accessToken: 'vitalspace.workspace.accessToken',
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1';
const apiOrigin = import.meta.env.VITE_API_ORIGIN ?? new URL(apiBaseUrl).origin;

const queryClient = useQueryClient();
const tenantId = ref(localStorage.getItem(storageKeys.tenantId) ?? '');
const accessToken = ref(localStorage.getItem(storageKeys.accessToken) ?? '');
const selectedCaseId = ref('');
const selectedUploadFile = ref<File | null>(null);
const connectionState = ref<'disconnected' | 'connecting' | 'connected'>('disconnected');
const lastRealtimeEvent = ref<EntityChangedEvent | null>(null);
const actionMessage = ref('No case action run in this session.');
const actionState = ref<'idle' | 'working' | 'success' | 'failed'>('idle');
let socket: Socket | null = null;

const createCaseForm = ref({
  title: '',
  reference: '',
  propertyId: '',
  workflowTemplateId: '',
  primaryAmount: '',
  secondaryAmount: '',
});

const updateCaseForm = ref({
  title: '',
  status: '',
  primaryAmount: '',
  secondaryAmount: '',
});

const recordForm = ref({
  amount: '',
  status: 'accepted',
  notes: '',
});

const noteBody = ref('');
const transitionStageKey = ref('');
const transitionSummary = ref('');
const communicationChannel = ref<'email' | 'sms'>('email');
const communicationTemplateId = ref('');
const communicationRecipientName = ref('');
const communicationRecipientEmail = ref('');
const communicationRecipientPhone = ref('');

watch(tenantId, (value) => {
  localStorage.setItem(storageKeys.tenantId, value);
});

watch(accessToken, (value) => {
  localStorage.setItem(storageKeys.accessToken, value);
});

watch(
  () => props.product,
  () => {
    selectedCaseId.value = '';
    lastRealtimeEvent.value = null;
  },
);

watch([tenantId, accessToken], ([nextTenantId, nextAccessToken], [previousTenantId, previousToken]) => {
  if (
    nextTenantId.trim() === previousTenantId.trim() &&
    nextAccessToken.trim() === previousToken.trim()
  ) {
    return;
  }

  selectedCaseId.value = '';
  lastRealtimeEvent.value = null;
});

watch(communicationChannel, () => {
  communicationTemplateId.value = '';
});

const canLoad = computed(() => tenantId.value.trim().length > 0 && accessToken.value.trim().length > 0);
const productLabel = computed(() => (props.product === 'sales' ? 'Sales' : 'Lettings'));
const recordLabel = computed(() => (props.product === 'sales' ? 'Offer' : 'Application'));
const reportLabel = computed(() =>
  props.product === 'sales' ? 'Sales pipeline report' : 'Agreed lets report',
);

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
    throw new Error((await response.text()) || `request_failed_${response.status}`);
  }

  return (await response.json()) as T;
}

async function apiPatch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken.value.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `request_failed_${response.status}`);
  }

  return (await response.json()) as T;
}

const propertiesQuery = useQuery({
  queryKey: ['workspace-properties', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ properties: PropertySummary[] }>(
      `/properties?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const workflowTemplatesQuery = useQuery({
  queryKey: ['workspace-workflow-templates', tenantId, props.product],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ workflowTemplates: WorkflowTemplateSummary[] }>(
      `/workflow-templates?tenantId=${encodeURIComponent(tenantId.value.trim())}&caseType=${props.product}`,
    ),
});

const emailTemplatesQuery = useQuery({
  queryKey: ['workspace-email-templates', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ emailTemplates: EmailTemplate[] }>(
      `/email-templates?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const smsTemplatesQuery = useQuery({
  queryKey: ['workspace-sms-templates', tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ smsTemplates: SmsTemplate[] }>(
      `/sms-templates?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const dashboardQuery = useQuery({
  queryKey: ['workspace-dashboard', props.product, tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ dashboard: SalesDashboard | LettingsDashboard }>(
      `/${props.product}/dashboard?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const casesQuery = useQuery({
  queryKey: ['workspace-cases', props.product, tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ cases: CaseListRow[] }>(
      `/${props.product}/cases?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const reportQuery = useQuery({
  queryKey: ['workspace-report', props.product, tenantId],
  enabled: canLoad,
  queryFn: () =>
    apiGet<{ report: SalesPipelineReport | AgreedLetsReport }>(
      `/reports/${props.product === 'sales' ? 'sales-pipeline' : 'agreed-lets'}?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const selectedCaseReady = computed(() => canLoad.value && selectedCaseId.value.trim().length > 0);

const caseDetailQuery = useQuery({
  queryKey: ['workspace-case-detail', props.product, tenantId, selectedCaseId],
  enabled: selectedCaseReady,
  queryFn: () =>
    apiGet<SalesCaseDetailResponse | LettingsCaseDetailResponse>(
      `/${props.product}/cases/${selectedCaseId.value}?tenantId=${encodeURIComponent(tenantId.value.trim())}`,
    ),
});

const properties = computed(() => propertiesQuery.data.value?.properties ?? []);
const workflowTemplates = computed(() => workflowTemplatesQuery.data.value?.workflowTemplates ?? []);
const cases = computed(() => casesQuery.data.value?.cases ?? []);
const dashboard = computed(() => dashboardQuery.data.value?.dashboard ?? null);
const report = computed(() => reportQuery.data.value?.report ?? null);
const detail = computed(() => caseDetailQuery.data.value ?? null);
const emailTemplates = computed(() => emailTemplatesQuery.data.value?.emailTemplates ?? []);
const smsTemplates = computed(() => smsTemplatesQuery.data.value?.smsTemplates ?? []);
const selectedTemplates = computed(() =>
  communicationChannel.value === 'email' ? emailTemplates.value : smsTemplates.value,
);

const notes = computed(() => detail.value?.notes ?? []);
const files = computed(() => detail.value?.files ?? []);
const communications = computed(() => detail.value?.communications ?? []);
const timelineEntries = computed(() => detail.value?.timelineEntries ?? []);
const workflow = computed(() => detail.value?.workflow ?? null);
const productRecords = computed(() => {
  if (!detail.value) {
    return [];
  }

  return props.product === 'sales'
    ? (detail.value as SalesCaseDetailResponse).salesOffers
    : (detail.value as LettingsCaseDetailResponse).lettingsApplications;
});

const primaryError = computed(() => {
  return (
    propertiesQuery.error.value ??
    workflowTemplatesQuery.error.value ??
    emailTemplatesQuery.error.value ??
    smsTemplatesQuery.error.value ??
    dashboardQuery.error.value ??
    casesQuery.error.value ??
    reportQuery.error.value ??
    caseDetailQuery.error.value
  );
});

watch(
  () => cases.value,
  (nextCases) => {
    if (!nextCases.length) {
      selectedCaseId.value = '';
      return;
    }

    if (!nextCases.some((caseRow) => caseRow.id === selectedCaseId.value)) {
      selectedCaseId.value = nextCases[0]?.id ?? '';
    }
  },
  { immediate: true },
);

watch(
  () => detail.value,
  (nextDetail) => {
    if (!nextDetail) {
      updateCaseForm.value = {
        title: '',
        status: '',
        primaryAmount: '',
        secondaryAmount: '',
      };
      transitionStageKey.value = '';
      return;
    }

    updateCaseForm.value.title = nextDetail.case.title;
    if (props.product === 'sales') {
      const salesDetail = nextDetail as SalesCaseDetailResponse;
      updateCaseForm.value.status = salesDetail.salesCase.saleStatus;
      updateCaseForm.value.primaryAmount = salesDetail.salesCase.askingPrice?.toString() ?? '';
      updateCaseForm.value.secondaryAmount = salesDetail.salesCase.agreedPrice?.toString() ?? '';
    } else {
      const lettingsDetail = nextDetail as LettingsCaseDetailResponse;
      updateCaseForm.value.status = lettingsDetail.lettingsCase.lettingStatus;
      updateCaseForm.value.primaryAmount = lettingsDetail.lettingsCase.monthlyRent?.toString() ?? '';
      updateCaseForm.value.secondaryAmount =
        lettingsDetail.lettingsCase.depositAmount?.toString() ?? '';
    }

    transitionStageKey.value = nextDetail.workflow?.currentStageKey ?? '';
  },
  { immediate: true },
);

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Not set';
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function setActionState(
  state: 'idle' | 'working' | 'success' | 'failed',
  message: string,
) {
  actionState.value = state;
  actionMessage.value = message;
}

async function refreshWorkspace() {
  await Promise.all([
    propertiesQuery.refetch(),
    workflowTemplatesQuery.refetch(),
    emailTemplatesQuery.refetch(),
    smsTemplatesQuery.refetch(),
    dashboardQuery.refetch(),
    casesQuery.refetch(),
    reportQuery.refetch(),
    caseDetailQuery.refetch(),
  ]);
}

function invalidateWorkspaceQueries(event: EntityChangedEvent) {
  if (event.tenantId !== tenantId.value.trim()) {
    return;
  }

  lastRealtimeEvent.value = event;
  void queryClient.invalidateQueries({
    queryKey: ['workspace-dashboard', props.product, tenantId],
  });
  void queryClient.invalidateQueries({
    queryKey: ['workspace-cases', props.product, tenantId],
  });
  void queryClient.invalidateQueries({
    queryKey: ['workspace-report', props.product, tenantId],
  });
  void queryClient.invalidateQueries({
    queryKey: ['workspace-case-detail', props.product, tenantId, selectedCaseId],
  });
}

watch(
  [canLoad, accessToken, () => props.product],
  ([ready, token]) => {
    if (socket) {
      socket.off('entity.changed', invalidateWorkspaceQueries);
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

    socket.on('entity.changed', invalidateWorkspaceQueries);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (!socket) {
    return;
  }

  socket.off('entity.changed', invalidateWorkspaceQueries);
  socket.disconnect();
  socket = null;
});

async function createCase() {
  if (!canLoad.value) {
    setActionState('failed', 'Tenant ID and bearer token are required before creating a case.');
    return;
  }

  setActionState('working', `Creating ${props.product} case...`);

  try {
    const payload: Record<string, unknown> = {
      tenantId: tenantId.value.trim(),
      caseType: props.product,
      title: createCaseForm.value.title,
      ...(createCaseForm.value.reference ? { reference: createCaseForm.value.reference } : {}),
      ...(createCaseForm.value.propertyId ? { propertyId: createCaseForm.value.propertyId } : {}),
      ...(createCaseForm.value.workflowTemplateId
        ? { workflowTemplateId: createCaseForm.value.workflowTemplateId }
        : {}),
    };

    if (props.product === 'sales') {
      if (createCaseForm.value.primaryAmount) {
        payload.askingPrice = Number(createCaseForm.value.primaryAmount);
      }

      await apiPost<{ case: { id: string } }>(`/sales/cases`, payload);
    } else {
      if (createCaseForm.value.primaryAmount) {
        payload.monthlyRent = Number(createCaseForm.value.primaryAmount);
      }

      if (createCaseForm.value.secondaryAmount) {
        payload.depositAmount = Number(createCaseForm.value.secondaryAmount);
      }

      await apiPost<{ case: { id: string } }>(`/lettings/cases`, payload);
    }

    createCaseForm.value = {
      title: '',
      reference: '',
      propertyId: '',
      workflowTemplateId: '',
      primaryAmount: '',
      secondaryAmount: '',
    };
    await refreshWorkspace();
    setActionState('success', `${productLabel.value} case created.`);
  } catch (error) {
    setActionState('failed', error instanceof Error ? error.message : 'Case creation failed.');
  }
}

async function updateCase() {
  if (!selectedCaseId.value) {
    setActionState('failed', 'Pick a case before updating it.');
    return;
  }

  setActionState('working', `Updating ${props.product} case...`);

  try {
    const payload: Record<string, unknown> = {
      tenantId: tenantId.value.trim(),
      title: updateCaseForm.value.title,
    };

    if (props.product === 'sales') {
      payload.saleStatus = updateCaseForm.value.status;
      payload.askingPrice = updateCaseForm.value.primaryAmount
        ? Number(updateCaseForm.value.primaryAmount)
        : null;
      payload.agreedPrice = updateCaseForm.value.secondaryAmount
        ? Number(updateCaseForm.value.secondaryAmount)
        : null;
      await apiPatch(`/sales/cases/${selectedCaseId.value}`, payload);
    } else {
      payload.lettingStatus = updateCaseForm.value.status;
      payload.monthlyRent = updateCaseForm.value.primaryAmount
        ? Number(updateCaseForm.value.primaryAmount)
        : null;
      payload.depositAmount = updateCaseForm.value.secondaryAmount
        ? Number(updateCaseForm.value.secondaryAmount)
        : null;
      await apiPatch(`/lettings/cases/${selectedCaseId.value}`, payload);
    }

    await refreshWorkspace();
    setActionState('success', `${productLabel.value} case updated.`);
  } catch (error) {
    setActionState('failed', error instanceof Error ? error.message : 'Case update failed.');
  }
}

async function addRecord() {
  if (!selectedCaseId.value) {
    setActionState('failed', `Pick a case before adding a ${recordLabel.value.toLowerCase()}.`);
    return;
  }

  setActionState('working', `Adding ${recordLabel.value.toLowerCase()}...`);

  try {
    if (props.product === 'sales') {
      await apiPost(`/sales/cases/${selectedCaseId.value}/offers`, {
        tenantId: tenantId.value.trim(),
        caseId: selectedCaseId.value,
        amount: Number(recordForm.value.amount),
        status: recordForm.value.status,
        ...(recordForm.value.notes ? { notes: recordForm.value.notes } : {}),
      });
    } else {
      await apiPost(`/lettings/cases/${selectedCaseId.value}/applications`, {
        tenantId: tenantId.value.trim(),
        caseId: selectedCaseId.value,
        monthlyRentOffered: Number(recordForm.value.amount),
        status: recordForm.value.status,
        ...(recordForm.value.notes ? { notes: recordForm.value.notes } : {}),
      });
    }

    recordForm.value = {
      amount: '',
      status: 'accepted',
      notes: '',
    };
    await refreshWorkspace();
    setActionState('success', `${recordLabel.value} added.`);
  } catch (error) {
    setActionState('failed', error instanceof Error ? error.message : 'Record creation failed.');
  }
}

async function addNote() {
  if (!selectedCaseId.value || !noteBody.value.trim()) {
    setActionState('failed', 'Pick a case and enter a note first.');
    return;
  }

  setActionState('working', 'Adding note...');

  try {
    await apiPost(`/cases/${selectedCaseId.value}/notes`, {
      tenantId: tenantId.value.trim(),
      caseId: selectedCaseId.value,
      noteType: 'internal',
      body: noteBody.value.trim(),
    });
    noteBody.value = '';
    await refreshWorkspace();
    setActionState('success', 'Note added.');
  } catch (error) {
    setActionState('failed', error instanceof Error ? error.message : 'Note creation failed.');
  }
}

async function transitionCase() {
  if (!selectedCaseId.value || !transitionStageKey.value) {
    setActionState('failed', 'Pick a case and target stage before transitioning.');
    return;
  }

  setActionState('working', 'Transitioning workflow...');

  try {
    await apiPost(`/cases/${selectedCaseId.value}/transitions`, {
      tenantId: tenantId.value.trim(),
      caseId: selectedCaseId.value,
      toStageKey: transitionStageKey.value,
      ...(transitionSummary.value ? { summary: transitionSummary.value } : {}),
    });
    transitionSummary.value = '';
    await refreshWorkspace();
    setActionState('success', 'Workflow transitioned.');
  } catch (error) {
    setActionState('failed', error instanceof Error ? error.message : 'Workflow transition failed.');
  }
}

async function sendCommunication() {
  if (!selectedCaseId.value || !communicationTemplateId.value) {
    setActionState('failed', 'Pick a case and a communication template first.');
    return;
  }

  setActionState('working', 'Sending communication...');

  try {
    await apiPost(`/cases/${selectedCaseId.value}/communications`, {
      tenantId: tenantId.value.trim(),
      caseId: selectedCaseId.value,
      channel: communicationChannel.value,
      templateType: communicationChannel.value,
      templateId: communicationTemplateId.value,
      ...(communicationRecipientName.value
        ? { recipientName: communicationRecipientName.value }
        : {}),
      ...(communicationChannel.value === 'email'
        ? { recipientEmail: communicationRecipientEmail.value }
        : { recipientPhone: communicationRecipientPhone.value }),
    });
    communicationRecipientName.value = '';
    communicationRecipientEmail.value = '';
    communicationRecipientPhone.value = '';
    communicationTemplateId.value = '';
    await refreshWorkspace();
    setActionState('success', 'Communication sent.');
  } catch (error) {
    setActionState(
      'failed',
      error instanceof Error ? error.message : 'Communication send failed.',
    );
  }
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

async function uploadFile() {
  if (!selectedCaseId.value || !selectedUploadFile.value) {
    setActionState('failed', 'Pick a case and choose a file before uploading.');
    return;
  }

  setActionState('working', `Uploading ${selectedUploadFile.value.name}...`);

  try {
    const base64Data = await fileToBase64(selectedUploadFile.value);
    await apiPost('/files', {
      tenantId: tenantId.value.trim(),
      entityType: 'case',
      entityId: selectedCaseId.value,
      label: `${productLabel.value} document`,
      originalName: selectedUploadFile.value.name,
      contentType: selectedUploadFile.value.type || 'application/octet-stream',
      base64Data,
    });
    const uploadedName = selectedUploadFile.value.name;
    selectedUploadFile.value = null;
    await refreshWorkspace();
    setActionState('success', `${uploadedName} uploaded successfully.`);
  } catch (error) {
    setActionState('failed', error instanceof Error ? error.message : 'File upload failed.');
  }
}

async function downloadFile(file: FileRecord) {
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

const currentCaseTitle = computed(() => detail.value?.case.title ?? 'No case selected');
const currentCaseReference = computed(() => detail.value?.case.reference ?? 'No reference');
</script>

<template>
  <main class="explorer-shell workspace-shell">
    <section class="explorer-header workspace-header">
      <div>
        <RouterLink class="back-link" to="/">Back</RouterLink>
        <p class="eyebrow">Milestone B Workspace</p>
        <h1>{{ productLabel }} operational workspace</h1>
        <p class="hero-copy">
          Work live {{ productLabel.toLowerCase() }} cases, progress workflow, send communications,
          attach files, and check the pilot report without leaving the workspace.
        </p>
        <p class="hero-meta">
          Realtime:
          <strong>{{ connectionState }}</strong>
          <template v-if="lastRealtimeEvent">
            • last event {{ lastRealtimeEvent.entityType }}.{{ lastRealtimeEvent.mutationType }}
          </template>
        </p>
      </div>
      <div class="workspace-nav">
        <RouterLink
          class="ghost-button"
          :class="{ 'workspace-nav-active': product === 'sales' }"
          to="/workspace/sales"
        >
          Sales
        </RouterLink>
        <RouterLink
          class="ghost-button"
          :class="{ 'workspace-nav-active': product === 'lettings' }"
          to="/workspace/lettings"
        >
          Lettings
        </RouterLink>
        <button class="ghost-button" type="button" :disabled="!canLoad" @click="refreshWorkspace">
          Refresh
        </button>
      </div>
    </section>

    <section class="control-panel">
      <label class="field" :for="`workspace-tenant-id-${product}`">
        <span>Tenant ID</span>
        <input
          :id="`workspace-tenant-id-${product}`"
          v-model="tenantId"
          type="text"
          placeholder="uuid"
        />
      </label>
      <label class="field field-wide" :for="`workspace-access-token-${product}`">
        <span>Bearer token</span>
        <input
          :id="`workspace-access-token-${product}`"
          v-model="accessToken"
          type="password"
          placeholder="paste access token"
        />
      </label>
      <div class="sync-panel">
        <span>{{ reportLabel }}</span>
        <p class="muted-copy">Auto-refreshes with the workspace queries.</p>
      </div>
    </section>

    <section class="status-ribbon">
      <article class="status-tile">
        <h2>Cases</h2>
        <template v-if="dashboard">
          <p>total {{ dashboard.counts.totalCases }}</p>
          <p>open {{ dashboard.counts.openCases }}</p>
          <p>completed {{ dashboard.counts.completedCases }}</p>
        </template>
      </article>
      <article class="status-tile">
        <h2>{{ recordLabel }}s</h2>
        <template v-if="dashboard && product === 'sales'">
          <p>total {{ (dashboard as SalesDashboard).counts.totalOffers }}</p>
          <p>accepted {{ (dashboard as SalesDashboard).counts.acceptedOffers }}</p>
          <p>accepted value {{ formatMoney((dashboard as SalesDashboard).values.acceptedOfferValue) }}</p>
        </template>
        <template v-else-if="dashboard">
          <p>total {{ (dashboard as LettingsDashboard).counts.totalApplications }}</p>
          <p>accepted {{ (dashboard as LettingsDashboard).counts.acceptedApplications }}</p>
          <p>rent offered {{ formatMoney((dashboard as LettingsDashboard).values.totalRentOffered) }}</p>
        </template>
      </article>
      <article class="status-tile">
        <h2>Progress</h2>
        <template v-if="dashboard && product === 'sales'">
          <p>offer accepted {{ (dashboard as SalesDashboard).counts.offerAcceptedCases }}</p>
          <p>conveyancing {{ (dashboard as SalesDashboard).counts.conveyancingCases }}</p>
        </template>
        <template v-else-if="dashboard">
          <p>agreed lets {{ (dashboard as LettingsDashboard).counts.agreedLets }}</p>
          <p>move ins {{ (dashboard as LettingsDashboard).counts.moveIns }}</p>
        </template>
      </article>
      <article class="status-tile">
        <h2>Action state</h2>
        <p :class="`sync-${actionState}`">{{ actionMessage }}</p>
      </article>
    </section>

    <p v-if="primaryError" class="error-banner">
      {{ primaryError instanceof Error ? primaryError.message : String(primaryError) }}
    </p>

    <section class="explorer-grid workspace-grid">
      <aside class="rail-panel workspace-rail">
        <article class="workspace-form-card">
          <div class="panel-heading">
            <h2>Create {{ productLabel }} case</h2>
          </div>
          <label class="field">
            <span>Title</span>
            <input v-model="createCaseForm.title" type="text" :placeholder="`${productLabel} case title`" />
          </label>
          <label class="field">
            <span>Reference</span>
            <input v-model="createCaseForm.reference" type="text" placeholder="Optional reference" />
          </label>
          <label class="field">
            <span>Property</span>
            <select v-model="createCaseForm.propertyId">
              <option value="">No linked property</option>
              <option v-for="property in properties" :key="property.id" :value="property.id">
                {{ property.displayAddress }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Workflow template</span>
            <select v-model="createCaseForm.workflowTemplateId">
              <option value="">No workflow</option>
              <option
                v-for="workflowTemplate in workflowTemplates"
                :key="workflowTemplate.id"
                :value="workflowTemplate.id"
              >
                {{ workflowTemplate.name }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>{{ product === 'sales' ? 'Asking price' : 'Monthly rent' }}</span>
            <input v-model="createCaseForm.primaryAmount" type="number" min="0" step="1" />
          </label>
          <label v-if="product === 'lettings'" class="field">
            <span>Deposit amount</span>
            <input v-model="createCaseForm.secondaryAmount" type="number" min="0" step="1" />
          </label>
          <button class="primary-link" type="button" @click="createCase">
            Create case
          </button>
        </article>

        <article class="workspace-form-card">
          <div class="panel-heading">
            <h2>{{ productLabel }} cases</h2>
            <span>{{ cases.length }}</span>
          </div>
          <p v-if="casesQuery.isLoading.value" class="muted-copy">Loading cases…</p>
          <p v-else-if="!cases.length" class="muted-copy">Create the first case to begin.</p>
          <button
            v-for="caseRow in cases"
            :key="caseRow.id"
            class="property-row"
            :class="{ selected: caseRow.id === selectedCaseId }"
            :data-case-id="caseRow.id"
            type="button"
            @click="selectedCaseId = caseRow.id"
          >
            <strong>{{ caseRow.title }}</strong>
            <span>{{ caseRow.propertyDisplayAddress ?? 'No property linked' }}</span>
            <small>
              {{ caseRow.reference ?? 'No ref' }} •
              {{ product === 'sales' ? caseRow.saleStatus : caseRow.lettingStatus }} •
              {{ caseRow.currentStageName ?? 'No workflow' }}
            </small>
          </button>
        </article>
      </aside>

      <section class="detail-panel workspace-detail">
        <article class="info-card report-card">
          <div class="panel-heading">
            <h2>{{ reportLabel }}</h2>
            <span>{{ report ? formatDate(report.generatedAt) : 'No report' }}</span>
          </div>
          <template v-if="report && product === 'sales'">
            <div class="report-grid">
              <div class="record-card">
                <strong>Accepted offer value</strong>
                <span>{{ formatMoney((report as SalesPipelineReport).values.acceptedOfferValue) }}</span>
              </div>
              <div class="record-card">
                <strong>Offer accepted cases</strong>
                <span>{{ (report as SalesPipelineReport).counts.offerAcceptedCases }}</span>
              </div>
            </div>
            <ul class="record-list">
              <li
                v-for="caseRow in (report as SalesPipelineReport).cases"
                :key="caseRow.id"
                class="record-card"
              >
                <strong>{{ caseRow.title }}</strong>
                <span>{{ caseRow.propertyDisplayAddress ?? 'No property linked' }}</span>
                <small>{{ caseRow.saleStatus ?? 'Unknown status' }}</small>
              </li>
            </ul>
          </template>
          <template v-else-if="report">
            <div class="report-grid">
              <div class="record-card">
                <strong>Agreed lets</strong>
                <span>{{ (report as AgreedLetsReport).counts.agreedLets }}</span>
              </div>
              <div class="record-card">
                <strong>Total rent offered</strong>
                <span>{{ formatMoney((report as AgreedLetsReport).values.totalRentOffered) }}</span>
              </div>
            </div>
            <ul class="record-list">
              <li
                v-for="agreedLet in (report as AgreedLetsReport).agreedLets"
                :key="agreedLet.caseId"
                class="record-card"
              >
                <strong>{{ agreedLet.title }}</strong>
                <span>{{ agreedLet.propertyDisplayAddress ?? 'No property linked' }}</span>
                <small>
                  {{ agreedLet.lettingStatus }} • move in {{ formatDate(agreedLet.moveInAt) }}
                </small>
              </li>
            </ul>
          </template>
        </article>

        <div v-if="!selectedCaseId" class="empty-state">
          Pick a case to work the operational flow.
        </div>

        <template v-else-if="detail">
          <header class="detail-hero">
            <div>
              <p class="eyebrow">Current case</p>
              <h2>{{ currentCaseTitle }}</h2>
              <p>{{ currentCaseReference }} • {{ detail.case.propertyDisplayAddress ?? 'No property linked' }}</p>
            </div>
            <dl class="metric-strip">
              <div>
                <dt>{{ product === 'sales' ? 'Asking price' : 'Monthly rent' }}</dt>
                <dd>
                  {{
                    product === 'sales'
                      ? formatMoney((detail as SalesCaseDetailResponse).salesCase.askingPrice)
                      : formatMoney((detail as LettingsCaseDetailResponse).lettingsCase.monthlyRent)
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ product === 'sales' ? 'Agreed price' : 'Deposit' }}</dt>
                <dd>
                  {{
                    product === 'sales'
                      ? formatMoney((detail as SalesCaseDetailResponse).salesCase.agreedPrice)
                      : formatMoney((detail as LettingsCaseDetailResponse).lettingsCase.depositAmount)
                  }}
                </dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>{{ workflow?.currentStageName ?? 'No workflow' }}</dd>
              </div>
            </dl>
          </header>

          <section class="card-grid workspace-card-grid">
            <article class="info-card workspace-form-card">
              <div class="panel-heading">
                <h3>Update case</h3>
              </div>
              <label class="field">
                <span>Title</span>
                <input v-model="updateCaseForm.title" type="text" />
              </label>
              <label class="field">
                <span>{{ product === 'sales' ? 'Sale status' : 'Letting status' }}</span>
                <input v-model="updateCaseForm.status" type="text" />
              </label>
              <label class="field">
                <span>{{ product === 'sales' ? 'Asking price' : 'Monthly rent' }}</span>
                <input v-model="updateCaseForm.primaryAmount" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span>{{ product === 'sales' ? 'Agreed price' : 'Deposit amount' }}</span>
                <input v-model="updateCaseForm.secondaryAmount" type="number" min="0" step="1" />
              </label>
              <button class="ghost-button" type="button" @click="updateCase">Save case</button>
            </article>

            <article class="info-card workspace-form-card">
              <div class="panel-heading">
                <h3>Add {{ recordLabel }}</h3>
                <span>{{ productRecords.length }}</span>
              </div>
              <label class="field">
                <span>{{ product === 'sales' ? 'Amount' : 'Monthly rent offered' }}</span>
                <input v-model="recordForm.amount" type="number" min="0" step="1" />
              </label>
              <label class="field">
                <span>Status</span>
                <input v-model="recordForm.status" type="text" />
              </label>
              <label class="field">
                <span>{{ product === 'sales' ? 'Offer notes' : 'Application notes' }}</span>
                <textarea v-model="recordForm.notes" rows="3" />
              </label>
              <button class="ghost-button" type="button" @click="addRecord">
                Add {{ recordLabel.toLowerCase() }}
              </button>
              <ul class="record-list">
                <li v-for="recordItem in productRecords" :key="recordItem.id" class="record-card">
                  <strong>
                    {{
                      product === 'sales'
                        ? formatMoney((recordItem as SalesOfferRecord).amount)
                        : formatMoney((recordItem as LettingsApplicationRecord).monthlyRentOffered)
                    }}
                  </strong>
                  <span>{{ recordItem.status }}</span>
                  <small>
                    {{ recordItem.contactDisplayName ?? 'No contact linked' }} •
                    {{ formatDate(recordItem.submittedAt) }}
                  </small>
                </li>
              </ul>
            </article>

            <article class="info-card workspace-form-card">
              <div class="panel-heading">
                <h3>Workflow</h3>
              </div>
              <label class="field">
                <span>Target stage</span>
                <select v-model="transitionStageKey">
                  <option
                    v-for="stage in workflow?.stages ?? []"
                    :key="stage.id"
                    :value="stage.key"
                  >
                    {{ stage.name }}
                  </option>
                </select>
              </label>
              <label class="field">
                <span>Summary</span>
                <textarea v-model="transitionSummary" rows="3" />
              </label>
              <button class="ghost-button" type="button" @click="transitionCase">
                Move workflow
              </button>
            </article>

            <article class="info-card workspace-form-card">
              <div class="panel-heading">
                <h3>Notes and files</h3>
              </div>
              <label class="field">
                <span>Case note</span>
                <textarea v-model="noteBody" rows="3" />
              </label>
              <button class="ghost-button" type="button" @click="addNote">Add note</button>
              <div class="file-upload-panel">
                <input :id="`workspace-file-upload-${product}`" type="file" @change="handleFileSelection" />
                <button class="ghost-button" type="button" @click="uploadFile">Upload file</button>
              </div>
              <ul class="record-list">
                <li v-for="note in notes" :key="note.id" class="record-card">
                  <strong>{{ note.noteType }}</strong>
                  <span>{{ note.body }}</span>
                  <small>{{ note.authorDisplayName ?? 'Unknown author' }} • {{ formatDate(note.createdAt) }}</small>
                </li>
              </ul>
              <ul class="record-list">
                <li v-for="file in files" :key="file.id" class="record-card">
                  <strong>{{ file.originalName }}</strong>
                  <span>{{ file.label ?? 'No label' }}</span>
                  <small>{{ formatDate(file.createdAt) }}</small>
                  <button class="ghost-button file-download-button" type="button" @click="downloadFile(file)">
                    Download
                  </button>
                </li>
              </ul>
            </article>

            <article class="info-card workspace-form-card">
              <div class="panel-heading">
                <h3>Communications</h3>
                <span>{{ communications.length }}</span>
              </div>
              <label class="field">
                <span>Channel</span>
                <select v-model="communicationChannel">
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
              <label class="field">
                <span>Template</span>
                <select v-model="communicationTemplateId">
                  <option value="">Select template</option>
                  <option v-for="template in selectedTemplates" :key="template.id" :value="template.id">
                    {{ template.name }}
                  </option>
                </select>
              </label>
              <label class="field">
                <span>Recipient name</span>
                <input v-model="communicationRecipientName" type="text" />
              </label>
              <label v-if="communicationChannel === 'email'" class="field">
                <span>Recipient email</span>
                <input v-model="communicationRecipientEmail" type="email" />
              </label>
              <label v-else class="field">
                <span>Recipient phone</span>
                <input v-model="communicationRecipientPhone" type="text" />
              </label>
              <button class="ghost-button" type="button" @click="sendCommunication">
                Send {{ communicationChannel }}
              </button>
              <ul class="record-list">
                <li
                  v-for="communication in communications"
                  :key="communication.id"
                  class="record-card"
                >
                  <strong>{{ communication.subject ?? communication.channel }}</strong>
                  <span>{{ communication.body }}</span>
                  <small>
                    {{
                      communication.channel === 'email'
                        ? communication.recipientEmail
                        : communication.recipientPhone
                    }}
                    • {{ formatDate(communication.sentAt) }}
                  </small>
                </li>
              </ul>
            </article>
          </section>

          <article class="timeline-panel workspace-timeline-panel">
            <div class="panel-heading">
              <h2>Timeline</h2>
              <span>{{ timelineEntries.length }}</span>
            </div>
            <ol class="timeline-list">
              <li v-for="entry in timelineEntries" :key="entry.id" class="timeline-row">
                <div class="timeline-dot" />
                <div class="timeline-copy">
                  <div class="timeline-meta">
                    <strong>{{ entry.title }}</strong>
                    <span>{{ entry.source }}</span>
                    <time>{{ formatDate(entry.occurredAt) }}</time>
                  </div>
                  <p>{{ entry.body }}</p>
                  <p v-if="entry.actor" class="muted-copy">Actor: {{ entry.actor }}</p>
                </div>
              </li>
            </ol>
          </article>
        </template>
      </section>
    </section>
  </main>
</template>
