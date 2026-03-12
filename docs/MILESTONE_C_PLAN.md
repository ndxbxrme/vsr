# Milestone C Plan

## 1. Purpose

This document turns the post-Milestone B handoff into implementation-ready work.

Milestone C should not widen the product. Its job is to make the rebuilt platform trustworthy under real pilot conditions:

- side-by-side pilot execution
- parity-gap capture and closure
- integration hardening
- migration and import helpers where they unblock rollout
- reconciliation and operator discipline

Milestone B proved the product slice. Milestone C must prove that selected tenants can rely on it.

Progression-engine redesign should remain planned but deferred during this milestone. Milestone C should use pilot evidence to sharpen that later implementation rather than trying to rebuild the workflow core mid-pilot. See [PROGRESSION_ENGINE.md](/home/kieron/code/vitalspace-remake/docs/PROGRESSION_ENGINE.md).

## 2. Milestone C Goal

At the end of Milestone C, the new platform should support:

- a real side-by-side pilot for selected sales and lettings users
- repeatable parity checking against the legacy system for the in-scope workflows
- deeper Dezrez trust through reconciliation, replay, and operational visibility
- import or bootstrap helpers only where they remove pilot friction
- operator tooling for investigating stale syncs, mismatched counts, and workflow discrepancies
- regression coverage for every blocking pilot issue found during rollout

## 3. Milestone C Position

Milestone C follows the completed shared-core and workspace delivery in Milestone B.

It spans the practical overlap between:

- Phase 4: Integration Hardening and Migration
- the first real pilot/parallel-run work needed before broader tenant rollout

Milestone C is the confidence milestone.

## 4. Milestone C Non-Goals

- leads rebuild
- maintenance rebuild
- broad CRM expansion
- birthdays or wider deferred reporting work unless pilot-critical
- broad historic backfill of all legacy data
- full tenant migration at scale
- billing or SaaS commercial packaging
- a hard cutover away from legacy

## 5. Exit Criteria

Milestone C is done when all of the following are true:

- at least one selected tenant can run the defined sales and lettings pilot workflows side by side with the legacy app
- every blocking parity issue found during pilot use is either fixed with regression coverage or explicitly accepted and deferred
- property and workflow reconciliation checks exist for pilot tenants and are good enough to spot stale or mismatched operational data
- Dezrez sync behavior is operationally inspectable through clear status, replay, retry, and reconciliation surfaces
- pilot users can bootstrap the minimum needed data without manual database intervention
- migration/import helpers exist where they materially reduce pilot friction
- operational staff have enough guidance and tooling to investigate the common “why is this case or property missing/stale?” questions
- unit, API integration, and Playwright coverage exist for pilot-critical regressions and the main side-by-side workflows
- Milestone D can focus on rollout expansion rather than rediscovering basic pilot discipline

## 6. Scope Shape

Milestone C should be delivered as five narrow slices:

1. pilot execution and gap capture
2. reconciliation and trust tooling
3. Dezrez and sync hardening
4. import/bootstrap helpers
5. pilot operations and release discipline

## 7. Core Capability Set

### Pilot Execution

- selected tenant pilot checklist
- explicit pilot workflows and owners
- parity issue logging with severity and decision
- regression-test rule for every blocking pilot bug

### Reconciliation

- property count and freshness checks
- case/workflow count checks
- report-spot-check tooling for sales pipeline and agreed lets
- external-id and legacy-reference visibility where useful

### Integration Hardening

- better error classification for sync and webhook failures
- stale-sync detection and operator surfacing
- repeatable webhook replay and manual reconciliation paths
- clearer audit trail from upstream change to local write
- full-sync trust rules: sync-run history, inventory snapshots, anomaly detection, and conservative stale/delisted transitions rather than one-run delisting

### Import and Bootstrap

- minimal import helpers for pilot tenants
- seed/bootstrap utilities for workflow templates, communication templates, and starter records
- legacy reference capture where it helps side-by-side checking

### Pilot Operations

- runbook-style docs for pilot setup, checks, and rollback posture
- readiness and trust dashboards focused on operators rather than developers
- release discipline for pilot fixes

## 8. Workstreams

## 8.1 Pilot Validation Workstream

Tasks:

- choose the first real pilot tenant or tenants
- define the exact daily pilot workflows
- capture parity issues during side-by-side usage
- classify issues as blocking, non-blocking, or deferred
- add regression coverage for blocking fixes

