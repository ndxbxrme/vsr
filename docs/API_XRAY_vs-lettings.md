# API XRAY — vs-lettings

## 1) Quick orientation
- Purpose of this service (1–2 paragraphs, based on evidence)

This service is an ndx-server/Express API for lettings case progression management, milestone automation, outbound communications, and periodic property synchronization. It stores operational state in ndx-database tables (notably `properties`, `progressions`, `emailtemplates`, `smstemplates`, `users`, `marketing`) and exposes authenticated HTTP endpoints for milestone actions, progression updates, reporting queries, and email-trigger workflows.

The API also integrates with external property systems (`PROPERTY_URL` and `ndx.dezrez`), runs background jobs at db-ready time, and mutates persisted `properties` state based on webhook-triggered synchronization and user-driven milestone activity. Evidence: `src/server/app.coffee`, `src/server/controllers/*.coffee`, `src/server/services/*.coffee`.

- Key entrypoints (file paths)
  - `src/server/app.coffee`
  - `src/server/controllers/property.coffee`
  - `src/server/controllers/milestone.coffee`
  - `src/server/controllers/env.coffee`
  - `src/server/services/property.coffee`
  - `src/server/services/milestone.coffee`
  - `src/server/services/permissions.coffee`
  - `src/server/services/decorator.coffee`
  - `src/server/services/invite-forgot.coffee`
  - `src/server/services/boards-reminder.coffee`
  - `src/server/services/dezrez.coffee`

- Key ndx-server plugins/packages used (bullet list)
  - `ndx-server` (`src/server/app.coffee`) for bootstrap and plugin wiring.
  - `ndx-rest` (configured via `ndx.rest.permissions.set` in `src/server/services/permissions.coffee`).
  - `ndxdb`/database layer accessed as `ndx.database` (configured by `database: 'db'` in `src/server/app.coffee`).
  - `ndx-auth`/`ndx-passport` behavior consumed via `ndx.authenticate()` in controllers.
  - `ndx-mailgun-api` consumed as `ndx.email.send(...)`.
  - `ndx-sms24x` consumed as `ndx.sms.send(...)`.
  - Invite/forgot modules used via `ndx.invite`/`ndx.forgot` template hooks in `src/server/services/invite-forgot.coffee`.

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)
  - `src/server/app.coffee` calls:
    - `require('ndx-server').config({...}).start()`
    - config includes:
      - `database: 'db'`
      - `tables: ['users','properties','progressions','emailtemplates','smstemplates','dashboard','targets','shorttoken','marketing']`
      - `localStorage: './data'`
      - `hasInvite: true`
      - `hasForgot: true`
      - `softDelete: true`
      - `publicUser` projection (`_id`, `displayName`, `local.email`, `roles`)

- Middleware pipeline (in order, if determinable)
  - Explicit middleware order is mostly hidden inside `ndx-server` and plugin auto-loading.
  - Observable route-level auth middleware:
    - `ndx.authenticate()` on most `/api/...` routes.
    - `ndx.authenticate(['admin','superadmin'])` on `GET /api/properties/reset-progressions`.
  - **Unknown:** full global middleware order (body parser, CORS, error middleware, etc.) is not explicit in `/src/server`.

- Router mounting points / base paths
  - Direct registration on `ndx.app` (Express app), no explicit sub-router mount files in `/src/server`.
  - Base patterns observed:
    - `/api/properties/*`
    - `/api/milestone/*`
    - `/api/agreed/search`
    - `/env.js`
    - `/webhook`
    - `/status`

- Error handling approach (if present)
  - Most handlers wrap logic in `try/catch` and call `putError('vslettings', e)` then still `res.end('OK')` in many cases.
  - `putError` currently logs to console (`src/server/puterror.coffee` exports `putError`, not `putError1`).
  - No centralized Express error handler found in `/src/server`.

