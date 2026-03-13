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

async function getJson<T>(url: string, accessToken?: string): Promise<T> {
  const response = await fetch(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function waitForPropertyCount(tenantId: string, accessToken: string, expectedCount: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await getJson<{ properties: Array<{ id: string }> }>(
      `${API_BASE_URL}/properties?tenantId=${tenantId}`,
      accessToken,
    );
    if (response.properties.length === expectedCount) {
      return response.properties;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`timed_out_waiting_for_property_count_${expectedCount}`);
}

async function waitForStaleCandidate(tenantId: string, accessToken: string, expectedCount: number) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await getJson<{
      integrationAccount: { staleCandidatePropertyCount: number } | null;
    }>(`${API_BASE_URL}/integrations/dezrez/accounts?tenantId=${tenantId}`, accessToken);
    if (response.integrationAccount?.staleCandidatePropertyCount === expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`timed_out_waiting_for_stale_candidate_count_${expectedCount}`);
}

async function createPilotOperationsTenant() {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const email = `pilot-ops-${unique}@example.com`;

  await postJson(`${API_BASE_URL}/auth/signup`, {
    email,
    password: 'Secret123',
    firstName: 'Pilot',
    lastName: 'Operator',
  });

  const login = await postJson<{ accessToken: string }>(`${API_BASE_URL}/auth/login`, {
    email,
    password: 'Secret123',
  });

  const createTenant = await postJson<{
    tenant: { id: string };
    branch: { id: string };
  }>(
    `${API_BASE_URL}/tenants`,
    {
      name: `Pilot Operations ${unique}`,
      slug: `pilot-ops-${unique}`,
      branchName: 'Main',
      branchSlug: `main-${unique}`,
    },
    login.accessToken,
  );

  const tenantId = createTenant.tenant.id;
  const branchId = createTenant.branch.id;

  const salesWorkflow = await postJson<{ workflowTemplate: { id: string } }>(
    `${API_BASE_URL}/workflow-templates`,
    {
      tenantId,
      key: `pilot-sales-${unique}`,
      name: `Pilot Sales ${unique}`,
      caseType: 'sales',
      stages: [
        { key: 'instruction', name: 'Instruction', stageOrder: 0 },
        { key: 'completed', name: 'Completed', stageOrder: 1, isTerminal: true },
      ],
    },
    login.accessToken,
  );

  const lettingsWorkflow = await postJson<{ workflowTemplate: { id: string } }>(
    `${API_BASE_URL}/workflow-templates`,
    {
      tenantId,
      key: `pilot-lettings-${unique}`,
      name: `Pilot Lettings ${unique}`,
      caseType: 'lettings',
      stages: [
        { key: 'application', name: 'Application', stageOrder: 0 },
        { key: 'agreed_let', name: 'Agreed Let', stageOrder: 1 },
      ],
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/email-templates`,
    {
      tenantId,
      key: `pilot-email-${unique}`,
      name: 'Pilot Email',
      subjectTemplate: 'Pilot {{case.reference}}',
      bodyTextTemplate: 'Pilot body',
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/sms-templates`,
    {
      tenantId,
      key: `pilot-sms-${unique}`,
      name: 'Pilot SMS',
      bodyTemplate: 'Pilot sms body',
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/integrations/dezrez/accounts`,
    {
      tenantId,
      name: 'Pilot Ops Dezrez',
      settings: {
        mode: 'seed',
        seedProperties: [
          {
            externalId: 'PILOT-ROLE-1',
            propertyId: 'PILOT-PROP-1',
            displayAddress: '12 Operator Street, Manchester',
            postcode: 'M1 2OP',
            marketingStatus: 'for_sale',
          },
          {
            externalId: 'PILOT-ROLE-2',
            propertyId: 'PILOT-PROP-2',
            displayAddress: '14 Missing Street, Manchester',
            postcode: 'M1 2MS',
            marketingStatus: 'for_sale',
          },
        ],
      },
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/integrations/dezrez/sync`,
    {
      tenantId,
    },
    login.accessToken,
  );

  const properties = await waitForPropertyCount(tenantId, login.accessToken, 2);
  const firstProperty = properties[0];

  if (!firstProperty) {
    throw new Error('pilot_property_not_found');
  }

  await postJson(
    `${API_BASE_URL}/sales/cases`,
    {
      tenantId,
      branchId,
      propertyId: firstProperty.id,
      workflowTemplateId: salesWorkflow.workflowTemplate.id,
      reference: `PILOT-SALES-${unique}`,
      title: 'Pilot sales case',
      askingPrice: 450000,
      saleStatus: 'instruction',
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/lettings/cases`,
    {
      tenantId,
      branchId,
      propertyId: firstProperty.id,
      workflowTemplateId: lettingsWorkflow.workflowTemplate.id,
      reference: `PILOT-LET-${unique}`,
      title: 'Pilot lettings case',
      monthlyRent: 1750,
      depositAmount: 1800,
      lettingStatus: 'application',
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/integrations/dezrez/accounts`,
    {
      tenantId,
      name: 'Pilot Ops Dezrez',
      settings: {
        mode: 'seed',
        seedProperties: [
          {
            externalId: 'PILOT-ROLE-1',
            propertyId: 'PILOT-PROP-1',
            displayAddress: '12 Operator Street, Manchester',
            postcode: 'M1 2OP',
            marketingStatus: 'for_sale',
          },
        ],
      },
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/integrations/dezrez/sync`,
    {
      tenantId,
    },
    login.accessToken,
  );

  await waitForStaleCandidate(tenantId, login.accessToken, 1);

  return {
    tenantId,
    accessToken: login.accessToken,
  };
}

test('pilot operations view surfaces stale sync trust issues and reconciliation drilldown', async ({ page }) => {
  test.slow();

  const seededTenant = await createPilotOperationsTenant();

  await page.addInitScript(({ tenantId, accessToken }) => {
    window.localStorage.clear();
    window.localStorage.setItem('vitalspace.workspace.tenantId', tenantId);
    window.localStorage.setItem('vitalspace.workspace.accessToken', accessToken);
  }, seededTenant);

  await page.goto('/pilot-readiness');

  await expect(page.getByRole('heading', { name: 'Pilot operations' })).toBeVisible();
  await expect(page.getByTestId('pilot-operator-summary')).toContainText('stale candidates 1', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('pilot-operator-alerts')).toContainText(
    'Property sync state needs review',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('pilot-operator-drilldown')).toContainText(
    '14 Missing Street, Manchester',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('pilot-report-alignment')).toContainText('Sales pipeline');
  await expect(page.getByTestId('pilot-workflow-coverage')).toContainText('Instruction');
});
