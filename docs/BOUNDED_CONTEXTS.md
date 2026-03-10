# VitalSpace Bounded Context and Module Map

## 1. Purpose

This document turns the platform blueprint into an application shape. It defines the bounded contexts, what each context owns, how contexts interact, and how those boundaries should translate into backend and frontend modules.

The goal is to stop the remake from becoming a new version of the legacy sprawl.

## 2. Context Map Overview

The target system should be grouped into three layers:

- Platform Core
- Operational Domains
- External Integrations

### Platform Core

- Identity
- Tenancy
- Access Control
- Realtime
- Files
- Communications
- Audit
- Billing

### Operational Domains

- CRM and Leads
- Property and Contacts
- Case Management
- Sales
- Lettings
- Maintenance
- Reporting

### External Integrations

- Dezrez
- Fixflo
- Lead Sources
- Email Providers
- SMS Providers
- Domain and webhook infrastructure

## 3. Bounded Contexts

## 3.1 Identity

### Owns

- authentication
- local credentials
- OAuth/OIDC identities
- password reset
- invite acceptance
- sessions and tokens
- user profile basics

### Does Not Own

- tenant membership
- business roles inside products
- billing or plan state

### Key Entities

- `user`
- `credential`
- `oauth_account`
- `session`
- `invite_token`
- `password_reset_token`

### Public Responsibilities

- sign up a user
- authenticate a user
- link and manage OAuth/OIDC identities
- reset password
- accept invite
- issue and revoke tokens

## 3.2 Tenancy

### Owns

- tenants
- brands
- branches
- tenant domains
- onboarding state
- subscription placeholders

### Does Not Own

- authentication
- product workflow data

### Key Entities

- `tenant`
- `brand`
- `branch`
- `tenant_domain`
- `subscription_account`
- `feature_flag`

### Public Responsibilities

- create tenant
- create branch
- bind subdomain
- bind custom domain
- load tenant settings for runtime

## 3.3 Access Control

### Owns

- memberships
- roles
- permissions
- product access flags

### Does Not Own

- login
- billing
- business workflow rules

### Key Entities

- `membership`
- `role`
- `permission_grant`

### Public Responsibilities

- assign user to tenant or branch
- resolve effective permissions
- enforce role-based access rules

## 3.4 Property and Contacts

### Owns

- canonical property records
- canonical contacts and parties
- external ID mappings for properties and contacts

### Does Not Own

- case progression
- lead assignment
- maintenance issue lifecycle

### Key Entities

- `property`
- `contact`
- `contact_method`
- `party_link`
- `external_reference`

### Public Responsibilities

- store canonical property records
- resolve external-to-internal mappings
- expose property and contact lookups to operational domains

## 3.5 CRM and Leads

### Owns

- lead capture
- lead source tracking
- lead qualification
- valuation and instruction intake
- lead assignment and follow-up

### Does Not Own

- sales case progression
- lettings case progression
- maintenance operations

### Key Entities

- `lead`
- `lead_source`
- `lead_assignment`
- `lead_activity`

### Public Responsibilities

- ingest leads from forms and portals
- route leads to users or teams
- convert leads into downstream records when appropriate

## 3.6 Case Management

### Owns

- shared case model
- timeline
- notes
- documents
- workflow templates
- workflow state transitions

### Does Not Own

- product-specific sales rules
- product-specific lettings rules
- property sync

### Key Entities

- `case`
- `case_party`
- `timeline_event`
- `note`
- `document`
- `workflow_template`
- `workflow_instance`
- `workflow_stage`
- `workflow_transition`

### Public Responsibilities

- create and manage shared case records
- track progression
- record auditable user and system actions
- expose the shared operational timeline

Case Management is the shared engine used by Sales and Lettings. It should stay generic enough to be reused, but not so generic that core business rules become unreadable.

## 3.7 Sales

### Owns

- sales-specific case rules
- offers
- sales dashboards
- conveyancing-specific milestones and automations

### Does Not Own

