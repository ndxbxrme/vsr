# API XRAY — vs-maintenance-leads

## 1) Quick orientation
- Purpose of this service (1–2 paragraphs, based on evidence)

This service is an API backend for a maintenance workflow centered on `issues` and `tasks`, with tenant/contractor/landlord communication and message handling. Evidence: server config declares core tables (`issues`, `tasks`, `contractors`, `landlords`, templates, etc.) and all custom HTTP routes are operational workflows (`/api/chase`, `/api/inform`, `/api/complete`, `/api/restore`, `/api/mailin`, `/api/message-center/send`) in `src/server/app.coffee`.

The API is built through `ndx-server` (Express wrapper), uses `ndx-database` as an in-memory store with event hooks (`preInsert`, `preUpdate`, `insert`, `update`, `ready`), and emits realtime notifications through `ndx.socket.emitToAll` plus `ndx-rest` configuration (`permissions`, `selectTransform`, `transforms`).

- Key entrypoints (file paths)
  - `src/server/app.coffee` (main bootstrap, trigger registration, route definitions, `start()`)
  - `src/server/services/fixflo.coffee` (DB `ready` hook, background ingestion from Fixflo)
  - `src/server/services/permissions.coffee` (`ndx.database.permissions` and `ndx.rest.permissions`)
  - `src/server/services/transforms.coffee` (`ndx.rest.selectTransform`, `ndx.rest.transforms`)
  - `src/server/services/decorator.coffee` (extra `preInsert`/`preUpdate` listeners)
  - `src/server/services/invite-forgot.coffee` (invite/forgot template fetchers)

- Key ndx-server plugins/packages used (bullet list)
  - `ndx-server` (required directly in `src/server/app.coffee:13`)
  - `ndx-database` (used via `ndx.database.*` in `app.coffee` and services)
  - `ndx-rest` (used via `ndx.rest.*` in services)
  - `ndx-socket` (used via `ndx.socket.emitToAll` in `app.coffee`)
  - `ndx-file-upload` (used via `ndx.fileUpload.saveFile` in `/api/mailin`)
  - `ndx-mailgun-api`/email integration via `ndx.email.send` (used in messaging flows)
  - `ndx-sms24x`/SMS integration via `ndx.sms.send`
  - `ndx-invite` / forgot flow integration exposed as `ndx.invite` and `ndx.forgot` (from `hasInvite`/`hasForgot` config + `invite-forgot.coffee`)

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)
  - `src/server/app.coffee:13-20` initializes `ndx-server` with:
    - `database: 'db'`
    - `tables: ['users','issues','tasks','contractors','landlords','messages','emailtemplates','smstemplates','shorttoken']`
    - `localStorage: './data'`
    - `hasInvite: true`, `hasForgot: true`, `softDelete: true`
  - `src/server/app.coffee:21` and `:219` add two `.use` blocks (trigger wiring, then route wiring).
  - `src/server/app.coffee:534` calls `.start()`.

- Middleware pipeline (in order, if determinable)
  1. Internal ndx-server middleware stack: **Unknown** (package internals not in repo).
  2. First custom `.use` block (`app.coffee:21-218`) registers DB listeners/triggers.
  3. Second custom `.use` block (`app.coffee:219-533`) mounts routes.
  4. Route-level middleware:
    - `ndx.authenticate()` on authenticated routes.
    - `bodyParser.urlencoded({extended:true})` on `/api/mailin`.

- Router mounting points / base paths
  - All explicit custom routes mount under `/api/*` (`src/server/app.coffee:222-533`).
  - `ndx.addPublicRoute('/api/mailin')` and `ndx.addPublicRoute('/api/fixflo/pdf')` mark those routes public (`app.coffee:220-221`).

- Error handling approach (if present)
  - Most routes do not pass errors to `next`; they respond with `'OK'` regardless of many branch outcomes.
  - `/api/message-center/send` has `try/catch` and returns `res.json(e)` on exception (`app.coffee:482-533`).
  - `/api/mailin` logs parse/send errors but still returns `200 Ok` (`app.coffee:426-478`).

