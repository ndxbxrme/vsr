import { describe, expect, it } from 'vitest';
import { shouldAutoCloseCase, shouldAutoCreateCase } from './case-lifecycle';

describe('case lifecycle rules', () => {
  it('auto-creates sales and lettings cases only for qualifying live statuses', () => {
    expect(
      shouldAutoCreateCase({
        caseType: 'sales',
        marketingStatus: 'InstructionToSell',
        hasActiveCase: false,
        isDelisted: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoCreateCase({
        caseType: 'lettings',
        marketingStatus: 'InstructionToLet',
        hasActiveCase: false,
        isDelisted: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoCreateCase({
        caseType: 'sales',
        marketingStatus: 'WithdrawnInstruction',
        hasActiveCase: false,
        isDelisted: false,
      }),
    ).toBe(false);

    expect(
      shouldAutoCreateCase({
        caseType: 'sales',
        marketingStatus: 'InstructionToSell',
        hasActiveCase: true,
        isDelisted: false,
      }),
    ).toBe(false);
  });

  it('auto-closes open cases only for progression completion or confident delisting', () => {
    expect(
      shouldAutoCloseCase({
        caseStatus: 'open',
        progressionCompleted: true,
        propertySyncState: 'active',
      }),
    ).toEqual({
      nextStatus: 'completed',
      closedReason: 'progression_completed',
    });

    expect(
      shouldAutoCloseCase({
        caseStatus: 'open',
        progressionCompleted: false,
        propertySyncState: 'delisted',
      }),
    ).toEqual({
      nextStatus: 'cancelled',
      closedReason: 'property_delisted',
    });

    expect(
      shouldAutoCloseCase({
        caseStatus: 'completed',
        progressionCompleted: true,
        propertySyncState: 'delisted',
      }),
    ).toBe(false);
  });
});
