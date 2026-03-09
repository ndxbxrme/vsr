# API XRAY — vs-dezrez

## 1) Quick orientation
- Purpose of this service (1–2 paragraphs, based on evidence)

This service is an `ndx-server` app that acts as an API/cache bridge between internal consumers and Dezrez APIs. It exposes HTTP endpoints for role/property/offer/viewing/event lookups, stores selected results in an in-memory `ndxdb` database with local persistence, and supports refresh/webhook-driven synchronization flows. Evidence: `server/app.js`, `server/controllers/dezrez.js`, `server/controllers/webhook.js`, `server/services/dezres.js`.

At startup, `ndx-server` auto-loads both local `/server/services` and `/server/controllers`, plus installed `ndx-*` packages from `node_modules`. In this repo, that adds auth, CORS, database backup, superadmin bootstrap, and DB exec endpoints to the API surface in addition to the local Dezrez/webhook endpoints. Evidence: `node_modules/ndx-server/build/index.js:180-233`, `package.json` dependencies.

- Key entrypoints (file paths)
  - `server/app.js`
  - `server/controllers/dezrez.js`
  - `server/controllers/webhook.js`
  - `server/services/dezres.js`
  - `node_modules/ndx-server/build/index.js` (autoload/runtime wiring)

- Key ndx-server plugins/packages used (bullet list)
  - `ndx-server` (framework/bootstrap, Express wiring, module autoload)
  - `ndxdb` (in-memory DB engine used as `ndx.database`)
  - `ndx-auth` (token issue/refresh + CORS token endpoints)
  - `ndx-user-roles` (role-based authorize middleware)
  - `ndx-cors` (CORS headers middleware)
  - `ndx-connect` (superadmin SQL exec endpoint)
  - `ndx-database-backup` (backup list/restore endpoints + scheduled backup)
  - `ndx-superadmin` (ensures default superadmin user exists)
  - `ndx-permissions` (installed/transitive; no direct route wiring found in this service code)

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)

`server/app.js` starts the service:

```js
require('ndx-server').config({
  database: 'db',
  tables: ['users','properties','postdata','role','offers','events','viewings','viewingsbasic','property','propertyowners','searches'],
  localStorage: './data',
}).start();
```

`ndx-server` then:
1. Creates `ndx.database` from `settings.DB_ENGINE` (here: `ndxdb`) (`node_modules/ndx-server/build/index.js:93-95`).
2. Creates Express app/server (`:108`, `:171`).
3. Auto-loads `ndx-*` packages and local `server/services/**/*.js` + `server/controllers/**/*.js` (`:180-233`).

- Middleware pipeline (in order, if determinable)

From `node_modules/ndx-server/build/index.js` and loaded modules:
1. `compression()` and `helmet()` (`:114`)
2. request logging (`morgan`) unless disabled (`:115-127`)
3. maintenance middleware (`:129-131`)
4. session middleware + memory store (`:131-139`)
5. `cookieParser` (`:139`)
6. JSON body parser (or encryption-aware parser path) (`:140-170`)
7. token controller middleware:
- `/*` host/server-id middleware (`node_modules/ndx-server/build/controllers/token.js:81-89`)
- `/api/*` auth-token parsing + unauthorized enforcement (`:90-172`)
8. `ndx-cors` middleware on `/:var(api|auth)?` (`node_modules/ndx-cors/build/index.js:4-13`)
9. `ndx-user-roles` middleware on `/api/*` extending user object (`node_modules/ndx-user-roles/build/app.js:81-84`)
10. local and plugin routes
11. final error handler (`node_modules/ndx-server/build/index.js:247-261`)

- Router mounting points / base paths
  - Root-mounted local routes (e.g. `/role/:id`, `/webhook`, `/refresh`, etc.)
  - `/auth/*` for auth token endpoints
  - `/api/*` for protected admin/maintenance endpoints from plugins

- Error handling approach (if present)
  - Global Express error middleware sends `err.message` or `err.toString()` with status `err.status || 500` (`node_modules/ndx-server/build/index.js:248-260`).
  - Several local handlers swallow errors in `catch` blocks and return fallback JSON (e.g. empty array/object) (`server/controllers/dezrez.js`).