## 3) HTTP API surface
Provide a table for **all** endpoints discovered.

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| GET | `/api/emit` | `src/server/app.coffee:(anonymous route)` | none | `200`, body `'OK'` | Reads one issue, emits websocket `newIssue` |
| GET | `/api/update-statuses` | `src/server/app.coffee:(anonymous route)` | none | `200`, `'OK'` | Scans issues, normalizes status fields, upserts issues |
| POST | `/api/notes/:issueId` | `src/server/app.coffee:(anonymous route)` | `params.issueId`, `body.notes` | `200`, `'OK'` | Updates `issues.notes` |
| GET | `/api/chase/:method/:taskId` | `src/server/app.coffee:(anonymous route)` | `params.method` (`email`/`sms` implied), `params.taskId` | `200`, `'OK'` | Reads template/task/issue/contractor, sends email/SMS, appends issue note, upserts issue |
| GET | `/api/chase-invoice/:method/:taskId` | `src/server/app.coffee:(anonymous route)` | `params.method`, `params.taskId` | `200`, `'OK'` | Same pattern as chase with `ChaseInvoice` template |
| GET | `/api/inform/:method/:taskId` | `src/server/app.coffee:(anonymous route)` | `params.method`, `params.taskId` | `200`, `'OK'` | Sends tenant email/SMS via template, appends note, upserts issue |
| GET | `/api/complete/:issueId` | `src/server/app.coffee:(anonymous route)` | `params.issueId` | `200`, `'OK'` | Updates issue `statusName=Completed`, sends completion email/SMS to tenant |
| GET | `/api/restore/:issueId` | `src/server/app.coffee:(anonymous route)` | `params.issueId` | `200`, `'OK'` | Restores soft-deleted issue fields, marks related tasks deleted, upserts issue |
| GET | `/api/fixflo/pdf/:fixfloId` | `src/server/app.coffee:(anonymous route)` | `params.fixfloId` | PDF bytes (`Content-Type: application/pdf`) | Outbound HTTP GET to Fixflo report URL |
| ALL | `/api/mailin` | `src/server/app.coffee:(anonymous route)` | Mailgun-like POST body or multipart form (`subject/sender/Date/body-plain/stripped-text/files`) | `200`, `'Ok'` | Parses inbound email, uploads attachments, updates `issues.messages/documents/newMessages`, emits `newMessage` |
| POST | `/api/message-center/send` | `src/server/app.coffee:(anonymous route)` | `body.issueId`, `body.item.messageTo`, `body.body`, optional `attachments`, etc. | `200`, `'OK'` or JSON error | Sends outbound email via Mailgun, appends outbound message into `issue.messages` |

Then, for each endpoint, add a short subsection:

### GET /api/emit
- **Handler:** `src/server/app.coffee:(route at lines 222-225)`
- **Purpose:** Manually emits one issue as `newIssue` websocket message.
- **Request:** none.
- **Response:** `200` text `'OK'`.
- **DB touches:** `issues` (`selectOne` without filter).
- **Triggers involved:** none directly (read only).
- **Realtime effects:** explicit `ndx.socket.emitToAll('newIssue', issue)`.
- **Notes:** Unauthenticated in code; no null-check before emitting.

### GET /api/update-statuses
- **Handler:** `src/server/app.coffee:(route at lines 226-238)`
- **Purpose:** Backfill/normalize `statusName` and `contractorName` on all issues.
- **Request:** no request body/query.
- **Response:** `200` text `'OK'`.
- **DB touches:** `issues` (`select`, `upsert`), `contractors` (`selectOne`).
- **Triggers involved:** issue `upsert` may fire `preInsert/preUpdate` and `insert/update` listeners.
- **Realtime effects:** possible `newIssue` broadcasts via `sendSockets` on issue inserts.
- **Notes:** Authentication required via `ndx.authenticate()`.

### POST /api/notes/:issueId
- **Handler:** `src/server/app.coffee:(route at lines 239-244)`
- **Purpose:** Replace issue notes array.
- **Request:** `params.issueId`, body `{notes: [...]}`.
- **Response:** `200` text `'OK'`.
- **DB touches:** `issues` (`update`).
- **Triggers involved:** `assignAddressAndNames`, `sendMessages`, `checkDeleted`, `decorate` on `preUpdate`; `updateStatus`, `assignProperties` on `update`.
- **Realtime effects:** no explicit socket emit in route; package-level rest sync: **Unknown**.
- **Notes:** No schema validation.

