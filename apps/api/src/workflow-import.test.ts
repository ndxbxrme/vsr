import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildImportedWorkflowTemplates } from './workflow-import';

describe('workflow import', () => {
  it('builds version-ready workflow templates from the legacy sales and lettings JSON', () => {
    const salesJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'sources/data/workflow-sales.json'), 'utf8'),
    );
    const lettingsJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'sources/data/workflow-lettings.json'), 'utf8'),
    );

    const salesTemplates = buildImportedWorkflowTemplates({
      caseType: 'sales',
      workflows: salesJson,
    });
    const lettingsTemplates = buildImportedWorkflowTemplates({
      caseType: 'lettings',
      workflows: lettingsJson,
    });

    expect(salesTemplates).toHaveLength(2);
    expect(lettingsTemplates).toHaveLength(2);
    const firstSalesTemplate = salesTemplates[0]!;
    const firstLettingsTemplate = lettingsTemplates[0]!;

    expect(firstSalesTemplate).toMatchObject({
      caseType: 'sales',
      side: 'Buyer',
      status: 'active',
      isSystem: false,
    });
    expect(firstSalesTemplate.stages.length).toBeGreaterThan(5);
    expect(
      firstSalesTemplate.edges.some(
        (edge) => edge.edgeType === 'action_trigger' && edge.fromStageKey === '8forob3s',
      ),
    ).toBe(true);
    expect(
      firstSalesTemplate.actions.some(
        (action) =>
          action.actionType === 'Email' &&
          action.templateReference === '58dd157d4ca0dca73c975b98',
      ),
    ).toBe(true);

    expect(firstLettingsTemplate).toMatchObject({
      caseType: 'lettings',
      side: 'Tenant',
      status: 'active',
      isSystem: false,
    });
    expect(
      firstLettingsTemplate.actions.some(
        (action) =>
          action.actionType === 'Sms' &&
          Array.isArray(action.recipientGroups) &&
          action.recipientGroups.includes('purchasersContact'),
      ),
    ).toBe(true);
    expect(
      firstLettingsTemplate.stages.some(
        (stage) => stage.isTerminal && typeof stage.legacyStageId === 'string',
      ),
    ).toBe(true);
  });
});
