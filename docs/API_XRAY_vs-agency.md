# API XRAY — vs-agency

## 1) Quick orientation
- This service is an `ndx-server` backend that exposes property and milestone workflow endpoints, persists an in-memory/local-storage-backed database, and orchestrates progression automation, notifications, and upstream property-data sync. Evidence: `src/server/app.coffee`, `src/server/controllers/property.coffee`, `src/server/controllers/milestone.coffee`, `src/server/services/property.coffee`, `src/server/services/milestone.coffee`.
- API behavior is implemented through `ndx.app` route handlers in controllers/services and shared helpers attached on `ndx` (`ndx.property`, `ndx.milestone`, `ndx.dezrez`).
- `ndx.database` is used as the central data store/event bus. Hooks like `ready`, `preUpdate`, and `selectTransform` drive bootstrapping and data mutation side effects.

Key entrypoints (file paths):
- `src/server/app.coffee`
- `src/server/controllers/property.coffee`
- `src/server/controllers/milestone.coffee`
- `src/server/services/property.coffee`
- `src/server/services/milestone.coffee`

Key ndx-server plugins/packages used (bullet list):
- `ndx-server` (directly required): service/bootstrap host (`src/server/app.coffee:3`)
- `ndx-database` style API via `ndx.database` (`select/update/insert/delete/upsert/on/count`) used throughout server files
- `ndx-rest` (dependency present in `package.json:57`) appears to be implicitly loaded by `ndx-server`; no explicit init code exists in `src/server`
- `ndx-auth`/`ndx-passport`/`ndx-permissions` style behavior via `ndx.authenticate(...)` route middleware
- `ndx-mailgun-api` style behavior via `ndx.email.send(...)`
- `ndx-sms24x` style behavior via `ndx.sms.send(...)`
- `ndx-short-token` likely backing configured `shorttoken` table

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)
  - `src/server/app.coffee` calls:
    - `require 'ndx-server'`
    - `.config(...)` with:
      - `database: 'db'`
      - `tables: ['users', 'properties', 'progressions', 'emailtemplates', 'smstemplates', 'dashboard', 'targets', 'shorttoken', 'clientmanagement']`
      - `localStorage: './data'`
      - feature flags: `hasInvite`, `hasForgot`, `serveUploads`, `softDelete`
      - `publicUser` projection
    - `.start()`
- Middleware pipeline (in order, if determinable)
  - Explicit middleware in `src/server`:
    - Route-level auth middleware `ndx.authenticate(...)` on protected routes.
  - Global middleware order is **Unknown** from `/src/server`; likely inside `ndx-server` and loaded `ndx-*` plugins.
- Router mounting points / base paths
  - Routes are mounted directly onto `ndx.app` (Express app).
  - Main namespaces:
    - `/api/properties/*`
    - `/api/milestone/*`
    - `/env.js`
    - `/webhook`
    - `/status`
- Error handling approach (if present)
  - No explicit Express error middleware (`app.use((err,...`) found in `/src/server`.
  - Most handlers return `res.end('OK'|'ok'|'hi')` or `res.json(...)`; several upstream failures are ignored or logged only.
  - One explicit throw exists (`src/server/services/milestone.coffee:59`).

