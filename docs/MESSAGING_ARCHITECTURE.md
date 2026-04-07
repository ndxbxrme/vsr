# Messaging Architecture

## 1. Purpose

This document defines the target messaging architecture for workflow-driven communications.

It exists because messaging is not a side feature:

- workflow milestones trigger outbound communications
- tenants need different delivery providers
- development and pilot testing must not spam real recipients
- the legacy system proved that template editing is high-value, but full-code templates were too hard for business users

The current remake already has a simple communications slice in [communications-service.ts](/home/kieron/code/vitalspace-remake/apps/api/src/communications-service.ts). That slice should now evolve into a real messaging service rather than growing ad hoc.

## 2. Goals

The messaging system should:

- centralize all outbound email and SMS behavior
- support multiple providers per channel on a tenant basis
- support safe non-delivery modes for local development, pilot testing, and provider verification
- keep templates provider-agnostic
- support workflow-driven actions without sending inline inside workflow mutations
- provide clear dispatch, retry, and delivery history
- give business users a manageable template editor rather than raw code

## 3. Non-Goals

- full inbound email handling in the first slice
- a generic marketing automation platform
- arbitrary script execution in templates
- provider-specific template builders as the source of truth
- a fully custom drag/drop page builder before the core sending model is stable

Inbound handling is deferred, but the outbound model must be designed so inbound can be added cleanly later.

## 4. Channel and Provider Model

Treat channel and provider separately.

Examples:

- channel `email`
- channel `sms`

- provider `mailgun`
- provider `twilio_sms`
- provider `sms24x`
- provider `log`

The tenant chooses the provider account per channel. Templates remain channel-scoped and app-owned.

### 4.1 Initial Provider Support

Initial target providers:

- email
  - `mailgun`
  - `log`
- sms
  - `twilio_sms`
  - `sms24x`
  - `log`

Notes:

- `mailgun` is required because the current client uses it for email
- `twilio_sms` should be first-class because it is a widely supported default
- `sms24x` should be supported through a custom adapter modeled on the existing SOAP integration in the linked legacy wrapper
- `log` is the development and safe-testing sink

## 5. Safe Delivery Modes

Safe delivery behavior should be built into the product, not improvised with temporary environment flags.

### 5.1 Delivery Modes

Each tenant/channel should support a delivery mode:

- `live`
- `redirect`
- `log_only`
- `disabled`

Behavior:

- `live`
  - send to the real recipient through the configured provider
- `redirect`
  - send through the configured provider, but replace the real recipient with a tenant-defined safe address or number
- `log_only`
  - render and persist the message, but do not call any external provider
- `disabled`
  - reject workflow-driven sends for that channel and record the reason

### 5.2 Redirect Rules

Tenant-level redirect settings should be supported separately per channel:

- `emailRedirectTo`
- `smsRedirectTo`

When redirect mode is enabled:

- keep the original recipient in dispatch metadata
- send only to the safe override
- clearly mark the dispatch as redirected in the UI and audit trail

This is useful when:

- verifying provider credentials
- testing workflow actions on a live tenant safely
- demonstrating the product without contacting real customers

### 5.3 Log Sink

The `log` provider should be a first-class adapter, not just `console.log`.

It should:

- write rendered messages to the database
- optionally mirror them to a local file in development
- never call an external provider
- be selectable per tenant/channel

Recommended file sink path in local development:

- `.data/messages/<tenant-id>/<yyyy-mm-dd>.log`

The database remains the canonical audit record.

## 6. Recommended Data Model

### 6.1 Provider Accounts

- `message_provider_accounts`
  - tenant id
  - channel
  - provider key
  - display name
  - encrypted credentials
  - provider settings JSON
  - status

### 6.2 Tenant Channel Settings

- `tenant_message_channel_settings`
  - tenant id
  - channel
  - default provider account id
  - delivery mode
  - redirect email or phone
  - default from identity
  - testing flags

### 6.3 Templates

- `message_templates`
  - tenant id
  - key
  - channel
  - name
  - status
  - current version id

- `message_template_versions`
  - template id
  - version number
  - editor mode
  - subject document
  - body document
  - rendered HTML snapshot if relevant
  - variable schema JSON
  - created by

The existing `email_templates` and `sms_templates` can either be migrated into this structure or kept temporarily as a compatibility layer while the new model is introduced.