## 3) HTTP API surface
Provide a table for **all** endpoints discovered.

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| POST | `/token` | `server/controllers/dezrez.js:(anonymous)` | none used | `200 { accessToken: 1234 }` | none |
| GET | `/role/:id/offers` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | cached `offers.body` or Dezrez response, else `[]` | DB `selectOne/upsert` on `offers`; outbound Dezrez GET |
| GET | `/role/:id/viewings` | same pattern | `params.id` | cached body or Dezrez response, else `[]` | DB `viewings` read/upsert; outbound Dezrez GET |
| GET | `/role/:id/viewingsbasic` | same pattern | `params.id` | cached body or Dezrez response, else `[]` | DB `viewingsbasic` read/upsert; outbound Dezrez GET |
| GET | `/role/:id/events` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | `events.Collection` or `[]` | outbound Dezrez GET |
| GET | `/role/:id` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | cached role or Dezrez role, else `{}` | DB `role` read/upsert; outbound Dezrez GET |
| GET | `/property/:id/owners` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | cached owners body or Dezrez owners, else `{}` | DB `propertyowners` read/upsert; outbound Dezrez GET |
| GET | `/property/:id` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | cached property or Dezrez property, else `{}` | DB `property` read/upsert; outbound Dezrez GET |
| POST | `/simplepropertyrole/search` | `server/controllers/dezrez.js:(anonymous)` | none used | synthetic `{Collection,CurrentCount,PageSize}` from `searches._id=1`; else `res.end(200)` | DB read `searches` |
| GET | `/simplepropertyrole/:id` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | matching search property or `res.end(200)` | DB read `searches` |
| GET | `/stats/rightmove/:id` | `server/controllers/dezrez.js:(anonymous)` | `params.id` | Dezrez response JSON | outbound Dezrez GET |
| GET | `/people/findbyemail` | `server/controllers/dezrez.js:(anonymous)` | `query.emailAddress` | Dezrez response JSON | outbound Dezrez GET |
| GET | `/people/:id/:status` | `server/controllers/dezrez.js:(anonymous)` | `params.id`, `params.status` | Dezrez response JSON | outbound Dezrez GET |
| GET | `/prop` | `server/controllers/dezrez.js:(anonymous)` | none | array from `fetchProperty` | outbound Dezrez POST search |
| POST | `/refresh` | `server/controllers/webhook.js:(anonymous)` | none | `'ok'` | refreshes `searches`; enqueues property/offer/viewing sync jobs |
| POST | `/refresh/:id` | `server/controllers/webhook.js:(anonymous)` | `params.id` | `'ok'` or `'bad id'` | enqueues targeted sync jobs |
| POST | `/refresh-searches` | `server/controllers/webhook.js:(anonymous)` | none | `'ok'` | updates `searches`; may POST to `VS_PROPERTY_WEBHOOK` |
| GET | `/status` | `server/controllers/webhook.js:(anonymous)` | none | health/state JSON (`bootingUp`, `changeList`, counters) | none |
| POST | `/webhook` | `server/controllers/webhook.js:(anonymous)` | event body (`PropertyId`,`PropertyRoleId`,`RootEntityId`,`EventName`) | `'ok'` | enqueues change; POSTs raw event to `http://92.236.199.184:4220/event` |
| POST | `/auth/token` | `node_modules/ndx-auth/build/app.js:(anonymous)` | Basic auth header | `{accessToken,refreshToken,expires}` or error | DB select on `users` |
| POST | `/auth/refresh` | `node_modules/ndx-auth/build/app.js:(anonymous)` | body `refreshToken` or `token` | new access+refresh tokens | token parse only |
| POST | `/api/generate_cors_token` | `node_modules/ndx-auth/build/app.js:(anonymous)` | body `name`,`hours` | `{ token }` | requires superadmin; inserts user row |
| POST | `/api/revoke_cors_token` | `node_modules/ndx-auth/build/app.js:(anonymous)` | body `name` or `id` or `token` | `'OK'` | requires superadmin; deletes user row(s) |
| POST | `/api/database/exec` | `node_modules/ndx-connect/build/app.js:(anonymous)` | body `sql`,`props`,`notCritical` | DB exec output JSON | requires superadmin; arbitrary DB mutation/query |
| GET | `/api/backup/list` | `node_modules/ndx-database-backup/build/app.js:(anonymous)` | none | list of backup file paths | requires superadmin |
| POST | `/api/backup/restore` | `node_modules/ndx-database-backup/build/app.js:(anonymous)` | body `fileName` | `'OK'` or throw | requires superadmin; restores DB from file |

### POST /token
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** local stub token endpoint.
- **Request:** no fields used.
- **Response:** `200 { accessToken: 1234 }`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** not tied to ndx auth tokens.

### GET /role/:id/offers
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch/cached role offers.
- **Request:** `params.id`.
- **Response:** `200` with cached `offers.body` or Dezrez payload; fallback `[]`.
- **DB touches:** `offers` `selectOne`; conditional `upsert`.
- **Triggers involved:** ndxdb `preInsert/insert` or `preUpdate/update` depending `upsert` branch.
- **Realtime effects:** no explicit websocket emit.
- **Notes:** error in Dezrez call is swallowed.