## 3) HTTP API surface
Provide a table for **all** endpoints discovered.

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| POST | `/api/properties/send-request-email` | `src/server/controllers/property.coffee:(anonymous)` | Body includes `type`, `toMail`, `toName`, `refName`, `property` | `200` text `'OK'` or `'No template'`/`'No email package'` | Reads `emailtemplates`; sends email; appends note to `properties.notes`; updates `properties` |
| POST | `/api/properties/send-accept-email` | `src/server/controllers/property.coffee:(anonymous)` | Body includes `applicant`, `property` | `200` text `'OK'` | Reads `emailtemplates`; sends acceptance email |
| POST | `/api/properties/send-marketing-email` | `src/server/controllers/property.coffee:(anonymous)` | Body includes `marketing` | `200` text `'OK'` | Reads `emailtemplates`; sends email; inserts into `marketing` |
| GET | `/api/properties/reset-progressions` | `src/server/controllers/property.coffee:(anonymous)` | None | `200` text `'OK'` | Selects all `properties`; bulk-updates progression/milestone fields; calls `ndx.property.checkNew()` |
| POST | `/api/properties/advance-progression` | `src/server/controllers/property.coffee:(anonymous)` | Body includes `property`, optional `milestone`, `advanceTo` or `noDays`, `reason` | `200` text `'OK'` | Reads `emailtemplates` and `users`; sends email(s); appends `advanceRequests`; updates `properties` |
| GET | `/api/properties/:roleId` | `src/server/controllers/property.coffee:(anonymous)` | Path param `roleId` | `200` JSON property object or null-like | Calls `ndx.property.fetch` (`selectOne` on `properties`) |
| GET | `/api/properties/:roleId/progressions` | `src/server/controllers/property.coffee:(anonymous)` | Path param `roleId` | `200` JSON progression array (or `[]`) | Selects from `properties` by `roleId` |
| POST | `/api/agreed/search` | `src/server/controllers/property.coffee:(anonymous)` | Body includes `startDate`, `endDate` | `200` JSON string (months array) | Selects all `properties`; computes monthly commission/property summaries |
| POST | `/api/milestone/start` | `src/server/controllers/milestone.coffee:(anonymous)` | Body includes `milestone`, `roleId` | `200` text `'OK'` | Calls `ndx.milestone.processActions('Start', ...)`; may update `properties`; may send email/SMS |
| POST | `/api/milestone/completed` | `src/server/controllers/milestone.coffee:(anonymous)` | Body includes `milestone`, `roleId` | `200` text `'OK'` | Calls `ndx.milestone.processActions('Complete', ...)`; may update `properties`; may send email/SMS |
| GET | `/env.js` | `src/server/controllers/env.coffee:(anonymous)` | None | `200` JS payload defining Angular constant `env` | Exposes `PROPERTY_URL` and `PROPERTY_TOKEN` values to client JS |
| POST | `/webhook` | `src/server/services/property.coffee:(anonymous)` | Not validated | `200` text `'ok'` | Increments `webhookCalls`; runs `checkNew()` sync against external property API; many `properties` writes |
| GET | `/status` | `src/server/services/property.coffee:(anonymous)` | None | `200` JSON `{ webhookCalls, debugInfo }` | Read-only status of sync internals |

Then, for each endpoint, add a short subsection:

### POST /api/properties/send-request-email
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Send a request email from template and add a markdown note to a property.
- **Request:** uses `req.body.type`, `toMail`, `toName`, `refName`, and `property`.
- **Response:** text `'No template'`, `'No email package'`, or `'OK'`.
- **DB touches:** `selectOne('emailtemplates', {name: "<type> Request"})`; `update('properties', {notes}, {_id})`.
- **Triggers involved:** `preUpdate` (`decorator` on `properties`).
- **Realtime effects:** **Unknown** explicit event names; db update likely visible through ndx-rest (package behavior not explicit here).
- **Notes:** typo `requre` appears in `if not ndx.email` branch; despite errors, handler ends with `'OK'`.

### POST /api/properties/send-accept-email
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Send application accepted email based on employment-specific template.
- **Request:** expects `req.body.applicant.employment`, applicant email, plus property info.
- **Response:** text `'OK'`.
- **DB touches:** `select('emailtemplates', {name: "Application Accepted - <employment>"})`.
- **Triggers involved:** none (read-only db).
- **Realtime effects:** none from this handler.
- **Notes:** async callback style; no failure response path.

### POST /api/properties/send-marketing-email
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Send marketing notification and persist marketing record.
- **Request:** expects `req.body.marketing`.
- **Response:** text `'OK'`.
- **DB touches:** `select('emailtemplates', {name: 'Marketing Email'})`; `insert('marketing', ...)`.
- **Triggers involved:** `preInsert` (`decorator` on `marketing` table receives callback true for all).
- **Realtime effects:** **Unknown** explicit channel/event; insertion may propagate via ndx-rest.
- **Notes:** hard-coded recipient `richard@vitalspace.co.uk`.