Maps to:

- V1

## 8.2 Reconciliation Workstream

Tasks:

- add tenant-scoped reconciliation endpoints or views
- compare property counts and recent sync freshness
- compare case counts and workflow-stage distributions
- add report spot checks for sales pipeline and agreed lets

Maps to:

- M1

## 8.3 Integration Hardening Workstream

Tasks:

- deepen Dezrez sync observability
- improve stale-sync and partial-sync diagnosis
- harden manual retry and replay workflows
- add targeted reconciliation jobs for active pilot records

Maps to:

- M2

## 8.4 Import and Bootstrap Workstream

Tasks:

- add small import/bootstrap helpers for pilot tenants
- preserve legacy IDs or references where they help operators verify records
- avoid one-off SQL unless it is wrapped in repeatable helpers

Maps to:

- M3

## 8.5 Pilot Operations Workstream

Tasks:

- document pilot setup and support flow
- define release discipline for pilot fixes
- prepare the Milestone D rollout handoff

Maps to:

- V1

## 9. Testing Strategy

Milestone C should keep the same three test layers, but bias them toward trust and regression rather than greenfield capability.

### Unit Tests

Cover:

- reconciliation calculators
- sync freshness classification
- import/bootstrap validation rules
- parity decision helpers where logic exists in code

### API Integration Tests

Cover:

- reconciliation endpoints
- import/bootstrap helpers
- pilot-readiness and trust views
- retry/replay/reconciliation job paths
- every pilot-blocking bug fix

### End-to-End Tests

Use Playwright for pilot-critical flows.

Required flows:

1. sales pilot flow with side-by-side-safe actions and report verification
2. lettings pilot flow with agreed lets verification
3. operator checks pilot readiness/trust surfaces and can identify a missing or stale record situation

Testing rules:

- every blocking pilot bug gets a regression test before closeout
- do not add browser coverage for low-value deferred features
- when a bug is isolated to service logic or reconciliation logic, prefer unit/API coverage over browser-only fixes

## 10. Data and Migration Rules

Milestone C still should not become a full migration project.

Rules:

- only build imports that unblock pilot usage or parity checking
- preserve source IDs and legacy references for traceability
- prefer repeatable import/bootstrap commands over ad hoc scripts
- add reconciliation outputs before importing more data
- do not chase low-value history until current operational records are trusted

## 11. Recommended Sequence

The execution order inside Milestone C should be:

1. define pilot tenant and workflows
2. build reconciliation and trust surfaces
3. harden Dezrez sync and operator diagnosis
4. add import/bootstrap helpers only where pilot friction remains
5. run the pilot, close blocking gaps, and capture Milestone D handoff

This order is deliberate:

- pilot work should be driven by real operational friction, not speculation
- reconciliation needs to exist before broader import work
- integration hardening should be guided by actual stale/mismatch cases seen during pilot

## 12. First Backlog Cut

### Batch 1

- define pilot checklist and tenant-selection assumptions
- add reconciliation API surface for properties, cases, workflow, and reports
- add API integration tests for reconciliation outputs

### Batch 2

- add pilot operations view or operator console improvements
- surface stale-sync and mismatch indicators
- add Playwright coverage for pilot trust checks

### Batch 3

- harden Dezrez sync diagnosis and targeted manual reconciliation
- add sync-run and stale-property guardrails so bad upstream feeds cannot mass-delist stock
- add regression coverage for any discovered sync/pathology bugs

### Batch 4

- add minimal import/bootstrap helpers for pilot tenants
- preserve legacy references needed for side-by-side checks

### Batch 5

- run the first real pilot sweep
- close blocking gaps only
- produce Milestone C closeout and Milestone D handoff

## 13. Risks Specific to Milestone C

- turning pilot hardening into a hidden full migration project
- widening scope into deferred CRM/admin work because pilot users ask for “nice to haves”
- mistaking missing trust tooling for missing product capability
- fixing parity bugs without adding regression coverage
- using manual database intervention instead of building repeatable bootstrap/reconciliation paths

## 14. Recommendation

Treat Milestone C as an operational confidence milestone.

The right target is not “more features.” The right target is: a selected tenant can use the new sales and lettings workflows in parallel, operators can explain stale or mismatched states, and the team can close pilot blockers quickly without losing control of scope.