### GET /role/:id/viewings
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch/cached role viewings.
- **Request:** `params.id`.
- **Response:** cached `body` or Dezrez payload; fallback `[]`.
- **DB touches:** `viewings` `selectOne/upsert`.
- **Triggers involved:** ndxdb insert/update lifecycle triggers may fire.
- **Realtime effects:** none explicit.
- **Notes:** same cache-then-fetch pattern.

### GET /role/:id/viewingsbasic
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch/cached basic viewing data.
- **Request:** `params.id`.
- **Response:** cached `body` or Dezrez payload; fallback `[]`.
- **DB touches:** `viewingsbasic` `selectOne/upsert`.
- **Triggers involved:** ndxdb insert/update lifecycle triggers may fire.
- **Realtime effects:** none explicit.
- **Notes:** same shared loop logic as offers/viewings.

### GET /role/:id/events
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch role event history from Dezrez.
- **Request:** `params.id`.
- **Response:** `events.Collection` or `[]`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** does not cache into `events` table.

### GET /role/:id
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch/cached role details.
- **Request:** `params.id`.
- **Response:** role object or `{}`.
- **DB touches:** `role` `selectOne/upsert`.
- **Triggers involved:** ndxdb insert/update lifecycle triggers may fire.
- **Realtime effects:** none explicit.
- **Notes:** on cache miss, handler sets `_id = +id` before upsert.

### GET /property/:id/owners
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch/cached property owners.
- **Request:** `params.id`.
- **Response:** cached `owners.body`, or fresh owners object, else `{}`.
- **DB touches:** `propertyowners` `selectOne/upsert`.
- **Triggers involved:** ndxdb insert/update lifecycle triggers may fire.
- **Realtime effects:** none explicit.
- **Notes:** passes `req.params.id` as `params` to templated route; still intended as `property/{id}/owners`.

### GET /property/:id
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch/cached property details.
- **Request:** `params.id`.
- **Response:** property object or `{}`.
- **DB touches:** `property` `selectOne/upsert`.
- **Triggers involved:** ndxdb insert/update lifecycle triggers may fire.
- **Realtime effects:** none explicit.
- **Notes:** on miss sets `_id = +id` before upsert.

### POST /simplepropertyrole/search
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** return locally cached search results in Dezrez-like shape.
- **Request:** none used.
- **Response:** `Collection` wrapper or `res.end(200)` when missing search row.
- **DB touches:** `searches` `selectOne`.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** uses fixed `_id:1` singleton record.

### GET /simplepropertyrole/:id
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** return one property from cached search list by `RoleId`.
- **Request:** `params.id`.
- **Response:** property object or `res.end(200)`.
- **DB touches:** `searches` read.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** linear scan on `search.properties`.

### GET /stats/rightmove/:id
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** proxy Dezrez stats endpoint.
- **Request:** `params.id`.
- **Response:** Dezrez JSON.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** direct passthrough.

### GET /people/findbyemail
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** proxy people lookup by email.
- **Request:** query `emailAddress`.
- **Response:** Dezrez JSON.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** query param remapped to Dezrez `emailAddress`.

### GET /people/:id/:status
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** proxy status-specific people endpoint.
- **Request:** `params.id`, `params.status`.
- **Response:** Dezrez JSON.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** `status` is path-composed dynamically.

### GET /prop
- **Handler:** `server/controllers/dezrez.js:(anonymous)`
- **Purpose:** fetch one-page property search result for diagnostics/testing.
- **Request:** none.
- **Response:** array from `fetchProperty`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** `fetchProperty` uses PageSize `1`.

### POST /refresh
- **Handler:** `server/controllers/webhook.js:(anonymous)`
- **Purpose:** force full refresh queue build.
- **Request:** none.
- **Response:** `'ok'`.
- **DB touches:** `searches` upsert via `updateSearch`; later async worker upserts `role`,`property`,`propertyowners`,`offers`,`viewings`,`viewingsbasic`.
- **Triggers involved:** `ready` listener already running worker loop; DB upserts trigger ndxdb insert/update events internally.
- **Realtime effects:** no websocket; external HTTP POSTs may happen (`VS_PROPERTY_WEBHOOK`, `VS_APP_WEBHOOK`).
- **Notes:** sync processing is deferred through `changeList` queue.

### POST /refresh/:id
- **Handler:** `server/controllers/webhook.js:(anonymous)`
- **Purpose:** enqueue targeted role refresh.
- **Request:** numeric `params.id`.
- **Response:** `'ok'` or `'bad id'`.
- **DB touches:** indirect async upserts by poller.
- **Triggers involved:** ndxdb lifecycle events during upsert.
- **Realtime effects:** none websocket.
- **Notes:** immediate response before refresh work completes.