## 3) HTTP API surface

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| GET | `/api/properties/reset-progressions` | `src/server/controllers/property.coffee:(anonymous route handler)` | No documented params/body; auth role required (`admin`,`superadmin`) | `200` body `OK` | Bulk-updates all `properties` progression fields and invokes `ndx.property.checkNew()` |
| POST | `/api/properties/advance-progression` | `src/server/controllers/property.coffee:(anonymous route handler)` | Body: `property`, optional `milestone`, optional `advanceTo`, optional `noDays`, `reason` | `200` body `OK` | Creates advance request record; updates `properties.advanceRequests`; optionally emails admins |
| POST | `/api/properties/send-new-sales-email` | `src/server/controllers/property.coffee:(anonymous route handler)` | Body: `newSales` | `200` body `OK` | Reads users + template; sends email per user |
| POST | `/api/properties/send-reduction-email` | `src/server/controllers/property.coffee:(anonymous route handler)` | Body: `reduction` | `200` body `OK` | Reads users + template; sends email per user |
| GET | `/api/properties/:roleId` | `src/server/controllers/property.coffee:(anonymous route handler)` | Param: `roleId` | `200` JSON property object (or null-ish via callback) | Calls `ndx.property.fetch` which may read/update/insert `properties` and call external APIs |
| GET | `/api/properties/:roleId/progressions` | `src/server/controllers/property.coffee:(anonymous route handler)` | Param: `roleId` | `200` JSON progression array or `[]` | Reads `properties` by `roleId` |
| POST | `/api/milestone/start` | `src/server/controllers/milestone.coffee:(anonymous route handler)` | Body: `milestone`, `roleId` | `200` body `OK` | Invokes milestone action engine (`Start` trigger path), may update `properties`, send email/SMS |
| POST | `/api/milestone/completed` | `src/server/controllers/milestone.coffee:(anonymous route handler)` | Body: `milestone`, `roleId` | `200` body `OK` | Invokes milestone action engine (`Complete` trigger path), may update `properties`, send email/SMS |
| GET | `/env.js` | `src/server/controllers/env.coffee:(anonymous route handler)` | None | JS response containing `PROPERTY_URL` and `PROPERTY_TOKEN` constants | Exposes selected env vars in runtime JS |
| POST | `/webhook` | `src/server/controllers/property.coffee:(anonymous route handler)` | No body usage | `200` body `hi` | No-op |
| POST | `/webhook` | `src/server/services/property.coffee:(anonymous route handler)` | No body usage | `200` body `ok` | Increments in-memory counter + calls `checkNew()` sync workflow |
| POST | `/status` | `src/server/services/property.coffee:(anonymous route handler)` | No body usage | `200` JSON `{webhookCalls}` | Reports in-memory webhook call count |

### GET /api/properties/reset-progressions
- **Handler:** `src/server/controllers/property.coffee:(route at lines 7-20)`
- **Purpose:** Administrative reset of progression state for all properties.
- **Request:** No payload consumed.
- **Response:** `200` plain text `OK`.
- **DB touches:** `properties` `select` all, then per-record `update` setting `progressions`, `milestone`, `milestoneIndex`, `milestoneStatus`, `cssMilestone`.
- **Triggers involved:** `preUpdate` on `properties` may fire for each update (`src/server/services/property.coffee:239-243`).
- **Realtime effects:** **Unknown** direct event names/channels; property updates likely propagate through `ndx-rest` if enabled.
- **Notes:** Heavy bulk loop; no batching/throttling.

### POST /api/properties/advance-progression
- **Handler:** `src/server/controllers/property.coffee:(route at lines 21-78)`
- **Purpose:** Request milestone advancement and persist request history on property.
- **Request:** Uses `req.body.property`, optional `req.body.milestone`, optional `req.body.advanceTo` or `req.body.noDays`, `req.body.reason`.
- **Response:** `200` plain text `OK`.
- **DB touches:** `emailtemplates` select by name, `users` select admins, `properties` update by `roleId` to persist `advanceRequests`.
- **Triggers involved:** `preUpdate` on `properties` may recalculate milestone fields.
- **Realtime effects:** **Unknown** explicit websocket event contract; property mutation may be broadcast by `ndx-rest`.
- **Notes:** Uses `ndx.user` (shared mutable context) for requestor metadata; email loop sets `templates[0].to = users[0].local.email` inside `for user in users` (potential bug/hidden coupling).

### POST /api/properties/send-new-sales-email
- **Handler:** `src/server/controllers/property.coffee:(route at lines 79-92)`
- **Purpose:** Send “New Sales Instruction Email” to users.
- **Request:** `req.body.newSales`.
- **Response:** `200` plain text `OK`.
- **DB touches:** `users` select all, `emailtemplates` select by name.
- **Triggers involved:** None from DB writes (read-only DB operations).
- **Realtime effects:** None observed.
- **Notes:** Selects template per user iteration; sends to `user.local?.email`.

### POST /api/properties/send-reduction-email
- **Handler:** `src/server/controllers/property.coffee:(route at lines 93-106)`
- **Purpose:** Send “Price Reduction Email” to users.
- **Request:** `req.body.reduction`.
- **Response:** `200` plain text `OK`.
- **DB touches:** `users` select all, `emailtemplates` select by name.
- **Triggers involved:** None from DB writes.
- **Realtime effects:** None observed.
- **Notes:** Same query/send pattern as new-sales route.

