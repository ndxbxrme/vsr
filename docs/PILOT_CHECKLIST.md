# Pilot Checklist

## 1. Purpose

This checklist is for the first Milestone C side-by-side pilot.

It is intentionally narrow. The goal is to prove the new sales and lettings workflows under real tenant conditions without widening scope into non-blocking deferred features.

## 2. Tenant Selection Assumptions

Choose a pilot tenant that matches all of the following as closely as possible:

- already uses Dezrez in a stable, predictable way
- has active sales and lettings work, but not extreme volume
- has staff willing to report parity gaps quickly and clearly
- does not depend on leads, maintenance, or deferred CRM/admin screens for the pilot workflows
- can tolerate side-by-side operation while the new app is being hardened

Avoid using the first pilot tenant for:

- unusual data edge cases as the primary test bed
- broad historic migration demands
- workflows that depend heavily on deferred modules

## 3. Pre-Pilot Setup

Before pilot day, confirm:

- tenant, branch, memberships, and access roles are correct
- at least one sales workflow template exists
- at least one lettings workflow template exists
- email and SMS templates exist for the pilot flows
- at least one property is available for case linking
- the tenant passes the pilot-readiness snapshot in the new app
- the sales pipeline and agreed lets reports return expected baseline data
- local support runbook and escalation owner are agreed

## 4. Pilot Flows

The first pilot should cover only these two flows:

1. Sales case progression
   Open or create a sales case, add an offer, add notes/files, send a communication, progress workflow, and confirm report visibility.

2. Lettings agreed let flow
   Open or create a lettings case, add an application, progress workflow, and confirm agreed lets visibility.

Anything outside those flows is a separate decision, not automatic pilot scope.

## 5. Daily Pilot Checks

At the start of each pilot day:

- check pilot readiness snapshot
- check reconciliation counts for properties, cases, workflow, and reports
- confirm Dezrez sync status does not show stale or failed critical items
- confirm the selected users can sign in and load the workspace

At the end of each pilot day:

- record any parity gaps found
- classify each gap as blocking, non-blocking, or deferred
- add regression tests for any code changes made that day
- note whether a workaround was required in the legacy app

## 6. Parity Gap Rules

Classify issues as:

- `Blocking`: stops the defined pilot workflow from completing safely or accurately
- `Non-blocking`: annoying or incomplete, but the workflow can still be completed reliably
- `Deferred`: outside Milestone B/C scope or better handled later

Rules:

- every blocking fix needs regression coverage
- do not pull deferred CRM/admin/reporting work forward unless it becomes truly blocking
- prefer the smallest viable fix that restores trust in the pilot workflow

## 7. Success Signal

The pilot day is successful when:

- both in-scope workflows can be completed in the new app
- reconciliation and report outputs remain trustworthy
- any issues found are understandable and classifiable
- staff do not need direct database intervention to continue

## 8. Escalation

Stop and escalate when:

- workflow results disagree with reports and the mismatch is unexplained
- property or case data is stale with no clear recovery path
- users need repeated fallback to the legacy UI for an in-scope step
- a fix would require dragging a deferred module into current scope
