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

async function createSeededExplorerTenant() {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  const email = `explorer-e2e-${unique}@example.com`;
  const slug = `explorer-estates-${unique}`;

  await postJson<{ user: { id: string } }>(`${API_BASE_URL}/auth/signup`, {
    email,
    password: 'Secret123',
    firstName: 'Explorer',
    lastName: 'Owner',
  });

  const login = await postJson<{ accessToken: string }>(`${API_BASE_URL}/auth/login`, {
    email,
    password: 'Secret123',
  });

  const createTenant = await postJson<{ tenant: { id: string } }>(
    `${API_BASE_URL}/tenants`,
    {
      name: `Explorer Estates ${unique}`,
      slug,
      branchName: 'Main',
      branchSlug: `main-${unique}`,
    },
    login.accessToken,
  );

  const configureDezrez = await postJson<{ integrationAccount: { id: string } }>(
    `${API_BASE_URL}/integrations/dezrez/accounts`,
    {
      tenantId: createTenant.tenant.id,
      name: 'Seeded Explorer Dezrez',
      settings: {
        mode: 'seed',
        seedProperties: [
          {
            externalId: 'DRZ-500',
            propertyId: '500',
            displayAddress: '12 Example Street, Manchester',
            postcode: 'M1 2AB',
            marketingStatus: 'for_sale',
          },
        ],
        seedOffersByRoleId: {
          'DRZ-500': [
            {
              Id: 'offer-500',
              MarketingRoleId: 'DRZ-500',
              Value: 550000,
              DateTime: '2026-03-11T10:00:00.000Z',
              ApplicantGroup: {
                PrimaryMember: {
                  ContactName: 'Alicia Buyer',
                  PrimaryEmail: 'alicia@example.com',
                },
                Grade: {
                  Name: 'Hot',
                },
              },
              Response: {
                ResponseType: {
                  Name: 'Accepted',
                },
              },
            },
          ],
        },
        seedViewingsByRoleId: {
          'DRZ-500': [
            {
              Id: 'viewing-500',
              MarketingRoleId: 'DRZ-500',
              StartDate: '2026-03-11T15:00:00.000Z',
              EventStatus: {
                Name: 'Confirmed',
              },
              MainContact: {
                ContactName: 'Victor Viewer',
                PrimaryEmail: 'victor@example.com',
              },
              Grade: {
                Name: 'Warm',
              },
            },
          ],
        },
        seedViewingDetailsByRoleId: {
          'DRZ-500': [
            {
              Id: 'viewing-500',
              MarketingRoleId: 'DRZ-500',
              StartDate: '2026-03-11T15:00:00.000Z',
              EventStatus: {
                Name: 'Confirmed',
              },
              MainContact: {
                ContactName: 'Victor Viewer',
                PrimaryEmail: 'victor@example.com',
              },
              Grade: {
                Name: 'Warm',
              },
              Feedback: [{ Id: 'feedback-1' }],
              Notes: [{ Id: 'note-1' }],
            },
          ],
        },
        seedEventsByRoleId: {
          'DRZ-500': [
            {
              Id: 'timeline-500',
              MarketingRoleId: 'DRZ-500',
              EventType: {
                Name: 'Memo',
                SystemName: 'memo',
              },
              Title: 'Vendor updated fixtures',
              Description: 'Kitchen appliances confirmed',
              OccurredAt: '2026-03-11T16:00:00.000Z',
              CreatedBy: {
                Name: 'Case Handler',
                Email: 'case-handler@example.com',
              },
            },
          ],
        },
      },
    },
    login.accessToken,
  );

  const status = await getJson<{ integrationAccount: { id: string; name: string } | null }>(
    `${API_BASE_URL}/integrations/dezrez/accounts?tenantId=${createTenant.tenant.id}`,
    login.accessToken,
  );

  if (!status.integrationAccount) {
    throw new Error('seeded_integration_status_missing');
  }

  return {
    accessToken: login.accessToken,
    tenantId: createTenant.tenant.id,
    integrationAccountId: configureDezrez.integrationAccount.id,
  };
}

async function sendDezrezWebhook(integrationAccountId: string, eventName: string) {
  const response = await fetch(`${API_ORIGIN}/event?integrationAccountId=${integrationAccountId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      EventName: eventName,
      PropertyId: '500',
      PropertyRoleId: 'DRZ-500',
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook ${eventName} failed: ${await response.text()}`);
  }
}

test('loads seeded Dezrez data and updates through realtime invalidation', async ({ page }) => {
  test.slow();

  const seededTenant = await createSeededExplorerTenant();
  const malformedPropertyUrls = new Set<string>();

  page.on('request', (request) => {
    if (request.url().includes('/api/v1/properties//')) {
      malformedPropertyUrls.add(request.url());
    }
  });

  await page.addInitScript(({ tenantId, accessToken }) => {
    window.localStorage.clear();
    window.localStorage.setItem('vitalspace.explorer.tenantId', tenantId);
    window.localStorage.setItem('vitalspace.explorer.accessToken', accessToken);
  }, seededTenant);
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      name: 'Sales and lettings workspaces are ready for the first operational slice.',
    }),
  ).toBeVisible();
  await expect(page.getByText('API base: http://127.0.0.1:4320/api/v1')).toBeVisible();

  await page.getByRole('link', { name: 'Open Property Explorer' }).click();
  await expect(page.getByRole('heading', { name: 'Property read model validation' })).toBeVisible();
  await expect
    .poll(() => malformedPropertyUrls.size, {
      message: `unexpected malformed property urls: ${[...malformedPropertyUrls].join(', ')}`,
    })
    .toBe(0);

  await expect(page.getByText('Seeded Explorer Dezrez')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('properties 0')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Request sync' }).click();
  await expect(page.getByText(/Sync accepted\./)).toBeVisible();
  await expect(page.getByText('properties 1')).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.property-row').filter({ hasText: '12 Example Street, Manchester' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/last event/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Property sync completed')).toBeVisible({ timeout: 20_000 });

  await page.locator('.property-row').filter({ hasText: '12 Example Street, Manchester' }).click();
  await expect(page.getByText(/sync active/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Misses/i)).toBeVisible({ timeout: 20_000 });

  await sendDezrezWebhook(seededTenant.integrationAccountId, 'Offer');
  await sendDezrezWebhook(seededTenant.integrationAccountId, 'ViewingFeedback');
  await sendDezrezWebhook(seededTenant.integrationAccountId, 'GenericEvent');

  await expect(page.getByText('Alicia Buyer')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Victor Viewer')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Vendor updated fixtures')).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('.history-row strong').filter({ hasText: 'ViewingFeedback' }).first(),
  ).toBeVisible({ timeout: 20_000 });

  await page.setInputFiles('#property-file-upload', {
    name: 'memorandum.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('memorandum for testing', 'utf8'),
  });
  await page.getByRole('button', { name: 'Upload file' }).click();
  await expect(page.getByText('memorandum.txt uploaded successfully.')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('memorandum.txt')).toBeVisible({ timeout: 20_000 });
  expect([...malformedPropertyUrls]).toEqual([]);
});
