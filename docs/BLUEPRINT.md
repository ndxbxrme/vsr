# VitalSpace Remake Blueprint

## 1. Purpose

This document defines the target architecture and delivery plan for remaking the VitalSpace platform as a modern, multi-tenant SaaS product.

The current platform is a collection of separate legacy applications with a unified AngularJS frontend layered on top. The target platform should replace that with:

- one backend codebase
- one primary Postgres database
- one modern frontend
- first-class multi-tenancy and whitelabeling
- self-serve SaaS onboarding
- explicit domain boundaries instead of implicit framework behavior

This is a platform redesign and migration, not a direct port.

## 2. Goals

- Consolidate legacy APIs into a single backend application.
- Consolidate legacy in-memory/local-storage data stores into Postgres.
- Replace the AngularJS frontend with Vue 3 + Vite.
- Support multi-tenant operation for agencies/brands from day one.
- Support full OAuth/OIDC signup and login flows alongside local auth.
- Preserve critical legacy workflows before adding major new features.
- Make integrations, messaging, permissions, and workflows explicit and testable.
- Preserve the legacy app's live-refresh feel with an explicit realtime architecture.

## 3. Non-Goals

- Reproducing every legacy quirk before launch.
- Preserving legacy internal implementation patterns such as `ndx-*` auto-magic, implicit DB triggers, or route duplication.
- Splitting into microservices early.
- Rebuilding everything in one cutover.

## 4. Current State Summary

Based on the x-ray docs and source review:

- The frontend is a unified AngularJS shell that routes into multiple historical products.
- Backend services are separate apps with overlapping data models and inconsistent naming.
- Important behavior lives in DB hooks, background polling, webhook chains, and package conventions rather than explicit application services.
- Sales and lettings share a large amount of behavior and should become one case/workflow domain with configurable variants.
- Leads and maintenance are adjacent domains, but should remain separate modules inside the new platform.
- External systems such as Dezrez, Fixflo, Gravity Forms, Rightmove, OnTheMarket, email, and SMS are operationally important.
- The current deployment already separates static frontend hosting from API hosting, which is a good fit for the remake.

## 5. Architectural Principles

- Modular monolith first.
- Multi-tenant by default, not retrofitted later.
- Explicit domain services over implicit framework hooks.
- Async work handled by jobs and workers, not request threads.
- Realtime updates emitted explicitly by application services, not hidden DB triggers.
- Configuration over forks for workflows, branding, and templates.
- Provider-agnostic integration contracts with provider-specific adapters.
- Readability and observability over cleverness.
- Backwards-compatible migration where possible.

## 6. Target Stack

### Frontend

- Vue 3
- Vite
- TypeScript
- Vue Router
- Pinia
- TanStack Query for server state
- Socket.IO client for tenant-scoped realtime updates
- Component library built in-house for tenant theming

### Backend

- Node.js
- Express
- TypeScript
- Postgres
- Drizzle for schema, migrations, and querying
- Zod for request and domain validation
- AWS SQS-based workers for async jobs
- Socket.IO-based realtime gateway

### Infrastructure

- Frontend on S3 + CloudFront
- Backend on AWS Fargate
- Postgres on RDS
- SQS for queues
- S3 for uploads/documents
- CloudWatch for logs and metrics

## 7. Recommended System Shape

Build one backend repo and deployable service, but structure it as a modular monolith with clear domain modules:

- `identity`
- `tenancy`
- `users`
- `sales`
- `lettings`
- `leads`
- `maintenance`
- `communications`
- `integrations`
- `files`
- `reporting`
- `admin`

These modules share one database but do not reach into each other arbitrarily. Cross-domain actions should happen through application services, domain events, or queued jobs.

## 8. Tenant Model

Multi-tenancy is a core requirement. The minimum model should include:

- `tenants`
- `brands`
- `branches`
- `users`
- `memberships`
- `roles`
- `plans`
- `subscriptions`
- `feature_flags`

### Tenant Rules

- Every business record belongs to a `tenant_id`.
- Many operational records should also belong to a `branch_id`.
- Branding, workflow templates, communication templates, and integration credentials are tenant-scoped.
- Global platform admins exist outside normal tenant roles.
- Agency users can belong to one or more branches within a tenant.

### Whitelabel Scope

Whitelabeling should cover:

- logo
- colours
- typography
- email templates
- SMS templates
- subdomains
- custom domains

It should not require separate frontend builds per tenant.

## 9. Domain Boundaries

### 9.1 Identity and Tenancy