### POST /refresh-searches
- **Handler:** `server/controllers/webhook.js:(anonymous)`
- **Purpose:** refresh cached search list only.
- **Request:** none.
- **Response:** `'ok'`.
- **DB touches:** `searches` upsert.
- **Triggers involved:** ndxdb insert/update lifecycle events may fire.
- **Realtime effects:** no websocket; may POST `VS_PROPERTY_WEBHOOK` when not booting.
- **Notes:** does not enqueue per-role sync by itself.

### GET /status
- **Handler:** `server/controllers/webhook.js:(anonymous)`
- **Purpose:** expose internal sync counters and queue state.
- **Request:** none.
- **Response:** JSON with `bootingUp`, `changeList`, counts, errors.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** operational endpoint; no auth in this code.

### POST /webhook
- **Handler:** `server/controllers/webhook.js:(anonymous)`
- **Purpose:** ingest external change event and enqueue refresh work.
- **Request:** webhook event body.
- **Response:** `'ok'`.
- **DB touches:** no direct write in handler; async queue later writes.
- **Triggers involved:** queue classification via `getEventType`; ndxdb events on later upserts.
- **Realtime effects:** none websocket; forwards body via HTTP POST to `http://92.236.199.184:4220/event`.
- **Notes:** silently ignores outbound forwarding errors.

### POST /auth/token
- **Handler:** `node_modules/ndx-auth/build/app.js:(anonymous)`
- **Purpose:** issue access/refresh tokens from Basic credentials.
- **Request:** `Authorization: Basic base64(email:password)`.
- **Response:** token bundle JSON or unauthorized error.
- **DB touches:** `users` select for local credentials.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** not prefixed with `/api`; available as `/auth/token`.

### POST /auth/refresh
- **Handler:** `node_modules/ndx-auth/build/app.js:(anonymous)`
- **Purpose:** rotate tokens from refresh token.
- **Request:** `body.refreshToken` or `body.token`.
- **Response:** new token bundle or unauthorized.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** validates token prefix `REFRESH`.

### POST /api/generate_cors_token
- **Handler:** `node_modules/ndx-auth/build/app.js:(anonymous)`
- **Purpose:** create service-style token by inserting pseudo-user.
- **Request:** `body.name`, optional `body.hours`.
- **Response:** `{ token }`.
- **DB touches:** `users` insert.
- **Triggers involved:** ndxdb `preInsert/insert`.
- **Realtime effects:** none.
- **Notes:** guarded by `ndx.authenticate('superadmin')`.

### POST /api/revoke_cors_token
- **Handler:** `node_modules/ndx-auth/build/app.js:(anonymous)`
- **Purpose:** revoke generated CORS token by name/id/token.
- **Request:** one of `body.name|id|token`.
- **Response:** `'OK'`.
- **DB touches:** `users` delete.
- **Triggers involved:** ndxdb `preDelete/delete`.
- **Realtime effects:** none.
- **Notes:** also superadmin-protected.

### POST /api/database/exec
- **Handler:** `node_modules/ndx-connect/build/app.js:(anonymous)`
- **Purpose:** execute arbitrary SQL against ndxdb.
- **Request:** `body.sql`, optional JSON-string `body.props`, `body.notCritical`.
- **Response:** query/mutation output JSON.
- **DB touches:** arbitrary by SQL.
- **Triggers involved:** any relevant ndxdb pre/post events depending SQL type.
- **Realtime effects:** none explicit.
- **Notes:** highest-impact endpoint; superadmin-protected.

### GET /api/backup/list
- **Handler:** `node_modules/ndx-database-backup/build/app.js:(anonymous)`
- **Purpose:** list backup files.
- **Request:** none.
- **Response:** array of file paths.
- **DB touches:** none direct.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** superadmin-only.

### POST /api/backup/restore
- **Handler:** `node_modules/ndx-database-backup/build/app.js:(anonymous)`
- **Purpose:** restore database from a backup file.
- **Request:** `body.fileName`.
- **Response:** `'OK'` or thrown error.
- **DB touches:** invokes `ndx.database.restoreFromBackup(readStream)`.
- **Triggers involved:** ndxdb `restore` callback event.
- **Realtime effects:** none explicit.
- **Notes:** superadmin-only; no async completion acknowledgement beyond immediate response.

## 4) ndx-database model & access patterns
### 4.1 Database instance & usage
- Where the db is instantiated/accessed
  - Instantiated by `ndx-server` as `ndx.database = settings.DB_ENGINE.config(settings).setNdx(ndx).start()` (`node_modules/ndx-server/build/index.js:93-95`).
  - Configured via `server/app.js` with `database: 'db'`, explicit `tables`, and `localStorage: './data'`.
