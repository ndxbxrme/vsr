import { expect, test } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:4320';
const API_BASE_URL = `${API_ORIGIN}/api/v1`;

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function createWorkflowLibraryTenant() {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const email = `workflow-library-${unique}@example.com`;

  await postJson(`${API_BASE_URL}/auth/signup`, {
    email,
    password: 'Secret123',
    firstName: 'Workflow',
    lastName: 'Admin',
  });

  const login = await postJson<{ accessToken: string }>(`${API_BASE_URL}/auth/login`, {
    email,
    password: 'Secret123',
  });

  const createTenant = await postJson<{ tenant: { id: string } }>(
    `${API_BASE_URL}/tenants`,
    {
      name: `Workflow Library ${unique}`,
      slug: `workflow-library-${unique}`,
      branchName: 'Main',
      branchSlug: `main-${unique}`,
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/workflow-templates`,
    {
      tenantId: createTenant.tenant.id,
      key: `sales-buyer-progress-${unique}`,
      name: `Buyer Progress ${unique}`,
      side: 'Buyer',
      caseType: 'sales',
      definition: {
        importSource: 'legacy_json',
        legacyWorkflow: {
          name: 'Buyer Purchase Workflow',
        },
      },
      stages: [
        { legacyStageId: 'legacy-offer', key: 'offer_accepted', name: 'Offer accepted', stageOrder: 0 },
        { legacyStageId: 'legacy-memo', key: 'memo_sent', name: 'Memo sent', stageOrder: 1 },
        { legacyStageId: 'legacy-complete', key: 'completed', name: 'Completed', stageOrder: 2, isTerminal: true },
      ],
      edges: [
        {
          fromStageKey: 'offer_accepted',
          toStageKey: 'memo_sent',
          edgeType: 'action_trigger',
          triggerOn: 'Complete',
        },
        {
          fromStageKey: 'memo_sent',
          toStageKey: 'completed',
          edgeType: 'estimated_after',
        },
      ],
      actions: [
        {
          stageKey: 'offer_accepted',
          actionOrder: 0,
          triggerOn: 'Complete',
          actionType: 'Email',
          templateReference: 'sales-memo-email',
          recipientGroups: ['vendorsContact', 'purchasersContact'],
        },
        {
          stageKey: 'memo_sent',
          actionOrder: 1,
          triggerOn: 'Start',
          actionType: 'Trigger',
          targetStageKey: 'completed',
        },
      ],
    },
    login.accessToken,
  );

  return {
    accessToken: login.accessToken,
    tenantId: createTenant.tenant.id,
    workflowName: `Buyer Progress ${unique}`,
  };
}

test('workflow library exposes imported stages, edges, and actions', async ({ page }) => {
  const seededTenant = await createWorkflowLibraryTenant();

  await page.addInitScript(({ tenantId, accessToken }) => {
    window.localStorage.clear();
    window.localStorage.setItem('vitalspace.workspace.tenantId', tenantId);
    window.localStorage.setItem('vitalspace.workspace.accessToken', accessToken);
  }, seededTenant);

  await page.goto('/workflows/sales');

  await expect(page.getByRole('heading', { name: 'Sales progression templates' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(seededTenant.workflowName) })).toBeVisible();
  await expect(page.getByRole('heading', { name: seededTenant.workflowName })).toBeVisible();
  await expect(page.getByText('legacy_json • Buyer Purchase Workflow')).toBeVisible();
  await expect(page.getByText('Offer accepted -> Memo sent')).toBeVisible();
  await expect(page.locator('.workflow-action-row strong', { hasText: 'Email' })).toBeVisible();
  await expect(page.getByText('template sales-memo-email')).toBeVisible();
  await expect(page.getByText('recipients: vendorsContact, purchasersContact')).toBeVisible();
});
