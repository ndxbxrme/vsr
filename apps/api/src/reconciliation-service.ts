import { type createDbClient, schema } from '@vitalspace/db';
import { asc, eq, sql } from 'drizzle-orm';
import { loadLettingsDashboard } from './lettings-service';
import { loadSalesDashboard } from './sales-service';

type DbClient = ReturnType<typeof createDbClient>['db'];

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function buildCheck(args: {
  key: string;
  label: string;
  status: 'ready' | 'missing' | 'investigate';
  detail: string;
}) {
  return args;
}

export async function loadTenantReconciliation(args: {
  db: DbClient;
  tenantId: string;
}) {
  const [tenant] = await args.db
    .select({
      id: schema.tenants.id,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, args.tenantId))
    .limit(1);

  if (!tenant) {
    return null;
  }

  const [propertiesSummary] = await args.db
    .select({
      propertyCount: sql<number>`count(*)`,
      latestPropertyUpdatedAt: sql<Date | null>`max(${schema.properties.updatedAt})`,
    })
    .from(schema.properties)
    .where(eq(schema.properties.tenantId, args.tenantId));

  const [externalReferenceSummary] = await args.db
    .select({
      propertiesWithExternalReferenceCount: sql<number>`count(distinct ${schema.externalReferences.entityId})`,
    })
    .from(schema.externalReferences)
    .where(
      sql`${schema.externalReferences.tenantId} = ${args.tenantId} and ${schema.externalReferences.entityType} = 'property'`,
    );

  const [salesCaseSummary] = await args.db
    .select({
      salesCaseCount: sql<number>`count(*)`,
      salesOpenCaseCount: sql<number>`count(*) filter (where ${schema.cases.status} = 'open')`,
      salesCompletedCaseCount: sql<number>`count(*) filter (where ${schema.cases.status} = 'completed')`,
      salesOfferAcceptedCaseCount: sql<number>`count(*) filter (where ${schema.salesCases.saleStatus} = 'offer_accepted')`,
      salesCasesWithoutPropertyCount: sql<number>`count(*) filter (where ${schema.cases.propertyId} is null)`,
      salesCasesWithoutWorkflowCount: sql<number>`count(*) filter (where ${schema.workflowInstances.id} is null)`,
    })
    .from(schema.salesCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.salesCases.caseId))
    .leftJoin(schema.workflowInstances, eq(schema.workflowInstances.caseId, schema.cases.id))
    .where(eq(schema.salesCases.tenantId, args.tenantId));

  const [salesOfferSummary] = await args.db
    .select({
      salesAcceptedOfferCount: sql<number>`count(*) filter (where ${schema.salesOffers.status} = 'accepted')`,
      salesAcceptedOfferValue: sql<number>`coalesce(sum(${schema.salesOffers.amount}) filter (where ${schema.salesOffers.status} = 'accepted'), 0)`,
    })
    .from(schema.salesOffers)
    .where(eq(schema.salesOffers.tenantId, args.tenantId));

  const [lettingsCaseSummary] = await args.db
    .select({
      lettingsCaseCount: sql<number>`count(*)`,
      lettingsOpenCaseCount: sql<number>`count(*) filter (where ${schema.cases.status} = 'open')`,
      lettingsCompletedCaseCount: sql<number>`count(*) filter (where ${schema.cases.status} = 'completed')`,
      lettingsAgreedLetCount: sql<number>`count(*) filter (where ${schema.lettingsCases.lettingStatus} = 'agreed_let' or ${schema.lettingsCases.lettingStatus} = 'application_accepted')`,
      lettingsCasesWithoutPropertyCount: sql<number>`count(*) filter (where ${schema.cases.propertyId} is null)`,
      lettingsCasesWithoutWorkflowCount: sql<number>`count(*) filter (where ${schema.workflowInstances.id} is null)`,
    })
    .from(schema.lettingsCases)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.lettingsCases.caseId))
    .leftJoin(schema.workflowInstances, eq(schema.workflowInstances.caseId, schema.cases.id))
    .where(eq(schema.lettingsCases.tenantId, args.tenantId));

  const [lettingsApplicationSummary] = await args.db
    .select({
      lettingsAcceptedApplicationCount: sql<number>`count(*) filter (where ${schema.lettingsApplications.status} = 'accepted')`,
      lettingsAcceptedRentValue: sql<number>`coalesce(sum(${schema.lettingsApplications.monthlyRentOffered}) filter (where ${schema.lettingsApplications.status} = 'accepted'), 0)`,
    })
    .from(schema.lettingsApplications)
    .where(eq(schema.lettingsApplications.tenantId, args.tenantId));

  const workflowStageRows = await args.db
    .select({
      caseType: schema.cases.caseType,
      workflowStatus: schema.workflowInstances.status,
      currentStageKey: schema.workflowStages.key,
      currentStageName: schema.workflowStages.name,
      count: sql<number>`count(*)`,
    })
    .from(schema.workflowInstances)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.workflowInstances.caseId))
    .leftJoin(
      schema.workflowStages,
      eq(schema.workflowStages.id, schema.workflowInstances.currentWorkflowStageId),
    )
    .where(eq(schema.workflowInstances.tenantId, args.tenantId))
    .groupBy(
      schema.cases.caseType,
      schema.workflowInstances.status,
      schema.workflowStages.key,
      schema.workflowStages.name,
    )
    .orderBy(
      asc(schema.cases.caseType),
      asc(schema.workflowInstances.status),
      asc(schema.workflowStages.key),
    );

  const salesDashboard = await loadSalesDashboard({
    db: args.db,
    tenantId: args.tenantId,
  });
  const lettingsDashboard = await loadLettingsDashboard({
    db: args.db,
    tenantId: args.tenantId,
  });

  const propertyCount = toNumber(propertiesSummary?.propertyCount);
  const propertiesWithExternalReferenceCount = toNumber(
    externalReferenceSummary?.propertiesWithExternalReferenceCount,
  );
  const propertiesWithoutExternalReferenceCount =
    propertyCount - propertiesWithExternalReferenceCount;

  const salesActual = {
    totalCases: toNumber(salesCaseSummary?.salesCaseCount),
    openCases: toNumber(salesCaseSummary?.salesOpenCaseCount),
    completedCases: toNumber(salesCaseSummary?.salesCompletedCaseCount),
    offerAcceptedCases: toNumber(salesCaseSummary?.salesOfferAcceptedCaseCount),
    acceptedOffers: toNumber(salesOfferSummary?.salesAcceptedOfferCount),
    acceptedOfferValue: toNumber(salesOfferSummary?.salesAcceptedOfferValue),
    casesWithoutProperty: toNumber(salesCaseSummary?.salesCasesWithoutPropertyCount),
    casesWithoutWorkflow: toNumber(salesCaseSummary?.salesCasesWithoutWorkflowCount),
  };

  const lettingsActual = {
    totalCases: toNumber(lettingsCaseSummary?.lettingsCaseCount),
    openCases: toNumber(lettingsCaseSummary?.lettingsOpenCaseCount),
    completedCases: toNumber(lettingsCaseSummary?.lettingsCompletedCaseCount),
    agreedLets: toNumber(lettingsCaseSummary?.lettingsAgreedLetCount),
    acceptedApplications: toNumber(lettingsApplicationSummary?.lettingsAcceptedApplicationCount),
    totalRentOffered: toNumber(lettingsApplicationSummary?.lettingsAcceptedRentValue),
    casesWithoutProperty: toNumber(lettingsCaseSummary?.lettingsCasesWithoutPropertyCount),
    casesWithoutWorkflow: toNumber(lettingsCaseSummary?.lettingsCasesWithoutWorkflowCount),
  };

  const salesReportAlignment =
    salesDashboard.counts.totalCases === salesActual.totalCases &&
    salesDashboard.counts.openCases === salesActual.openCases &&
    salesDashboard.counts.completedCases === salesActual.completedCases &&
    salesDashboard.counts.offerAcceptedCases === salesActual.offerAcceptedCases &&
    salesDashboard.counts.acceptedOffers === salesActual.acceptedOffers &&
    salesDashboard.values.acceptedOfferValue === salesActual.acceptedOfferValue;

  const lettingsReportAlignment =
    lettingsDashboard.counts.totalCases === lettingsActual.totalCases &&
    lettingsDashboard.counts.openCases === lettingsActual.openCases &&
    lettingsDashboard.counts.completedCases === lettingsActual.completedCases &&
    lettingsDashboard.counts.agreedLets === lettingsActual.agreedLets &&
    lettingsDashboard.counts.acceptedApplications === lettingsActual.acceptedApplications &&
    lettingsDashboard.values.totalRentOffered === lettingsActual.totalRentOffered;

  const workflow = {
    sales: {
      casesWithoutWorkflow: salesActual.casesWithoutWorkflow,
      stageCounts: workflowStageRows
        .filter((row) => row.caseType === 'sales')
        .map((row) => ({
          workflowStatus: row.workflowStatus,
          currentStageKey: row.currentStageKey ?? 'unassigned',
          currentStageName: row.currentStageName ?? 'Unassigned',
          count: toNumber(row.count),
        })),
    },
    lettings: {
      casesWithoutWorkflow: lettingsActual.casesWithoutWorkflow,
      stageCounts: workflowStageRows
        .filter((row) => row.caseType === 'lettings')
        .map((row) => ({
          workflowStatus: row.workflowStatus,
          currentStageKey: row.currentStageKey ?? 'unassigned',
          currentStageName: row.currentStageName ?? 'Unassigned',
          count: toNumber(row.count),
        })),
    },
  };

  const checks = [
    buildCheck({
      key: 'properties_available',
      label: 'Properties available for pilot use',
      status: propertyCount > 0 ? 'ready' : 'missing',
      detail:
        propertyCount > 0
          ? `${propertyCount} properties are available to link to pilot cases.`
          : 'No properties are currently available for pilot case creation.',
    }),
    buildCheck({
      key: 'property_external_reference_coverage',
      label: 'Property external reference coverage',
      status:
        propertyCount === 0
          ? 'missing'
          : propertiesWithoutExternalReferenceCount === 0
            ? 'ready'
            : 'investigate',
      detail:
        propertyCount === 0
          ? 'No properties are available yet.'
          : propertiesWithoutExternalReferenceCount === 0
            ? 'All pilot properties have external references for traceability.'
            : `${propertiesWithoutExternalReferenceCount} properties do not have external references yet.`,
    }),
    buildCheck({
      key: 'case_property_links',
      label: 'Case to property links',
      status:
        salesActual.casesWithoutProperty + lettingsActual.casesWithoutProperty === 0
          ? 'ready'
          : 'investigate',
      detail:
        salesActual.casesWithoutProperty + lettingsActual.casesWithoutProperty === 0
          ? 'All current pilot cases are linked to properties.'
          : `${salesActual.casesWithoutProperty + lettingsActual.casesWithoutProperty} pilot cases are missing property links.`,
    }),
    buildCheck({
      key: 'workflow_coverage',
      label: 'Workflow coverage on pilot cases',
      status:
        salesActual.casesWithoutWorkflow + lettingsActual.casesWithoutWorkflow === 0
          ? 'ready'
          : 'investigate',
      detail:
        salesActual.casesWithoutWorkflow + lettingsActual.casesWithoutWorkflow === 0
          ? 'All current pilot cases have workflow instances.'
          : `${salesActual.casesWithoutWorkflow + lettingsActual.casesWithoutWorkflow} pilot cases are missing workflow instances.`,
    }),
    buildCheck({
      key: 'sales_report_alignment',
      label: 'Sales pipeline report alignment',
      status: salesReportAlignment ? 'ready' : 'investigate',
      detail: salesReportAlignment
        ? 'Sales pipeline report matches direct case and offer counts.'
        : `Sales report mismatch detected. Dashboard accepted offers ${salesDashboard.counts.acceptedOffers}, actual accepted offers ${salesActual.acceptedOffers}.`,
    }),
    buildCheck({
      key: 'lettings_report_alignment',
      label: 'Agreed lets report alignment',
      status: lettingsReportAlignment ? 'ready' : 'investigate',
      detail: lettingsReportAlignment
        ? 'Agreed lets report matches direct case and application counts.'
        : `Lettings report mismatch detected. Dashboard agreed lets ${lettingsDashboard.counts.agreedLets}, actual agreed lets ${lettingsActual.agreedLets}.`,
    }),
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      properties: {
        totalCount: propertyCount,
        withExternalReferenceCount: propertiesWithExternalReferenceCount,
        withoutExternalReferenceCount: propertiesWithoutExternalReferenceCount,
        latestUpdatedAt: propertiesSummary?.latestPropertyUpdatedAt ?? null,
      },
      cases: {
        sales: salesActual,
        lettings: lettingsActual,
      },
      workflow,
      reports: {
        salesPipeline: {
          dashboardCounts: salesDashboard.counts,
          dashboardValues: salesDashboard.values,
          actualCounts: {
            totalCases: salesActual.totalCases,
            openCases: salesActual.openCases,
            completedCases: salesActual.completedCases,
            offerAcceptedCases: salesActual.offerAcceptedCases,
            acceptedOffers: salesActual.acceptedOffers,
          },
          actualValues: {
            acceptedOfferValue: salesActual.acceptedOfferValue,
          },
          aligned: salesReportAlignment,
        },
        agreedLets: {
          dashboardCounts: lettingsDashboard.counts,
          dashboardValues: lettingsDashboard.values,
          actualCounts: {
            totalCases: lettingsActual.totalCases,
            openCases: lettingsActual.openCases,
            completedCases: lettingsActual.completedCases,
            agreedLets: lettingsActual.agreedLets,
            acceptedApplications: lettingsActual.acceptedApplications,
          },
          actualValues: {
            totalRentOffered: lettingsActual.totalRentOffered,
          },
          aligned: lettingsReportAlignment,
        },
      },
    },
    checks,
  };
}