### GET /api/chase/:method/:taskId
- **Handler:** `src/server/app.coffee:(route at lines 245-273)`
- **Purpose:** Chase contractor by email or SMS for a task.
- **Request:** `params.method`, `params.taskId`.
- **Response:** `200` text `'OK'`.
- **DB touches:** `emailtemplates`/`smstemplates` (`selectOne` by `name='Chase'`), `tasks` (`selectOne`), `issues` (`selectOne`,`upsert`), `contractors` (`selectOne`).
- **Triggers involved:** issue `upsert` listeners as above.
- **Realtime effects:** potential `newIssue` on insert via trigger; otherwise explicit none.
- **Notes:** If `method` is neither `email` nor `sms`, message not sent but route still returns OK.

### GET /api/chase-invoice/:method/:taskId
- **Handler:** `src/server/app.coffee:(route at lines 274-302)`
- **Purpose:** Chase contractor invoice using `ChaseInvoice` template.
- **Request:** `params.method`, `params.taskId`.
- **Response:** `200` text `'OK'`.
- **DB touches:** same collections as `/api/chase`.
- **Triggers involved:** issue `upsert` listeners.
- **Realtime effects:** same as `/api/chase`.
- **Notes:** Appends note text specific to invoice chase.

### GET /api/inform/:method/:taskId
- **Handler:** `src/server/app.coffee:(route at lines 303-331)`
- **Purpose:** Inform tenant via email/SMS.
- **Request:** `params.method`, `params.taskId`.
- **Response:** `200` text `'OK'`.
- **DB touches:** templates (`name='Inform'`), `tasks`, `issues`, `contractors`; issue `upsert`.
- **Triggers involved:** issue `upsert` listeners.
- **Realtime effects:** explicit none in route.
- **Notes:** `template.to` derives from tenant contact info.

### GET /api/complete/:issueId
- **Handler:** `src/server/app.coffee:(route at lines 332-358)`
- **Purpose:** Mark issue completed and notify tenant.
- **Request:** `params.issueId`.
- **Response:** `200` text `'OK'`.
- **DB touches:** `issues` (`update`, then `selectOne`), templates (`name='Complete'`), `contractors` (`selectOne`).
- **Triggers involved:** issue update listeners (`sendMessages` can also fire on statusName transition).
- **Realtime effects:** explicit none in route.
- **Notes:** Notifications are attempted after status update; no rollback if notify fails.

### GET /api/restore/:issueId
- **Handler:** `src/server/app.coffee:(route at lines 359-378)`
- **Purpose:** Restore issue state after soft deletion.
- **Request:** `params.issueId`.
- **Response:** `200` text `'OK'`.
- **DB touches:** `issues` (`selectOne`,`upsert`), `tasks` (`update` by `issue`).
- **Triggers involved:** task update listeners and issue upsert listeners.
- **Realtime effects:** possible `newIssue` on insert path; explicit none here.
- **Notes:** Sets `deleted = null`, `statusName='Reported'`, clears `cfpJobNumber`.

### GET /api/fixflo/pdf/:fixfloId
- **Handler:** `src/server/app.coffee:(route at lines 379-384)`
- **Purpose:** Proxy a Fixflo report PDF.
- **Request:** `params.fixfloId`.
- **Response:** binary PDF, `Content-Type: application/pdf`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** Uses `ndx.fixflo.issuesUrl` set by Fixflo service; public route.

### ALL /api/mailin
- **Handler:** `src/server/app.coffee:(route at lines 385-478)`
- **Purpose:** Inbound email webhook ingestion into issue message thread.
- **Request:** URL-encoded or multipart payload; parses hidden `:I<issueId>+<replyId>:` token from email body.
- **Response:** `200` text `'Ok'`.
- **DB touches:** `issues` (`selectOne`,`update`), `landlords` (`selectOne` for sender classification).
- **Triggers involved:** issue update listeners.
- **Realtime effects:** explicit `ndx.socket.emitToAll('newMessage', {address, subject, from})`.
- **Notes:** `reporter.log 'email handled successfully'` appears to call bare `reporter` (not `ndx.reporter`), which may throw/undefined depending runtime scope.

### POST /api/message-center/send
- **Handler:** `src/server/app.coffee:(route at lines 480-533)`
- **Purpose:** Send outbound email from message center and persist it into issue messages.
- **Request:** body fields include `issueId`, `item.messageTo` (`entity::name::email`), `body`, optional `attachments`, optional `replyId`.
- **Response:** `200` text `'OK'`; on catch returns `res.json(e)`.
- **DB touches:** `emailtemplates` (`selectOne`), `issues` (`selectOne`,`update`).
- **Triggers involved:** issue update listeners.
- **Realtime effects:** explicit none.
- **Notes:** DB update runs inside async Mailgun callback, after HTTP response already sent.

