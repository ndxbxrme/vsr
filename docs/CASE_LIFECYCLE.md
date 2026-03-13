# Case Lifecycle Design

## 1. Purpose

This document defines how sales and lettings cases should behave in the remake.

It exists because the legacy system treats cases as one of the core operational units:

- a case appears automatically when the property enters the system in a qualifying status
- operational users work the case day to day
- a case can be assigned to an owner for workload and dashboard purposes
- the case stays live until progression completes or the property is delisted

That behavior is correct in spirit and should be preserved, but the remake should model it more explicitly.

## 1.1 Current Status

This slice is now partially implemented in the remake.

Implemented:

- `cases.owner_membership_id`
- `cases.closed_reason`
- sales and lettings create/update APIs can assign or clear ownership
- sales and lettings cases can be closed with an explicit reason
- progression-complete transitions close cases with `progression_completed`
- a shared lifecycle rules module exists for later auto-create / auto-close work

Still deferred:

- automatic case creation from property sync events
- automatic case close from confident delisting
- tenant-configurable status rules
- richer listing-cycle logic for relist edge cases

## 2. Core Principle

`property` and `case` should not be the same thing.

- `property` is the long-lived canonical record for the stock item
- `case` is the operational workflow record for one active sales or lettings journey

This distinction matters because:

- the same property can go through multiple marketing or transaction cycles over time
- the same property can be relisted with a new Dezrez role id
- dashboards and ownership should operate on cases, not just on stock
- progression completion and delisting are case lifecycle events, not just property flags

## 3. Recommended Case Model

Each case should represent one active operational episode for a property and product type.

Recommended rules:

- a sales case belongs to one property
- a lettings case belongs to one property
- cases are tenant-scoped and usually branch-scoped
- each case has a product-specific state plus shared open/closed status
- each case may have a nullable owner assignment

Important constraint:

- there should normally be at most one active sales case and one active lettings case per property at a time

That constraint should be enforced in application logic, not left to user discipline.

## 4. Creation Rules

Cases should be created automatically from property sync events when the property enters a qualifying operational state.

The rule should be tenant-configurable, but the default behavior should be:

- sales case auto-created when a property enters a live sales instruction state
- lettings case auto-created when a property enters a live lettings instruction state

The real trigger should not be “property exists in Dezrez”.

The trigger should be:

- property exists
- product type is known
- marketing or workflow status is in an allowed set for case creation
- there is not already an active case of that type for the same property

This avoids creating junk cases for non-operational or historical stock.

## 5. Ownership and Permissions

Ownership and permissions should be separate concerns.

Permissions:

- sales users and admins can work sales cases
- lettings users and admins can work lettings cases
- admins can work both

Ownership:

- case owner should be `owner_membership_id` or equivalent
- owner should be optional
- owner affects dashboards, queues, and accountability
- owner should not gate access unless a tenant explicitly wants that later

This matches the legacy behavior more closely:

- ownership matters for who “owns” the work
- it should not stop the rest of the relevant team from helping

## 6. Lifecycle States

At the shared case level, the remake should keep a simple lifecycle:

- `open`
- `on_hold`
- `completed`
- `cancelled`

Product-specific state stays in the product tables:

- `sales_cases.sale_status`
- `lettings_cases.letting_status`

This is the right split:

- shared case status answers “is this still operationally active?”
- product status answers “where is this journey within sales or lettings?”

## 7. Close Rules

The close rules should preserve the legacy behavior, but defensively.

### 7.1 Progression Complete

When the progression reaches its terminal state:

- case becomes `completed`
- completion timestamp is recorded
- product-specific status moves to its final terminal status
- dashboard projections update from case events, not from ad hoc scans

### 7.2 Confident Delisting

When the property is confidently delisted:

- if the case is still open, it should move to `cancelled`
- cancellation reason should be explicit, for example `property_delisted`
- the transition should be evented and auditable

This must use the hardened property-sync trust rules:

- do not close from a single bad sync
- do not close from an anomalous empty feed
- only act when the property lifecycle is confidently delisted

### 7.3 Reinstatement and Relisting

If a property disappears and then returns:

- if the previous case was never truly closed and the transaction is still ongoing, keep the same case and update the linked current role reference
- if the previous case was properly cancelled or completed and the property has started a new marketing cycle, create a new case

This is why role history and stable property identity both matter.

The practical rule should be:

- property is stable
- case is per operational cycle
- role id is evidence about the current cycle, not the case id itself

## 8. Relationship to Dezrez Role IDs

The case should not be keyed directly to the Dezrez role id.

Instead:

- the property is matched by stable upstream `propertyId`
- the current marketing cycle is tracked through the current Dezrez role ref
- the case uses the property as the durable subject
- lifecycle rules decide whether a new role means “same open case” or “new case episode”

This avoids coupling case identity to fragile upstream role churn.

## 9. Dashboard Implications

Dashboard calculations should be case-centric.

The main operational metrics should be based on:

- open cases by type
- cases by owner
- cases by workflow stage
- ageing in stage
- completed / cancelled / agreed / offer-accepted outcomes

Property rows can support stock dashboards, but progression and workload dashboards should read from cases.

That is the clean way to preserve the legacy behavior where owner assignment mainly affects dashboards.

## 10. Recommended Schema Direction

The current implementation already has:

- `cases`
- `sales_cases`
- `lettings_cases`
- `workflow_instances`

The next schema refinements should be:

- add `owner_membership_id` to `cases`
- add explicit `closed_reason` or `cancellation_reason` to `cases`
- add optional `opened_from_event` metadata
- add `current_external_role_id` or a clear link to the current Dezrez role ref for the active case context
- later, add an explicit `listing_cycle` or `marketing_episode` concept if pilot evidence shows it is needed

## 11. Immediate Planning Impact

This document implies the following near-term rules:

- keep manual case creation for internal tooling where useful
- but plan for auto-case creation from property sync as the real operational mode
- treat owner assignment as dashboard/workload metadata, not a permission boundary
- keep cases live until progression completes or the property is confidently delisted
- do not let delisting logic bypass the hardened sync trust rules

## 12. Recommended Next Implementation Slice

When we pick this up in code, the order should be:

1. add owner assignment to cases
2. define tenant-configurable auto-case creation rules by product and property status
3. add safe case auto-create / case close services driven by property lifecycle events
4. make dashboards read owner and lifecycle from cases
5. only then deepen progression-specific automation on top