### GET /api/properties/reset-progressions
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Administrative reset of progression/milestone state across all properties.
- **Request:** none; requires `admin` or `superadmin`.
- **Response:** text `'OK'`.
- **DB touches:** `select('properties', null)` then per-record `update('properties', {progressions:[], milestone:'', milestoneIndex:'', milestoneStatus:'', cssMilestone:''}, {_id})`.
- **Triggers involved:** `preUpdate` (`decorator`).
- **Realtime effects:** **Unknown** explicit websocket details; high-volume property updates likely emitted by ndx-rest.
- **Notes:** calls `ndx.property.checkNew()` after reset, which performs external sync and more writes.

### POST /api/properties/advance-progression
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Create “advance progression” request for milestone(s), notify admins, and save request on property.
- **Request:** `req.body.property`, optional explicit `milestone`, `advanceTo` or `noDays`, `reason`.
- **Response:** text `'OK'`.
- **DB touches:** `select('emailtemplates', {name:'Advance Progression'})`; `select('users', {sendEmail:true, roles.admin.$nnull:true})`; `update('properties', {advanceRequests}, {RoleId: req.body.property.roleId})`.
- **Triggers involved:** `preUpdate` (`decorator`), plus any package-level ndx-rest db hooks.
- **Realtime effects:** **Unknown** explicit event names.
- **Notes:** update condition uses `RoleId` (uppercase) while other code generally uses `roleId`; recipient assignment uses `users[0]` inside loop (likely bug).

### GET /api/properties/:roleId
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Return a single property by role identifier.
- **Request:** path param `roleId`.
- **Response:** JSON property (or undefined/null result from lookup).
- **DB touches:** indirect `selectOne('properties', {uId: roleId})` via `ndx.property.fetch` in `src/server/services/property.coffee`.
- **Triggers involved:** none (read-only).
- **Realtime effects:** none.
- **Notes:** this lookup uses `uId`, not `roleId`.

### GET /api/properties/:roleId/progressions
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Return stored progression array for a property by roleId.
- **Request:** path param `roleId`.
- **Response:** JSON progression array or `[]`.
- **DB touches:** `select('properties', {roleId})`.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** role identifier semantics differ from `/api/properties/:roleId` handler.

### POST /api/agreed/search
- **Handler:** `src/server/controllers/property.coffee:(anonymous)`
- **Purpose:** Build month-bucket report of agreed lets and commission across a date range.
- **Request:** `startDate`, `endDate`.
- **Response:** `res.end(JSON.stringify(months))` where each month has `date`, `properties`, `commission`, `target`.
- **DB touches:** `select('properties')` full scan.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** nested loops over months x properties; potential performance issue at larger dataset size.

### POST /api/milestone/start
- **Handler:** `src/server/controllers/milestone.coffee:(anonymous)`
- **Purpose:** Execute milestone “Start” trigger action pipeline.
- **Request:** `milestone`, `roleId`.
- **Response:** text `'OK'`.
- **DB touches:** indirect via `ndx.milestone.processActions`.
- **Triggers involved:** DB `preUpdate` when property case is updated.
- **Realtime effects:** **Unknown** explicit websocket event names; property updates likely observable.
- **Notes:** action constructed as `{on:'Start', type:'Trigger', triggerAction:'', milestone:<id>}`.

### POST /api/milestone/completed
- **Handler:** `src/server/controllers/milestone.coffee:(anonymous)`
- **Purpose:** Execute milestone completion trigger pipeline.
- **Request:** `milestone`, `roleId`.
- **Response:** text `'OK'`.
- **DB touches:** indirect via `ndx.milestone.processActions`.
- **Triggers involved:** DB `preUpdate` when updating `properties`.
- **Realtime effects:** **Unknown** explicit websocket event names.
- **Notes:** action uses `triggerAction: 'complete'`.

### GET /env.js
- **Handler:** `src/server/controllers/env.coffee:(anonymous)`
- **Purpose:** Emit runtime JS config for Angular module.
- **Request:** none.
- **Response:** JavaScript defining `module.constant('env', { PROPERTY_URL, PROPERTY_TOKEN })`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** no auth; exposes token value from environment.

