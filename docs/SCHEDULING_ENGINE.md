# Scheduling Engine Design

## 1. Purpose

This document defines the scheduling layer that sits underneath workflow progressions.

It exists because milestone delays, completion dates, and downstream ripple effects only make sense if milestone schedule state is first-class. The current remake now has:

- versioned workflow templates
- imported stages, edges, and actions from legacy workflow JSON
- multi-track workflow instances on cases
- first-pass milestone-scoped delay requests wired into runtime schedule recalculation

What it did not have was the engine that turns workflow definitions into reliable milestone dates. The first implementation slice of that engine is now in place, but deeper branch/action behavior still needs to be layered on.

That engine is the next required foundation before deeper progression UX work.

## 2. Problem Statement

The current remake still treats dates mostly at the case level:

- sales: `targetExchangeAt`, `targetCompletionAt`
- lettings: `agreedLetAt`, `moveInAt`

That is too coarse for the legacy behavior.

In the legacy app:

- delay requests are made against the current milestone
- milestone estimated dates can be changed or delayed
- downstream milestones move as a consequence
- the overall progression dates are projections from milestone state

So the scheduling engine must answer:

- what is the estimated date for each milestone right now?
- what changed it?
- what milestones depend on it?
- what should move when this milestone is completed, delayed, skipped, or reopened?

## 3. Design Goals

The scheduling engine should:

- treat milestone schedule state as first-class runtime data
- compute estimates from workflow template rules, not ad hoc controller logic
- support multiple workflow tracks per case
- support parallel milestones and dependency chains
- support manual override and approved delay as explicit records
- recalculate downstream milestone dates deterministically
- keep case-level dates as projections, not primary authored values
- be cheap to test without relying on wall-clock time

## 4. Legacy Scheduling Signals

The imported workflow JSON already contains the core scheduling inputs:

- `estDays`
- `estAfter`
- `estType`
- trigger-based starts through action rules
- parallel milestone groups

From the samples:

- sales milestones often chain off another milestone's `complete`
- lettings milestones often start in parallel after one upstream milestone completes
- some milestones have `estDays: 0`, which still matters because they anchor later milestones

These fields should become explicit canonical scheduling inputs in the template/runtime model.

## 5. Recommended Runtime Model

The current `workflow_instances` and `workflow_stages` tables are not enough on their own. We need per-instance, per-stage runtime state.

Recommended runtime records:

- `workflow_stage_runtime`
- `workflow_schedule_change`
- `workflow_delay_request`
- `workflow_schedule_projection`

### 5.1 workflow_stage_runtime

Each workflow instance should have one runtime row per stage.

Recommended fields:

- `workflow_instance_id`
- `workflow_stage_id`
- `tenant_id`
- `status`
- `is_current`
- `dependency_state`
- `estimated_start_at`
- `estimated_complete_at`
- `target_start_at`
- `target_complete_at`
- `actual_started_at`
- `actual_completed_at`
- `schedule_source`
- `last_recalculated_at`
- `manual_override_at`
- `manual_override_reason`
- `created_at`
- `updated_at`

Key point:

- `estimated_*` are engine outputs
- `target_*` are operator-facing commitments after override/delay
- `actual_*` are real execution timestamps

### 5.2 workflow_schedule_change

Every significant schedule mutation should be append-only.

Recommended fields:

- `workflow_instance_id`
- `workflow_stage_id`
- `change_type`
- `old_estimated_complete_at`
- `new_estimated_complete_at`
- `old_target_complete_at`
- `new_target_complete_at`
- `reason`
- `actor_user_id`
- `source`
- `created_at`

Typical `change_type` values:

- `initial_calculation`
- `recalculation`
- `delay_approved`
- `manual_override`
- `completion_ripple`
- `reopen_ripple`

### 5.3 workflow_delay_request

Delay requests should remain first-class, but they should be milestone-scoped rather than case-date-scoped.

That means the authoritative target should be:

- current workflow instance
- current workflow stage runtime
- requested new milestone target date

not:

- top-level sales or lettings case field

## 6. Scheduling Rules

The calculator should be deterministic and side-effect free.

Inputs:

- workflow template graph
- workflow instance
- workflow stage runtime state
- approved schedule overrides
- completion timestamps
- explicit branch selections
- calculation anchor time

Outputs:

- next schedule values for every impacted stage
- list of schedule change events to persist
- case-level projected dates

### 6.1 Anchor Rules

Every milestone estimate needs an anchor.

Supported anchors:

- workflow start
- upstream milestone start
- upstream milestone completion
- approved manual target date
- approved delay target date

This is the canonical form of the legacy `estAfter` + `estType` behavior.

### 6.2 Offset Rules