## 4) ndx-database model & access patterns
### 4.1 Database instance & usage
- Where the db is instantiated/accessed
  - Instantiation details are hidden inside `ndx-server`; app config declares `database: 'db'` in `src/server/app.coffee:14-20`.
  - Access pattern is always via `ndx.database` (`select`, `selectOne`, `update`, `upsert`, `on`, permission setters).

- Common access patterns (helpers/services, direct calls, etc.)
  - Direct route-level CRUD in `app.coffee`.
  - Cross-entity denormalization in trigger callbacks (e.g., task update writes issue, issue update writes landlord).
  - Background ingestion on DB ready (`services/fixflo.coffee`).
  - Global allow-all permission callbacks in `services/permissions.coffee`.

### 4.2 Collections (or equivalent)
For each collection:

#### users
- **Shape:** Not explicitly defined in server code.
- **Relationships:** Unknown in this scope.
- **Where used:** Only declared in table config and decorator switch.
- **Typical operations:** No explicit CRUD in `/src/server` custom code.

#### issues
- **Shape:** `_id`, address fields (`address1`, `address2`, `postcode`, computed `address`), tenant fields (`tenantTitle`, `tenantFirstName`, `tenantLastName`, `tenant`, `tenantEmail`, `tenantPhone`), contractor fields (`booked`, `contractor`, `contractorName`), status (`status`, `statusName`, `cfpJobNumber`, `deleted`), messaging (`notes`, `messages`, `newMessages`, `documents`), landlord link (`landlordId`), fixflo fields (`fixfloId`, `fixfloUrl`, `fixfloStatus`, `source`, `date`), search composite (`search`).
- **Relationships:** `issues.booked -> contractors._id`; task link by `tasks.issue`; `issues.landlordId -> landlords._id`.
- **Where used:** `app.coffee` throughout; `services/fixflo.coffee`.
- **Typical operations:** heavy `selectOne`, `select`, `update`, `upsert`.

#### tasks
- **Shape:** `_id`, `issue`, `contractor`, `contractorName`, `cfpJobNumber`, `deleted`.
- **Relationships:** `tasks.issue -> issues._id`; `tasks.contractor -> contractors._id`.
- **Where used:** route handlers (`/api/chase*`, `/api/inform`, `/api/restore`), triggers (`assignAddressAndNames`, `updateStatus`, `checkDeleted`).
- **Typical operations:** `selectOne`, `update` by issue, trigger-driven dependent updates.

#### contractors
- **Shape:** `_id`, `name`, `email`, `phone` (observed fields).
- **Relationships:** referenced by `issues.booked`, `tasks.contractor`.
- **Where used:** notification routes and triggers.
- **Typical operations:** `selectOne` lookups.

#### landlords
- **Shape:** `_id`, `name`, `email`, `addresses` (array of address strings).
- **Relationships:** `issues.landlordId -> landlords._id`; reverse inferred mapping by `addresses`+postcode.
- **Where used:** inbound mail sender attribution, landlord auto-assignment and reverse address maintenance.
- **Typical operations:** `selectOne`, `select`, `update`.

#### messages
- **Shape:** Unknown; no direct operations in `/src/server` custom code.
- **Relationships:** Unknown.
- **Where used:** only listed in configured tables.
- **Typical operations:** Unknown.

#### emailtemplates
- **Shape:** `name`, `subject`, `body`, `from`.
- **Relationships:** used by invite/forgot, chase/inform/complete/message-center flows.
- **Where used:** `app.coffee`, `services/invite-forgot.coffee`.
- **Typical operations:** `selectOne` and `select` by template name.

#### smstemplates
- **Shape:** `name`, `body` implied.
- **Relationships:** used when `method='sms'` and code queries `smstemplates` via `req.params.method + 'templates'`.
- **Where used:** `app.coffee` send flows.
- **Typical operations:** `selectOne` by `name`.

#### shorttoken
- **Shape:** Unknown.
- **Relationships:** Unknown.
- **Where used:** only table config list.
- **Typical operations:** Unknown.

### 4.3 High-value queries / operations
- Normalize issue status + contractor names for all issues
  - Where: `src/server/app.coffee:226-238`
  - Collections: `issues`, `contractors`
  - Performance: full scan of `issues` then per-issue lookups.