### POST /webhook
- **Handler:** `src/server/services/property.coffee:(anonymous)`
- **Purpose:** Trigger immediate property synchronization.
- **Request:** body ignored.
- **Response:** text `'ok'`.
- **DB touches:** many writes through `checkNew()` (`insert`/`update` on `properties`).
- **Triggers involved:** `preInsert`/`preUpdate` decorators on `properties`.
- **Realtime effects:** **Unknown** explicit event names; sync writes may produce realtime db change events.
- **Notes:** unauthenticated endpoint in this file.

### GET /status
- **Handler:** `src/server/services/property.coffee:(anonymous)`
- **Purpose:** Debug endpoint for webhook call count and recent sync debug metadata.
- **Request:** none.
- **Response:** JSON `{webhookCalls, debugInfo}`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** public visibility depends on external middleware config (not explicit here).

## 4) ndx-database model & access patterns
### 4.1 Database instance & usage
- Where the db is instantiated/accessed
  - Configured by `database: 'db'` in `src/server/app.coffee`; accessed everywhere as `ndx.database`.
- Common access patterns (helpers/services, direct calls, etc.)
  - Direct controller calls: `select`, `selectOne`, `insert`, `update`, `count`.
  - Service-level helper wrappers:
    - `ndx.property.fetch(...)` and `ndx.property.checkNew(...)` in `src/server/services/property.coffee`.
    - Milestone action engine in `src/server/services/milestone.coffee`.
  - Event hooks: `ndx.database.on('ready'|'preInsert'|'preUpdate', ...)`.

### 4.2 Collections (or equivalent)
For each collection:

#### users
- **Shape:** includes `local.email`, `displayName`, `deleted`, `sendEmail`, nested role fields (`roles.admin`, `local.sites.main.role`).
- **Relationships:** used as recipients/permissions actors for milestone and progression notifications.
- **Where used:** `src/server/controllers/property.coffee`, `src/server/services/milestone.coffee`.
- **Typical operations:** filtered `select` by admin role/sendEmail, `select` by `_id`.

#### properties
- **Shape:** large denormalized object from external APIs; key fields include `_id`, `uId`, `roleId`/`RoleId`, `displayAddress`, `Status`, `progressions`, `milestone*`, `notes`, `advanceRequests`, `delisted`, override/fee fields, contacts.
- **Relationships:** references embedded progression trees; links to external role/property IDs.
- **Where used:** controllers (`property.coffee`), services (`property.coffee`, `milestone.coffee`).
- **Typical operations:** `select`, `selectOne`, frequent `update`, occasional `insert`; full scans for reporting and sync reconciliation.

#### progressions
- **Shape:** template progression definitions with `isdefault`, `deleted`, `milestones` (nested branches with milestone nodes/actions).
- **Relationships:** copied into each property as `property.progressions`.
- **Where used:** `src/server/services/property.coffee`.
- **Typical operations:** `select` defaults (`isdefault:true`) and clone into property.

#### emailtemplates
- **Shape:** includes `name`, `_id`, `subject`, `body`/`text`, `from`.
- **Relationships:** used by invite/forgot, milestone actions, and property email endpoints.
- **Where used:** controllers and services.
- **Typical operations:** `selectOne`/`select` by `name` or `_id`.

#### smstemplates
- **Shape:** at minimum `_id`, `body`.
- **Relationships:** used by milestone action pipeline.
- **Where used:** `src/server/services/milestone.coffee`.
- **Typical operations:** `select` by `_id`.

#### marketing
- **Shape:** request-driven marketing object with appended `user`.
- **Relationships:** persisted audit-like output of marketing email flow.
- **Where used:** `src/server/controllers/property.coffee`.
- **Typical operations:** `insert`.

#### dashboard
- **Shape:** **Unknown** in `/src/server`.
- **Relationships:** **Unknown**.
- **Where used:** only listed in `tables` config.
- **Typical operations:** none found.

#### targets
- **Shape:** **Unknown** in `/src/server`.
- **Relationships:** may relate to reporting; not directly queried.
- **Where used:** only listed in `tables` config.
- **Typical operations:** none found.

#### shorttoken
- **Shape:** **Unknown** in `/src/server`.
- **Relationships:** likely used by ndx short-token plugin.
- **Where used:** only listed in `tables` config.
- **Typical operations:** none found directly.