### GET /api/properties/:roleId
- **Handler:** `src/server/controllers/property.coffee:(route at lines 107-109)`
- **Purpose:** Fetch enriched case/property state by roleId.
- **Request:** URL param `roleId`.
- **Response:** `200` JSON from `ndx.property.fetch` callback.
- **DB touches:** Indirect via `ndx.property.fetch`: select/update/insert on `properties`.
- **Triggers involved:** `preUpdate` on property updates.
- **Realtime effects:** **Unknown** explicit channel names; updates likely observable via `ndx-rest`.
- **Notes:** Handler returns quickly with current DB value; async refresh may mutate DB after response.

### GET /api/properties/:roleId/progressions
- **Handler:** `src/server/controllers/property.coffee:(route at lines 110-117)`
- **Purpose:** Return progression array for a property role.
- **Request:** URL param `roleId`.
- **Response:** `200` JSON progression array or empty array.
- **DB touches:** `properties` select by `roleId`.
- **Triggers involved:** None (read-only route).
- **Realtime effects:** None observed.
- **Notes:** No explicit 404 path.

### POST /api/milestone/start
- **Handler:** `src/server/controllers/milestone.coffee:(route at lines 4-12)`
- **Purpose:** Trigger milestone action processing for start event.
- **Request:** Body includes `milestone`, `roleId`.
- **Response:** `200` plain text `OK`.
- **DB touches:** Indirect via `ndx.milestone.processActions` (may update `properties`, select templates/users).
- **Triggers involved:** `preUpdate` on `properties` when milestone updates are written.
- **Realtime effects:** **Unknown** direct events; property updates may fan out via `ndx-rest`.
- **Notes:** No validation/error response on invalid milestone id.

### POST /api/milestone/completed
- **Handler:** `src/server/controllers/milestone.coffee:(route at lines 13-21)`
- **Purpose:** Trigger milestone action processing for completion event.
- **Request:** Body includes `milestone`, `roleId`.
- **Response:** `200` plain text `OK`.
- **DB touches:** Indirect via `ndx.milestone.processActions`.
- **Triggers involved:** `preUpdate` on `properties`.
- **Realtime effects:** **Unknown** direct events; property updates may be emitted by `ndx-rest`.
- **Notes:** Completion path can recursively trigger milestone child actions.

### GET /env.js
- **Handler:** `src/server/controllers/env.coffee:(route at lines 4-24)`
- **Purpose:** Serve runtime JS env constants.
- **Request:** None.
- **Response:** `200` JavaScript payload defining Angular `env` constant.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Emits sensitive-ish tokens if set (`PROPERTY_TOKEN`) directly into script response.

### POST /webhook (controller implementation)
- **Handler:** `src/server/controllers/property.coffee:(route at lines 118-119)`
- **Purpose:** Placeholder webhook endpoint.
- **Request:** Ignored.
- **Response:** `200` plain text `hi`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Conflicts with another `/webhook` route in `services/property.coffee`.

### POST /webhook (service implementation)
- **Handler:** `src/server/services/property.coffee:(route at lines 232-236)`
- **Purpose:** Trigger property sync workflow and track call count.
- **Request:** Ignored.
- **Response:** `200` plain text `ok`.
- **DB touches:** Indirect through `checkNew()` (`properties` select/update; external fetches).
- **Triggers involved:** `preUpdate` on `properties` for updates performed during sync.
- **Realtime effects:** **Unknown** direct event naming; DB updates likely broadcast via `ndx-rest`.
- **Notes:** Effective handler depends on load order (duplicate path+method).

### POST /status
- **Handler:** `src/server/services/property.coffee:(route at lines 237-238)`
- **Purpose:** Expose in-memory webhook invocation count.
- **Request:** None.
- **Response:** `200` JSON `{ webhookCalls: <number> }`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Counter resets on process restart.

## 4) ndx-database model & access patterns

### 4.1 Database instance & usage
- DB configured by `src/server/app.coffee:5-7` (`database: 'db'`, `localStorage: './data'`, explicit table list).
- Access pattern is direct `ndx.database.*` calls from controllers/services.
- Event hooks are used as trigger mechanism:
  - `ready` hooks in multiple files
  - `preUpdate` hook for property mutation normalization
  - `selectTransform` hook for response projection
- No repository/data-access abstraction layer; business logic and DB operations are mixed in route/service functions.

### 4.2 Collections (or equivalent)

