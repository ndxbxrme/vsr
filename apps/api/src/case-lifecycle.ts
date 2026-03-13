export type CaseLifecycleProduct = 'sales' | 'lettings';

const SALES_AUTO_CREATE_STATUSES = new Set([
  'instruction',
  'instructiontosell',
  'forsale',
  'onmarket',
  'offerreceived',
  'offeraccepted',
  'conveyancing',
]);

const LETTINGS_AUTO_CREATE_STATUSES = new Set([
  'application',
  'applicationreceived',
  'applicationaccepted',
  'instructiontolet',
  'tolet',
  'agreedlet',
  'movein',
]);

function normalizeStatus(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function shouldAutoCreateCase(args: {
  caseType: CaseLifecycleProduct;
  propertyStatus?: string | null;
  marketingStatus?: string | null;
  hasActiveCase: boolean;
  isDelisted: boolean;
}) {
  if (args.hasActiveCase || args.isDelisted) {
    return false;
  }

  const candidates = [normalizeStatus(args.marketingStatus), normalizeStatus(args.propertyStatus)].filter(
    (value): value is string => Boolean(value),
  );
  const qualifyingStatuses =
    args.caseType === 'sales' ? SALES_AUTO_CREATE_STATUSES : LETTINGS_AUTO_CREATE_STATUSES;

  return candidates.some((status) => qualifyingStatuses.has(status));
}

export function shouldAutoCloseCase(args: {
  caseStatus: 'open' | 'on_hold' | 'completed' | 'cancelled';
  propertySyncState?: string | null;
  progressionCompleted: boolean;
}) {
  if (args.caseStatus === 'completed' || args.caseStatus === 'cancelled') {
    return false;
  }

  if (args.progressionCompleted) {
    return {
      nextStatus: 'completed' as const,
      closedReason: 'progression_completed',
    };
  }

  if (args.propertySyncState === 'delisted') {
    return {
      nextStatus: 'cancelled' as const,
      closedReason: 'property_delisted',
    };
  }

  return false;
}