- Common access patterns (helpers/services, direct calls, etc.)
  - Direct calls from controllers: `selectOne`, `upsert`, `insert` (commented in one place), and event listener registration `on('ready', ...)`.
  - Plugin calls from `ndx-auth`, `ndx-connect`, `ndx-database-backup`, `ndx-superadmin`.
  - Upsert-heavy cache hydration pattern in local controllers.

### 4.2 Collections (or equivalent)
For each collection:

#### users
- **Shape:** auth-oriented records (`email`, `displayName`, `local.email`, `local.password`, `roles`, `_id`).
- **Relationships:** role checks for admin endpoints (`superadmin`).
- **Where used:** `ndx-auth`, `ndx-superadmin`, `ndx-server` token middleware, `ndx-user-roles`.
- **Typical operations:** select during auth, insert (cors token/superadmin bootstrap), update (role add/remove), delete (revoke token user).

#### properties
- **Shape:** Unknown (declared in table list but not directly accessed in local code).
- **Relationships:** Unknown.
- **Where used:** only table declaration in `server/app.js`.
- **Typical operations:** Unknown from inspected code.

#### postdata
- **Shape:** Unknown (intended webhook payload table).
- **Relationships:** Unknown.
- **Where used:** insert is commented out in `server/controllers/webhook.js:271`.
- **Typical operations:** currently none.

#### role
- **Shape:** Dezrez role payload plus `_id` (RoleId), may include `PropertyId`, `TenantRoleId`, `PurchasingRoleId`, `agent_ref`.
- **Relationships:** links to `property` by `PropertyId`, other related role records by role IDs.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** cache lookup/upsert; refresh worker upserts primary + related roles.

#### offers
- **Shape:** `{ _id: <RoleId>, body: <offersPayload> }`.
- **Relationships:** keyed by role ID.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** selectOne/upsert.

#### events
- **Shape:** intended `{ _id: <RoleId>, body: <eventsPayload> }`.
- **Relationships:** keyed by role ID.
- **Where used:** table declared; event refresh branch is commented out in `webhook.js`.
- **Typical operations:** effectively none active.

#### viewings
- **Shape:** `{ _id: <RoleId>, body: <viewingsPayload> }`.
- **Relationships:** keyed by role ID.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** selectOne/upsert.

#### viewingsbasic
- **Shape:** `{ _id: <RoleId>, body: <viewingsBasicPayload> }`.
- **Relationships:** keyed by role ID.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** selectOne/upsert.

#### property
- **Shape:** Dezrez property payload plus `_id` (PropertyId).
- **Relationships:** associated from role via `PropertyId`; owners in `propertyowners`.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** selectOne/upsert.

#### propertyowners
- **Shape:** `{ _id: <PropertyId>, body: <ownersPayload> }`.
- **Relationships:** keyed to `property._id`.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** selectOne/upsert.

#### searches
- **Shape:** singleton cache `{ _id: 1, properties: [ ... ] }`.
- **Relationships:** each `properties[]` entry expected to include `RoleId`.
- **Where used:** `server/controllers/dezrez.js`, `server/controllers/webhook.js`.
- **Typical operations:** selectOne/upsert; in-memory diff against old search set.

### 4.3 High-value queries / operations
- **Search cache refresh + diffing role IDs**
  - What it does: pulls latest marketing properties, stores in `searches`, computes added/removed RoleIds.
  - Where it lives: `server/controllers/webhook.js:updateSearch`.
  - Collections touched: `searches` (direct), then queue triggers writes to `role/property/propertyowners/offers/viewings/viewingsbasic`.
  - Any performance-sensitive loops or scans: diffs by `Array.filter` + `indexOf`; `search.properties.find(...)` later is linear.

- **Queued per-role hydration worker**
  - What it does: processes `changeList` queue; branches by `property|offer|viewing` and upserts related documents.
  - Where it lives: `server/controllers/webhook.js:pollForChanges`.
  - Collections touched: `role`, `property`, `propertyowners`, `offers`, `viewings`, `viewingsbasic`.
  - Any performance-sensitive loops or scans: single-item dequeue every 3s; backlog can grow if webhook volume high.

- **Lazy cache-on-read endpoints**
  - What it does: on read miss, fetch from Dezrez then upsert local cache.
  - Where it lives: `server/controllers/dezrez.js` (`/role/*`, `/property/*`).
  - Collections touched: `offers`, `viewings`, `viewingsbasic`, `role`, `property`, `propertyowners`.
  - Any performance-sensitive loops or scans: per-request remote round-trip when cache miss.

- **Arbitrary SQL execution endpoint**
  - What it does: executes caller-provided SQL/props via `ndx.database.exec`.
  - Where it lives: `node_modules/ndx-connect/build/app.js`.
  - Collections touched: arbitrary.
  - Any performance-sensitive loops or scans: depends on supplied SQL.