- Assign contractor metadata and write assignment note when tasks are inserted/updated
  - Where: trigger `assignAddressAndNames` (`app.coffee:22-62`)
  - Collections: `tasks`, `contractors`, `issues`
  - Performance: per-event lookup + issue upsert.

- Cross-sync landlord addresses <-> issues
  - Where: trigger `assignProperties` (`app.coffee:153-195`)
  - Collections: `landlords`, `issues`
  - Performance: nested loops over landlord addresses and matching issues by postcode then address compare.

- Auto-assign landlord on issue insert by address match
  - Where: trigger `assignLandlord` (`app.coffee:196-207`)
  - Collections: `landlords`, `issues`
  - Performance: scans all landlords and all addresses.

- Inbound email ingestion and thread append
  - Where: `/api/mailin` (`app.coffee:385-478`)
  - Collections: `issues`, `landlords`
  - Performance: single issue lookup per message; loops attachments.

- Fixflo polling import
  - Where: `services/fixflo.coffee:4-62`
  - Collections: `issues`
  - Performance: paginated external fetch with 200ms sleeps; per-item DB lookup and optional upsert.

## 5) ndx-database triggers (MUST be detailed)
Create an inventory table:

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `assignAddressAndNames` | `preInsert`, `preUpdate` | `issues`, `tasks` | `src/server/app.coffee` | Computes issue denormalized fields, resolves contractor names, writes task-assignment note to issue | `issues` upsert from task path |
| `updateStatus` | `insert`, `update` | `tasks`, `issues` | `src/server/app.coffee` | Sets issue status/statusName and cfpJobNumber from task events; defaults new issue to Reported | `issues` upsert |
| `sendMessages` | `preInsert`, `preUpdate` | `issues` | `src/server/app.coffee` | On statusName transitions, sends template email/SMS and appends note | External email/SMS sends; mutates notes |
| `sendSockets` | `insert` | `issues` | `src/server/app.coffee` | Emits `newIssue` websocket event | Realtime broadcast |
| `checkDeleted` | `preUpdate` | `issues`, `tasks` | `src/server/app.coffee` | On delete flag, resets issue status and cascades soft deletes/resets | updates related tasks/issues |
| `assignProperties` | `insert`, `update` | `landlords`, `issues` | `src/server/app.coffee` | Syncs landlordId on issues and address list on landlords | cross-table updates |
| `assignLandlord` | `preInsert` | `issues` | `src/server/app.coffee` | Sets landlordId from postcode/address matching | mutates inserted issue object |
| `decorate` | `preInsert`, `preUpdate` | all tables (branch no-op) | `src/server/services/decorator.coffee` | Placeholder decorator hook currently allows all | none observed |
| Fixflo ready hook | `ready` | database global | `src/server/services/fixflo.coffee` | Starts periodic Fixflo ingestion | repeating external HTTP + issue upserts |

Then, for each trigger:

### Trigger: assignAddressAndNames
- **Defined in:** `src/server/app.coffee:22-62`
- **Fires on:** `preUpdate`, `preInsert`.
- **Applies to:** `issues`, `tasks`.
- **Logic:**
  1. Skip if `args.changes.deleted`.
  2. For `issues`: derive `contractor`, `address`, `tenant`, `search` fields.
  3. For `tasks`: load contractor + issue, set `task.contractorName`, append assignment note to issue.
- **DB side effects:** issue upsert in task branch.
- **External side effects:** none.
- **Realtime side effects:** indirect only (if resulting DB writes trigger other listeners).
- **Notes:** Calls async DB operations inside trigger callback before `cb(true)`.

### Trigger: updateStatus
- **Defined in:** `src/server/app.coffee:63-78`
- **Fires on:** `insert`, `update`.
- **Applies to:** `tasks`, `issues`.
- **Logic:**
  1. Task insert: mark linked issue booked, set `statusName='Booked'`, copy `cfpJobNumber`.
  2. Task update (non-delete): update issue `cfpJobNumber`.
  3. Issue insert: default `statusName='Reported'`.
- **DB side effects:** issue upserts.
- **External side effects:** none.
- **Realtime side effects:** indirect via issue insert hooks.
- **Notes:** Assumes linked issue exists for task events.

