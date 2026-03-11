import { describe, expect, it } from 'vitest';
import {
  createCasePartySchema,
  createCaseSchema,
  createContactSchema,
  createWorkflowTemplateSchema,
} from './index';

describe('shared core contracts', () => {
  it('parses contact and case payloads with defaults', () => {
    const contact = createContactSchema.parse({
      tenantId: '00000000-0000-0000-0000-000000000001',
      displayName: 'Jane Seller',
      primaryEmail: 'jane@example.com',
    });

    const caseRecord = createCaseSchema.parse({
      tenantId: '00000000-0000-0000-0000-000000000001',
      caseType: 'sales',
      title: '12 North Street Sale',
    });

    expect(contact.contactType).toBe('person');
    expect(caseRecord.status).toBe('open');
  });

  it('parses case parties and workflow templates', () => {
    const party = createCasePartySchema.parse({
      tenantId: '00000000-0000-0000-0000-000000000001',
      caseId: '00000000-0000-0000-0000-000000000010',
      partyRole: 'seller',
      displayName: 'Jane Seller',
    });

    const workflowTemplate = createWorkflowTemplateSchema.parse({
      key: 'sales-default',
      name: 'Sales Default',
      caseType: 'sales',
      stages: [
        {
          key: 'instruction',
          name: 'Instruction',
          stageOrder: 0,
        },
        {
          key: 'completed',
          name: 'Completed',
          stageOrder: 1,
          isTerminal: true,
        },
      ],
    });

    expect(party.isPrimary).toBe(false);
    expect(workflowTemplate.stages).toHaveLength(2);
    expect(workflowTemplate.stages[1]?.isTerminal).toBe(true);
  });
});