Responsible for:

- signup
- login
- OAuth/OIDC signup and login
- invitations
- password reset
- tenant creation
- branch creation
- memberships and roles
- subscription state
- tenant domain binding

Stripe should be introduced later behind a billing interface so the domain model is ready before payment workflows are switched on.

### 9.2 Sales

Responsible for:

- sales cases
- offers
- milestones
- progression workflows
- dashboards
- solicitor and related party coordination
- case notes and timeline

### 9.3 Lettings

Responsible for:

- lettings cases
- offers/applications
- progression workflows
- agreed lets reporting
- landlord and tenant workflow state

Sales and lettings should share a common case/workflow engine where sensible, with product-specific configurations layered on top.

### 9.4 Leads

Responsible for:

- lead capture
- lead assignment
- source tracking
- valuation/instruction flows
- offer and instruction intake

### 9.5 Maintenance

Responsible for:

- issues
- tasks
- contractors
- landlords
- tenant communications
- inbound/outbound message threads

### 9.6 Communications

Responsible for:

- email sending
- SMS sending
- templates
- audit trail of sends
- inbound email parsing
- future notification preferences

### 9.7 Integrations

Responsible for:

- Dezrez sync
- Fixflo sync
- Gravity Forms ingestion
- Rightmove/OnTheMarket ingestion
- webhook handling
- retries and reconciliation jobs

Integration boundaries should stay provider-agnostic at the platform layer:

- raw inbound events are stored in generic webhook tables
- provider-specific classifiers turn raw events into durable integration jobs
- provider adapters fetch and normalize external data into canonical entities
- external activity feeds should normalize into shared `timeline_events`, not provider-specific event caches
- provider quirks stay inside adapters, not in domain modules or frontend code

## 10. Data Model Direction

The legacy system has inconsistent identifiers and duplicated concepts. The new platform needs canonical entities.

Core entities should include:

- `tenant`
- `branch`
- `user`
- `membership`
- `property`
- `contact`
- `case`
- `case_party`
- `workflow`
- `workflow_stage`
- `workflow_event`
- `offer`
- `lead`
- `issue`
- `task`
- `message_thread`
- `message`
- `document`
- `integration_account`
- `integration_sync_run`
- `audit_log`

### Canonical Modeling Rules

- Use internal UUID primary keys.
- Store external IDs separately with source metadata.
- Do not use source-specific IDs as internal primary keys.
- Keep an append-only audit/timeline for user-visible operational history.
- Prefer normalized core entities plus explicit read models for dashboards and search.

## 11. Frontend Blueprint

The frontend should be one Vue application with route areas by product domain, not a shell that proxies multiple site runtimes.

### Frontend Areas

- marketing/public site
- signup/onboarding
- main app shell
- sales workspace
- lettings workspace
- leads workspace
- maintenance workspace
- admin/settings

### Frontend Rules

- Tenant context resolved at login or subdomain/domain entry.
- Permissions enforced both in API and UI routing.
- Shared components for timelines, case headers, forms, templates, search tables, notes, and communications.
- Product differences handled by schema/configuration where possible.
- Realtime events should update query caches by entity and let the client decide whether to patch local state or refetch.

## 12. Backend Blueprint

### API Style

- REST-first JSON API
- Versioned under `/api/v1`
- Webhooks under explicit `/webhooks/*`
- Internal/admin jobs not exposed as public operational routes
- Stripe integration behind placeholder service interfaces until billing is enabled
- Realtime events delivered over tenant-scoped Socket.IO channels

### Backend Rules

- No hidden behavior in DB triggers for core workflow logic.
- Request handlers should stay thin.
- Domain services own business rules.
- Background jobs handle sync, reconciliation, notifications, imports, and fan-out.
- A centralized realtime service should be called explicitly after successful mutations to emit typed change events.
- Validation at API boundary and service boundary.
- Every important mutation writes to an audit trail.

### Realtime Model

- The system should retain the legacy app's "live refresh" feel, but with a cleaner implementation.
- Realtime emission should happen in application services after writes succeed, not inside database triggers.
- Emitted events should include enough metadata for clients to decide whether to patch in-place or invalidate and refetch.
- The default event shape should include tenant, entity type, entity id, mutation type, and optionally a partial payload or hydrated read model.
- Bulk or high-risk mutations may still use invalidate-and-refetch semantics on the client.
- The first implementation should optimize for correctness and simplicity before aggressive fine-grained patching.

## 13. Integration Strategy

