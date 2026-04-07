import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decryptJsonPayload } from '@vitalspace/auth';
import { tenantSettingsSchema } from '@vitalspace/contracts';
import { type createDbClient, schema } from '@vitalspace/db';
import { and, asc, desc, eq } from 'drizzle-orm';

type DbClient = ReturnType<typeof createDbClient>['db'];
type MessageChannel = 'email' | 'sms';
type MessageDeliveryMode = 'live' | 'redirect' | 'log_only' | 'disabled';
type MessageProviderKey = 'log' | 'mailgun' | 'twilio_sms' | 'sms24x';

type ProviderSendResult = {
  providerMessageId?: string | null;
  status: 'sent' | 'logged' | 'failed';
  responsePayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

type ProviderAccountForSend = {
  id: string;
  providerKey: MessageProviderKey;
  status: string;
  credentialsJsonEncrypted: unknown;
  settingsJson: Record<string, unknown> | null;
};

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

function assertResponseOk(response: Response, body: string) {
  if (response.ok) {
    return;
  }

  throw new Error(`message_provider_http_error:${response.status}:${body.slice(0, 400)}`);
}

function getRequiredString(
  source: Record<string, unknown> | null | undefined,
  key: string,
  errorCode: string,
) {
  const value = source?.[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(errorCode);
  }

  return value.trim();
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizeSms24xPhoneNumber(value: string) {
  const compact = value.replace(/[+\s]/g, '');
  const localized = compact.replace(/^447/, '07');
  if (/^07\d+$/.test(localized)) {
    return localized;
  }

  throw new Error('sms24x_invalid_recipient');
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

async function loadTenantChannelSettings(args: {
  db: DbClient;
  tenantId: string;
  channel: MessageChannel;
}) {
  const [tenant] = await args.db
    .select({
      settingsJson: schema.tenants.settingsJson,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, args.tenantId))
    .limit(1);

  if (!tenant) {
    throw new Error('tenant_not_found');
  }

  const settings = tenantSettingsSchema.parse(tenant.settingsJson ?? {});
  return settings.messaging[args.channel];
}

async function appendMessageLogFile(args: {
  tenantId: string;
  channel: MessageChannel;
  providerKey: MessageProviderKey;
  dispatchId: string;
  to: string | null;
  originalTo: string | null;
  subject?: string | null;
  body: string;
}) {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const baseDir = process.env.MESSAGE_LOG_DIR?.trim() || '.data/messages';
  const tenantDir = join(baseDir, args.tenantId);
  await mkdir(tenantDir, { recursive: true });
  const logPath = join(tenantDir, `${dateKey}.log`);
  const lines = [
    `[${now.toISOString()}] channel=${args.channel} provider=${args.providerKey} dispatch=${args.dispatchId}`,
    `to=${args.to ?? ''}`,
    `original_to=${args.originalTo ?? ''}`,
    `subject=${args.subject ?? ''}`,
    args.body,
    '',
  ];
  await appendFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  return logPath;
}

function decryptProviderCredentials(value: unknown) {
  const encryptionSecret = process.env.APP_ENCRYPTION_KEY ?? '';
  return decryptJsonPayload<Record<string, unknown>>(value, encryptionSecret);
}

async function sendViaMailgun(args: {
  to: string;
  fromIdentity?: string | null | undefined;
  subject?: string | null | undefined;
  body: string;
  htmlBody?: string | null | undefined;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown> | null | undefined;
}) {
  const apiKey = getRequiredString(args.credentials, 'apiKey', 'mailgun_api_key_required');
  const domain = getRequiredString(args.settings ?? args.credentials, 'domain', 'mailgun_domain_required');
  const apiBaseUrl =
    (typeof args.settings?.apiBaseUrl === 'string' && args.settings.apiBaseUrl.trim()) ||
    'https://api.mailgun.net';
  const fromIdentity =
    (typeof args.settings?.fromIdentity === 'string' && args.settings.fromIdentity.trim()) ||
    (args.fromIdentity?.trim() ?? '');

  if (!fromIdentity) {
    throw new Error('mailgun_from_identity_required');
  }

  const bodyParams = new URLSearchParams();
  bodyParams.set('from', fromIdentity);
  bodyParams.set('to', args.to);
  bodyParams.set('subject', args.subject ?? '');
  bodyParams.set('text', args.body);
  if (args.htmlBody) {
    bodyParams.set('html', args.htmlBody);
  }

  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams,
  });

  const responseText = await response.text();
  assertResponseOk(response, responseText);

  const parsed =
    responseText.trim().length > 0 ? (JSON.parse(responseText) as Record<string, unknown>) : {};

  return {
    providerMessageId:
      typeof parsed.id === 'string' ? parsed.id : typeof parsed.message === 'string' ? parsed.message : null,
    status: 'sent',
    responsePayload: parsed,
    errorMessage: null,
  } satisfies ProviderSendResult;
}

async function sendViaTwilioSms(args: {
  to: string;
  fromIdentity?: string | null | undefined;
  body: string;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown> | null | undefined;
}) {
  const accountSid = getRequiredString(args.credentials, 'accountSid', 'twilio_account_sid_required');
  const authToken = getRequiredString(args.credentials, 'authToken', 'twilio_auth_token_required');
  const apiBaseUrl =
    (typeof args.settings?.apiBaseUrl === 'string' && args.settings.apiBaseUrl.trim()) ||
    'https://api.twilio.com';
  const messagingServiceSid =
    typeof args.settings?.messagingServiceSid === 'string' && args.settings.messagingServiceSid.trim().length > 0
      ? args.settings.messagingServiceSid.trim()
      : null;
  const fromNumber =
    (typeof args.settings?.fromNumber === 'string' && args.settings.fromNumber.trim()) ||
    (args.fromIdentity?.trim() ?? '');

  if (!messagingServiceSid && !fromNumber) {
    throw new Error('twilio_from_number_or_messaging_service_required');
  }

  const bodyParams = new URLSearchParams();
  bodyParams.set('To', args.to);
  bodyParams.set('Body', args.body);
  if (messagingServiceSid) {
    bodyParams.set('MessagingServiceSid', messagingServiceSid);
  } else {
    bodyParams.set('From', fromNumber);
  }
  if (typeof args.settings?.statusCallbackUrl === 'string' && args.settings.statusCallbackUrl.trim()) {
    bodyParams.set('StatusCallback', args.settings.statusCallbackUrl.trim());
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(
    `${apiBaseUrl.replace(/\/$/, '')}/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams,
    },
  );

  const responseText = await response.text();
  assertResponseOk(response, responseText);

  const parsed =
    responseText.trim().length > 0 ? (JSON.parse(responseText) as Record<string, unknown>) : {};

  return {
    providerMessageId: typeof parsed.sid === 'string' ? parsed.sid : null,
    status: 'sent',
    responsePayload: parsed,
    errorMessage: null,
  } satisfies ProviderSendResult;
}

async function sendViaSms24x(args: {
  to: string;
  fromIdentity?: string | null | undefined;
  body: string;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown> | null | undefined;
}) {
  const username = getRequiredString(args.credentials, 'username', 'sms24x_username_required');
  const password = getRequiredString(args.credentials, 'password', 'sms24x_password_required');
  const wsdlUrl =
    (typeof args.settings?.wsdlUrl === 'string' && args.settings.wsdlUrl.trim()) ||
    'https://www.24x2.com/wssecure/service.asmx?WSDL';
  const endpointUrl =
    (typeof args.settings?.endpointUrl === 'string' && args.settings.endpointUrl.trim()) ||
    wsdlUrl.replace(/\?WSDL$/i, '');
  const fromIdentity =
    (typeof args.settings?.fromIdentity === 'string' && args.settings.fromIdentity.trim()) ||
    (args.fromIdentity?.trim() ?? '');

  const normalizedTo = normalizeSms24xPhoneNumber(args.to);
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SendFullSMS xmlns="http://tempuri.org/">
      <UserName>${xmlEscape(username)}</UserName>
      <Password>${xmlEscape(password)}</Password>
      <Mobiles>${xmlEscape(normalizedTo)}</Mobiles>
      <MessageFrom>${xmlEscape(fromIdentity)}</MessageFrom>
      <MessageToSend>${xmlEscape(args.body)}</MessageToSend>
      <DateTimeToSend>${xmlEscape(new Date().toISOString())}</DateTimeToSend>
      <UserField></UserField>
      <EmailAddressToSendReplies></EmailAddressToSendReplies>
    </SendFullSMS>
  </soap:Body>
</soap:Envelope>`;

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://tempuri.org/SendFullSMS',
    },
    body: envelope,
  });

  const responseText = await response.text();
  assertResponseOk(response, responseText);

  const resultMatch = responseText.match(/<SendFullSMSResult>(.*?)<\/SendFullSMSResult>/i);
  const providerMessageId = resultMatch?.[1]?.trim() || null;

  return {
    providerMessageId,
    status: 'sent',
    responsePayload: {
      rawResponse: responseText,
    },
    errorMessage: null,
  } satisfies ProviderSendResult;
}

