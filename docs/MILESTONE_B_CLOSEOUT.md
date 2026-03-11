# Milestone B Closeout

## 1. Outcome

Milestone B is complete.

The remake now supports the first usable sales and lettings product slice on top of the shared platform delivered in Milestone A.

The delivered scope includes:

- shared case, workflow, contact, party, note, file, audit, and timeline primitives
- sales dashboard, list, detail, offer flow, communication actions, and reporting
- lettings dashboard, list, detail, application flow, communication actions, and agreed lets reporting
- shared workspace UI for sales and lettings
- realtime invalidation across the operational workspace flows
- Playwright coverage for the two pilot-ready operational flows
- a tenant-scoped pilot readiness snapshot for side-by-side rollout checks

## 2. Pilot Flows

The first side-by-side pilot should use these two flows:

1. Sales case progression
   Create or open a sales case, add an offer, add notes/files, send a communication, progress the workflow, and confirm the case remains visible in the sales pipeline report.

2. Lettings agreed let flow
   Create or open a lettings case, add an application, progress the workflow, and confirm the case appears in the agreed lets report.

These flows map directly to the `MVP` items in [LEGACY_PARITY_MATRIX.md](/home/kieron/code/vitalspace-remake/docs/LEGACY_PARITY_MATRIX.md) for sales, lettings, communications, files, reporting, and realtime behavior.

## 3. Parity Sweep

The first parity sweep result is:

- `Pass`: shared shell, auth, OAuth, tenancy, domains, and permissions
- `Pass`: explicit realtime updates with tenant-scoped invalidation
- `Pass`: Dezrez-backed property foundation for sales and lettings workflows
- `Pass`: sales and lettings dashboards, list/detail workspaces, progression, and core reports
- `Pass`: email and SMS templates plus case-aware communication sends
- `Pass`: files, notes, timeline, and audit visibility inside case workflows
- `Deferred by plan`: client management, solicitors, birthdays, wider CRM screens, targets, and broader reporting

No blocking parity gaps remain inside the Milestone B scope as defined in the milestone plan.

## 4. Known Non-Blockers

The following remain intentionally outside Milestone B:

- wider CRM and birthday screens
- solicitor or client-management rebuild
- broader reporting and targets
- migration helpers beyond what is needed to support pilot usage
- deeper provider/integration hardening beyond the current Dezrez-backed foundation

These should move to Milestone C only where they directly improve pilot confidence or rollout readiness.

## 5. Evidence

Milestone B has:

- API integration coverage for shared core, sales, lettings, communications, reporting, and pilot readiness
- Playwright coverage for:
  - sales workspace flow
  - lettings workspace flow
  - communication actions
  - reporting visibility
  - realtime invalidation

## 6. Milestone C Handoff

Milestone C should focus on hardening rather than widening scope.

Recommended priorities:

1. pilot execution with selected staff and real tenant data
2. parity-gap capture and regression tests for any issues found
3. deeper integration hardening and operational tooling
4. migration/import helpers only where they unblock rollout
5. selective expansion into deferred features with proven operational value