- the generic workflow engine
- authentication
- tenant theming

### Key Entities

- `sales_case`
- `sales_offer`
- `sales_dashboard_snapshot`

### Public Responsibilities

- apply sales workflow rules to cases
- manage sales offers and progression data
- produce sales operational views

## 3.8 Lettings

### Owns

- lettings-specific case rules
- applications
- agreed lets reporting inputs
- landlord and tenant workflow variants

### Does Not Own

- the generic workflow engine
- authentication
- tenant theming

### Key Entities

- `lettings_case`
- `lettings_application`
- `lettings_offer`
- `lettings_dashboard_snapshot`

### Public Responsibilities

- apply lettings workflow rules to cases
- manage applications and lettings progression
- produce lettings operational views

## 3.9 Maintenance

### Owns

- maintenance issues
- tasks
- contractor allocation
- landlord linkage
- inbound and outbound issue messaging

### Does Not Own

- sales and lettings cases
- tenant signup

### Key Entities

- `issue`
- `task`
- `contractor`
- `landlord`
- `message_thread`
- `message`

### Public Responsibilities

- manage issue lifecycle
- coordinate contractors and landlords
- maintain maintenance communication history

## 3.10 Realtime

### Owns

- websocket connections
- tenant-scoped channels
- authenticated subscriptions
- typed mutation events
- broadcast fan-out rules

### Does Not Own

- business data
- workflow decisions
- persistence

### Key Entities

- `realtime_connection`
- `subscription`
- `change_event`

### Public Responsibilities

- publish mutation events after successful writes
- expose tenant-aware subscription channels
- let clients decide whether to patch state or refetch
- provide a stable event contract for the frontend

Realtime should be triggered explicitly from application services after mutations succeed. It should not depend on database triggers or table watchers.

## 3.11 Communications

### Owns

- email templates
- SMS templates
- outbound sends
- inbound email parsing
- notification audit

### Does Not Own

- business decisions about when a notification should be sent

### Key Entities

- `email_template`
- `sms_template`
- `notification`
- `message_delivery`
- `inbound_message`

### Public Responsibilities

- send communications requested by operational domains
- store message outcomes
- standardize provider integrations

## 3.12 Files

### Owns

- uploads
- generated documents
- attachment metadata
- access control hooks for file retrieval

### Key Entities

- `file_object`
- `file_attachment`

### Public Responsibilities

- store file metadata
- link files to cases, issues, contacts, and messages
- provide secure download references

## 3.13 Audit

### Owns

- append-only action log
- actor metadata
- compliance-focused change history

### Key Entities

- `audit_log`
- `audit_actor`

### Public Responsibilities

- record important mutations
- provide support and compliance history

## 3.14 Reporting

### Owns

- read models
- dashboard aggregates
- export views

### Does Not Own

- primary workflow writes

### Key Entities

- `report_view`
- `dashboard_metric`
- `export_job`

### Public Responsibilities

- expose operational reporting for dashboards
- generate tenant-scoped exports

For MVP, reporting should focus on operational parity, not advanced BI.

## 3.15 Billing

### Owns

- plan catalog
- subscription state abstraction
- billing events

### Does Not Own

- tenant signup
- payment provider credentials in the first implementation pass

### Key Entities

- `plan`
- `subscription`
- `billing_event`

### Public Responsibilities

- abstract billing state from the rest of the app
- provide a clean integration seam for Stripe later

Billing should exist as a placeholder module early, even if payment workflows are deferred.

## 3.16 Integrations

### Owns

- external account credentials
- sync jobs
- webhook verification
- retry and reconciliation state

### Does Not Own

- business workflow decisions in other domains

### Key Entities

- `integration_account`
- `integration_mapping`
- `sync_job`
- `sync_run`
- `webhook_event`

### Public Responsibilities

- adapt external systems into canonical platform events and commands
- coordinate tenant-scoped integration settings
- surface integration health

## 4. Relationship Rules