### Trigger: sendMessages
- **Defined in:** `src/server/app.coffee:95-123`
- **Fires on:** `preInsert`, `preUpdate`.
- **Applies to:** `issues` with `changes.statusName.to`.
- **Logic:**
  1. Ignore if status transition missing or target `Reported`.
  2. Build merged issue object; load first matching task and contractor.
  3. For `Booked`: send contractor email+SMS via `Booked` templates.
  4. For `Completed`: send tenant email+SMS via `Completed` templates.
  5. Append status-change note if `args.user` present.
- **DB side effects:** mutates `args.obj.notes` pre-write.
- **External side effects:** `ndx.email.send`, `ndx.sms.send`.
- **Realtime side effects:** none direct.
- **Notes:** Uses helper `sendMessage` (`app.coffee:79-94`).

### Trigger: sendSockets
- **Defined in:** `src/server/app.coffee:124-127`
- **Fires on:** `insert`.
- **Applies to:** `issues` only.
- **Logic:** emit new issue payload to all sockets.
- **DB side effects:** none.
- **External side effects:** none.
- **Realtime side effects:** `newIssue` broadcast.
- **Notes:** No filtering/scoping in this code.

### Trigger: checkDeleted
- **Defined in:** `src/server/app.coffee:128-143`
- **Fires on:** `preUpdate`.
- **Applies to:** updates where `changes.deleted.to` is truthy.
- **Logic:**
  1. If deleting an issue: reset status fields, soft-delete related tasks (`issue: args.id`).
  2. If deleting a task: reset linked issue status to reported.
- **DB side effects:** updates `tasks` or `issues`.
- **External side effects:** none.
- **Realtime side effects:** none direct.
- **Notes:** Potential trigger chaining due nested updates.

### Trigger: assignProperties
- **Defined in:** `src/server/app.coffee:153-195`
- **Fires on:** `insert`, `update`.
- **Applies to:** `landlords`, `issues`.
- **Logic:**
  1. Landlord writes: iterate `landlord.addresses`, find issues by postcode+fuzzy address, set `issue.landlordId`.
  2. Issue writes: if landlord changed, remove old address from previous landlord and add current address to new landlord when missing.
- **DB side effects:** updates both `issues` and `landlords`.
- **External side effects:** console logging.
- **Realtime side effects:** none direct.
- **Notes:** Nested cross-updates can cause multiple trigger cascades.

### Trigger: assignLandlord
- **Defined in:** `src/server/app.coffee:196-207`
- **Fires on:** `preInsert`.
- **Applies to:** `issues` without `landlordId`.
- **Logic:** scan landlords + addresses; if postcode/address match found, set `args.obj.landlordId`.
- **DB side effects:** none direct (mutates pre-insert object).
- **External side effects:** none.
- **Realtime side effects:** none.
- **Notes:** Full scan behavior.

### Trigger: decorate
- **Defined in:** `src/server/services/decorator.coffee:131-142`
- **Fires on:** `preInsert`, `preUpdate`.
- **Applies to:** all tables; special-cases users/issues/contractors but always `cb true`.
- **Logic:** currently no-op pass-through.
- **DB side effects:** none.
- **External side effects:** none.
- **Realtime side effects:** none.
- **Notes:** registered in `setImmediate`, so relative ordering vs app triggers is not explicit.

### Trigger: ready (Fixflo bootstrap)
- **Defined in:** `src/server/services/fixflo.coffee:4-62`
- **Fires on:** `ready` database event.
- **Applies to:** database initialization lifecycle.
- **Logic:** start polling every 5 minutes; fetch recent Fixflo issues; upsert unseen items.
- **DB side effects:** issue upserts keyed by `fixfloId`.
- **External side effects:** repeated external API calls using `FIXFLO_KEY`.
- **Realtime side effects:** indirect via issue insert/update hooks.
- **Notes:** Import loop adds 200ms delay between calls.

## 6) ndx-rest realtime/websocket contract
### 6.1 Websocket setup
- Where websocket server is created/attached
  - Explicit creation code is not present in `/src/server`; it is likely inside `ndx-server`/`ndx-socket` internals. **Unknown from in-scope code.**

- How ndx-rest is initialized and connected to db
  - Explicit initialization is not shown in `/src/server`.
  - Observable hooks:
    - `ndx.rest.permissions.set(...)` in `src/server/services/permissions.coffee:76-81`
    - `ndx.rest.selectTransform` + `ndx.rest.transforms` in `src/server/services/transforms.coffee:4-93`
  - Binding details are package-internal: **Unknown**.

