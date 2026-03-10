# Milestone A Plan

## 1. Purpose

This document breaks Milestone A into implementation-ready work. It covers:

- repository and package layout
- first technical epics
- testing strategy
- initial migrations
- early Dezrez validation slice
- recommended sequencing

Milestone A is the platform foundation milestone. It should make later product work faster and safer.

## 2. Milestone A Goal

At the end of Milestone A, the new platform should support:

- tenant-aware backend and frontend boot
- local auth and OAuth/OIDC auth
- memberships, roles, and permissions
- tenant and branch administration
- file upload/download foundations
- audit logging
- outbox event creation
- realtime event broadcasting
- worker and queue foundations
- webhook ingestion foundations
- a thin Dezrez-backed property slice proving that property-dependent workflows can be built on the platform

## 3. Milestone A Non-Goals

- full sales workspace
- full lettings workspace
- complete Dezrez integration breadth
- migration of all legacy data
- leads or maintenance rebuild
- billing implementation

## 4. Exit Criteria

Milestone A is done when all of the following are true:

- a user can sign in with local auth and at least one OAuth/OIDC provider
- tenant resolution works via local dev host strategy and production-ready domain model
- memberships and roles gate API routes and UI areas
- file upload and secure file retrieval work
- every important mutation path writes audit and outbox records
- Socket.IO clients can authenticate and receive tenant-scoped change events
- workers can consume queued jobs and webhook events
- webhook intake persists raw events and classifies them into durable integration jobs
- a tenant can store Dezrez credentials, trigger a sync, and view synchronized properties through the new API/UI
- unit, API integration, and Playwright e2e tests run in CI

## 5. Recommended Monorepo Shape

Use `pnpm` workspaces.

Suggested top-level layout:

- `apps/api`
- `apps/web`
- `apps/worker`
- `packages/db`
- `packages/config`
- `packages/contracts`
- `packages/auth`
- `packages/integrations`
- `packages/realtime`
- `packages/ui`
- `packages/test-helpers`
- `packages/eslint-config`
- `packages/typescript-config`

### App Responsibilities

`apps/api`

- REST API
- auth callbacks
- upload endpoints
- webhook intake
- Socket.IO server bootstrap

`apps/web`

- Vue app
- auth flows
- tenant bootstrapping
- settings/admin foundation
- property validation slice

`apps/worker`

- SQS consumers
- notification jobs
- outbox publisher
- webhook processors
- Dezrez sync jobs

### Package Responsibilities

`packages/db`

- Drizzle schema
- migrations
- database client
- seed helpers

`packages/contracts`

- shared Zod schemas
- event envelope types
- API DTOs

`packages/auth`

- auth helpers
- token/session utilities
- OAuth/OIDC provider adapters

`packages/integrations`

- provider adapters
- webhook classifiers
- integration job processors
- payload normalizers

`packages/realtime`

- Socket.IO event definitions
- channel naming helpers
- outbox-to-socket publishing helpers

`packages/test-helpers`

- shared test factories
- database reset helpers
- tenant/user bootstrap utilities

## 6. Testing Strategy

Testing is a Milestone A requirement, not a later hardening task.

### Unit Testing

Use `Vitest`.

Cover:

- auth logic
- tenant resolution
- permission evaluation
- outbox writer
- realtime event mapper
- integration mapping logic
- Dezrez payload translators

### API Integration Testing

Use `Vitest` plus `Supertest`.

Cover:

- auth endpoints
- OAuth callback handling with mocked providers
- tenant-aware route protection
- file upload metadata flow
- webhook intake
- outbox creation on mutations
- property sync endpoints

These tests should run against a real test Postgres instance.

### End-to-End Testing

Use `Playwright`.

Initial e2e flows:

1. local auth login and logout
2. OAuth login happy path with test/mocked provider
3. tenant admin creates branch and invites user
4. invited user accepts invite and can sign in
5. tenant admin configures Dezrez credentials
6. manual property sync runs and property list becomes visible
7. realtime property change event reaches the browser and updates UI state

### Test Infrastructure Rules

- CI must run unit, API integration, and Playwright suites.
- Playwright should run against disposable local services, not shared environments.
- Test data should be created by factories and seed helpers, not ad hoc SQL in each test.
- Every bug fix in platform code should add or update a test at the lowest sensible layer.

## 7. Initial Technical Decisions

### Tooling

- package manager: `pnpm`
- unit and integration tests: `Vitest`
- API integration tests: `Supertest`
- e2e tests: `Playwright`
- linting: `ESLint`
- formatting: `Prettier`

### Local Infrastructure

Use Docker Compose for local dependencies:

- Postgres
- local SQS emulator or AWS-compatible queue emulator if useful
- local file storage emulator only if it adds value; otherwise use local filesystem in dev and S3 abstraction in code

### CI

The first CI pipeline should run:

- install
- lint
- typecheck
- unit tests
- API integration tests
- Playwright e2e tests

## 8. Milestone A Workstreams

## 8.1 Foundation Workstream

Tasks:

- create monorepo
- configure TypeScript, linting, formatting
- add workspace scripts
- add Docker Compose for local dependencies
- add baseline CI

Maps to:

- P1

## 8.2 Database Workstream

Tasks:

- set up Drizzle
- create migration runner
- create first migrations for:
  - `users`
  - `credentials`
  - `oauth_accounts`
  - `sessions`
  - `tenants`
  - `brands`
  - `branches`
  - `tenant_domains`
  - `roles`
  - `permissions`
  - `role_permissions`
  - `memberships`
  - `membership_roles`
  - `feature_flags`
  - `file_objects`
  - `file_attachments`
  - `audit_logs`
  - `outbox_events`
  - `integration_accounts`
  - `webhook_events`
  - `integration_jobs`
  - `properties`
  - `external_references`

Maps to:

- P2
- partial C1

## 8.3 Identity and Access Workstream

Tasks:

- local auth endpoints
- session and refresh model
- OAuth/OIDC provider abstraction
- initial provider implementation
- invite acceptance flow
- password reset flow
- membership and role resolution middleware

Maps to:

- P3

## 8.4 Tenancy Workstream

Tasks:

- tenant creation flow
- branch creation flow
- domain model and tenant resolution middleware
- tenant bootstrap API
- frontend tenant boot contract

Maps to:

- P4

## 8.5 Files Workstream

Tasks:

- upload endpoint
- file metadata persistence
- attachment linking primitives
- secure file retrieval

Maps to:

- P5

## 8.6 Audit, Outbox, and Realtime Workstream

Tasks:

- audit write helpers
- outbox write helpers
- standardized mutation service pattern
- Socket.IO server and auth handshake
- tenant channel strategy
- event envelope contract
- frontend realtime client and query invalidation helpers

Maps to:

- P6
- P7

## 8.7 Worker and Webhook Workstream

Tasks:

- worker app bootstrap
- SQS queue abstraction
- outbox publisher worker
- webhook intake endpoint and persistence
- provider-agnostic integration job model
- provider-specific webhook classification
- retry/dead-letter conventions

Maps to:

- P8

## 8.8 Settings/Admin Workstream

Tasks:

- user list and role assignment UI
- tenant settings shell
- branch management UI
- theme/brand settings basics

Maps to:

- P9

## 8.9 Early Dezrez Validation Slice

This is an intentional early pull-forward.

It is not the full `SL1` epic. It is a thin vertical slice to de-risk the platform and unlock property-based development early.

Tasks:

- create `integration_accounts` flow for Dezrez credentials
- build a minimal Dezrez client adapter
- create one manual sync endpoint or admin action
- implement `/event` Dezrez webhook intake against the generic webhook pipeline
- classify incoming Dezrez webhooks into durable refresh jobs
- fetch and persist a property list into `properties` plus `external_references`
- expose a minimal property list API
- build a simple property list screen in the admin/app shell
- emit property sync change events via outbox and realtime
- cover this slice with unit, integration, and Playwright tests

Success criteria:

- a tenant admin can configure Dezrez
- a sync can be triggered safely
- properties appear in the UI
- realtime events flow correctly when property data changes

Maps to:

- P8
- partial C1
- thin pre-SL1 validation slice

## 9. Recommended Sequence

The first execution order inside Milestone A should be:

1. foundation repo setup
2. CI and test harness setup
3. database and migration foundation
4. local auth and session flow
5. tenant and branch model
6. memberships and roles
7. audit and outbox
8. realtime foundation
9. worker and queue foundation
10. file storage foundation
11. admin/settings shell
12. early Dezrez validation slice
13. OAuth/OIDC provider flow
14. full Playwright hardening for Milestone A flows

This order is deliberate:

- tests come in at the start
- property data arrives early enough to support later product work
- OAuth is not blocked, but local auth lands first so the platform becomes usable faster

## 10. First Backlog Cut

The first implementation backlog should roughly be:

### Batch 1

- initialize monorepo
- configure `pnpm`
- set up `apps/api`, `apps/web`, `apps/worker`
- add `packages/db`, `packages/contracts`, `packages/test-helpers`
- add lint, typecheck, Vitest, Playwright
- add CI pipeline

### Batch 2

- bring up Postgres locally
- implement migration runner
- add first schema migrations
- add database test helpers

### Batch 3

- implement local auth and sessions
- implement tenant and branch basics
- implement memberships and roles
- implement protected API middleware

### Batch 4

- implement audit/outbox pattern
- implement Socket.IO auth and tenant channels
- implement worker bootstrap and queue publishing

### Batch 5

- implement file metadata and upload path
- implement admin/settings shell
- implement Dezrez credential storage

### Batch 6

- implement manual Dezrez sync
- persist properties and external references
- build simple property list UI
- add realtime property refresh behavior
- complete Playwright flows

## 11. Risks Specific to Milestone A

- delaying tests will create fragile foundations very quickly
- overbuilding OAuth before local auth works will slow everything down
- trying to deliver full Dezrez breadth in Milestone A will bloat the milestone
- skipping outbox discipline will weaken realtime and worker design later
- postponing tenant-aware design in early APIs will create expensive rewrites

## 12. Recommendation

Start implementation with the monorepo, tests, schema foundations, and local auth. Then push straight into tenant context, outbox/realtime, and the thin Dezrez property slice. That combination gives the team a working platform skeleton plus real property data, which is the most useful place to start building the rest of the product.