#### users
- **Shape:** implied fields include `_id`, `displayName`, `local.email`, `roles.*`, `telephone`, `deleted`.
- **Relationships:** referenced by email-notification flows and role-based recipient selection.
- **Where used:** `controllers/property.coffee`, `services/milestone.coffee`, `services/unknown-solicitors.coffee`.
- **Typical operations:** `select` only (all users, admins, non-deleted).

#### properties
- **Shape:** very broad; includes `roleId`, `offer`, `role`, `progressions[]`, `milestone`, `milestoneIndex`, `milestoneStatus`, `cssMilestone`, solicitor/contact fields, `notes`, `chainBuyer`, `chainSeller`, `delisted`, `modifiedAt`, `override.deleted`, `advanceRequests[]`.
- **Relationships:** linked to upstream role/property ids (`roleId`, `offer.Id`, `PropertyId`), joins implied to `progressions` templates and contacts/users.
- **Where used:** `controllers/property.coffee`, `services/property.coffee`, `services/milestone.coffee`, `services/unknown-solicitors.coffee`.
- **Typical operations:** `select`, `insert`, `update`, `delete`; frequent whole-object updates.

#### progressions
- **Shape:** progression templates with `isdefault` and nested `milestones` branches.
- **Relationships:** cloned into `properties.progressions` for per-case state.
- **Where used:** `services/property.coffee`, `services/milestone.coffee`.
- **Typical operations:** `select` defaults only.

#### emailtemplates
- **Shape:** `name`, `_id`, `subject`, `body`, `from`, plus runtime-assigned template vars.
- **Relationships:** used by invite/forgot and domain notification flows.
- **Where used:** `controllers/property.coffee`, `services/milestone.coffee`, `services/unknown-solicitors.coffee`, `services/invite-forgot.coffee`.
- **Typical operations:** `select` by `name` or `_id`.

#### smstemplates
- **Shape:** `_id`, `body` (implied).
- **Relationships:** used by milestone actions for SMS sends.
- **Where used:** `services/milestone.coffee`.
- **Typical operations:** `select` by `_id`.

#### clientmanagement
- **Shape:** upstream role/property snapshot plus local fields (`_id`, `RoleId`, `notes`, `active`, `now`, related enrichment objects).
- **Relationships:** sourced from upstream search/dezrez endpoints.
- **Where used:** `services/property.coffee`.
- **Typical operations:** `select` by `RoleId`, `upsert`, `insert`, bulk `update` for stale rows.

#### dashboard
- **Shape:** **Unknown** from `/src/server` (declared in table config only).
- **Relationships:** transformed projection key `dashboard/properties` exists in `services/transformer.coffee`.
- **Where used:** no explicit route/service DB operations found in `/src/server`.
- **Typical operations:** **Unknown**.

#### targets
- **Shape:** **Unknown** from `/src/server`.
- **Relationships:** **Unknown**.
- **Where used:** no explicit usage found in `/src/server`.
- **Typical operations:** **Unknown**.

#### shorttoken
- **Shape:** **Unknown** from `/src/server`.
- **Relationships:** likely invite/forgot support, but not directly manipulated here.
- **Where used:** only table declaration in `app.coffee`.
- **Typical operations:** **Unknown**.

### 4.3 High-value queries / operations
- Reset all progression state
  - What it does: zeroes progression/milestone computed fields for every property.
  - Where: `src/server/controllers/property.coffee:7-20`
  - Collections: `properties`
  - Perf notes: full-scan + per-row update.
- Build initial property DB on startup
  - What it does: if no properties, searches upstream OfferAccepted roles, then fetches each case and inserts.
  - Where: `src/server/controllers/property.coffee:121-147`
  - Collections: `properties`
  - Perf notes: serial recursive fetch loop.
- Webhook-triggered sync (`checkNew`)
  - What it does: re-fetches upstream OfferAccepted list; updates progression/milestone computed state; delists missing roles.
  - Where: `src/server/services/property.coffee:179-227`
  - Collections: `properties`, `progressions`
  - Perf notes: nested loops comparing every local property to upstream collection.
- Property fetch and conditional refresh
  - What it does: returns cached property; may asynchronously refresh role data and mutate DB.
  - Where: `src/server/services/property.coffee:247-331`
  - Collections: `properties`
  - Perf notes: external calls; potential repeated updates on hot paths.
