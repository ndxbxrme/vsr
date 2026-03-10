export function createTestTenant(overrides: Partial<{ id: string; name: string }> = {}) {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? 'Test Tenant',
  };
}