- Namespaces/paths if defined
  - **Unknown** in `/src/server`.

### 6.2 Event inventory (frontend notifications)
Provide a table:

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| `newIssue` | DB insert on `issues` via `sendSockets` trigger; manual `/api/emit` route | Entire issue object (`args.obj` or selected issue) | Broadcast to all (`emitToAll`) | `src/server/app.coffee:124-127`, `222-225` |
| `newMessage` | `/api/mailin` after issue message append | `{address, subject, from}` | Broadcast to all (`emitToAll`) | `src/server/app.coffee:471-474` |
| ndx-rest data-change events | Likely DB CRUD replication | Unknown | Unknown | Not visible in `/src/server` (package internals) |

### 6.3 Subscriptions & scoping model
- How clients subscribe (rooms/topics/collection-level)
  - Explicit subscription API is not shown in `/src/server`. **Unknown**.
- Per-user/per-case scoping rules (if any)
  - Explicit socket broadcasts shown are global (`emitToAll`), so no per-user/per-case scoping in custom events.
  - `ndx.rest.selectTransform` currently returns `transforms.all` only when `all` is true, else null (`services/transforms.coffee:4-8`).
- Any dedupe/throttle behavior (if any)
  - No dedupe/throttle logic in explicit socket emits.
  - `fixflo` polling runs every 5 minutes with simple existence check by `fixfloUrl` and upsert by `fixfloId`.

## 7) Cross-cutting domain flows (API + DB + realtime)
Pick the **top 5–10** most important workflows you can infer from code (e.g., “create matter”, “update milestone”, “upload doc metadata”, etc.). For each:

### Flow: Issue insert/normalize pipeline
1. API entrypoint(s): likely ndx-rest/auto CRUD insert for `issues` (**route not visible in `/src/server`**).
2. DB operations: issue insert.
3. Triggers fired: `assignAddressAndNames` (preInsert), `sendMessages` (preInsert conditional), `assignLandlord` (preInsert), `updateStatus` (insert), `sendSockets` (insert), `assignProperties` (insert), `decorate` (preInsert).
4. Realtime events emitted: explicit `newIssue` on insert.
5. Resulting state changes: denormalized address/search/tenant/contractor fields and landlord linkage may be set.

### Flow: Task assignment updates issue metadata
1. API entrypoint(s): likely ndx-rest task create/update endpoint (**Unknown path**).
2. DB operations: task insert/update; linked issue upsert.
3. Triggers fired: `assignAddressAndNames`, `updateStatus`, possibly `checkDeleted`, plus issue-side trigger chain from upsert.
4. Realtime events emitted: possible `newIssue` if issue insert path occurs.
5. Resulting state changes: contractor name and booking status propagated to issue; assignment note appended.

### Flow: Contractor chase communication
1. API entrypoint(s): `GET /api/chase/:method/:taskId`.
2. DB operations: read template/task/issue/contractor; issue upsert with new note.
3. Triggers fired: issue upsert trigger set.
4. Realtime events emitted: no explicit route emit.
5. Resulting state changes: outbound email/SMS sent, issue note records chase action.

### Flow: Tenant informed communication
1. API entrypoint(s): `GET /api/inform/:method/:taskId`.
2. DB operations: read template/task/issue/contractor; issue upsert with note.
3. Triggers fired: issue upsert trigger set.
4. Realtime events emitted: no explicit route emit.
5. Resulting state changes: tenant contacted and issue note appended.

### Flow: Completion transition
1. API entrypoint(s): `GET /api/complete/:issueId`.
2. DB operations: issue update (`statusName=Completed`) + reads of issue/template/contractor.
3. Triggers fired: issue `preUpdate`/`update` listeners including `sendMessages` (status transition branch).
4. Realtime events emitted: none explicit.
5. Resulting state changes: completion status persisted, tenant completion notifications attempted.

### Flow: Restore soft-deleted issue
1. API entrypoint(s): `GET /api/restore/:issueId`.
2. DB operations: load issue, update related tasks to deleted, upsert issue cleared fields.
3. Triggers fired: task update listeners; issue upsert listeners.
4. Realtime events emitted: no explicit route emit.
5. Resulting state changes: issue marked active/reported, cfp job removed, restore note added.

### Flow: Inbound email webhook to message thread
1. API entrypoint(s): `ALL /api/mailin`.
2. DB operations: parse issue token; load issue; append inbound message and attachments; increment `newMessages`; update issue.
3. Triggers fired: issue update listeners.
4. Realtime events emitted: explicit `newMessage` broadcast.
5. Resulting state changes: issue conversation and document list grows.