### 4.3 High-value queries / operations
List the important query-like behaviors (even if not SQL), e.g. “find open cases by user”, “update milestone”, etc.
- Fetch default progression templates and clone onto properties
  - Where: `src/server/services/property.coffee:getDefaultProgressions`
  - Collections: `progressions`, `properties`
  - Performance notes: simple iteration over default progression records.
- Property sync against external role search and detail APIs
  - Where: `src/server/services/property.coffee:checkNew/fetchCurrentProps/fetchPropertyData`
  - Collections: `properties`, `progressions`
  - Performance notes: external API loops and full `properties` scan for delisting check.
- Milestone recalculation on property objects
  - Where: `src/server/services/property.coffee:calculateMilestones`
  - Collections: persisted through `update('properties', ...)`
  - Performance notes: nested loops with iterative dependency resolution (`while needsCompleting and i++ < 5`).
- Agreed-search monthly report
  - Where: `src/server/controllers/property.coffee` (`POST /api/agreed/search`)
  - Collections: `properties`
  - Performance notes: full dataset scan and month cross-loop.
- Milestone action processing pipeline
  - Where: `src/server/services/milestone.coffee:processActions`
  - Collections: `properties`, `users`, `emailtemplates`, `smstemplates`
  - Performance notes: nested traversal of progression/milestone trees and callback-driven I/O.

## 5) ndx-database triggers (MUST be detailed)
Create an inventory table:

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `ready` | DB initialization complete | global db | `src/server/controllers/property.coffee` | If `properties` empty, bulk-build property data from external API | Inserts/updates many `properties` |
| `ready` | DB initialization complete | global db | `src/server/services/property.coffee` | Placeholder (commented interval/checkNew) | No active side effects in current code |
| `ready` | DB initialization complete | global db | `src/server/services/boards-reminder.coffee` | Schedules recurring Wednesday 11:00 UK reminder job | Sends emails using template |
| `preInsert` | Before db insert | all tables (logic allows all) | `src/server/services/decorator.coffee` | Decorator callback gate | No mutation shown; callback `true` |
| `preUpdate` | Before db update | all tables (logic allows all) | `src/server/services/decorator.coffee` | Decorator callback gate | No mutation shown; callback `true` |

Then, for each trigger:

### Trigger: ready (initial property bootstrap)
- **Defined in:** `src/server/controllers/property.coffee:(ready handler)`
- **Fires on:** db `ready` event.
- **Applies to:** global db; conditional path only if `ndx.database.count('properties')` is falsy.
- **Logic:** query external `/search` for letting OfferAccepted; iterate collection with progress bar; call `ndx.property.fetch(RoleId)` for each.
- **DB side effects:** property records can be inserted/updated through `ndx.property.fetch` and downstream sync functions.
- **External side effects:** outbound HTTP to `PROPERTY_URL`; console logging.
- **Realtime side effects:** **Unknown** explicit websocket event names; db changes likely propagate via ndx-rest.
- **Notes:** this hook can do large startup data hydration.

### Trigger: ready (property service hook)
- **Defined in:** `src/server/services/property.coffee:(ready handler)`
- **Fires on:** db `ready` event.
- **Applies to:** global db.
- **Logic:** currently no-op (both `setInterval checkNew` and `checkNew()` lines commented out).
- **DB side effects:** none in current code.
- **External side effects:** none in current code.
- **Realtime side effects:** none.
- **Notes:** historical behavior appears intended but disabled.

### Trigger: ready (boards reminder scheduler)
- **Defined in:** `src/server/services/boards-reminder.coffee:(ready handler)`
- **Fires on:** db `ready` event.
- **Applies to:** global db.
- **Logic:** schedules `sendEmail` via `setTimeout(millisecondsUntil11am())`; on Wednesdays (`getDay() is 3`) selects template `Auto Reminder - Boards` and emails fixed recipients.
- **DB side effects:** reads `emailtemplates` only.
- **External side effects:** sends emails through `ndx.email.send`.
- **Realtime side effects:** none.
- **Notes:** re-arms itself daily by recursive `setTimeout`.