- Client management enrichment sync
  - What it does: fetches instruction-to-sell roles, enriches via multiple dezrez endpoints, upserts into `clientmanagement`, marks stale inactive.
  - Where: `src/server/services/property.coffee:116-177`
  - Collections: `clientmanagement`
  - Perf notes: high fan-out Promise graph per property.
- Milestone action engine
  - What it does: applies start/complete action state transitions, then cascades actions (Trigger/Email/Sms).
  - Where: `src/server/services/milestone.coffee:45-124`
  - Collections: `properties`, `emailtemplates`, `smstemplates`, `users`
  - Perf notes: recursive action processing; side effects include outbound sends.

## 5) ndx-database triggers (MUST be detailed)

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `ready` | DB ready event at startup | `properties` | `src/server/controllers/property.coffee:121-147` | Seeds property DB if empty by fetching upstream cases | Many `ndx.property.fetch` calls, inserts/updates in `properties` |
| `ready` | DB ready event at startup | `properties` | `src/server/services/property.coffee:6-14` | Purges soft-deleted overridden properties | `ndx.database.delete('properties', {_id})` |
| `ready` | DB ready event at startup | none (timer setup) | `src/server/services/property.coffee:228-230` | Placeholder scheduled sync setup (currently commented) | None currently |
| `preUpdate` | Before any update | `properties` | `src/server/services/property.coffee:239-243` | Recalculates milestone/computed fields on property object | Mutates update payload before persistence |
| `ready` | DB ready event at startup | `properties`, `emailtemplates`, `users` | `src/server/services/unknown-solicitors.coffee:2-60` | Starts interval job for unknown-solicitor digest emails | Periodic email sends |
| `selectTransform` | During select transform pipeline | transformed select payloads | `src/server/services/transformer.coffee:6-13` | Applies named object projection (`dashboard/properties`) | Alters returned object shape |

### Trigger: ready (property bootstrap seeding)
- **Defined in:** `src/server/controllers/property.coffee:121-147`
- **Fires on:** custom DB event `ready`.
- **Applies to:** global startup; gated by `ndx.database.count('properties') == 0`.
- **Logic:**
  1. Query external `/search` for offer-accepted selling roles.
  2. Create progress bar.
  3. Serially call `ndx.property.fetch(RoleId)` for each result.
- **DB side effects:** inserts/updates `properties` through `ndx.property.fetch`.
- **External side effects:** HTTP to `PROPERTY_URL`.
- **Realtime side effects:** **Unknown** explicit events; property writes may emit via `ndx-rest`.
- **Notes:** long bootstrap operation; no backoff/retry strategy.

### Trigger: ready (purge overridden deleted properties)
- **Defined in:** `src/server/services/property.coffee:6-14`
- **Fires on:** custom DB event `ready`.
- **Applies to:** `properties` with filter `override.deleted: true`.
- **Logic:** select matching properties then delete each by `_id`.
- **DB side effects:** `delete` operations on `properties`.
- **External side effects:** console logging.
- **Realtime side effects:** **Unknown** if deletes are broadcast by `ndx-rest`.
- **Notes:** likely cleanup for soft-delete artifacts.

### Trigger: ready (property scheduler placeholder)
- **Defined in:** `src/server/services/property.coffee:228-230`
- **Fires on:** `ready`.
- **Applies to:** none currently.
- **Logic:** commented out `setInterval checkNew` and `checkNew()`.
- **DB side effects:** none currently.
- **External side effects:** none.
- **Realtime side effects:** none.
- **Notes:** indicates intended periodic sync design.

### Trigger: preUpdate (property recalculation)
- **Defined in:** `src/server/services/property.coffee:239-243`
- **Fires on:** before update (`preUpdate`) when `args.table is 'properties'`.
- **Applies to:** all property updates.
- **Logic:**
  1. Grab pending update object (`args.obj`).
  2. Run `calculateMilestones(property)` to recompute derived milestone fields.
  3. Call callback to continue update.
- **DB side effects:** no direct extra writes; mutates same update payload.
- **External side effects:** none.
- **Realtime side effects:** indirect; changed computed fields become part of persisted update.
- **Notes:** can overwrite caller-supplied milestone fields; hidden coupling across all property updates.

### Trigger: ready (unknown solicitor digest scheduler)
- **Defined in:** `src/server/services/unknown-solicitors.coffee:2-60`
- **Fires on:** `ready`, then internal `setInterval` every 10s.
- **Applies to:** non-delisted properties and business-day/time gate.
- **Logic:**
  1. Build normalized solicitor-name set from properties.
  2. Collect properties with purchaser/vendor solicitor as Unknown.
  3. If any unknowns, load template + users and send emails.
  4. Maintain next scheduled send time.