async function sendViaProvider(args: {
  channel: MessageChannel;
  providerKey: MessageProviderKey;
  dispatchId: string;
  tenantId: string;
  to: string | null;
  originalTo: string | null;
  fromIdentity?: string | null | undefined;
  subject?: string | null | undefined;
  body: string;
  htmlBody?: string | null | undefined;
  providerAccount?: ProviderAccountForSend | null | undefined;
}) {
  if (args.providerKey === 'log') {
    const logPath = await appendMessageLogFile({
      tenantId: args.tenantId,
      channel: args.channel,
      providerKey: 'log',
      dispatchId: args.dispatchId,
      to: args.to,
      originalTo: args.originalTo,
      subject: args.subject ?? null,
      body: args.body,
    });

    return {
      providerMessageId: null,
      status: 'logged',
      responsePayload: {
        logPath,
        htmlBody: args.htmlBody ?? null,
      },
      errorMessage: null,
    } satisfies ProviderSendResult;
  }

  if (!args.to) {
    throw new Error('message_recipient_required');
  }

  if (!args.providerAccount) {
    throw new Error('message_provider_account_required');
  }

  if (args.providerAccount.status !== 'active') {
    throw new Error('message_provider_account_inactive');
  }

  const credentials = decryptProviderCredentials(args.providerAccount.credentialsJsonEncrypted);

  if (args.providerKey === 'mailgun') {
    if (args.channel !== 'email') {
      throw new Error('message_provider_channel_mismatch');
    }

    return sendViaMailgun({
      to: args.to,
      fromIdentity: args.fromIdentity,
      subject: args.subject ?? null,
      body: args.body,
      htmlBody: args.htmlBody ?? null,
      credentials,
      settings: args.providerAccount.settingsJson,
    });
  }

  if (args.providerKey === 'twilio_sms') {
    if (args.channel !== 'sms') {
      throw new Error('message_provider_channel_mismatch');
    }

    return sendViaTwilioSms({
      to: args.to,
      fromIdentity: args.fromIdentity,
      body: args.body,
      credentials,
      settings: args.providerAccount.settingsJson,
    });
  }

  if (args.providerKey === 'sms24x') {
    if (args.channel !== 'sms') {
      throw new Error('message_provider_channel_mismatch');
    }

    return sendViaSms24x({
      to: args.to,
      fromIdentity: args.fromIdentity,
      body: args.body,
      credentials,
      settings: args.providerAccount.settingsJson,
    });
  }

  throw new Error(`message_provider_not_implemented:${args.providerKey}`);
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

export async function createMessageProviderAccountRecord(args: {
  db: DbClient;
  tenantId: string;
  channel: MessageChannel;
  providerKey: MessageProviderKey;
  name: string;
  status: string;
  credentialsJsonEncrypted?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
}) {
  const createdAccounts = await args.db
    .insert(schema.messageProviderAccounts)
    .values({
      tenantId: args.tenantId,
      channel: args.channel,
      providerKey: args.providerKey,
      name: args.name,
      status: args.status,
      credentialsJsonEncrypted: args.credentialsJsonEncrypted ?? null,
      settingsJson: args.settings ?? null,
    })
    .returning();

  return requireValue(createdAccounts[0], 'message_provider_account');
}

export async function listMessageProviderAccounts(args: { db: DbClient; tenantId: string }) {
  return args.db
    .select({
      id: schema.messageProviderAccounts.id,
      tenantId: schema.messageProviderAccounts.tenantId,
      channel: schema.messageProviderAccounts.channel,
      providerKey: schema.messageProviderAccounts.providerKey,
      name: schema.messageProviderAccounts.name,
      status: schema.messageProviderAccounts.status,
      settingsJson: schema.messageProviderAccounts.settingsJson,
      createdAt: schema.messageProviderAccounts.createdAt,
      updatedAt: schema.messageProviderAccounts.updatedAt,
    })
    .from(schema.messageProviderAccounts)
    .where(eq(schema.messageProviderAccounts.tenantId, args.tenantId))
    .orderBy(
      asc(schema.messageProviderAccounts.channel),
      asc(schema.messageProviderAccounts.providerKey),
      asc(schema.messageProviderAccounts.name),
    );
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
      providerAccountId: schema.communicationDispatches.providerAccountId,
      providerKey: schema.communicationDispatches.providerKey,
      deliveryMode: schema.communicationDispatches.deliveryMode,
      recipientName: schema.communicationDispatches.recipientName,
      originalRecipientEmail: schema.communicationDispatches.originalRecipientEmail,
      originalRecipientPhone: schema.communicationDispatches.originalRecipientPhone,
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
  channel: MessageChannel;
  templateId: string;
  templateType: MessageChannel;
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

  const channelSettings = await loadTenantChannelSettings({
    db: args.db,
    tenantId: args.tenantId,
    channel: args.channel,
  });

  const deliveryMode = channelSettings.deliveryMode as MessageDeliveryMode;
  if (deliveryMode === 'disabled') {
    throw new Error('message_channel_disabled');
  }

  const originalRecipient =
    args.channel === 'email' ? (args.recipientEmail ?? null) : (args.recipientPhone ?? null);
  if (args.channel === 'email' && !originalRecipient) {
    throw new Error('recipient_email_required');
  }
  if (args.channel === 'sms' && !originalRecipient) {
    throw new Error('recipient_phone_required');
  }

  const effectiveRecipient =
    deliveryMode === 'redirect' && channelSettings.redirectTo
      ? channelSettings.redirectTo
      : originalRecipient;

  if (!effectiveRecipient) {
    throw new Error('message_redirect_recipient_required');
  }

  const [providerAccount] =
    channelSettings.defaultProviderAccountId !== null
      ? await args.db
          .select({
            id: schema.messageProviderAccounts.id,
            providerKey: schema.messageProviderAccounts.providerKey,
            status: schema.messageProviderAccounts.status,
            credentialsJsonEncrypted: schema.messageProviderAccounts.credentialsJsonEncrypted,
            settingsJson: schema.messageProviderAccounts.settingsJson,
          })
          .from(schema.messageProviderAccounts)
          .where(
            and(
              eq(schema.messageProviderAccounts.id, channelSettings.defaultProviderAccountId),
              eq(schema.messageProviderAccounts.tenantId, args.tenantId),
            ),
          )
          .limit(1)
      : [];

  const providerKey =
    deliveryMode === 'log_only'
      ? 'log'
      : ((providerAccount?.providerKey ??
          channelSettings.defaultProviderKey ??
          'log') as MessageProviderKey);

  let subject: string | null = null;
  let body: string;
  let bodyHtml: string | null = null;
  let templateKey: string;

  if (args.channel === 'email') {
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

    subject = renderTemplate(template.subjectTemplate, baseVariables);
    body = renderTemplate(template.bodyTextTemplate, baseVariables);
    bodyHtml = template.bodyHtmlTemplate
      ? renderTemplate(template.bodyHtmlTemplate, baseVariables)
      : null;
    templateKey = template.key;
  } else {
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

    body = renderTemplate(template.bodyTemplate, baseVariables);
    templateKey = template.key;
  }

  const createdDispatches = await args.db
    .insert(schema.communicationDispatches)
    .values({
      tenantId: args.tenantId,
      caseId: args.caseId,
      channel: args.channel,
      templateType: args.templateType,
      templateId: args.templateId,
      providerAccountId: providerAccount?.id ?? null,
      providerKey,
      deliveryMode,
      sentByUserId: args.sentByUserId ?? null,
      recipientName: args.recipientName ?? null,
      originalRecipientEmail: args.channel === 'email' ? originalRecipient : null,
      originalRecipientPhone: args.channel === 'sms' ? originalRecipient : null,
      recipientEmail: args.channel === 'email' ? effectiveRecipient : null,
      recipientPhone: args.channel === 'sms' ? effectiveRecipient : null,
      subject,
      body,
      status: 'queued',
      metadataJson: {
        templateKey,
        bodyHtml,
        mode: deliveryMode,
        originalRecipient,
        effectiveRecipient,
        ...(args.metadata ?? {}),
      },
    })
    .returning();

  const dispatch = requireValue(createdDispatches[0], 'communication_dispatch');

  try {
    const providerResult = await sendViaProvider({
      channel: args.channel,
      providerKey,
      dispatchId: dispatch.id,
      tenantId: args.tenantId,
      to: effectiveRecipient,
      originalTo: originalRecipient,
      fromIdentity: channelSettings.fromIdentity,
      subject,
      body,
      htmlBody: bodyHtml,
      providerAccount: deliveryMode === 'log_only' ? null : (providerAccount as ProviderAccountForSend | undefined),
    });

    await args.db.insert(schema.communicationAttempts).values({
      tenantId: args.tenantId,
      dispatchId: dispatch.id,
      providerAccountId: providerAccount?.id ?? null,
      providerKey,
      requestPayloadJson: {
        channel: args.channel,
        fromIdentity: channelSettings.fromIdentity,
        originalRecipient,
        effectiveRecipient,
      },
      responsePayloadJson: providerResult.responsePayload ?? null,
      providerMessageId: providerResult.providerMessageId ?? null,
      status: providerResult.status,
      errorMessage: providerResult.errorMessage ?? null,
    });

    const updatedDispatches = await args.db
      .update(schema.communicationDispatches)
      .set({
        status: providerResult.status,
        providerMessageId: providerResult.providerMessageId ?? null,
        errorMessage: providerResult.errorMessage ?? null,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.communicationDispatches.id, dispatch.id))
      .returning();

    const updatedDispatch = requireValue(updatedDispatches[0], 'communication_dispatch');

    const verb =
      providerResult.status === 'logged'
        ? args.channel === 'email'
          ? 'Logged email'
          : 'Logged sms'
        : args.channel === 'email'
          ? 'Sent email'
          : 'Sent sms';

    return {
      dispatch: updatedDispatch,
      caseContext,
      summary:
        args.channel === 'email'
          ? `${verb} "${subject ?? ''}" to ${effectiveRecipient}`
          : `${verb} to ${effectiveRecipient}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown_message_send_error';

    await args.db.insert(schema.communicationAttempts).values({
      tenantId: args.tenantId,
      dispatchId: dispatch.id,
      providerAccountId: providerAccount?.id ?? null,
      providerKey,
      requestPayloadJson: {
        channel: args.channel,
        fromIdentity: channelSettings.fromIdentity,
        originalRecipient,
        effectiveRecipient,
      },
      responsePayloadJson: null,
      providerMessageId: null,
      status: 'failed',
      errorMessage,
    });

    await args.db
      .update(schema.communicationDispatches)
      .set({
        status: 'failed',
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(schema.communicationDispatches.id, dispatch.id));

    throw error;
  }
}