The current platform relies heavily on external systems and webhook chains. In the new system:

- inbound webhooks should be authenticated, logged, and queued
- inbound webhooks should be persisted before downstream processing
- provider webhook handlers should classify into durable integration jobs rather than process inline
- provider refresh jobs should hydrate canonical tables such as properties, offers, viewings, and timeline events
- outbound sync should be retryable and observable
- integration credentials should be tenant-scoped where applicable
- sync status should be visible in admin tooling
- all import/sync flows should be idempotent

### Initial Integration Priorities

1. Dezrez
2. Email
3. SMS
4. File storage/uploads
5. Fixflo
6. Lead ingestion sources

## 14. Security and Compliance Baseline

- Tenant isolation enforced in every query path.
- Fine-grained role checks.
- Audit logging for sensitive actions.
- Signed file access or permission-checked download endpoints.
- Secret management through AWS parameter/secret storage.
- No frontend exposure of privileged tokens.
- PII minimization in logs.

## 15. Delivery Strategy

This should be delivered in phases.

### Phase 0: Blueprint and Discovery

- finalize domain model
- produce legacy parity matrix
- document required integrations
- identify critical workflows for launch
- define tenancy and pricing assumptions

### Phase 1: Platform Foundations

- backend skeleton
- Postgres schema and migrations
- auth and membership model
- OAuth/OIDC foundations
- tenant and branch provisioning
- file storage
- communications framework
- realtime framework
- job/worker framework
- audit log

### Phase 2: Shared Core

- property/contact/case canonical model
- workflow engine
- timeline/notes/documents
- search and dashboard read models
- tenant theming system
- core app shell in Vue

### Phase 3: Sales and Lettings MVP

- dashboard
- case list
- case detail
- progression workflows
- offers/applications
- templates and notifications
- required reports

Sales and lettings should be built on the same shared platform foundations and progressed together, with internal rollout and side-by-side validation against the legacy system before either becomes the default.

### Phase 4: Integrations and Data Migration

- Dezrez sync
- legacy imports
- reconciliation tooling
- dual-run or controlled cutover by module/tenant

### Phase 5: Leads and Maintenance

- rebuild leads workflows
- rebuild maintenance workflows
- inbound email/message center
- contractor/landlord areas as required

### Phase 6: SaaS Productization

- self-serve signup
- subscription management
- onboarding wizard
- whitelabel admin
- feature packaging and billing controls

Initial billing code should use placeholder interfaces and no live charging until the core product is stable enough to commercialize.

## 16. Migration Strategy

Do not cut over everything at once.

Recommended migration order:

1. Stand up new platform foundations with no tenant traffic.
2. Rebuild shared case model and sales/lettings core.
3. Import a snapshot of legacy data into the new canonical schema.
4. Run sync/reconciliation tooling until outputs are trusted.
5. Pilot with one internal or low-risk tenant.
6. Migrate remaining tenants in waves.
7. Move leads and maintenance after core platform is stable.

### Migration Rules

- Build importers, not hand-written one-off scripts where possible.
- Preserve external source IDs for traceability.
- Keep a mapping table from legacy IDs to new IDs.
- Add reconciliation reports for counts, statuses, milestones, and financial totals.

## 17. Major Risks

- Hidden legacy behavior in `ndx-*` packages and DB hooks.
- Inconsistent identifiers across services.
- Cross-service webhook dependencies masking real source-of-truth rules.
- Scope creep from combining rewrite, replatform, SaaS, and product redesign.
- Underestimating data migration and reconciliation effort.
- Attempting to generalize multi-tenancy too late.

## 18. Decisions Taken

- ORM: Drizzle
- Queue: AWS SQS
- Billing provider: Stripe later, behind placeholder interfaces for now
- Tenant routing model: support both subdomains and custom domains
- Sales and lettings delivery: build both on the shared platform and run alongside the legacy system until trusted
- Client portals: later, not MVP
- Launch reporting scope: operational parity only for core workflows, with advanced analytics later

## 19. Immediate Next Outputs

The next planning artifacts should be:

1. a bounded-context and module map
2. a canonical entity/schema draft
3. a legacy-to-new parity matrix
4. an integration inventory with auth methods and data ownership
5. an MVP scope definition for first launch

## 20. Recommendation

Start with sales and lettings as the first operational remake on top of the new shared platform foundations. They contain the most central workflow value, the clearest overlap, and the strongest justification for the new canonical case model. Leads and maintenance should follow as later modules unless a business dependency forces one of them earlier.
