# VitalSpace Delivery Breakdown

## 1. Purpose

This document turns the architecture, schema, and parity decisions into a delivery sequence. It defines the work in practical terms so implementation can start without losing scope control.

This is not a sprint plan. It is a program-level breakdown of epics, dependencies, and rollout sequencing.

## 2. Delivery Principles

- Build foundations once and reuse them.
- Do not start leads or maintenance before the shared platform core is stable.
- Sales and lettings should be built on the same shared case and workflow engine.
- Side-by-side running is part of the plan, not an afterthought.
- Parity is measured by workflows and operational confidence, not by screen count.
- Realtime, audit, tenancy, and integrations are platform concerns and must not be bolted on later.

## 3. Delivery Phases

### Phase 0: Planning and Definition

Purpose:

- remove architectural ambiguity
- define scope and constraints
- prepare for implementation

Outputs:

- blueprint
- bounded contexts
- canonical schema
- legacy parity matrix
- delivery breakdown

Status:

- complete enough to move into implementation planning

### Phase 1: Platform Foundations

Purpose:

- establish the platform capabilities every later module depends on

Success criteria:

- developers can build tenant-aware authenticated features on the new stack
- the platform can persist core records, emit audit and realtime events, and run background jobs

### Phase 2: Shared Core

Purpose:

- build the canonical business core used by both sales and lettings

Success criteria:

- properties, contacts, cases, workflows, notes, documents, and essential reporting work end to end

### Phase 3: Sales and Lettings MVP

Purpose:

- deliver real operational workflows for side-by-side usage

Success criteria:

- selected users can perform core sales and lettings work in the new system alongside the legacy platform

### Phase 4: Integration Hardening and Migration

Purpose:

- make the platform trustworthy under real data and real integrations

Success criteria:

- sync, imports, reconciliation, and side-by-side validation are reliable enough for pilot usage

### Phase 5: Secondary Domains

Purpose:

- add leads and maintenance on top of the stable shared platform

Success criteria:

- non-core legacy domains are rebuilt without destabilizing the sales/lettings core

### Phase 6: SaaS Productization

Purpose:

- turn the rebuilt platform into a tenant-ready commercial SaaS product

Success criteria:

- onboarding, whitelabel controls, domain binding, and later billing are production ready

## 4. Epics

## 4.1 Platform Foundation Epics

### Epic P1: Monorepo and Runtime Skeleton

Scope:

- backend project structure
- frontend project structure
- shared TypeScript standards
- environment/config conventions
- local developer bootstrap

Deliverables:

- backend app skeleton
- frontend app skeleton
- module directory structure matching bounded contexts
- linting, formatting, test harnesses

Dependencies:

- none

### Epic P2: Database and Migration Foundation

Scope:

- Drizzle setup
- migration strategy
- Postgres local/dev/prod conventions
- base schema bootstrap

Deliverables:

- migration runner
- schema package or module layout
- first platform-core migrations

Dependencies:

- P1

### Epic P3: Identity and Access

Scope:

- local auth
- OAuth/OIDC auth
- sessions
- invites
- password reset
- memberships
- roles and permissions

Deliverables:

- authenticated API foundation
- tenant-aware access control
- user and membership administration primitives

Dependencies:

- P1
- P2

### Epic P4: Tenancy and Runtime Tenant Resolution

Scope:

- tenants
- brands
- branches
- tenant domains
- tenant context resolution by subdomain/custom domain
- feature flags

Deliverables:

- tenant-aware backend request context
- tenant-aware frontend boot flow
- branch-aware user context

Dependencies:

- P1
- P2
- P3

### Epic P5: Files and Document Storage

Scope:

- S3-backed file storage
- file metadata
- attachment model
- secure upload/download patterns

Deliverables:

- file upload service
- file attachment service
- signed or authorized download flow

Dependencies:

- P1
- P2
- P3
- P4

### Epic P6: Audit and Outbox

Scope:

- audit logging
- outbox event model
- event publishing hooks in application services

Deliverables:

- audit writer
- outbox writer
- shared mutation patterns for business services

Dependencies:

- P1
- P2
- P3
- P4

### Epic P7: Realtime Platform

Scope:

- Socket.IO gateway
- authenticated subscriptions
- tenant-scoped channels
- event envelope contract
- frontend cache invalidation/patch strategy

Deliverables:

- backend realtime service
- frontend realtime client layer
- initial entity-change event handlers

Dependencies:

- P3
- P4
- P6

### Epic P8: Job and Integration Infrastructure

Scope:

- SQS queue strategy
- worker processes
- retry/dead-letter rules
- webhook ingestion framework
- integration account model

Deliverables:

- worker runtime
- queue publishing helpers
- webhook event pipeline

Dependencies:

- P1
- P2
- P4
- P6

### Epic P9: Tenant Admin and Settings Foundation

Scope:

- user management UI
- branch management UI
- role assignment UI
- brand/theme settings
- template management shell

Deliverables:

- initial admin/settings area

Dependencies:

- P3
- P4

## 4.2 Shared Core Epics

### Epic C1: Property and Contact Core

Scope:

- canonical property model
- canonical contact model
- relationship mapping
- external references

Deliverables:

- property service
- contacts service
- search/list/detail APIs for core use cases

Dependencies:

- P2
- P4
- P6

### Epic C2: Case Core

Scope:

- shared case model
- case parties
- notes
- timeline
- ownership

Deliverables:

- case APIs
- case list/detail read models
- timeline and note components

Dependencies:

- C1
- P3
- P4
- P5
- P6
- P7

### Epic C3: Workflow Engine

Scope:

- workflow templates
- stage state
- workflow events
- manual actions
- milestone progression

Deliverables:

- workflow template management
- workflow instance service
- evented workflow transitions

Dependencies:

- C2
- P6
- P7

### Epic C4: Communications Core

Scope:

- email templates
- SMS templates
- notification requests
- notification delivery tracking

Deliverables:

- template APIs/UI
- communications service
- notification worker hooks

Dependencies:

- P3
- P4
- P6
- P8
- P9

### Epic C5: Integrations Core

Scope:

- integration accounts
- webhook storage
- sync runs
- mapping patterns

Deliverables:

- integrations admin foundation
- sync bookkeeping

Dependencies:

- P4
- P6
- P8

### Epic C6: Essential Reporting Core

Scope:

- operational dashboard metrics
- search/read models
- agreed lets/sales pipeline base metrics

Deliverables:

- minimal reporting APIs
- first dashboard read models

Dependencies:

- C1
- C2
- C3

## 4.3 Sales and Lettings Epics

### Epic SL1: Dezrez Integration

Scope:

- property/role/offers/viewings/event sync
- external reference mapping
- sync monitoring

Deliverables:

- working Dezrez integration for sales and lettings core

Dependencies:

- C1
- C5
- P8

### Epic SL2: Sales Case Workspace

Scope:

- sales dashboard
- sales case list
- sales case detail
- sales-specific fields

Deliverables:

- first usable sales workspace

Dependencies:

- C2
- C3
- C4
- C6
- SL1

### Epic SL3: Sales Offers and Progression Actions

Scope:

- offer submission and updates
- progression requests
- milestone automation hooks

Deliverables:

- sales offer workflow
- sales progression actions

Dependencies:

- SL2
- C3
- C4
- P7

### Epic SL4: Lettings Case Workspace

Scope:

- lettings dashboard
- lettings case list
- lettings case detail
- lettings-specific fields

Deliverables:

- first usable lettings workspace

Dependencies:

- C2
- C3
- C4
- C6
- SL1

### Epic SL5: Lettings Applications, Offers, and Agreed Reporting

Scope:

- applications
- offers
- agreed lets reporting
- milestone automation hooks

Deliverables:

- lettings applications/offers
- agreed lets report

Dependencies:

- SL4
- C3
- C4
- C6
- P7

### Epic SL6: Workflow and Template Admin

Scope:

- progression template editing
- email/SMS template assignment
- tenant-level workflow configuration

Deliverables:

- settings screens and APIs needed by operational admins

Dependencies:

- C3
- C4
- P9

## 4.4 Migration and Rollout Epics

### Epic M1: Legacy Data Mapping and Import

Scope:

- legacy ID mapping
- import pipelines
- import validation

Deliverables:

- repeatable import jobs
- mapping tables and reports

Dependencies:

- schema and core services in place

### Epic M2: Reconciliation

Scope:

- counts and totals
- workflow state comparison
- property/case parity checks

Deliverables:

- reconciliation reports
- discrepancy workflows

Dependencies:

- M1
- SL2
- SL3
- SL4
- SL5

### Epic M3: Pilot Rollout

Scope:

- internal users first
- selected tenant/branch pilot
- support and feedback loops

Deliverables:

- pilot checklist
- issue triage process
- rollback and coexistence plan

Dependencies:

- M2

## 4.5 Later-Domain Epics

### Epic L1: Leads Module

Scope:

- lead list/detail/history
- lead ingestion
- lead assignment
- birthday/reminder style CRM utilities

Decision:

- later

### Epic L2: Maintenance Module

Scope:

- issue lifecycle
- contractors/landlords
- tasks
- message center
- Fixflo integration

Decision:

- later

### Epic L3: SaaS Billing

Scope:

- Stripe integration
- subscription lifecycle
- billing UI and webhooks

Decision:

- later

## 5. Recommended Build Order

The implementation order should be:

1. `P1` Monorepo and runtime skeleton
2. `P2` Database and migration foundation
3. `P3` Identity and access
4. `P4` Tenancy and tenant resolution
5. `P6` Audit and outbox
6. `P7` Realtime platform
7. `P8` Job and integration infrastructure
8. `P5` Files and document storage
9. `P9` Tenant admin and settings foundation
10. `C1` Property and contact core
11. `C2` Case core
12. `C3` Workflow engine
13. `C4` Communications core
14. `C5` Integrations core
15. `SL1` Dezrez integration
16. `C6` Essential reporting core
17. `SL2` Sales case workspace
18. `SL3` Sales offers and progression actions
19. `SL4` Lettings case workspace
20. `SL5` Lettings applications, offers, and agreed reporting
21. `SL6` Workflow and template admin
22. `M1` Legacy data mapping and import
23. `M2` Reconciliation
24. `M3` Pilot rollout
25. `L1` Leads module
26. `L2` Maintenance module
27. `L3` SaaS billing

## 6. Suggested Milestones

### Milestone A: Platform Ready

Includes:

- P1 through P9

Definition of done:

- tenant-aware auth works
- OAuth works
- files work
- audit and outbox work
- realtime works
- workers and webhook ingestion work
- tenant admin/settings baseline exists

### Milestone B: Shared Core Ready

Includes:

- C1 through C5

Definition of done:

- properties, contacts, cases, workflow, communications, and integrations foundation work together

### Milestone C: Pilot Hardening and Migration Trust

Includes:

- enough of SL6, M1, M2, and M3 to support real side-by-side pilot usage

Definition of done:

- selected tenants can run the defined sales and lettings pilot workflows alongside legacy with reconciliation and operator discipline

### Milestone D: Lettings Operational Pilot

Includes:

- SL4, SL5, remaining essential C6 work

Definition of done:

- internal users can operate lettings workflows in the new system alongside legacy

### Milestone E: Parallel Run Confidence

Includes:

- SL6, M1, M2, M3

Definition of done:

- a real tenant can use the new platform in parallel with confidence and reconciliation discipline

## 7. Critical Dependencies and Risks

### Dependencies that can block many later epics

- tenant resolution
- memberships and permissions
- audit/outbox pattern
- realtime contract
- workflow engine design
- progression-engine target design and later implementation path, as defined in [PROGRESSION_ENGINE.md](/home/kieron/code/vitalspace-remake/docs/PROGRESSION_ENGINE.md)
- Dezrez integration quality

### Places where scope can easily blow up

- trying to do leads and maintenance too early
- overbuilding billing before core product stability
- reproducing legacy admin/debug tooling verbatim
- over-generalizing workflow automation before the first working path exists
- rebuilding every legacy dashboard at once

## 8. Team-Level Workstreams

If work is parallelized, the most sensible streams are:

- Platform: P1 to P9
- Core Domain: C1 to C4
- Integrations/Data: C5, SL1, M1, M2
- Product UI: SL2 to SL6

This only works once the schema and module boundaries are respected. Without that, the streams will constantly collide.

## 9. Definition of MVP

The MVP for first side-by-side rollout is:

- platform foundations complete
- shared core complete
- sales workflows usable
- lettings workflows usable
- essential reports available
- Dezrez integration operating
- imports and reconciliation working
- realtime working
- tenant admin/settings sufficient for operations

It is not:

- a fully rebuilt leads platform
- a fully rebuilt maintenance platform
- full SaaS billing
- every legacy admin screen
- every historical report

## 10. Recommendation

Implementation should begin with Milestone A and B work only. Do not start feature-heavy sales or lettings screens until the team has working tenancy, auth, audit, outbox, realtime, and case/workflow foundations. That discipline will make the later operational work faster, not slower.