Each milestone may add:

- `estDays`
- later: business-day rules if needed

Initial implementation should be simplest viable:

- calendar-day offsets
- consistent UTC storage
- UI-local rendering only at presentation time

If business days matter later, add that as a calculation mode rather than assuming it now.

### 6.3 Parallel Rules

If one stage triggers multiple downstream stages:

- all newly unlocked stages should calculate independently from the same anchor event
- each should get its own runtime row and schedule

### 6.4 Branch Rules

Unchosen branches should not continue to recalculate as active work.

After branch selection:

- chosen path remains schedulable
- unchosen path becomes `skipped` or `inactive`

### 6.5 Completion Ripple

When a milestone completes:

- set `actual_completed_at`
- unlock dependent stages
- recompute downstream estimates using the actual completion as anchor where relevant

### 6.6 Delay Ripple

When a delay is approved for the current milestone:

- update that stage runtime target date
- record schedule change
- recompute dependent downstream target/estimated dates
- update case-level projected dates derived from those milestones

## 7. Case-Level Projection

Case dates should become projections from workflow stage runtime, not primary authored fields.

Examples:

- sales `targetExchangeAt`
  comes from the current projected date of the relevant exchange milestone
- sales `targetCompletionAt`
  comes from the current projected date of the completion milestone
- lettings `agreedLetAt`
  comes from the current projected date of the agreed-let milestone
- lettings `moveInAt`
  comes from the current projected date of the move-in milestone

This keeps the case summary useful without making the case table the source of truth for scheduling.

## 8. UI Implications

The correct UX target is:

- operator clicks the current milestone
- sees milestone detail, notes, actions, current estimate, current target, and delay history
- can request delay for that milestone
- on approval, the milestone changes immediately and downstream milestones update

So the scheduling engine should support:

- milestone detail popover/panel
- per-milestone schedule history
- track-aware progression views
- projected downstream dates visible in the workflow UI

## 9. Testing Strategy

We should not test this by waiting in real time.

### 9.1 Pure Calculation Tests

The schedule calculator should be a pure function:

- input: template graph + runtime snapshot + anchor time
- output: computed stage schedule state

That lets us write deterministic unit tests for:

- linear chains
- parallel milestones
- branch selection
- completion ripple
- delay ripple
- reopen ripple

These tests should use fixed timestamps like:

- `2026-03-28T09:00:00.000Z`

and compare exact output dates.

### 9.2 Scenario Fixture Tests

Use captured workflow fixtures based on:

- [workflow-sales.json](/home/kieron/code/vitalspace-remake/sources/data/workflow-sales.json)
- [workflow-lettings.json](/home/kieron/code/vitalspace-remake/sources/data/workflow-lettings.json)

Build trimmed scenario fixtures such as:

- sales simple chain
- sales parallel survey/mortgage path
- lettings holding-deposit to referencing path

Then assert:

- initial schedule
- schedule after one milestone completes
- schedule after one milestone delay is approved

### 9.3 API Integration Tests

API tests should verify:

- requesting a delay on current milestone creates a pending request
- approving it updates milestone runtime schedule
- case-level projected dates change
- schedule change history is recorded

These tests should still use fixed timestamps in request bodies and DB assertions.

### 9.4 Browser Tests

Playwright should only test operator flows, not calculation correctness in detail.

Good E2E assertions:

- user opens milestone
- requests a delay
- approves it
- visible milestone date updates
- visible downstream milestone date updates
- case header projection updates

The deeper date math should stay in unit and API tests.

### 9.5 Clock Strategy

When the engine needs “now”, inject it.

Use:

- explicit `calculatedAt` parameter in pure functions
- test helpers that freeze time
- no direct `new Date()` inside core calculation logic unless wrapped

That keeps tests deterministic and removes any need to wait for timers.

## 10. Delivery Approach

Recommended implementation order:

1. add `workflow_stage_runtime`
2. build pure schedule calculator
3. backfill runtime rows for existing workflow instances
4. project case-level dates from runtime
5. refactor delay requests to milestone scope
6. expose milestone detail UI
7. add schedule history and ripple visibility

## 11. Boundaries

Keep these concerns out of the first scheduling slice:

- advanced SLA/business-calendar support
- generic BPMN-like workflow language
- arbitrary expression engines
- external automation providers

The first slice should do one thing well:

- calculate milestone dates from the legacy workflow model reliably and testably

## 12. Immediate Next Slice

The next coding slice after this document should be:

1. schema for per-stage runtime schedule state
2. pure schedule calculator with fixtures
3. unit tests for ripple recalculation
4. API projection of milestone schedule into case detail

Only after that should delay requests be refactored from case-date level to milestone level.
