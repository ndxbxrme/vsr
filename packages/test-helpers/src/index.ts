type TestTenant = {
  id: string;
  name: string;
  slug: string;
};

type TestUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

type TestContact = {
  id: string;
  tenantId: string;
  contactType: 'person' | 'company' | 'organization';
  displayName: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  primaryEmail?: string;
  primaryPhone?: string;
};

type TestCase = {
  id: string;
  tenantId: string;
  propertyId?: string;
  caseType: 'sales' | 'lettings';
  status: 'open' | 'on_hold' | 'completed' | 'cancelled';
  reference: string;
  title: string;
};

type TestWorkflowTemplate = {
  id: string;
  tenantId?: string;
  key: string;
  name: string;
  caseType: 'sales' | 'lettings';
  stages: Array<{
    id: string;
    key: string;
    name: string;
    stageOrder: number;
    isTerminal?: boolean;
  }>;
};

export function createTestTenant(overrides: Partial<TestTenant> = {}): TestTenant {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? 'Test Tenant',
    slug: overrides.slug ?? 'test-tenant',
  };
}

export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000002',
    email: overrides.email ?? 'test.user@example.com',
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'User',
    displayName: overrides.displayName ?? 'Test User',
  };
}

export function createTestContact(overrides: Partial<TestContact> = {}): TestContact {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000003',
    tenantId: overrides.tenantId ?? '00000000-0000-0000-0000-000000000001',
    contactType: overrides.contactType ?? 'person',
    displayName: overrides.displayName ?? 'Jane Seller',
    firstName: overrides.firstName ?? 'Jane',
    lastName: overrides.lastName ?? 'Seller',
    ...(overrides.organizationName !== undefined
      ? { organizationName: overrides.organizationName }
      : {}),
    ...(overrides.primaryEmail !== undefined
      ? { primaryEmail: overrides.primaryEmail }
      : { primaryEmail: 'jane.seller@example.com' }),
    ...(overrides.primaryPhone !== undefined
      ? { primaryPhone: overrides.primaryPhone }
      : { primaryPhone: '07123456789' }),
  };
}

export function createTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000004',
    tenantId: overrides.tenantId ?? '00000000-0000-0000-0000-000000000001',
    ...(overrides.propertyId !== undefined ? { propertyId: overrides.propertyId } : {}),
    caseType: overrides.caseType ?? 'sales',
    status: overrides.status ?? 'open',
    reference: overrides.reference ?? 'CASE-001',
    title: overrides.title ?? '12 North Street Sale',
  };
}

export function createTestWorkflowTemplate(
  overrides: Partial<TestWorkflowTemplate> = {},
): TestWorkflowTemplate {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000005',
    ...(overrides.tenantId !== undefined ? { tenantId: overrides.tenantId } : {}),
    key: overrides.key ?? 'sales-default',
    name: overrides.name ?? 'Sales Default',
    caseType: overrides.caseType ?? 'sales',
    stages: overrides.stages ?? [
      {
        id: '00000000-0000-0000-0000-000000000006',
        key: 'instruction',
        name: 'Instruction',
        stageOrder: 0,
      },
      {
        id: '00000000-0000-0000-0000-000000000007',
        key: 'completed',
        name: 'Completed',
        stageOrder: 1,
        isTerminal: true,
      },
    ],
  };
}
