# Progression Engine Design

## 1. Purpose

This document defines the target progression engine for sales and lettings.

It exists because progressions are not a minor case detail. They are one of the core products in the legacy app:

- they drive day-to-day operational work
- they allow milestone branching and alternative paths
- they support date-delay requests and manual intervention
- they trigger emails, SMS messages, and other downstream actions
- they feed dashboards and management reporting

The current remake already has a usable shared case/workflow slice. That slice should be treated as an interim operational foundation, not the final progression architecture.

## 2. Design Goals

The new progression engine should:

- support configurable sales and lettings workflows from one shared model
- support multiple progression tracks on one case when needed
- model branching paths explicitly rather than as ad hoc milestone array behavior
- support due dates, delay requests, and approved overrides as first-class records
- drive automations through explicit rules and events
- provide cheap dashboard reads through projections, not deep live traversal
- remain tenant-configurable without turning into unbounded workflow sprawl

## 3. Current Legacy Problems

From the legacy code and UI, the main issues appear to be:

- progression state is stored in mutable property-level structures and duplicated computed fields
- dashboard logic scans progression arrays and milestone indexes repeatedly
- hidden business behavior is mixed into controllers and milestone handlers
- branching and milestone overrides exist, but they are not modeled cleanly
- communication triggers are tied to clunky progression mutations

This makes the operational UI usable, but it makes reporting slow and the workflow rules hard to reason about.

## 4. Recommended Model

The target model should separate:

- workflow definition
- workflow runtime state
- workflow event history
- automation rules
- dashboard projections

### 4.1 Workflow Definition

Use tenant-scoped templates that define a graph, not just a flat ordered list.

Core definition concepts:

- `workflow_template`
- `workflow_node`
- `workflow_edge`
- `workflow_action_rule`

`workflow_node` should represent a milestone, task gate, or decision point.

`workflow_edge` should represent an allowed transition:

- normal linear next step
- branch choice
- conditional path
- terminal path

### 4.2 Workflow Runtime

Each case should be able to host one or more workflow instances.

Core runtime concepts:

- `workflow_instance`
- `workflow_node_state`
- `workflow_schedule_override`
- `workflow_assignment`

This allows:

- landlord side and tenant side progression tracks
- separate sales and post-offer subflows if needed
- future split tracks without changing the core design

### 4.3 Workflow History

Every meaningful change should become an append-only event.

Core history concepts:

- `workflow_event`
- `workflow_delay_request`
- `workflow_transition_decision`

These events should cover:

- node started
- node completed
- node skipped
- node blocked
- node reopened
- branch selected
- delay requested
- delay approved or rejected
- automation fired

## 5. State Model

Each node should have a clear runtime state, for example:

- `not_started`
- `active`
- `completed`
- `skipped`
- `blocked`
- `cancelled`

Each node should also carry scheduling fields:

- `target_start_at`
- `target_complete_at`
- `actual_started_at`
- `actual_completed_at`
- `delay_reason`
- `delay_requested_at`
- `delay_approved_at`

The important rule is that schedule changes should not overwrite history silently. Approved date changes should be represented as explicit override records plus workflow events.

## 6. Branching and Delay Handling

The screenshot in [lettings-progression.png](/home/kieron/code/vitalspace-remake/docs/lettings-progression.png) shows that the engine needs more than a linear checklist.

### 6.1 Branching

Branching should be explicit in the workflow template:

- node A can flow to B or C
- branch selection can be manual or rule-based
- the chosen path should be recorded as an event
- unchosen branches should be marked inactive or skipped explicitly

### 6.2 Delay Requests

Delay handling should not mutate milestone dates in place without explanation.

Use:

- `workflow_delay_request`
- approval metadata
- reason text
- old target date
- new target date
- actor and timestamp

That gives auditability and makes dashboard calculations straightforward.

## 7. Automation Model

Automations should hang off workflow transitions, not off hidden controller logic.

Example trigger points:

- on node activation
- on node completion
- on branch selection
- on delay approval
- on workflow completion

Example actions:

- send email template
- send SMS template
- create internal task
- post timeline note
- set case flag
- enqueue integration job
- refresh dashboard projection

These should be represented as explicit `workflow_action_rule` records or strongly-typed config stored against templates, then executed via outbox and worker jobs.

## 8. Dashboard Strategy

The dashboard problem should be solved with read models, not smarter live loops.

The write side should record workflow state and events. The read side should project that into operational aggregates such as:

- current stage counts
- due today / overdue milestones
- days in stage
- agreed lets / completions / exchanges
- consultant or branch workload
- conversion and aging metrics

Recommended read models:

- `workflow_instance_snapshot`
- `case_progression_snapshot`
- `dashboard_metric_snapshot`

These can be updated from workflow events and schedule overrides. The important principle is:

- operators read projections
- workflow writes update projections asynchronously or transactionally through explicit services
- dashboards do not scan raw progression graphs for every request

## 9. Relationship to Current Implementation

The current remake already has:

- case records
- workflow templates
- workflow instances
- transition events
- communications
- timeline
- dashboard slices

That should stay in place as the short-term operational layer.

But it should be treated as an interim shape. The progression engine described here is the target for the next workflow-heavy milestone once pilot confidence is high enough.

Practical rule:

- do not overbuild the current workflow slice into a second legacy system
- do not hide progression rules in dashboard queries or controller code
- do not put progression automations into database triggers

## 10. Delivery Approach

This should not be built immediately.

The right approach is:

1. keep the current case/workflow model stable enough for pilot work
2. use pilot findings to identify the real progression behaviors that must be preserved
3. design the progression-engine schema and projection layer from this document
4. implement it as a dedicated milestone or sub-milestone
5. migrate current workflow-heavy screens onto the new progression engine intentionally

## 11. Implementation Principles

- explicit graph model over implicit ordered arrays
- append-only workflow events over mutable hidden derived fields
- schedule overrides as first-class records
- automation rules as explicit configuration
- dashboard projections over live progression traversal
- tenant-scoped templates with controlled configurability
- no hidden DB-trigger business logic

## 12. Immediate Planning Impact

This document changes planning in one important way:

- workflow work already delivered should be understood as shared operational groundwork
- the final progression engine is a later dedicated design and implementation effort

That keeps current delivery on track without pretending the present workflow model is the end state.