- **Auth user lifecycle for CORS tokens**
  - What it does: inserts/deletes synthetic users used for generated tokens.
  - Where it lives: `node_modules/ndx-auth/build/app.js`.
  - Collections touched: `users`.
  - Any performance-sensitive loops or scans: simple key-based ops.

## 5) ndx-database triggers (MUST be detailed)
Create an inventory table:

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `ready` listener (webhook sync bootstrap) | When DB signals ready | all sync-targeted collections indirectly | `server/controllers/webhook.js` | runs `updateSearch()` then starts polling loop | outbound POST to `VS_PROPERTY_WEBHOOK`; periodic queue processing |
| `ready` listener (superadmin bootstrap) | When DB signals ready | `users` | `node_modules/ndx-superadmin/build/app.js` | ensures `superadmin@admin.com` exists | inserts default superadmin user if missing |
| ndxdb `preInsert` | Before `insert`/`upsert` insert path | any | `node_modules/ndxdb/build/database.js` | executes registered pre-insert callbacks and may cancel operation | can block insert when callback returns false |
| ndxdb `insert` | After insert write path | any | `node_modules/ndxdb/build/database.js` | executes registered insert callbacks with `{id,table,obj,...}` | callback-defined side effects |
| ndxdb `preUpdate` | Before update/upsert update path | any | `node_modules/ndxdb/build/database.js` | executes registered pre-update callbacks with diff payload | can block update |
| ndxdb `update` | After update write path | any | `node_modules/ndxdb/build/database.js` | executes registered update callbacks with change set | callback-defined side effects |
| ndxdb `preDelete` | Before delete | any | `node_modules/ndxdb/build/database.js` | executes pre-delete callbacks | can block delete |
| ndxdb `delete` | After delete | any | `node_modules/ndxdb/build/database.js` | executes delete callbacks with id/table marker object | callback-defined side effects |
| ndxdb `restore` | After restoreFromBackup | all restored tables | `node_modules/ndxdb/build/database.js` | executes restore callbacks | callback-defined side effects |

Then, for each trigger:

### Trigger: ready (webhook sync bootstrap)
- **Defined in:** `server/controllers/webhook.js:(anonymous ready callback)`
- **Fires on:** DB `ready` event.
- **Applies to:** global startup lifecycle.
- **Logic:**
  1. sets `bootingUp = true`
  2. `await updateSearch()` to seed search cache
  3. starts `pollForChanges()` loop
- **DB side effects:** upserts `searches`; subsequent poll loop upserts role/property/etc.
- **External side effects:** may call `VS_PROPERTY_WEBHOOK` after boot phase.
- **Realtime side effects:** no websocket events found.
- **Notes:** this is the key sync orchestrator in local code.

### Trigger: ready (superadmin bootstrap)
- **Defined in:** `node_modules/ndx-superadmin/build/app.js:(anonymous ready callback)`
- **Fires on:** DB `ready` event.
- **Applies to:** `users`.
- **Logic:** select for `superadmin@admin.com`; insert default user if absent.
- **DB side effects:** `users` insert.
- **External side effects:** console logging.
- **Realtime side effects:** none found.
- **Notes:** password defaults to `admin` hash if auto-created.

### Trigger: ndxdb preInsert
- **Defined in:** `node_modules/ndxdb/build/database.js:761-777`
- **Fires on:** `insert` and `upsert` (insert branch).
- **Applies to:** any table.
- **Logic:** runs async callback chain `preInsert`; insert proceeds only if callback truthy.
- **DB side effects:** none directly (gate only).
- **External side effects:** callback-defined only.
- **Realtime side effects:** none in this repo.
- **Notes:** no explicit `preInsert` registrations found in `/server` or loaded ndx modules here.

### Trigger: ndxdb insert
- **Defined in:** `node_modules/ndxdb/build/database.js:417-440`
- **Fires on:** successful SQL insert path.
- **Applies to:** any table.
- **Logic:** writes row to storage and dispatches `insert` callback payload.
- **DB side effects:** persistence side-write to local storage backend.
- **External side effects:** callback-defined.
- **Realtime side effects:** none in this repo.
- **Notes:** no explicit `insert` listener registration found in this codebase.

### Trigger: ndxdb preUpdate
- **Defined in:** `node_modules/ndxdb/build/database.js:716-741`
- **Fires on:** `update` and `upsert` update branch.
- **Applies to:** any table.
- **Logic:** computes diffs, runs `preUpdate`, can cancel update.
- **DB side effects:** none directly (gate only).
- **External side effects:** callback-defined.
- **Realtime side effects:** none found.
- **Notes:** no explicit `preUpdate` registration found in this repo.