- **DB side effects:** reads only (`properties`, `emailtemplates`, `users`).
- **External side effects:** outbound email sends.
- **Realtime side effects:** none observed.
- **Notes:** uses chained comparison `0 < nextSendTime.getDay() < 6`, which in JS is not strict range-check semantics.

### Trigger: selectTransform (dashboard/properties projection)
- **Defined in:** `src/server/services/transformer.coffee:6-27`
- **Fires on:** database `selectTransform` event.
- **Applies to:** selects requesting transformer key `dashboard/properties`.
- **Logic:** apply projection via `objtrans`; always include `_id`.
- **DB side effects:** none.
- **External side effects:** none.
- **Realtime side effects:** none.
- **Notes:** affects response shape only; not persistence.

## 6) ndx-rest realtime/websocket contract

### 6.1 Websocket setup
- No explicit websocket server creation or `ndx-rest` initialization is present in `/src/server`.
- Evidence of likely implicit wiring:
  - `src/server/app.coffee` only bootstraps via `require('ndx-server').config(...).start()`.
  - `package.json` includes `ndx-rest` and `ndx-socket` dependencies.
- Therefore, setup location is **Unknown in this repo scope**; likely inside `ndx-server`/`ndx-rest` packages.
- Namespace/path details are **Unknown** from `/src/server`.

### 6.2 Event inventory (frontend notifications)

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| **Unknown (likely db-change events for configured tables)** | `ndx.database` writes (`insert/update/delete/upsert`) on tables in `app.coffee` | Likely changed document and metadata; exact schema **Unknown** | **Unknown** (collection-level/permission-scoped behavior likely in `ndx-rest`) | Not explicitly defined in `/src/server`; likely in `ndx-rest` internals |

### 6.3 Subscriptions & scoping model
- Client subscription API, room/topic model, and auth binding for realtime are **Unknown** from `/src/server`.
- What is explicit:
  - This service mutates DB collections heavily (`properties`, `clientmanagement`) and uses `ndx.authenticate` for HTTP endpoints.
  - If `ndx-rest` is active via `ndx-server`, those DB mutations are the probable source for frontend notifications.
- Dedupe/throttle behavior is **Unknown**.

## 7) Cross-cutting domain flows (API + DB + realtime)

### Flow: Startup property seed
1. API entrypoint(s): none (startup via DB `ready` hook).
2. DB operations: count `properties`; fetch and insert/update property records.
3. Triggers fired: `ready` hook in `controllers/property.coffee`; `preUpdate` on subsequent updates.
4. Realtime events emitted: **Unknown** (likely table change events if `ndx-rest` active).
5. Resulting state changes: initial property dataset populated with progression defaults and role/contact data.

### Flow: Webhook sync and delist detection
1. API entrypoint(s): `POST /webhook` in `services/property.coffee`.
2. DB operations: fetch/update properties; mark missing roles as `delisted: true`.
3. Triggers fired: `preUpdate` for each property update.
4. Realtime events emitted: **Unknown** explicit names; likely property-change broadcasts.
5. Resulting state changes: refreshed case snapshots and delisting flags.

### Flow: Fetch property by role (read-through refresh)
1. API entrypoint(s): `GET /api/properties/:roleId`.
2. DB operations: select existing property; maybe update/insert depending on staleness or missing case.
3. Triggers fired: `preUpdate` when updates occur.
4. Realtime events emitted: **Unknown** for async updates after response.
5. Resulting state changes: client gets current case; backend may refresh cache asynchronously.

### Flow: Reset progression state (admin)
1. API entrypoint(s): `GET /api/properties/reset-progressions`.
2. DB operations: full-scan select + bulk property updates resetting progression/milestone fields.
3. Triggers fired: `preUpdate` repeatedly.
4. Realtime events emitted: **Unknown** (potential high-volume update fanout).
5. Resulting state changes: progression tracking wiped/reinitialized on all properties.

### Flow: Advance progression request
1. API entrypoint(s): `POST /api/properties/advance-progression`.
2. DB operations: select template/users; update property `advanceRequests`.
3. Triggers fired: `preUpdate` on property update.
4. Realtime events emitted: **Unknown**.
5. Resulting state changes: request audit entry stored, optional admin emails sent.

