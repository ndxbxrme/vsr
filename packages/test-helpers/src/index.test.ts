import { describe, expect, it } from 'vitest';
import {
  createTestCase,
  createTestContact,
  createTestTenant,
  createTestUser,
  createTestWorkflowTemplate,
} from './index';

describe('test helper factories', () => {
  it('creates consistent tenant, user, contact, and case fixtures', () => {
    const tenant = createTestTenant();
    const user = createTestUser();
    const contact = createTestContact();
    const caseRecord = createTestCase();

    expect(tenant.slug).toBe('test-tenant');
    expect(user.displayName).toBe('Test User');
    expect(contact.displayName).toBe('Jane Seller');
    expect(caseRecord.reference).toBe('CASE-001');
  });

  it('creates a workflow template with sensible default stages', () => {
    const workflowTemplate = createTestWorkflowTemplate();

    expect(workflowTemplate.stages).toHaveLength(2);
    expect(workflowTemplate.stages[0]?.key).toBe('instruction');
    expect(workflowTemplate.stages[1]?.isTerminal).toBe(true);
  });
});