### Trigger: ndxdb update
- **Defined in:** `node_modules/ndxdb/build/database.js:462-471`
- **Fires on:** update execution completion.
- **Applies to:** any table.
- **Logic:** persists updated row and dispatches `update` callback with `changes`.
- **DB side effects:** row write + storage write.
- **External side effects:** callback-defined.
- **Realtime side effects:** none found.
- **Notes:** no explicit `update` listener registration found in this repo.

### Trigger: ndxdb preDelete
- **Defined in:** `node_modules/ndxdb/build/database.js:807-820`
- **Fires on:** delete before SQL execution.
- **Applies to:** any table.
- **Logic:** runs `preDelete` callbacks, can cancel.
- **DB side effects:** none directly.
- **External side effects:** callback-defined.
- **Realtime side effects:** none found.
- **Notes:** no explicit `preDelete` listener registration found in this repo.

### Trigger: ndxdb delete
- **Defined in:** `node_modules/ndxdb/build/database.js:397-405`
- **Fires on:** delete SQL operations.
- **Applies to:** any table.
- **Logic:** marks deleted object in storage and dispatches `delete` callback.
- **DB side effects:** storage delete-marker write.
- **External side effects:** callback-defined.
- **Realtime side effects:** none found.
- **Notes:** no explicit `delete` listener registration found in this repo.

### Trigger: ndxdb restore
- **Defined in:** `node_modules/ndxdb/build/database.js:56-65`
- **Fires on:** `restoreFromBackup` completion.
- **Applies to:** all restored tables.
- **Logic:** table data replaced from backup stream, then `restore` callbacks fired.
- **DB side effects:** full-table delete+insert during restore.
- **External side effects:** callback-defined.
- **Realtime side effects:** none found.
- **Notes:** no explicit `restore` listener registration found in this repo.

## 6) ndx-rest realtime/websocket contract
### 6.1 Websocket setup
- Where websocket server is created/attached
  - **Unknown (not found in this codebase).**
- How ndx-rest is initialized and connected to db
  - `ndx-rest` package is **not present** in `package.json` or installed modules; no initialization/import was found.
- Namespaces/paths if defined
  - **Unknown / none found.**

### 6.2 Event inventory (frontend notifications)
Provide a table:

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| **Unknown (no websocket events found)** | N/A | N/A | N/A | N/A |

### 6.3 Subscriptions & scoping model
- How clients subscribe (rooms/topics/collection-level)
  - **Unknown. No socket subscription code found in `/server` or loaded `ndx-*` packages here.**
- Per-user/per-case scoping rules (if any)
  - **Unknown.**
- Any dedupe/throttle behavior (if any)
  - No websocket dedupe/throttle found. There is queue dedupe for change processing (`changeList` dedupe by `id + type`) and throttled `updateSearch` calls in `server/controllers/webhook.js`.

## 7) Cross-cutting domain flows (API + DB + realtime)
Pick the **top 5–10** most important workflows you can infer from code (e.g., “create matter”, “update milestone”, “upload doc metadata”, etc.). For each:

### Flow: Startup sync bootstrap
1. API entrypoint(s): none (startup + DB `ready` event).
2. DB operations: upsert `searches`; later upsert role/property/owners/offers/viewings/viewingsbasic.
3. Triggers fired: `ready`; ndxdb insert/update lifecycle callbacks.
4. Realtime events emitted: none websocket found; HTTP POST to `VS_PROPERTY_WEBHOOK` when boot completes.
5. Resulting state changes: local cache initialized and polling loop active.

### Flow: External webhook -> queued hydration
1. API entrypoint(s): `POST /webhook`.
2. DB operations: indirect, via queue worker (role/property/offers/viewings upserts).
3. Triggers fired: ndxdb pre/post insert/update callbacks on affected tables.
4. Realtime events emitted: none websocket found; forwards raw event to `http://92.236.199.184:4220/event`.
5. Resulting state changes: queue grows then gets drained into cache updates.

### Flow: Manual full refresh
1. API entrypoint(s): `POST /refresh`.
2. DB operations: refreshes `searches`, then enqueues full role/property/offer/viewing updates.
3. Triggers fired: ndxdb insert/update callbacks per upsert.
4. Realtime events emitted: none websocket found; possible `VS_PROPERTY_WEBHOOK` + `VS_APP_WEBHOOK/<roleId>` during worker processing.
5. Resulting state changes: all tracked caches gradually synchronized.

### Flow: Lazy read-through role/property cache
1. API entrypoint(s): `GET /role/:id`, `GET /property/:id`, `GET /property/:id/owners`, `GET /role/:id/{offers|viewings|viewingsbasic}`.
2. DB operations: `selectOne` cache read; miss triggers `upsert`.
3. Triggers fired: ndxdb insert/update callbacks on miss path.
4. Realtime events emitted: none websocket found.
5. Resulting state changes: cache warmed per requested entity.