### 6.4 Dispatch and Attempts

- `message_dispatches`
  - tenant id
  - case id
  - workflow instance id
  - workflow stage id
  - action source
  - channel
  - provider account id
  - template id
  - template version id
  - original recipient
  - effective recipient
  - mode used
  - rendered subject/body
  - status
  - send requested at
  - sent at

- `message_attempts`
  - dispatch id
  - provider request payload JSON
  - provider response payload JSON
  - provider message id
  - status
  - error code
  - error message
  - attempted at

### 6.5 Future Conversation Model

The first outbound slice does not need full inbound handling yet, but it should reserve the right data shape.

Future concepts:

- `message_threads`
  - tenant id
  - channel
  - case id
  - property id
  - contact id
  - provider routing identity
  - current status

- `message_messages`
  - thread id
  - direction `outbound` or `inbound`
  - dispatch id nullable
  - provider message id
  - sender identity
  - recipient identity
  - subject
  - body
  - raw payload JSON
  - received or sent at

The important point is that outbound dispatches should be able to join a future thread model cleanly.

## 7. Service Architecture

Messaging should run through one application service and one worker execution path.

### 7.1 Request Flow

1. workflow action creates a `message.requested` outbox event
2. worker resolves:
   - tenant channel settings
   - delivery mode
   - provider account
   - template and version
3. renderer builds the final subject/body
4. dispatch row is created
5. provider adapter sends or logs based on mode
6. attempt and final dispatch status are stored
7. dispatch becomes visible in case timeline/history

Do not send directly inside workflow transition handlers.

Every outbound dispatch should also capture enough metadata to support future inbound correlation:

- internal dispatch id
- provider message id
- from identity used
- recipient identity used
- case and property linkage
- template and workflow source

### 7.2 Provider Adapter Interface

Suggested interface:

```ts
type MessageChannel = 'email' | 'sms';

type SendMessageRequest = {
  tenantId: string;
  channel: MessageChannel;
  from?: string | null;
  to: string;
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  metadata?: Record<string, unknown>;
};

type SendMessageResult = {
  providerMessageId?: string | null;
  status: 'queued' | 'sent' | 'logged' | 'failed';
  rawResponse?: Record<string, unknown> | null;
};
```

Adapters:

- `mailgun`
- `twilio_sms`
- `sms24x`
- `log`

The adapter result should preserve provider identifiers that could later be used to correlate replies and status callbacks.

## 8. Workflow Action Model

Messaging actions should remain explicit and typed.

Initial workflow actions should include:

- `Trigger`
- `Email`
- `Sms`
- `InternalNote`
- `Task`
- `Webhook`

For `Email` and `Sms`, the workflow action should define:

- trigger point: `Start` or `Complete`
- template key or template id
- recipient selector
- optional extra variables

### 8.1 Recipient Selectors

Do not store legacy raw assumptions directly in provider code.

Support a typed recipient selector model:

- `case_party`
  - buyer
  - seller
  - tenant
  - landlord
  - guarantor
- `case_owner`
- `specific_membership`
- `branch_team`
- `all_admin`
- `all_agency`

Resolve selectors into actual recipients before rendering/sending.

## 9. Template Authoring

The legacy system proved template editing is valuable, but Pug/Jade was too technical.

The new system should use constrained authoring rather than raw code templates.

### 9.1 Recommended Editor Strategy

Use a structured editor, not a programming language.

Recommended approach:

- SMS editor
  - plain text
  - variable chips
  - live preview
  - segment counter

- Email editor
  - block-based rich text editor
  - locked layout sections
  - variables inserted as safe tokens
  - live preview with sample case data
  - optional advanced mode later if genuinely needed

### 9.2 Recommended Technology

Recommended first choice:

- Tiptap-based constrained editor for body content

Why:

- easier to constrain than a full HTML builder
- better fit for business-user editing than code templates
- good enough for structured content blocks

Do not start with:

- raw HTML editing for normal users
- raw MJML editing for normal users
- provider-owned template builders as the only editing experience

If drag/drop layout becomes a hard requirement later, evaluate a separate advanced builder after the core delivery model is stable.

### 9.3 Template Variable Model

Variables should be declared, typed, and previewable.

Examples:

- `case.reference`
- `case.title`
- `property.displayAddress`
- `workflow.stage.name`
- `workflow.stage.targetDate`
- `tenant.branchName`

Rules:

- unknown variables should fail validation in the editor
- rendering should not evaluate arbitrary code
- preview data should be selectable from real or fixture cases

## 10. Provider-Specific Notes

### 10.1 Mailgun

Use as an email transport provider only.

Keep our own templates and render before send. Do not make Mailgun Templates the source of truth for workflow messaging.

Future inbound expectations:

- preserve provider message identifiers
- preserve `Message-Id` / reply-thread metadata where available
- design for reply-address aliases or reply-to routing later

### 10.2 Twilio SMS

Use as a standard SMS provider adapter.

Design the adapter around:

- sender identity configuration
- provider message id capture
- webhook-ready status updates later

Future inbound expectations:

- conversation correlation should primarily use provider number + remote number pairing
- inbound message matching should not depend on codes embedded in message bodies

### 10.3 SMS24x

The current client’s legacy integration is a SOAP-based SMS adapter that:

- normalizes UK numbers
- supports an override number
- fills `{{ }}` template tokens
- calls `SendFullSMS` against the 24x2 WSDL endpoint

The new adapter should preserve the useful operational behavior:

- safe override support
- input normalization
- dispatch audit

But it should not preserve:

- eval-style template interpolation
- provider-specific logic leaking into workflow code

Future inbound expectations:

- preserve the provider request/response identifiers if the API exposes them
- if inbound delivery is added later, treat phone-pair correlation as primary and heuristic matching as secondary

## 11. Future Inbound Messaging

Inbound handling is intentionally deferred from the first outgoing implementation slice, but the target direction should be explicit now.

### 11.1 Problem Statement

The legacy approach of matching replies via codes embedded in message bodies is not reliable enough.

It breaks down because:

- users reply without preserving the code
- forwarded or edited messages lose the correlation token
- landlords can relate to multiple properties
- tenants can move between properties
- sender identity alone is not always enough to resolve the correct case

### 11.2 Preferred Correlation Strategy

Future inbound matching should prefer:

For email:

- provider message ids
- `In-Reply-To`
- `References`
- reply-to alias or dedicated routing address
- thread identity

For SMS:

- provider account identity
- sending number
- remote number
- existing open thread on that number pair

Only after those should the system attempt softer heuristics such as:

- case/contact/property linkage
- active case recency
- sender email or phone against known case parties

### 11.3 Explicit Rejection

Do not use “parse a code from the message body” as the primary correlation mechanism.

At most, body tokens can be a weak fallback signal.

### 11.4 Outbound Requirements to Enable Inbound Later

The outgoing implementation should therefore always store:

- provider message ids
- original and effective sender/recipient identities
- case id, property id, and workflow source where relevant
- dispatch metadata that can be joined into future conversation threads

## 12. Testing Strategy

## 11. Testing Strategy

Messaging should be testable without real time or real recipients.

### 11.1 Unit Tests

Cover:

- recipient resolution
- variable validation
- redirect behavior
- delivery mode selection
- provider payload mapping

### 11.2 API Integration Tests

Cover:

- template CRUD
- dispatch creation
- workflow-triggered message requests
- redirect mode
- log-only mode
- provider-account resolution

### 11.3 End-to-End Tests

Use the `log` provider in Playwright.

Required flows:

- workflow transition triggers an email action
- workflow transition triggers an SMS action
- redirected mode sends to the safe recipient only
- operator can inspect the recorded dispatch

### 11.4 Local Development

Default local development posture should be:

- `log_only` mode
- no real provider credentials required
- file/database inspection available immediately

## 13. Rollout Order

Recommended implementation order:

1. central provider abstraction
2. tenant channel settings and safe delivery modes
3. `log` provider
4. workflow actions emit message requests instead of inline sends
5. Mailgun adapter
6. Twilio SMS adapter
7. SMS24x adapter
8. versioned template model
9. constrained SMS editor
10. constrained email editor

## 14. Practical Rules

- keep templates app-owned
- keep delivery provider pluggable
- make safe mode the default for development
- never send real messages during automated tests
- record original and effective recipients whenever redirection occurs
- do not allow arbitrary template code execution
- keep messaging logic out of workflow transition controllers
- design every outbound dispatch so future inbound correlation is possible
