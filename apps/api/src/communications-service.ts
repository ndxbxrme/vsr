import { type createDbClient, schema } from '@vitalspace/db';
import { and, asc, desc, eq } from 'drizzle-orm';

type DbClient = ReturnType<typeof createDbClient>['db'];

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label}_not_found`);
  }

  return value;
}

function renderTemplate(
  template: string,
  variables: Record<string, string | number | boolean | null | undefined>,
) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, token: string) => {
    const value = variables[token];
    if (value === undefined || value === null) {
      return '';
    }

    return String(value);
  });
}

async function loadCaseContext(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  const [caseRow] = await args.db
    .select({
      caseId: schema.cases.id,
      caseTitle: schema.cases.title,
      caseReference: schema.cases.reference,
      caseType: schema.cases.caseType,
      propertyDisplayAddress: schema.properties.displayAddress,
      propertyPostcode: schema.properties.postcode,
    })
    .from(schema.cases)
    .leftJoin(schema.properties, eq(schema.properties.id, schema.cases.propertyId))
    .where(and(eq(schema.cases.tenantId, args.tenantId), eq(schema.cases.id, args.caseId)))
    .limit(1);

  return caseRow ?? null;
}

export async function createEmailTemplateRecord(args: {
  db: DbClient;
  tenantId: string;
  key: string;
  name: string;
  subjectTemplate: string;
  bodyTextTemplate: string;
  bodyHtmlTemplate?: string;
  status: string;
  metadata?: Record<string, unknown>;
}) {
  const createdTemplates = await args.db
    .insert(schema.emailTemplates)
    .values({
      tenantId: args.tenantId,
      key: args.key,
      name: args.name,
      subjectTemplate: args.subjectTemplate,
      bodyTextTemplate: args.bodyTextTemplate,
      bodyHtmlTemplate: args.bodyHtmlTemplate ?? null,
      status: args.status,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return requireValue(createdTemplates[0], 'email_template');
}

export async function createSmsTemplateRecord(args: {
  db: DbClient;
  tenantId: string;
  key: string;
  name: string;
  bodyTemplate: string;
  status: string;
  metadata?: Record<string, unknown>;
}) {
  const createdTemplates = await args.db
    .insert(schema.smsTemplates)
    .values({
      tenantId: args.tenantId,
      key: args.key,
      name: args.name,
      bodyTemplate: args.bodyTemplate,
      status: args.status,
      metadataJson: args.metadata ?? null,
    })
    .returning();

  return requireValue(createdTemplates[0], 'sms_template');
}

export async function listEmailTemplates(args: { db: DbClient; tenantId: string }) {
  return args.db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.tenantId, args.tenantId))
    .orderBy(asc(schema.emailTemplates.name), asc(schema.emailTemplates.createdAt));
}

export async function listSmsTemplates(args: { db: DbClient; tenantId: string }) {
  return args.db
    .select()
    .from(schema.smsTemplates)
    .where(eq(schema.smsTemplates.tenantId, args.tenantId))
    .orderBy(asc(schema.smsTemplates.name), asc(schema.smsTemplates.createdAt));
}

export async function listCaseCommunicationDispatches(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
}) {
  return args.db
    .select({
      id: schema.communicationDispatches.id,
      tenantId: schema.communicationDispatches.tenantId,
      caseId: schema.communicationDispatches.caseId,
      channel: schema.communicationDispatches.channel,
      templateType: schema.communicationDispatches.templateType,
      templateId: schema.communicationDispatches.templateId,
      recipientName: schema.communicationDispatches.recipientName,
      recipientEmail: schema.communicationDispatches.recipientEmail,
      recipientPhone: schema.communicationDispatches.recipientPhone,
      subject: schema.communicationDispatches.subject,
      body: schema.communicationDispatches.body,
      status: schema.communicationDispatches.status,
      errorMessage: schema.communicationDispatches.errorMessage,
      sentAt: schema.communicationDispatches.sentAt,
      createdAt: schema.communicationDispatches.createdAt,
      sentByDisplayName: schema.users.displayName,
    })
    .from(schema.communicationDispatches)
    .leftJoin(schema.users, eq(schema.users.id, schema.communicationDispatches.sentByUserId))
    .where(
      and(
        eq(schema.communicationDispatches.tenantId, args.tenantId),
        eq(schema.communicationDispatches.caseId, args.caseId),
      ),
    )
    .orderBy(desc(schema.communicationDispatches.sentAt), desc(schema.communicationDispatches.createdAt));
}

export async function sendCaseCommunicationRecord(args: {
  db: DbClient;
  tenantId: string;
  caseId: string;
  channel: 'email' | 'sms';
  templateId: string;
  templateType: 'email' | 'sms';
  sentByUserId?: string | null;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  variables: Record<string, string | number | boolean>;
  metadata?: Record<string, unknown>;
}) {
  const caseContext = await loadCaseContext({
    db: args.db,
    tenantId: args.tenantId,
    caseId: args.caseId,
  });

  if (!caseContext) {
    throw new Error('case_not_found');
  }

  const baseVariables = {
    'case.id': caseContext.caseId,
    'case.title': caseContext.caseTitle,
    'case.reference': caseContext.caseReference ?? '',
    'case.type': caseContext.caseType,
    'property.displayAddress': caseContext.propertyDisplayAddress ?? '',
    'property.postcode': caseContext.propertyPostcode ?? '',
    ...args.variables,
  };

  if (args.channel === 'email') {
    if (!args.recipientEmail) {
      throw new Error('recipient_email_required');
    }

    const [template] = await args.db
      .select()
      .from(schema.emailTemplates)
      .where(
        and(
          eq(schema.emailTemplates.id, args.templateId),
          eq(schema.emailTemplates.tenantId, args.tenantId),
          eq(schema.emailTemplates.status, 'active'),
        ),
      )
      .limit(1);

    if (!template) {
      throw new Error('email_template_not_found');
    }

    const subject = renderTemplate(template.subjectTemplate, baseVariables);
    const body = renderTemplate(template.bodyTextTemplate, baseVariables);

    const createdDispatches = await args.db
      .insert(schema.communicationDispatches)
      .values({
        tenantId: args.tenantId,
        caseId: args.caseId,
        channel: 'email',
        templateType: 'email',
        templateId: template.id,
        sentByUserId: args.sentByUserId ?? null,
        recipientName: args.recipientName ?? null,
        recipientEmail: args.recipientEmail,
        recipientPhone: null,
        subject,
        body,
        status: 'sent',
        metadataJson: {
          templateKey: template.key,
          bodyHtml: template.bodyHtmlTemplate
            ? renderTemplate(template.bodyHtmlTemplate, baseVariables)
            : null,
          ...(args.metadata ?? {}),
        },
      })
      .returning();

    return {
      dispatch: requireValue(createdDispatches[0], 'communication_dispatch'),
      caseContext,
      summary: `Sent email "${subject}" to ${args.recipientEmail}`,
    };
  }

  if (!args.recipientPhone) {
    throw new Error('recipient_phone_required');
  }

  const [template] = await args.db
    .select()
    .from(schema.smsTemplates)
    .where(
      and(
        eq(schema.smsTemplates.id, args.templateId),
        eq(schema.smsTemplates.tenantId, args.tenantId),
        eq(schema.smsTemplates.status, 'active'),
      ),
    )
    .limit(1);

  if (!template) {
    throw new Error('sms_template_not_found');
  }

  const body = renderTemplate(template.bodyTemplate, baseVariables);
  const createdDispatches = await args.db
    .insert(schema.communicationDispatches)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      channel: 'sms',
      templateType: 'sms',
      templateId: template.id,
      sentByUserId: args.sentByUserId ?? null,
      recipientName: args.recipientName ?? null,
      recipientEmail: null,
      recipientPhone: args.recipientPhone,
      subject: null,
      body,
      status: 'sent',
      metadataJson: {
        templateKey: template.key,
        ...(args.metadata ?? {}),
      },
    })
    .returning();

  return {
    dispatch: requireValue(createdDispatches[0], 'communication_dispatch'),
    caseContext,
    summary: `Sent sms to ${args.recipientPhone}`,
  };
}
