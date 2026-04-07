import { type createDbClient, schema } from '@vitalspace/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  createCaseRecord,
  loadCaseDetail,
  loadCaseRecord,
  loadWorkflowSummariesForCaseIds,
  pickPrimaryWorkflow,
} from './case-service';

type DbClient = ReturnType<typeof createDbClient>['db'];

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label}_not_found`);
  }

  return value;
}

export async function createSalesCaseRecord(args: {
  db: DbClient;
  tenantId: string;
  branchId?: string | null;
  propertyId?: string | null;
  ownerMembershipId?: string | null;
  workflowTemplateId?: string | null;
  reference?: string;
  title: string;
  description?: string;
  closedReason?: string | null;
  askingPrice?: number;
  agreedPrice?: number;
  saleStatus: string;
  memorandumSentAt?: Date;
  targetExchangeAt?: Date;
  targetCompletionAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const caseBundle = await createCaseRecord({
    db: args.db,
    tenantId: args.tenantId,
    caseType: 'sales',
    status: 'open',
    title: args.title,
    ...(args.branchId !== undefined ? { branchId: args.branchId } : {}),
    ...(args.propertyId !== undefined ? { propertyId: args.propertyId } : {}),
    ...(args.ownerMembershipId !== undefined ? { ownerMembershipId: args.ownerMembershipId } : {}),
    ...(args.workflowTemplateId !== undefined
      ? { workflowTemplateId: args.workflowTemplateId }
      : {}),
    ...(args.reference !== undefined ? { reference: args.reference } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.closedReason !== undefined ? { closedReason: args.closedReason } : {}),
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
  });

  const createdSalesCases = await args.db
    .insert(schema.salesCases)
    .values({
      tenantId: args.tenantId,
      caseId: caseBundle.caseRecord.id,
      askingPrice: args.askingPrice ?? null,
      agreedPrice: args.agreedPrice ?? null,
      saleStatus: args.saleStatus,
      memorandumSentAt: args.memorandumSentAt ?? null,
      targetExchangeAt: args.targetExchangeAt ?? null,
      targetCompletionAt: args.targetCompletionAt ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return {
    ...caseBundle,
    salesCase: requireValue(createdSalesCases[0], 'sales_case'),
  };
}

export async function updateSalesCaseRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  title?: string;
  description?: string;
  ownerMembershipId?: string | null;
  status?: 'open' | 'on_hold' | 'completed' | 'cancelled';
  closedReason?: string | null;
  askingPrice?: number | null;
  agreedPrice?: number | null;
  saleStatus?: string;
  memorandumSentAt?: Date | null;
  targetExchangeAt?: Date | null;
  targetCompletionAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  const [salesCase] = await args.db
    .select()
    .from(schema.salesCases)
    .where(
      and(eq(schema.salesCases.tenantId, args.tenantId), eq(schema.salesCases.caseId, args.caseId)),
    )
    .limit(1);

  if (!salesCase) {
    throw new Error('sales_case_not_found');
  }

  if (
    args.title !== undefined ||
    args.description !== undefined ||
    args.ownerMembershipId !== undefined ||
    args.status !== undefined ||
    args.closedReason !== undefined
  ) {
    if (args.ownerMembershipId) {
      const [membership] = await args.db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.id, args.ownerMembershipId),
            eq(schema.memberships.tenantId, args.tenantId),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new Error('owner_membership_not_found');
      }
    }

    await args.db
      .update(schema.cases)
      .set({
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.ownerMembershipId !== undefined ? { ownerMembershipId: args.ownerMembershipId } : {}),
        ...(args.status !== undefined
          ? {
              status: args.status,
              closedAt: args.status === 'completed' || args.status === 'cancelled' ? new Date() : null,
            }
          : {}),
        ...(args.closedReason !== undefined ? { closedReason: args.closedReason } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.cases.id, args.caseId));
  }

  await args.db
    .update(schema.salesCases)
    .set({
      ...(args.askingPrice !== undefined ? { askingPrice: args.askingPrice } : {}),
      ...(args.agreedPrice !== undefined ? { agreedPrice: args.agreedPrice } : {}),
      ...(args.saleStatus !== undefined ? { saleStatus: args.saleStatus } : {}),
      ...(args.memorandumSentAt !== undefined ? { memorandumSentAt: args.memorandumSentAt } : {}),
      ...(args.targetExchangeAt !== undefined ? { targetExchangeAt: args.targetExchangeAt } : {}),
      ...(args.targetCompletionAt !== undefined
        ? { targetCompletionAt: args.targetCompletionAt }
        : {}),
      ...(args.metadata !== undefined ? { metadataJson: args.metadata } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.salesCases.id, salesCase.id));

  const [updatedSalesCase] = await args.db
    .select()
    .from(schema.salesCases)
    .where(eq(schema.salesCases.id, salesCase.id))
    .limit(1);

  return requireValue(updatedSalesCase, 'sales_case');
}

export async function createSalesOfferRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  contactId?: string | null;
  amount: number;
  status: string;
  submittedAt?: Date;
  respondedAt?: Date | null;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  const [salesCase] = await args.db
    .select()
    .from(schema.salesCases)
    .where(
      and(eq(schema.salesCases.tenantId, args.tenantId), eq(schema.salesCases.caseId, args.caseId)),
    )
    .limit(1);

  if (!salesCase) {
    throw new Error('sales_case_not_found');
  }

  if (args.contactId) {
    const [contact] = await args.db
      .select()
      .from(schema.contacts)
      .where(
        and(eq(schema.contacts.tenantId, args.tenantId), eq(schema.contacts.id, args.contactId)),
      )
      .limit(1);

    if (!contact) {
      throw new Error('contact_not_found');
    }
  }

  const createdSalesOffers = await args.db
    .insert(schema.salesOffers)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      salesCaseId: salesCase.id,
      contactId: args.contactId ?? null,
      amount: args.amount,
      status: args.status,
      submittedAt: args.submittedAt ?? new Date(),
      respondedAt: args.respondedAt ?? null,
      notes: args.notes ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  if (args.status === 'accepted') {
    await args.db
      .update(schema.salesCases)
      .set({
        agreedPrice: args.amount,
        saleStatus: 'offer_accepted',
        updatedAt: new Date(),
      })
      .where(eq(schema.salesCases.id, salesCase.id));
  } else {
    await args.db
      .update(schema.salesCases)
      .set({
        saleStatus: 'offer_received',
        updatedAt: new Date(),
      })
      .where(eq(schema.salesCases.id, salesCase.id));
  }

  return requireValue(createdSalesOffers[0], 'sales_offer');
}

export async function listSalesOffers(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  return args.db
    .select({
      id: schema.salesOffers.id,
      tenantId: schema.salesOffers.tenantId,
      caseId: schema.salesOffers.caseId,
      salesCaseId: schema.salesOffers.salesCaseId,
      contactId: schema.salesOffers.contactId,
      amount: schema.salesOffers.amount,
      status: schema.salesOffers.status,
      submittedAt: schema.salesOffers.submittedAt,
      respondedAt: schema.salesOffers.respondedAt,
      notes: schema.salesOffers.notes,
      metadataJson: schema.salesOffers.metadataJson,
      createdAt: schema.salesOffers.createdAt,
      updatedAt: schema.salesOffers.updatedAt,
      contactDisplayName: schema.contacts.displayName,
    })
    .from(schema.salesOffers)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.salesOffers.contactId))
    .where(
      and(eq(schema.salesOffers.tenantId, args.tenantId), eq(schema.salesOffers.caseId, args.caseId)),
    )
    .orderBy(desc(schema.salesOffers.submittedAt), desc(schema.salesOffers.createdAt));
}

export async function listSalesCaseRecords(args: {
  db: DbClient;
  tenantId: string;
  status?: 'open' | 'on_hold' | 'completed' | 'cancelled';
  saleStatus?: string;
  branchId?: string;
}) {
  const caseRows = await args.db
    .select({
      id: schema.cases.id,
      tenantId: schema.cases.tenantId,
      branchId: schema.cases.branchId,
      propertyId: schema.cases.propertyId,
      ownerMembershipId: schema.cases.ownerMembershipId,
      caseType: schema.cases.caseType,
      status: schema.cases.status,
      closedReason: schema.cases.closedReason,
      reference: schema.cases.reference,
      title: schema.cases.title,
      description: schema.cases.description,
      openedAt: schema.cases.openedAt,
      closedAt: schema.cases.closedAt,
      createdAt: schema.cases.createdAt,
      updatedAt: schema.cases.updatedAt,
      propertyDisplayAddress: schema.properties.displayAddress,
      ownerDisplayName: schema.users.displayName,
      salesCaseId: schema.salesCases.id,
      askingPrice: schema.salesCases.askingPrice,
      agreedPrice: schema.salesCases.agreedPrice,
      saleStatus: schema.salesCases.saleStatus,
      targetExchangeAt: schema.salesCases.targetExchangeAt,
      targetCompletionAt: schema.salesCases.targetCompletionAt,
    })
    .from(schema.salesCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.salesCases.caseId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .leftJoin(schema.memberships, eq(schema.memberships.id, schema.cases.ownerMembershipId))
    .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.salesCases.tenantId, args.tenantId),
        args.status ? eq(schema.cases.status, args.status) : undefined,
        args.saleStatus ? eq(schema.salesCases.saleStatus, args.saleStatus) : undefined,
        args.branchId ? eq(schema.cases.branchId, args.branchId) : undefined,
      ),
    )
    .orderBy(desc(schema.cases.updatedAt), desc(schema.cases.createdAt));

  const workflowsByCaseId = await loadWorkflowSummariesForCaseIds({
    db: args.db,
    tenantId: args.tenantId,
    caseIds: caseRows.map((caseRow) => caseRow.id),
  });

  return caseRows.map((caseRow) => {
    const workflows = workflowsByCaseId.get(caseRow.id) ?? [];
    const primaryWorkflow = pickPrimaryWorkflow({
      caseType: 'sales',
      workflows: workflows as Array<{ track: string; templateSide?: string | null }>,
    }) as Record<string, unknown> | null;

    return {
      ...caseRow,
      workflowInstanceId: (primaryWorkflow?.id as string | undefined) ?? null,
      currentStageKey: (primaryWorkflow?.currentStageKey as string | undefined) ?? null,
      currentStageName: (primaryWorkflow?.currentStageName as string | undefined) ?? null,
      workflows,
    };
  });
}

export async function loadSalesCaseDetail(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const caseDetail = await loadCaseDetail(args);
  if (!caseDetail) {
    return null;
  }

  const [salesCase] = await args.db
    .select()
    .from(schema.salesCases)
    .where(
      and(eq(schema.salesCases.tenantId, args.tenantId), eq(schema.salesCases.caseId, args.caseId)),
    )
    .limit(1);

  if (!salesCase) {
    return null;
  }

  const salesOfferRows = await listSalesOffers(args);

  return {
    ...caseDetail,
    salesCase,
    salesOffers: salesOfferRows,
  };
}

export async function loadSalesDashboard(args: { db: DbClient; tenantId: string }) {
  const [caseTotals] = await args.db
    .select({
      totalCases: sql<number>`count(*)`,
      openCases: sql<number>`count(*) filter (where ${schema.cases.status} = 'open')`,
      completedCases: sql<number>`count(*) filter (where ${schema.cases.status} = 'completed')`,
      offerAcceptedCases: sql<number>`count(*) filter (where ${schema.salesCases.saleStatus} = 'offer_accepted')`,
      conveyancingCases: sql<number>`count(*) filter (where ${schema.salesCases.saleStatus} = 'conveyancing')`,
    })
    .from(schema.salesCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.salesCases.caseId))
    .where(eq(schema.salesCases.tenantId, args.tenantId));

  const [offerTotals] = await args.db
    .select({
      totalOffers: sql<number>`count(*)`,
      acceptedOffers: sql<number>`count(*) filter (where ${schema.salesOffers.status} = 'accepted')`,
      totalOfferValue: sql<number>`coalesce(sum(${schema.salesOffers.amount}), 0)`,
      acceptedOfferValue: sql<number>`coalesce(sum(${schema.salesOffers.amount}) filter (where ${schema.salesOffers.status} = 'accepted'), 0)`,
    })
    .from(schema.salesOffers)
    .where(eq(schema.salesOffers.tenantId, args.tenantId));

  const recentCases = await listSalesCaseRecords({
    db: args.db,
    tenantId: args.tenantId,
  });

  return {
    counts: {
      totalCases: Number(caseTotals?.totalCases ?? 0),
      openCases: Number(caseTotals?.openCases ?? 0),
      completedCases: Number(caseTotals?.completedCases ?? 0),
      offerAcceptedCases: Number(caseTotals?.offerAcceptedCases ?? 0),
      conveyancingCases: Number(caseTotals?.conveyancingCases ?? 0),
      totalOffers: Number(offerTotals?.totalOffers ?? 0),
      acceptedOffers: Number(offerTotals?.acceptedOffers ?? 0),
    },
    values: {
      totalOfferValue: Number(offerTotals?.totalOfferValue ?? 0),
      acceptedOfferValue: Number(offerTotals?.acceptedOfferValue ?? 0),
    },
    recentCases: recentCases.slice(0, 10),
  };
}

export async function ensureSalesCaseExists(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const caseRecord = await loadCaseRecord(args);
  if (!caseRecord || caseRecord.caseType !== 'sales') {
    return null;
  }

  const [salesCase] = await args.db
    .select()
    .from(schema.salesCases)
    .where(
      and(eq(schema.salesCases.tenantId, args.tenantId), eq(schema.salesCases.caseId, args.caseId)),
    )
    .limit(1);

  if (!salesCase) {
    return null;
  }

  return { caseRecord, salesCase };
}