### Trigger: preInsert (decorator)
- **Defined in:** `src/server/services/decorator.coffee:decorate`
- **Fires on:** before insert (`ndx.database.on 'preInsert'`).
- **Applies to:** all tables; explicit switch includes key tables but all branches call `cb true`.
- **Logic:** if `args.obj.deleted` returns `cb true`; otherwise switch on table and still `cb true`.
- **DB side effects:** none.
- **External side effects:** none.
- **Realtime side effects:** none directly.
- **Notes:** acts as permissive hook; no filtering/mutation in current state.

### Trigger: preUpdate (decorator)
- **Defined in:** `src/server/services/decorator.coffee:decorate`
- **Fires on:** before update (`ndx.database.on 'preUpdate'`).
- **Applies to:** all tables; same logic as `preInsert`.
- **Logic:** unconditional allow via `cb true`.
- **DB side effects:** none.
- **External side effects:** none.
- **Realtime side effects:** none directly.
- **Notes:** no guardrails implemented despite hook presence.

## 6) ndx-rest realtime/websocket contract
### 6.1 Websocket setup
- Where websocket server is created/attached
  - **Unknown in `/src/server`**. No explicit socket server construction or namespace wiring found.
- How ndx-rest is initialized and connected to db
  - ndx-rest appears auto-loaded via `ndx-server` plugins (dependency in `package.json`), then configured in `src/server/services/permissions.coffee` through `ndx.rest.permissions.set(...)`.
  - Explicit database-to-rest wiring code is **not** present in `/src/server`.
- Namespaces/paths if defined
  - **Unknown** (not defined in local server source).

### 6.2 Event inventory (frontend notifications)
Provide a table:

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| **Unknown** | Implicit ndx-rest reaction to db insert/update/delete | **Unknown** | Permissions are globally permissive (`all` operations true) in `services/permissions.coffee` | Hidden inside ndx-rest package (not explicit in `/src/server`) |

### 6.3 Subscriptions & scoping model
- How clients subscribe (rooms/topics/collection-level)
  - **Unknown** in this repo segment.
- Per-user/per-case scoping rules (if any)
  - No custom scoping logic found in `/src/server`; permissions code allows all operations for both db and rest.
- Any dedupe/throttle behavior (if any)
  - **Unknown**.

## 7) Cross-cutting domain flows (API + DB + realtime)
Pick the **top 5–10** most important workflows you can infer from code (e.g., “create matter”, “update milestone”, “upload doc metadata”, etc.). For each:

### Flow: Startup property hydration when db is empty
1. API entrypoint(s): none (db `ready` hook in `controllers/property.coffee`).
2. DB operations: checks `count('properties')`; then property fetch path leads to `insert/update` on `properties`.
3. Triggers fired: `ready`, plus `preInsert`/`preUpdate` decorators during writes.
4. Realtime events emitted: **Unknown** explicit names; likely db-change push via ndx-rest internals.
5. Resulting state changes: initializes property corpus and progression metadata.

### Flow: Webhook-driven property synchronization
1. API entrypoint(s): `POST /webhook`.
2. DB operations: `checkNew()` reads external role list, upserts `properties`, marks missing active roles as `delisted`.
3. Triggers fired: `preInsert`/`preUpdate`.
4. Realtime events emitted: **Unknown** explicit event names.
5. Resulting state changes: refreshed property records, milestone recalculations, delisting updates.

### Flow: Milestone start action
1. API entrypoint(s): `POST /api/milestone/start`.
2. DB operations: finds milestone in property progression tree and updates `properties` with start timestamps/progressing flags.
3. Triggers fired: decorator `preUpdate`; action-engine internal recursive "Trigger" actions (not db hooks).
4. Realtime events emitted: **Unknown** explicit event names; property update likely broadcast through ndx-rest.
5. Resulting state changes: milestone enters progressing state; optional downstream email/SMS actions may execute.

### Flow: Milestone complete action
1. API entrypoint(s): `POST /api/milestone/completed`.
2. DB operations: marks milestone completed; may backfill start time; updates property record.
3. Triggers fired: decorator `preUpdate`; internal recursive action processing for Start/Complete follow-ons.
4. Realtime events emitted: **Unknown** explicit names.
5. Resulting state changes: milestone completion timestamps set; next actions can dispatch notifications.

