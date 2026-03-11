# Milestone B Plan

## 1. Purpose

This document turns the next delivery phase into implementation-ready work.

Milestone B follows the completed platform foundation work in Milestone A. Its job is to turn the platform into a real operational product by building the shared business core plus the first usable sales and lettings workspaces.

This is the milestone where the remake stops being a platform demo and starts becoming a system staff can actually use alongside the legacy app.

## 2. Milestone B Goal

At the end of Milestone B, the new platform should support:

- a shared case and workflow engine used by both sales and lettings
- canonical contact and party management linked to properties and cases
- sales dashboard, case list, case detail, offer workflow, notes, files, and progression actions
- lettings dashboard, case list, case detail, application or offer workflow, notes, files, and progression actions
- shared timeline, audit, realtime, and document handling inside day-to-day operational workflows
- core communication templates and case-triggered communication actions
- essential operational reporting needed for side-by-side usage
- side-by-side pilot usage by selected staff without relying on the legacy UI for the main sales and lettings workflows in scope

## 3. Milestone B Position

Milestone B spans the practical overlap between:

- Phase 2: Shared Core
- Phase 3: Sales and Lettings MVP

Milestone A proved the platform. Milestone B must prove the product.

## 4. Milestone B Non-Goals

- full leads rebuild
- full maintenance rebuild
- advanced CRM or marketing tooling
- complete legacy reporting parity
- full migration of all historic records
- true production SQS transport rollout
- billing implementation
- client portal or public portal work
- hard cutover from legacy

## 5. Exit Criteria

Milestone B is done when all of the following are true:

- sales and lettings share one explicit case model with product-specific workflow configuration layered on top
- canonical contacts, case parties, and related property links exist and are usable from the UI and API
- users can create, view, update, and progress sales cases in the new system
- users can create, view, update, and progress lettings cases in the new system
- offers and lettings applications are stored in first-class internal records and shown in the relevant case workflows
- notes, timeline entries, documents, and uploaded files are visible inside operational case detail screens
- milestone and progression actions can trigger audited state changes and tenant-scoped realtime updates
- essential communication templates exist and operational users can trigger the required email or SMS actions for in-scope workflows
- the new UI provides dashboard, list, and detail flows for both sales and lettings that are good enough for pilot users
- essential operational reports needed for day-to-day checking are available
- unit, API integration, and Playwright coverage exist for the main sales and lettings flows in scope
- at least one side-by-side pilot path can be run in the new app end to end without returning to the legacy UI for the covered flow

## 6. Scope Shape

Milestone B should be delivered as a small number of coherent vertical slices, not as a giant domain dump.

The slices should be:

1. shared case core
2. sales operational slice
3. lettings operational slice
4. communications and reporting slice
5. pilot-readiness and parity validation slice

## 7. Core Capability Set

### Shared Core

- canonical contacts
- case parties and roles
- case notes
- case documents and attachments
- workflow templates
- workflow instances and stage transitions
- unified timeline and audit visibility

### Sales

- dashboard
- case list
- case detail
- offer records
- progression milestones
- workflow actions

### Lettings

- dashboard
- case list
- case detail
- application or offer records
- progression milestones
- agreed lets flow and reporting

### Communications

- tenant-scoped email templates
- tenant-scoped SMS templates
- audited send actions for in-scope workflows
- milestone-linked communication hooks where required for parity

### Reporting

- sales pipeline essentials
- agreed lets report
- operational list or queue style reporting needed for pilot users

## 8. Workstreams

## 8.1 Shared Core Domain Workstream

Tasks:

- finalize canonical contact and party model
- add case and case-extension tables needed for sales and lettings
- add note, document, and case attachment primitives where still missing
- implement shared case services and validation
- define workflow template and workflow instance services

Maps to:

- C1
- C2

## 8.2 Sales Workstream

Tasks:

- define sales case subtype or extension model
- implement sales case creation and update flows
- implement sales offer lifecycle
- implement sales dashboard read models
- implement progression actions and milestone transitions

Maps to:

- SL1
- R1

## 8.3 Lettings Workstream

Tasks:

- define lettings case subtype or extension model
- implement lettings case creation and update flows
- implement lettings application or offer lifecycle
- implement lettings dashboard read models
- implement agreed lets operational reporting
- implement progression actions and milestone transitions

Maps to:

- SL2
- R2

## 8.4 Communications Workstream

Tasks:

- implement template CRUD for email and SMS
- add case-aware send actions
- add timeline and audit recording for sends
- connect milestone actions to communication dispatch where required

Maps to:

- C3

## 8.5 Frontend Workspace Workstream

Tasks:

- build shared workspace shell patterns for dashboard, list, and detail screens
- build sales case list and detail screens
- build lettings case list and detail screens
- add forms and command surfaces for offers, notes, files, and workflow actions
- preserve realtime invalidation or patch behavior inside the case workspaces

Maps to:

- UX1
- UX2

## 8.6 Reporting Workstream

Tasks:

- define the minimum operational reports required by pilot users
- implement sales pipeline essentials
- implement agreed lets report
- implement export or print primitives only where operationally necessary

Maps to:

- R1
- R2

## 8.7 Pilot and Parity Validation Workstream

Tasks:

- choose the first side-by-side pilot workflows
- map pilot workflows to the parity matrix
- add reconciliation or spot-check tooling where needed
- capture parity gaps found during pilot use
- close only the gaps that block real operational confidence

Maps to:

- V1

## 9. Testing Strategy

Milestone B should deepen the same three test layers used in Milestone A.

### Unit Tests

Cover:

- workflow transition rules
- sales and lettings case service rules
- offer and application lifecycle rules
- contact and party linking rules
- communication trigger rules
- dashboard and report query builders

### API Integration Tests

Cover:

- case CRUD and permission enforcement
- sales offer flows
- lettings application or offer flows
- workflow stage transitions
- file attachment flows inside cases
- communication send actions
- reporting endpoints

### End-to-End Tests

Use Playwright for real user flows.

Required flows:

1. tenant admin or operational user opens sales dashboard, creates or opens a case, advances progression, adds a note, uploads a file, and sees realtime updates
2. operational user opens lettings dashboard, works an application or offer flow, advances progression, and sees the case update correctly
3. operational user triggers an in-scope communication action and sees the timeline update
4. operational user runs the required operational report and confirms the expected case appears

Testing rules:

- every new case workflow action must have unit coverage and at least API integration coverage
- every user-visible pilot workflow must have Playwright coverage
- new parity bugs found during side-by-side testing must add a regression test before closeout

## 10. Data and Migration Rules

Milestone B should not begin with a full migration project.

Instead:

- use the Dezrez-backed property foundation from Milestone A as the starting point
- create new cases and operational data directly in the new system
- add imports or one-off migration helpers only when they unblock pilot use
- keep external IDs and legacy references where they help side-by-side checking
- avoid importing low-value historic noise before current operational flows are trusted

## 11. Recommended Sequence

The first execution order inside Milestone B should be:

1. finalize contact, party, and case schema
2. implement shared case services and workflow primitives
3. build sales list and detail read or write flows
4. build lettings list and detail read or write flows
5. add notes, files, and timeline usage inside case detail
6. add offers and applications
7. add communications and templates
8. add essential dashboards and reports
9. harden pilot workflows with Playwright and parity checks

This order is deliberate:

- shared core lands before product-specific drift starts
- sales and lettings stay aligned because they are built on the same case engine
- operator-facing flows arrive before lower-value enrichment work

## 12. First Backlog Cut

### Batch 1

- extend schema for contacts, case parties, case records, and workflow records
- add shared DTOs and validators
- add factories and test helpers for cases and contacts

### Batch 2

- implement shared case services
- implement notes, timeline, and document linkage
- expose basic case list and case detail APIs

### Batch 3

- implement sales case flows
- implement sales offer flows
- add sales dashboard read model
- add API integration tests for sales workflows

### Batch 4

- implement lettings case flows
- implement lettings application or offer flows
- add agreed lets read model
- add API integration tests for lettings workflows

### Batch 5

- implement communications templates and send actions
- wire workflow-triggered communication hooks
- implement essential operational reports

### Batch 6

- build frontend sales and lettings workspaces
- add file upload and attachment usage inside cases
- add Playwright coverage for end-to-end operational flows

### Batch 7

- run first pilot parity sweep
- close blocking gaps only
- prepare Milestone C handoff for integration hardening and migration work

## 13. Risks Specific to Milestone B

- building sales and lettings separately instead of through shared case primitives will recreate legacy duplication
- pulling leads or maintenance forward will dilute focus and slow pilot readiness
- overbuilding generic workflow abstractions will hide business rules and make debugging harder
- trying to migrate too much historic data too early will obscure whether current workflows actually work
- postponing Playwright coverage until the end will make side-by-side validation slow and brittle

## 14. Recommendation

Treat Milestone B as the first real product milestone, not another platform milestone.

The right delivery target is a narrow but trustworthy operational slice: staff can work core sales and lettings cases in the new app, see the right property and case context, move workflows forward, send the required communications, and trust the resulting timeline, files, and reports. Everything outside that should need a strong reason to enter scope.