### Flow: Search cache API
1. API entrypoint(s): `POST /simplepropertyrole/search`, `GET /simplepropertyrole/:id`.
2. DB operations: read `searches` singleton.
3. Triggers fired: none for read path.
4. Realtime events emitted: none.
5. Resulting state changes: none; read-only responses from cache.

### Flow: Superadmin CORS token lifecycle
1. API entrypoint(s): `POST /api/generate_cors_token`, `POST /api/revoke_cors_token`.
2. DB operations: insert/delete users.
3. Triggers fired: ndxdb pre/post insert or delete callbacks.
4. Realtime events emitted: none found.
5. Resulting state changes: synthetic auth users created/removed.

### Flow: Ad-hoc DB admin execution
1. API entrypoint(s): `POST /api/database/exec`.
2. DB operations: arbitrary SQL; can affect any table.
3. Triggers fired: whichever ndxdb callbacks match SQL op type.
4. Realtime events emitted: none websocket found.
5. Resulting state changes: unrestricted by endpoint logic beyond superadmin auth.

### Flow: Backup restore
1. API entrypoint(s): `POST /api/backup/restore`.
2. DB operations: restore entire DB from backup stream.
3. Triggers fired: ndxdb `restore` event.
4. Realtime events emitted: none found.
5. Resulting state changes: table contents replaced from backup file.

## 8) Integration points visible in `/server`
Only include what is actually used by `/server`.
- Other internal services called (HTTP/RPC)
  - `process.env.VS_PROPERTY_WEBHOOK` (POST) from `updateSearch` and boot transition.
  - `process.env.VS_APP_WEBHOOK + '/' + role._id` (POST) on property-type queue processing.
  - hardcoded `http://92.236.199.184:4220/event` (POST) from `/webhook` handler.

- Email sending (ndx-email usage)
  - None found.

- Webhooks in/out (if present)
  - Inbound: `POST /webhook`.
  - Outbound: the three POST targets above.

- File/document generation (if present)
  - Backup file creation/restore via `ndx-database-backup` plugin to filesystem (`BACKUP_*.json`).

For each integration: purpose | where configured | where invoked | failure handling (if visible)
- Dezrez OAuth+API | configured in `server/services/dezres.js` (`envUrls`, `REZI_ID/REZI_SECRET`, `AGENCY_ID`) | invoked by `ndx.dezrez.get/post/fetchProperties/fetchProperty` from local controllers | Promise rejection for `get`; many caller `catch` blocks swallow errors.
- Property webhook receiver | configured by env `VS_PROPERTY_WEBHOOK` | `server/controllers/webhook.js:updateSearch`, `pollForChanges` boot transition | no retry/backoff; fire-and-forget `.end()`.
- App webhook receiver | configured by env `VS_APP_WEBHOOK` | `server/controllers/webhook.js:pollForChanges` property branch | wrapped in `try/catch` with console log on catch.
- External event forwarder | hardcoded URL in `server/controllers/webhook.js` | `/webhook` handler | errors swallowed.
- Backup filesystem | `BACKUP_DIR`, `BACKUP_INTERVAL` from env/settings in `ndx-database-backup` | interval backup + `/api/backup/*` endpoints | throws on missing file/glob error; limited handling.

## 9) Unknowns & follow-ups (actionable)
- `ndx-rest` websocket behavior is **Unknown/absent** in this repo snapshot:
  - Searched `package.json`, `package-lock.json`, `/server`, and loaded `ndx-*` modules; found no `ndx-rest` dependency or initialization.
- Websocket server creation is **Unknown**:
  - no `socket.io` usage found in this project code or loaded plugin code despite dependency presence in `ndx-server` package.
- Exact schema constraints/indexes are **Unknown**:
  - ndxdb tables are created schemaless (`CREATE TABLE <name>`). No explicit indexes/unique constraints found in `/server`.
- Auth posture for non-`/api/*` routes may be surprising:
  - token middleware enforces auth only for `/api/*`; most business endpoints here are root paths.
- Hidden behavior may exist in uninstalled/optional ndx plugins:
  - if `ndx-rest`, `ndx-socket`, or `ndx-publish` are added later, realtime contract can change substantially.
- Suggested next files/instrumentation:
  - add explicit logging around `changeList` enqueue/dequeue and external webhook call results in `server/controllers/webhook.js`.
  - instrument ndxdb lifecycle callbacks (`insert/update/delete`) in a local startup module if trigger observability is needed.
  - if realtime is expected, inspect deployment manifest for additional installed `ndx-*` modules not present in this repo lock state.