### Flow: Outbound message-center email
1. API entrypoint(s): `POST /api/message-center/send`.
2. DB operations: read `MessageCenter` template, then update issue with outbound message metadata in callback.
3. Triggers fired: issue update listeners (when callback update executes).
4. Realtime events emitted: none explicit.
5. Resulting state changes: external email sent and outbound message persisted to issue thread.

### Flow: Background Fixflo ingestion
1. API entrypoint(s): DB `ready` lifecycle (not HTTP).
2. DB operations: periodic `issues` lookup/upsert by Fixflo URLs/IDs.
3. Triggers fired: issue insert/update trigger chain.
4. Realtime events emitted: indirect `newIssue` possible on inserted issues.
5. Resulting state changes: newly created external Fixflo items become local issues.

## 8) Integration points visible in `/src/server`
Only include what is actually used by `/src/server`.
- Other internal services called (HTTP/RPC)
  - Fixflo API (HTTP via `superagent`): purpose = ingest issues and fetch PDF reports | configured via `FIXFLO_ISSUES_URL`, `FIXFLO_KEY` | invoked in `services/fixflo.coffee` and `/api/fixflo/pdf/:fixfloId` | failure handling = promise rejection/implicit errors; no global retries beyond periodic poll loop.

- Email sending (`ndx-email` usage)
  - `ndx.email.send` template-based send used in status/chase/inform/complete flows (`app.coffee:79-94`, route blocks).
  - Direct Mailgun API (`mailgun.messages().send`) used in `/api/message-center/send`.
  - Invite/forgot templates fetched from `emailtemplates` (`services/invite-forgot.coffee`).

- Webhooks in/out (if present)
  - Inbound webhook: `/api/mailin` parses Mailgun-style payload.
  - Outbound reporting webhook: `ndx.reporter.log` posts to `REPORT_URL` (`services/reporter.coffee`).

- File/document generation (if present)
  - Attachment ingestion via `ndx.fileUpload.saveFile` in `/api/mailin`.
  - File encryption/compression helper in `services/file-tools.coffee` (`saveFile`, `getReadStream`, `moveToAttachments`) exposed as `ndx.fileTools`; no direct route in `/src/server` calls these helpers.

For each integration: purpose | where configured | where invoked | failure handling (if visible)
- Fixflo: external maintenance source and report retrieval | env vars | `services/fixflo.coffee`, `app.coffee:379-384` | errors reject promise; not centrally handled.
- ndx email/SMS: status and chase notifications | templates in DB + ndx plugins | triggers + `/api/chase*`, `/api/inform`, `/api/complete` | no explicit retries; fire-and-forget style.
- Mailgun direct: message-center outbound email | `EMAIL_API_KEY`, `mg.vitalspace.co.uk` | `/api/message-center/send` | callback stores error on message record.
- REPORT_URL logging: operational logging | `REPORT_URL` | `ndx.reporter.log` call sites | exceptions swallowed.
- File upload persistence: store inbound attachments | ndx-file-upload plugin | `/api/mailin` | logs errors; continues flow.

## 9) Unknowns & follow-ups (actionable)
- Exact auto-generated ndx-rest HTTP CRUD endpoints are **Unknown** in this repo snapshot (only custom routes are explicit). Looked at: all files under `src/server`; no explicit REST route registration for table CRUD.
- Exact websocket namespace/path/auth handshake for `ndx-rest`/`ndx-socket` is **Unknown** from in-scope code. Looked at: `src/server/app.coffee`, `services/transforms.coffee`, `services/permissions.coffee`.
- Trigger execution order across modules (especially `decorate` registered in `setImmediate`) is partially implicit. Looked at: trigger registration points in `app.coffee` and `services/decorator.coffee`.
- Schema/index/uniqueness constraints for collections are **Unknown**; no model definitions found in `/src/server`.
- `shorttoken` and `messages` table usage in custom code is minimal/absent; behavior likely package-driven. Looked at: all `/src/server` files and search for direct operations.
- To confirm hidden runtime behavior, next files to inspect are package internals for installed versions:
  - `node_modules/ndx-server/*`
  - `node_modules/ndx-rest/*`
  - `node_modules/ndx-database/*`
  - (not available in current workspace because dependencies are not installed).
