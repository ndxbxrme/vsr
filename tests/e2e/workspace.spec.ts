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
    headers: accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : undefined,
  });

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as T;
}

async function createWorkspaceTenant(product: 'sales' | 'lettings') {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const email = `${product}-workspace-${unique}@example.com`;
  const slug = `${product}-workspace-${unique}`;
  const propertyExternalId = `${product.toUpperCase()}-${unique}`;
  const propertyAddress =
    product === 'sales'
      ? `18 Market View ${unique}, Manchester`
      : `24 Harbour Court ${unique}, Manchester`;
  const workflowKey = `${product}-default-${unique}`;
  const workflowName = `${product === 'sales' ? 'Sales' : 'Lettings'} Default ${unique}`;

  await postJson(`${API_BASE_URL}/auth/signup`, {
    email,
    password: 'Secret123',
    firstName: product === 'sales' ? 'Sales' : 'Lettings',
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
      name: `${product === 'sales' ? 'Sales' : 'Lettings'} Workspace ${unique}`,
      slug,
      branchName: 'Main',
      branchSlug: `main-${unique}`,
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/workflow-templates`,
    {
      tenantId: createTenant.tenant.id,
      key: workflowKey,
      name: workflowName,
      caseType: product,
      stages:
        product === 'sales'
          ? [
              { key: 'instruction', name: 'Instruction', stageOrder: 0 },
              { key: 'conveyancing', name: 'Conveyancing', stageOrder: 1 },
              { key: 'completed', name: 'Completed', stageOrder: 2, isTerminal: true },
            ]
          : [
              { key: 'application', name: 'Application', stageOrder: 0 },
              { key: 'agreed_let', name: 'Agreed Let', stageOrder: 1 },
              { key: 'completed', name: 'Completed', stageOrder: 2, isTerminal: true },
            ],
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/email-templates`,
    {
      tenantId: createTenant.tenant.id,
      key: `${product}-email-${unique}`,
      name: `${product === 'sales' ? 'Sales' : 'Lettings'} Update`,
      subjectTemplate: `${product === 'sales' ? 'Sales' : 'Lettings'} update for {{case.reference}}`,
      bodyTextTemplate: `Case {{case.title}} at {{property.displayAddress}} has been updated.`,
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/sms-templates`,
    {
      tenantId: createTenant.tenant.id,
      key: `${product}-sms-${unique}`,
      name: `${product === 'sales' ? 'Sales' : 'Lettings'} SMS`,
      bodyTemplate: `Case {{case.reference}} for {{property.postcode}} has moved on.`,
    },
    login.accessToken,
  );

  const integrationAccount = await postJson<{ integrationAccount: { id: string } }>(
    `${API_BASE_URL}/integrations/dezrez/accounts`,
    {
      tenantId: createTenant.tenant.id,
      name: `${product} seeded Dezrez`,
      settings: {
        mode: 'seed',
        seedProperties: [
          {
            externalId: propertyExternalId,
            propertyId: propertyExternalId,
            displayAddress: propertyAddress,
            postcode: product === 'sales' ? 'M1 2AB' : 'M3 4CD',
            marketingStatus: product === 'sales' ? 'for_sale' : 'to_let',
          },
        ],
      },
    },
    login.accessToken,
  );

  await postJson(
    `${API_BASE_URL}/integrations/dezrez/sync`,
    {
      tenantId: createTenant.tenant.id,
    },
    login.accessToken,
  );

  await waitForProperty(createTenant.tenant.id, login.accessToken, propertyAddress);

  return {
    accessToken: login.accessToken,
    tenantId: createTenant.tenant.id,
    propertyAddress,
    integrationAccountId: integrationAccount.integrationAccount.id,
  };
}

async function waitForProperty(tenantId: string, accessToken: string, address: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const properties = await getJson<{ properties: Array<{ displayAddress: string }> }>(
      `${API_BASE_URL}/properties?tenantId=${tenantId}`,
      accessToken,
    );

    if (properties.properties.some((property) => property.displayAddress === address)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`timed_out_waiting_for_property_${address}`);
}

test('sales workspace supports case actions and realtime invalidation', async ({ page }) => {
  test.slow();

  const seededTenant = await createWorkspaceTenant('sales');

  await page.addInitScript(({ tenantId, accessToken }) => {
    window.localStorage.clear();
    window.localStorage.setItem('vitalspace.workspace.tenantId', tenantId);
    window.localStorage.setItem('vitalspace.workspace.accessToken', accessToken);
  }, seededTenant);

  await page.goto('/workspace/sales');
  await expect(page.getByRole('heading', { name: 'Sales operational workspace' })).toBeVisible();

  const createPanel = page.locator('.workspace-rail .workspace-form-card').first();
  await createPanel.getByLabel('Title').fill('18 Market View sale');
  await createPanel.getByLabel('Reference').fill('SALE-E2E-001');
  await createPanel.getByLabel('Property').selectOption({ label: seededTenant.propertyAddress });
  await createPanel.getByLabel('Workflow template').selectOption({ index: 1 });
  await createPanel.getByLabel('Asking price').fill('525000');
  await createPanel.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByText('Sales case created.')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.property-row').filter({ hasText: '18 Market View sale' })).toBeVisible({
    timeout: 20_000,
  });

  const detailPanel = page.locator('.workspace-detail');
  await detailPanel.getByLabel('Amount').fill('515000');
  await detailPanel.getByLabel('Offer notes').fill('Buyer accepted after second viewing.');
  await detailPanel.getByRole('button', { name: 'Add offer' }).click();
  await expect(page.getByText('Offer added.')).toBeVisible({ timeout: 20_000 });

  await detailPanel.getByLabel('Case note').fill('Initial note from the operator.');
  await detailPanel.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Note added.')).toBeVisible({ timeout: 20_000 });

  await page.setInputFiles('#workspace-file-upload-sales', {
    name: 'sales-pack.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('sales pack', 'utf8'),
  });
  await detailPanel.getByRole('button', { name: 'Upload file' }).click();
  await expect(page.getByText('sales-pack.txt uploaded successfully.')).toBeVisible({
    timeout: 20_000,
  });

  await detailPanel.getByLabel('Template').selectOption({ index: 1 });
  await detailPanel.getByLabel('Recipient name').fill('Jamie Seller');
  await detailPanel.getByLabel('Recipient email').fill('jamie.seller@example.com');
  await detailPanel.getByRole('button', { name: 'Send email' }).click();
  await expect(page.getByText('Communication sent.')).toBeVisible({ timeout: 20_000 });

  await detailPanel.getByLabel('Target stage').selectOption('completed');
  await detailPanel.getByLabel('Summary').fill('Sale completed from the workspace.');
  await detailPanel.getByRole('button', { name: 'Move workflow' }).click();
  await expect(page.getByText('Workflow transitioned.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('accepted value £515,000')).toBeVisible({ timeout: 20_000 });

  const caseButton = page.locator('.property-row').filter({ hasText: '18 Market View sale' }).first();
  const selectedCaseId =
    (await caseButton.getAttribute('data-case-id')) ??
    (await page.locator('.property-row.selected').first().getAttribute('data-case-id'));

  if (!selectedCaseId) {
    throw new Error('sales_case_id_not_found');
  }

  await postJson(
    `${API_BASE_URL}/cases/${selectedCaseId}/notes`,
    {
      tenantId: seededTenant.tenantId,
      caseId: selectedCaseId,
      noteType: 'internal',
      body: 'Realtime note from API test.',
    },
    seededTenant.accessToken,
  );

  await expect(
    page.locator('.workspace-detail').getByText('Realtime note from API test.').first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/last event case_note\.created/i)).toBeVisible({ timeout: 20_000 });
});

test('lettings workspace supports applications and agreed lets reporting', async ({ page }) => {
  test.slow();

  const seededTenant = await createWorkspaceTenant('lettings');

  await page.addInitScript(({ tenantId, accessToken }) => {
    window.localStorage.clear();
    window.localStorage.setItem('vitalspace.workspace.tenantId', tenantId);
    window.localStorage.setItem('vitalspace.workspace.accessToken', accessToken);
  }, seededTenant);

  await page.goto('/workspace/lettings');
  await expect(page.getByRole('heading', { name: 'Lettings operational workspace' })).toBeVisible();

  const createPanel = page.locator('.workspace-rail .workspace-form-card').first();
  await createPanel.getByLabel('Title').fill('24 Harbour Court letting');
  await createPanel.getByLabel('Reference').fill('LET-E2E-001');
  await createPanel.getByLabel('Property').selectOption({ label: seededTenant.propertyAddress });
  await createPanel.getByLabel('Workflow template').selectOption({ index: 1 });
  await createPanel.getByLabel('Monthly rent').fill('1850');
  await createPanel.getByLabel('Deposit amount').fill('2000');
  await createPanel.getByRole('button', { name: 'Create case' }).click();

  await expect(page.getByText('Lettings case created.')).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.property-row').filter({ hasText: '24 Harbour Court letting' }),
  ).toBeVisible({ timeout: 20_000 });

  const detailPanel = page.locator('.workspace-detail');
  await detailPanel.getByLabel('Monthly rent offered').fill('1875');
  await detailPanel.getByLabel('Application notes').fill('Applicant approved.');
  await detailPanel.getByRole('button', { name: 'Add application' }).click();
  await expect(page.getByText('Application added.')).toBeVisible({ timeout: 20_000 });

  await detailPanel.getByLabel('Target stage').selectOption('agreed_let');
  await detailPanel.getByLabel('Summary').fill('Agreed let confirmed in the workspace.');
  await detailPanel.getByRole('button', { name: 'Move workflow' }).click();
  await expect(page.getByText('Workflow transitioned.')).toBeVisible({ timeout: 20_000 });

  await expect(
    page.getByRole('heading', {
      name: 'Agreed lets report',
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.report-card').getByText('24 Harbour Court letting').first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.report-card').getByText('£1,875').first()).toBeVisible({
    timeout: 20_000,
  });
});
