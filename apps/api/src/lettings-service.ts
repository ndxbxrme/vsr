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

export async function createLettingsCaseRecord(args: {
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
  monthlyRent?: number;
  depositAmount?: number;
  lettingStatus: string;
  agreedAt?: Date;
  moveInAt?: Date;
  agreedLetAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const caseBundle = await createCaseRecord({
    db: args.db,
    tenantId: args.tenantId,
    caseType: 'lettings',
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

  const createdLettingsCases = await args.db
    .insert(schema.lettingsCases)
    .values({
      tenantId: args.tenantId,
      caseId: caseBundle.caseRecord.id,
      monthlyRent: args.monthlyRent ?? null,
      depositAmount: args.depositAmount ?? null,
      lettingStatus: args.lettingStatus,
      agreedAt: args.agreedAt ?? null,
      moveInAt: args.moveInAt ?? null,
      agreedLetAt: args.agreedLetAt ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return {
    ...caseBundle,
    lettingsCase: requireValue(createdLettingsCases[0], 'lettings_case'),
  };
}

export async function updateLettingsCaseRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  title?: string;
  description?: string;
  ownerMembershipId?: string | null;
  status?: 'open' | 'on_hold' | 'completed' | 'cancelled';
  closedReason?: string | null;
  monthlyRent?: number | null;
  depositAmount?: number | null;
  lettingStatus?: string;
  agreedAt?: Date | null;
  moveInAt?: Date | null;
  agreedLetAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  const [lettingsCase] = await args.db
    .select()
    .from(schema.lettingsCases)
    .where(
      and(
        eq(schema.lettingsCases.tenantId, args.tenantId),
        eq(schema.lettingsCases.caseId, args.caseId),
      ),
    )
    .limit(1);

  if (!lettingsCase) {
    throw new Error('lettings_case_not_found');
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
    .update(schema.lettingsCases)
    .set({
      ...(args.monthlyRent !== undefined ? { monthlyRent: args.monthlyRent } : {}),
      ...(args.depositAmount !== undefined ? { depositAmount: args.depositAmount } : {}),
      ...(args.lettingStatus !== undefined ? { lettingStatus: args.lettingStatus } : {}),
      ...(args.agreedAt !== undefined ? { agreedAt: args.agreedAt } : {}),
      ...(args.moveInAt !== undefined ? { moveInAt: args.moveInAt } : {}),
      ...(args.agreedLetAt !== undefined ? { agreedLetAt: args.agreedLetAt } : {}),
      ...(args.metadata !== undefined ? { metadataJson: args.metadata } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.lettingsCases.id, lettingsCase.id));

  const [updatedLettingsCase] = await args.db
    .select()
    .from(schema.lettingsCases)
    .where(eq(schema.lettingsCases.id, lettingsCase.id))
    .limit(1);

  return requireValue(updatedLettingsCase, 'lettings_case');
}

export async function createLettingsApplicationRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  contactId?: string | null;
  monthlyRentOffered?: number | null;
  status: string;
  submittedAt?: Date;
  respondedAt?: Date | null;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  const [lettingsCase] = await args.db
    .select()
    .from(schema.lettingsCases)
    .where(
      and(
        eq(schema.lettingsCases.tenantId, args.tenantId),
        eq(schema.lettingsCases.caseId, args.caseId),
      ),
    )
    .limit(1);

  if (!lettingsCase) {
    throw new Error('lettings_case_not_found');
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

  const createdApplications = await args.db
    .insert(schema.lettingsApplications)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      lettingsCaseId: lettingsCase.id,
      contactId: args.contactId ?? null,
      monthlyRentOffered: args.monthlyRentOffered ?? null,
      status: args.status,
      submittedAt: args.submittedAt ?? new Date(),
      respondedAt: args.respondedAt ?? null,
      notes: args.notes ?? null,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  if (args.status === 'accepted') {
    await args.db
      .update(schema.lettingsCases)
      .set({
        monthlyRent: args.monthlyRentOffered ?? lettingsCase.monthlyRent,
        lettingStatus: 'application_accepted',
        agreedAt: new Date(),
        agreedLetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.lettingsCases.id, lettingsCase.id));
  } else {
    await args.db
      .update(schema.lettingsCases)
      .set({
        lettingStatus: 'application_received',
        updatedAt: new Date(),
      })
      .where(eq(schema.lettingsCases.id, lettingsCase.id));
  }

  return requireValue(createdApplications[0], 'lettings_application');
}

export async function listLettingsApplications(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  return args.db
    .select({
      id: schema.lettingsApplications.id,
      tenantId: schema.lettingsApplications.tenantId,
      caseId: schema.lettingsApplications.caseId,
      lettingsCaseId: schema.lettingsApplications.lettingsCaseId,
      contactId: schema.lettingsApplications.contactId,
      monthlyRentOffered: schema.lettingsApplications.monthlyRentOffered,
      status: schema.lettingsApplications.status,
      submittedAt: schema.lettingsApplications.submittedAt,
      respondedAt: schema.lettingsApplications.respondedAt,
      notes: schema.lettingsApplications.notes,
      metadataJson: schema.lettingsApplications.metadataJson,
      createdAt: schema.lettingsApplications.createdAt,
      updatedAt: schema.lettingsApplications.updatedAt,
      contactDisplayName: schema.contacts.displayName,
    })
    .from(schema.lettingsApplications)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.lettingsApplications.contactId))
    .where(
      and(
        eq(schema.lettingsApplications.tenantId, args.tenantId),
        eq(schema.lettingsApplications.caseId, args.caseId),
      ),
    )
    .orderBy(
      desc(schema.lettingsApplications.submittedAt),
      desc(schema.lettingsApplications.createdAt),
    );
}

export async function listLettingsCaseRecords(args: {
  db: DbClient;
  tenantId: string;
  status?: 'open' | 'on_hold' | 'completed' | 'cancelled';
  lettingStatus?: string;
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
      lettingsCaseId: schema.lettingsCases.id,
      monthlyRent: schema.lettingsCases.monthlyRent,
      depositAmount: schema.lettingsCases.depositAmount,
      lettingStatus: schema.lettingsCases.lettingStatus,
      agreedAt: schema.lettingsCases.agreedAt,
      moveInAt: schema.lettingsCases.moveInAt,
      agreedLetAt: schema.lettingsCases.agreedLetAt,
    })
    .from(schema.lettingsCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.lettingsCases.caseId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .leftJoin(schema.memberships, eq(schema.memberships.id, schema.cases.ownerMembershipId))
    .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.lettingsCases.tenantId, args.tenantId),
        args.status ? eq(schema.cases.status, args.status) : undefined,
        args.lettingStatus ? eq(schema.lettingsCases.lettingStatus, args.lettingStatus) : undefined,
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
      caseType: 'lettings',
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

export async function loadLettingsCaseDetail(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const caseDetail = await loadCaseDetail(args);
  if (!caseDetail) {
    return null;
  }

  const [lettingsCase] = await args.db
    .select()
    .from(schema.lettingsCases)
    .where(
      and(
        eq(schema.lettingsCases.tenantId, args.tenantId),
        eq(schema.lettingsCases.caseId, args.caseId),
      ),
    )
    .limit(1);

  if (!lettingsCase) {
    return null;
  }

  const lettingsApplications = await listLettingsApplications(args);

  return {
    ...caseDetail,
    lettingsCase,
    lettingsApplications,
  };
}

export async function loadLettingsDashboard(args: { db: DbClient; tenantId: string }) {
  const [caseTotals] = await args.db
    .select({
      totalCases: sql<number>`count(*)`,
      openCases: sql<number>`count(*) filter (where ${schema.cases.status} = 'open')`,
      completedCases: sql<number>`count(*) filter (where ${schema.cases.status} = 'completed')`,
      agreedLets: sql<number>`count(*) filter (where ${schema.lettingsCases.lettingStatus} = 'agreed_let' or ${schema.lettingsCases.lettingStatus} = 'application_accepted')`,
      moveIns: sql<number>`count(*) filter (where ${schema.lettingsCases.lettingStatus} = 'move_in')`,
    })
    .from(schema.lettingsCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.lettingsCases.caseId))
    .where(eq(schema.lettingsCases.tenantId, args.tenantId));

  const [applicationTotals] = await args.db
    .select({
      totalApplications: sql<number>`count(*)`,
      acceptedApplications: sql<number>`count(*) filter (where ${schema.lettingsApplications.status} = 'accepted')`,
      totalRentOffered: sql<number>`coalesce(sum(${schema.lettingsApplications.monthlyRentOffered}), 0)`,
    })
    .from(schema.lettingsApplications)
    .where(eq(schema.lettingsApplications.tenantId, args.tenantId));

  const agreedLets = await args.db
    .select({
      caseId: schema.cases.id,
      title: schema.cases.title,
      reference: schema.cases.reference,
      propertyDisplayAddress: schema.properties.displayAddress,
      monthlyRent: schema.lettingsCases.monthlyRent,
      agreedLetAt: schema.lettingsCases.agreedLetAt,
      moveInAt: schema.lettingsCases.moveInAt,
      lettingStatus: schema.lettingsCases.lettingStatus,
    })
    .from(schema.lettingsCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.lettingsCases.caseId))
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .where(
      and(
        eq(schema.lettingsCases.tenantId, args.tenantId),
        eq(schema.lettingsCases.lettingStatus, 'application_accepted'),
      ),
    )
    .orderBy(desc(schema.lettingsCases.agreedLetAt), desc(schema.cases.updatedAt));

  const recentCases = await listLettingsCaseRecords({
    db: args.db,
    tenantId: args.tenantId,
  });

  return {
    counts: {
      totalCases: Number(caseTotals?.totalCases ?? 0),
      openCases: Number(caseTotals?.openCases ?? 0),
      completedCases: Number(caseTotals?.completedCases ?? 0),
      agreedLets: Number(caseTotals?.agreedLets ?? 0),
      moveIns: Number(caseTotals?.moveIns ?? 0),
      totalApplications: Number(applicationTotals?.totalApplications ?? 0),
      acceptedApplications: Number(applicationTotals?.acceptedApplications ?? 0),
    },
    values: {
      totalRentOffered: Number(applicationTotals?.totalRentOffered ?? 0),
    },
    agreedLets,
    recentCases: recentCases.slice(0, 10),
  };
}

export async function ensureLettingsCaseExists(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const caseRecord = await loadCaseRecord(args);
  if (!caseRecord || caseRecord.caseType !== 'lettings') {
    return null;
  }

  const [lettingsCase] = await args.db
    .select()
    .from(schema.lettingsCases)
    .where(
      and(
        eq(schema.lettingsCases.tenantId, args.tenantId),
        eq(schema.lettingsCases.caseId, args.caseId),
      ),
    )
    .limit(1);

  if (!lettingsCase) {
    return null;
  }

  return { caseRecord, lettingsCase };
}