### Flow: Request email + note append
1. API entrypoint(s): `POST /api/properties/send-request-email`.
2. DB operations: read template from `emailtemplates`; update `properties.notes`.
3. Triggers fired: decorator `preUpdate`.
4. Realtime events emitted: **Unknown** explicit names.
5. Resulting state changes: outbound email sent and request note persisted on property timeline.

### Flow: Advance progression request
1. API entrypoint(s): `POST /api/properties/advance-progression`.
2. DB operations: read `emailtemplates` and `users`; update `properties.advanceRequests`.
3. Triggers fired: decorator `preUpdate`.
4. Realtime events emitted: **Unknown** explicit names.
5. Resulting state changes: new advance request recorded; admins may receive notification email.

### Flow: Marketing email and marketing record creation
1. API entrypoint(s): `POST /api/properties/send-marketing-email`.
2. DB operations: read `emailtemplates`; insert into `marketing`.
3. Triggers fired: decorator `preInsert`.
4. Realtime events emitted: **Unknown** explicit names.
5. Resulting state changes: marketing communication sent and persisted.

### Flow: Boards reminder scheduler
1. API entrypoint(s): none (time-based on db ready).
2. DB operations: read `emailtemplates` weekly check.
3. Triggers fired: `ready`.
4. Realtime events emitted: none.
5. Resulting state changes: periodic operational reminder emails.

## 8) Integration points visible in `/src/server`
Only include what is actually used by `/src/server`.
- Other internal services called (HTTP/RPC)
  - `PROPERTY_URL` external API (`/search`, `/property/:id`) via `superagent`.
    - purpose: property/case synchronization.
    - where configured: env vars used in `controllers/property.coffee`, `services/milestone.coffee`, `services/property.coffee`.
    - where invoked: `checkNew`, startup ready bootstrap, milestone property fetch.
    - failure handling: mostly `try/catch` + `putError`; callback branches often only log/no structured retries.
  - DeZrez wrapper (`ndx.dezrez`) with auth/token refresh.
    - purpose: fetch role/property/viewing/tenant details (`role/{id}`, `property/{id}`, `role/{id}/viewingsbasic`).
    - where configured: `src/server/services/dezrez.coffee` using `REZI_ID`, `REZI_SECRET`, `AGENCY_ID`.
    - where invoked: `src/server/services/property.coffee:fetchPropertyData`.
    - failure handling: callbacks get err; many call sites catch and `putError`.

- Email sending (ndx-email usage)
  - purpose: transactional and operational notifications.
  - where configured: implicit plugin load; template resolution via `emailtemplates`.
  - where invoked:
    - `controllers/property.coffee` (`send-request-email`, `send-accept-email`, `send-marketing-email`, `advance-progression`)
    - `services/milestone.coffee` (action type `Email`)
    - `services/boards-reminder.coffee` (scheduled board reminders)
  - failure handling: minimal; mostly silent or console logs.

- Webhooks in/out (if present)
  - Incoming webhook: `POST /webhook` in `services/property.coffee` triggers sync.
  - Outgoing webhook: none explicit.

- File/document generation (if present)
  - No document/file generation flow found in `/src/server`.
  - Minor markdown/text rendering via `marked` for email body formatting.

## 9) Unknowns & follow-ups (actionable)
A bullet list of:
- Exact ndx-rest websocket event names/channels/payloads are **Unknown** from `/src/server`; inspect `ndx-rest` package implementation for emitted contract.
- Exact websocket auth/subscription scoping is **Unknown**; inspect `ndx-socket`/`ndx-rest` initialization path in ndx-server internals.
- Full middleware order and global error handling are **Unknown**; inspect `ndx-server` bootstrap internals and any generated runtime `server/app.js`.
- Database trigger semantics beyond `ready/preInsert/preUpdate` are **Unknown**; no additional hooks found in active `.coffee` files.
- `src/server/services/property.coffeez` contains additional db hooks (`preUpdate`) and sync behavior but file extension suggests it may be inactive; confirm loader extension rules in ndx-server.
- Potential field mismatch (`RoleId` vs `roleId`) in `/api/properties/advance-progression` update condition should be verified against actual stored schema.
- Confirm whether `GET /api/properties/:roleId` intentionally queries by `uId` while `/progressions` queries by `roleId`.
- If realtime contract is critical for frontend clients, instrument db writes and socket emissions at runtime (or inspect ndx-rest source) to capture concrete event inventory.