### Flow: Milestone start/completion action cascade
1. API entrypoint(s): `POST /api/milestone/start`, `POST /api/milestone/completed`.
2. DB operations: property milestone updates; template lookups (`emailtemplates`, `smstemplates`, `users`).
3. Triggers fired: `preUpdate` for property updates.
4. Realtime events emitted: **Unknown** explicit channels.
5. Resulting state changes: milestone flags/timestamps advanced, recursive child actions executed, notifications sent.

### Flow: Unknown solicitors daily digest
1. API entrypoint(s): none (timer started from `ready` trigger).
2. DB operations: periodic reads from `properties`, `emailtemplates`, `users`.
3. Triggers fired: `ready` hook in unknown-solicitors service.
4. Realtime events emitted: none observed (read-only).
5. Resulting state changes: outbound reminder emails to users for cases with missing solicitor data.

### Flow: Client management enrichment (non-routed, callable service)
1. API entrypoint(s): none currently exposed (function `fetchClientManagementProperties` is internal and currently not invoked by routes).
2. DB operations: select/upsert/insert/update on `clientmanagement`.
3. Triggers fired: no collection-specific trigger in `/src/server` for `clientmanagement`.
4. Realtime events emitted: **Unknown**; table updates may be broadcast if ndx-rest includes table.
5. Resulting state changes: active client-management snapshot synchronized with upstream data.

## 8) Integration points visible in `/src/server`
- Property upstream API (`PROPERTY_URL`)
  - purpose: search/fetch property-role data for case lifecycle
  - where configured: env vars read in `controllers/property.coffee`, `services/property.coffee`, `services/milestone.coffee`
  - where invoked: `superagent.post("${PROPERTY_URL}/search")`, `superagent.get("${PROPERTY_URL}/property/{roleId}")`
  - failure handling: mostly minimal (`if not err` guards); errors often ignored or thrown (`milestone.coffee:59`)
- Dezrez API wrapper (`ndx.dezrez`)
  - purpose: retrieve role, property, owners, offers, events, stats details
  - where configured: `src/server/services/dezrez.coffee` (token refresh + env URL map)
  - where invoked: `src/server/services/property.coffee` (multiple `ndx.dezrez.get` calls)
  - failure handling: callback error propagation; many callers proceed with partial data
- Email sending (`ndx.email.send`)
  - purpose: operational/user notifications and templates
  - where configured: implicit plugin object presence checks (`if ndx.email`)
  - where invoked: `controllers/property.coffee`, `services/milestone.coffee`, `services/unknown-solicitors.coffee`
  - failure handling: no explicit retry/await handling
- SMS sending (`ndx.sms.send`)
  - purpose: milestone SMS actions
  - where configured: implicit plugin object `ndx.sms`
  - where invoked: `src/server/services/milestone.coffee:110-124`
  - failure handling: none visible
- Invite/Forgot template hooks
  - purpose: override template retrieval for invite/forgot flows
  - where configured: `src/server/services/invite-forgot.coffee`
  - where invoked: implicitly by `ndx.invite` / `ndx.forgot` plugin flows
  - failure handling: fallback default templates if DB templates absent

## 9) Unknowns & follow-ups (actionable)
- Exact `ndx-rest` websocket event names/channels/payload schema are **Unknown** from `/src/server`; no explicit emit/listen code found.
- Exact websocket setup path/namespaces/auth handshake are **Unknown**; likely inside `ndx-server`/`ndx-rest`/`ndx-socket` package internals.
- Effective route resolution for duplicate `POST /webhook` is **Unknown** without confirming module load order in `ndx-server`.
- Global middleware order and default error handlers are **Unknown** from local server code.
- Collection schemas for `dashboard`, `targets`, and `shorttoken` are **Unknown** (declared only in `app.coffee`).
- Index/unique-constraint definitions are **Unknown**; none explicitly configured in `/src/server`.
- Suggested next files to inspect/instrument:
  - `node_modules/ndx-server/*` for module load order and plugin boot sequence.
  - `node_modules/ndx-rest/*` for websocket event contract and subscription model.
  - `node_modules/ndx-database*`/`ndxdb` internals for trigger semantics and query operators (`$nnull`, `override`, `where`, etc.).
  - Add temporary logging around DB write paths (`insert/update/delete`) to capture actual outbound realtime payloads/channels.