- Identity provides authenticated users to Access Control.
- Tenancy and Access Control determine the runtime tenant and permissions for every request.
- Realtime receives explicit mutation events from application services in other contexts and broadcasts them to authorized clients.
- Property and Contacts provides canonical records used by Leads, Case Management, Sales, Lettings, and Maintenance.
- Case Management provides shared case, timeline, note, and workflow services to Sales and Lettings.
- Sales and Lettings may extend shared case behavior but should not redefine shared timeline or document concepts.
- Communications sends messages on request from Sales, Lettings, Leads, and Maintenance.
- Files serves all operational domains but does not decide who may upload or download without caller-provided authorization context.
- Integrations feeds Property and Contacts, Leads, Case Management, Sales, Lettings, and Maintenance through explicit application services or queued jobs.
- Reporting consumes data from operational domains and should prefer read models over deep live joins for dashboard-heavy screens.

## 5. Backend Module Map

The backend should expose code modules that match the bounded contexts closely.

Suggested top-level shape:

- `src/app`
- `src/modules/identity`
- `src/modules/tenancy`
- `src/modules/access-control`
- `src/modules/realtime`
- `src/modules/property`
- `src/modules/contacts`
- `src/modules/leads`
- `src/modules/cases`
- `src/modules/sales`
- `src/modules/lettings`
- `src/modules/maintenance`
- `src/modules/communications`
- `src/modules/files`
- `src/modules/audit`
- `src/modules/reporting`
- `src/modules/billing`
- `src/modules/integrations`
- `src/shared`
- `src/jobs`

Each module should contain:

- routes or controllers
- request/response schemas
- application services
- domain models
- repository layer
- tests

## 6. Frontend Module Map

The frontend should mirror the business shape rather than the legacy app split.

Suggested route areas:

- `/app`
- `/app/sales`
- `/app/lettings`
- `/app/leads`
- `/app/maintenance`
- `/app/settings`
- `/app/admin`

Suggested frontend feature modules:

- auth
- tenancy
- shell
- realtime
- properties
- contacts
- cases
- sales
- lettings
- leads
- maintenance
- communications
- documents
- reporting
- settings

## 7. Shared Kernel

These concepts are shared widely enough to justify common platform definitions:

- tenant context
- user identity
- branch context
- role and permission primitives
- realtime event envelope
- audit actor shape
- external reference shape
- note and timeline entry primitives
- file attachment references

The shared kernel should stay small. If it grows too much, boundaries are probably leaking.

## 8. Event and Job Boundaries

The following actions should normally happen through jobs or domain events rather than direct inline chaining:

- inbound webhooks
- external sync refreshes
- notification sends
- document generation
- dashboard aggregate refresh
- reconciliation checks
- large imports

The following actions should emit realtime change events through the Realtime context after successful writes:

- case mutations
- workflow stage changes
- offer and application changes
- issue and task changes
- important contact or property updates that affect active views

Recommended event examples:

- `tenant.created`
- `membership.invited`
- `lead.received`
- `case.created`
- `workflow.stage_changed`
- `sales.offer_submitted`
- `lettings.application_received`
- `maintenance.issue_reported`
- `integration.sync_completed`

These do not require full event sourcing. They are application events for decoupling and observability.

## 9. Contexts for MVP

The first operational MVP should include:

- Identity
- Tenancy
- Access Control
- Realtime
- Property and Contacts
- Case Management
- Sales
- Lettings
- Communications
- Files
- Audit
- Integrations
- Reporting

The following contexts can be reduced or deferred in the first release:

- Billing as placeholder only
- CRM and Leads after core case flows are stable
- Maintenance after core case flows are stable
- Client portal capabilities later

## 10. Anti-Patterns to Avoid

- generic mega-services shared across every domain
- direct table access across contexts
- putting workflow rules into database triggers
- letting provider payloads become internal domain models
- rebuilding separate frontend apps under one shell
- coupling tenant branding to deployment-time build output

## 11. Immediate Follow-On Artifact

The next document should be the canonical entity and schema draft. It should use the context map in this document as the source of truth for ownership.
