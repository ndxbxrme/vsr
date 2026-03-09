# API XRAY — vs-property

## 1) Quick orientation
- This service is a property-facing API server built on `ndx-server` (Express wrapper). It exposes custom endpoints for property search/detail retrieval, Dezrez-backed customer/property data access, and a webhook-driven property cache refresh flow.
- The server uses an in-memory `ndx-database` with tables `users`, `props`, and `tmpprops` configured in [`src/server/app.coffee`](src/server/app.coffee). Property data is periodically rebuilt by writing to `tmpprops` then swapping into `props`.
- Key entrypoints (file paths):
  - `src/server/app.coffee`
  - `src/server/controllers/property.coffee`
  - `src/server/controllers/dezrez.coffee`
  - `src/server/controllers/env.coffee`
  - `src/server/services/property.coffee`
  - `src/server/services/dezrez.coffee`
- Key ndx-server plugins/packages used (bullet list)
  - `ndx-server`: main bootstrap/wrapper (`src/server/app.coffee`)
  - `ndx-rest`: installed dependency; likely wires REST+realtime around db (implicit via server/plugin loading)
  - `ndx-socket`: installed dependency; likely transport used by realtime plugins (no explicit use in `/src/server`)
  - `ndx-passport` (+ social providers): authentication/session events used directly via `ndx.passport.on(...)`
  - `ndx-permissions`: installed; in-code db permission rules set via `ndx.database.permissions.set`
  - `ndx-database-backup`, `ndx-file-upload`, `ndx-auth`, `ndx-user-roles`, `ndx-superadmin`, etc. are installed but not explicitly configured in `/src/server`.

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)
  - In `src/server/app.coffee`, `require('ndx-server').config(...).use(...).controller(...).start()` initializes server and starts listening.
  - Config includes:
    - `database: 'vs'`
    - `tables: ['users', 'props', 'tmpprops']`
    - `localStorage: './data'`
    - `maxSqlCacheSize: 50`
    - `publicUser` projection
    - `restTables: ['users']`
- Middleware pipeline (in order, if determinable)
  1. Startup env guard (`.use`): checks `REZI_ID`, `REZI_SECRET`, `AGENCY_ID`, `API_URL`, `API_KEY`; logs warning if missing.
  2. DB permission registration (`.use`): sets `users.select` and `users.all` permissions.
  3. Passport event listeners (`.use`): on `login` and `refreshLogin`, updates current user timestamps.
  4. Controller phase (`.controller`): mounts static icon route and (implicitly via ndx-server conventions) loads controller/service modules in `src/server/controllers` and `src/server/services`.
- Router mounting points / base paths
  - Explicit base paths are direct mounts on `ndx.app`:
    - `/api/*` (property + dezrez controllers)
    - `/webhook`, `/status` (property service)
    - `/env.js` (env controller)
    - `/wp-content/themes/VitalSpace2015/public/img/int/icons` (static)
- Error handling approach (if present)
  - No explicit centralized error middleware in `/src/server`.
  - Some handlers call `next(err)` (e.g., Dezrez proxy endpoints).
  - Some handlers `throw` objects with `{status, message}` (property controller), relying on upstream ndx/Express error handling.

## 3) HTTP API surface

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| POST | `/api/search` | `src/server/controllers/property.coffee:(anonymous route fn)` | Body filters: `MinimumPrice`, `MaximumPrice`, `MinimumBedrooms`, `MaximumBedrooms`, `MinimumRooms`, `MaximumRooms`, `IncludeStc`, `RoleType`, `RoleStatus`, `Search`, `SortBy`, `SortDir`, `PageSize`, `PageNumber` | JSON `{TotalCount, CurrentCount, PageSize, PageNumber, Collection}` | Reads `props` table via SQL-like `SELECT` |
| GET | `/api/property/:id` | `src/server/controllers/property.coffee:(anonymous route fn)` | Param `id` | JSON remote property body from upstream API, augmented with `similar` array | Reads `props`; calls external property API via `superagent` |
| POST | `/api/dezrez/update-user-props` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Auth required; body `properties` | Text `ok` | Updates `users.properties` for authenticated user |
| POST | `/api/dezrez/email` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Auth required; optional body `email` (fallback user email) | JSON from Dezrez people lookup (or `{error:'error'}`) | Calls Dezrez API; may update user `dezrez` profile |
| POST | `/api/dezrez/findbyemail` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Auth required; optional body `email` | JSON from Dezrez people lookup (or `{error:'error'}`) | Calls Dezrez API; may update user `dezrez` profile |
| POST | `/api/dezrez/update` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Auth required; body `dezrez` | Text `OK` | Updates `users.dezrez` |
| GET | `/api/dezrez/property/:id` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Auth required; param `id` | JSON body proxied from Dezrez `property/{id}` | External Dezrez GET |
| GET | `/api/dezrez/rightmove/:id` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Auth required; param `id` | JSON body proxied from Dezrez `stats/rightmove/{id}` | External Dezrez GET; console logging |
| GET | `/api/dezrez/property/:id/events` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Requires `ndx.user.dezrez`; param `id` | JSON body from Dezrez `role/{id}/Events` | External Dezrez GET |
| GET | `/api/dezrez/property/list/:type` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Requires `ndx.user.dezrez`; param `type` | JSON body from Dezrez `people/{id}/{type}` | External Dezrez GET; console logging |
| GET | `/api/dezrez/role/:type` | `src/server/controllers/dezrez.coffee:(anonymous route fn)` | Requires `ndx.user.dezrez`; param `type` | JSON array of aggregated items | Multiple Dezrez GETs (`people/{id}/selling`, then per-role `role/{id}/{type}`) |
| GET | `/env.js` | `src/server/controllers/env.coffee:(anonymous route fn)` | None | JS payload defining Angular constant `env` | Emits runtime env values in JS |
| POST | `/webhook` | `src/server/services/property.coffee:(anonymous route fn)` | No explicit auth/check | Text `ok` | Fetches/refreshes property cache tables; POSTs two outbound webhooks |
| GET | `/status` | `src/server/services/property.coffee:(anonymous route fn)` | None | JSON `{webhookCalls, debugInfo}` | Reads in-memory counters/state |

### POST /api/search
- **Handler:** `src/server/controllers/property.coffee:(route callback)`
- **Purpose:** Query cached property records in `props` with filters/sort/paging.
- **Request:** Optional body fields listed in table; SQL where clause is assembled dynamically.
- **Response:** `200` JSON with counts and `Collection` array.
- **DB touches:** `props` `SELECT` (total and paged).
- **Triggers involved:** No explicit trigger in `/src/server`.
- **Realtime effects:** None explicit.
- **Notes:** `Search` uses interpolated `LIKE` string with only single-quote stripping; `skip` offset starts at `+1`.

### GET /api/property/:id
- **Handler:** `src/server/controllers/property.coffee:(route callback)`
- **Purpose:** Return detailed property info from upstream API, enriched with locally computed `similar` listings.
- **Request:** `:id` role/property id.
- **Response:** Remote response body (augmented with `similar` when available). Throws `{status:200,message:'no property found'}` or `{status:200,message:'no id'}` in missing cases.
- **DB touches:** `props` lookup by `RoleId`; similarity query by bedrooms/type/status.
- **Triggers involved:** None explicit.
- **Realtime effects:** None explicit.
- **Notes:** Similar list excludes status `InstructionToSell` and limits to 4.

### POST /api/dezrez/update-user-props
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Store authenticated user property list.
- **Request:** Body `properties`; requires `ndx.authenticate()`.
- **Response:** `200` text `ok`.
- **DB touches:** `users` update.
- **Triggers involved:** Potential internal ndx-rest/db hooks on `users` update (not defined in `/src/server`).
- **Realtime effects:** Unknown; likely user-table realtime due to `restTables: ['users']`.
- **Notes:** Uses `ndx.user._id` from session context.

### POST /api/dezrez/email
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Find Dezrez person record by email and bind to user when unique hit.
- **Request:** Optional body `email`, else `ndx.user.local.email` or `ndx.user.facebook.email`.
- **Response:** Dezrez lookup result array or `{error:'error'}`.
- **DB touches:** May update `users.dezrez` via `UPDATE ... SET dezrez=? WHERE _id=?`.
- **Triggers involved:** Potential internal ndx-rest/db hooks on `users` update (unknown details).
- **Realtime effects:** Unknown.
- **Notes:** Functionally same lookup pattern as `/api/dezrez/findbyemail`.

### POST /api/dezrez/findbyemail
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Same lookup workflow as `/api/dezrez/email`.
- **Request:** Same as above.
- **Response:** Same as above.
- **DB touches:** Same as above.
- **Triggers involved:** Same as above.
- **Realtime effects:** Unknown.
- **Notes:** Appears duplicate endpoint.

### POST /api/dezrez/update
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Persist arbitrary Dezrez payload onto authenticated user.
- **Request:** Body `dezrez`; auth required.
- **Response:** `200` text `OK`.
- **DB touches:** Direct SQL `UPDATE users SET dezrez=? WHERE _id=?`.
- **Triggers involved:** Potential internal ndx-rest/db hooks on `users` update (unknown details).
- **Realtime effects:** Unknown.
- **Notes:** No schema validation in handler.

### GET /api/dezrez/property/:id
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Proxy Dezrez property read.
- **Request:** Param `id`; auth required.
- **Response:** JSON Dezrez body or delegated error via `next(err)`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Uses `ndx.dezrez.get` service wrapper.

### GET /api/dezrez/rightmove/:id
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Proxy Dezrez rightmove stats.
- **Request:** Param `id`; auth required.
- **Response:** JSON Dezrez body or `next(err)`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Logs response/errors to console.

### GET /api/dezrez/property/:id/events
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Read role events from Dezrez.
- **Request:** Param `id`; requires `ndx.authorizeDezrez` (`ndx.user.dezrez` present).
- **Response:** JSON Dezrez body or `next(err)`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Sends `pageSize:2000` query.

### GET /api/dezrez/property/list/:type
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Fetch typed people-linked property lists from Dezrez.
- **Request:** Param `type`; requires `ndx.user.dezrez.Id`.
- **Response:** JSON Dezrez body.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** `type` is directly concatenated into upstream route.

### GET /api/dezrez/role/:type
- **Handler:** `src/server/controllers/dezrez.coffee:(route callback)`
- **Purpose:** Aggregate role subresources across all user selling roles.
- **Request:** Param `type`; requires `ndx.user.dezrez.Id`.
- **Response:** JSON aggregated array `items`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** N+1 style external calls; dedupes role ids in-memory.

### GET /env.js
- **Handler:** `src/server/controllers/env.coffee:(route callback)`
- **Purpose:** Serve runtime config JS snippet.
- **Request:** None.
- **Response:** JavaScript text containing env constants.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Not an API JSON endpoint but part of server HTTP surface.

### POST /webhook
- **Handler:** `src/server/services/property.coffee:(route callback)`
- **Purpose:** Trigger property cache refresh from upstream search API.
- **Request:** No validated payload.
- **Response:** `200` text `ok` immediately after scheduling async refresh chain.
- **DB touches:** Bulk insert into `tmpprops`, then replace `props` data, clear `tmpprops`.
- **Triggers involved:** No explicit local triggers; possible internal table-change hooks.
- **Realtime effects:** Unknown.
- **Notes:** Also POSTs to `VS_AGENCY_WEBHOOK` and `VS_LETTINGS_WEBHOOK` on successful refresh promise.

### GET /status
- **Handler:** `src/server/services/property.coffee:(route callback)`
- **Purpose:** Operational status for webhook pipeline.
- **Request:** None.
- **Response:** JSON with counter and debug object.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None.
- **Notes:** Exposes latest fetch diagnostic data.

## 4) ndx-database model & access patterns

### 4.1 Database instance & usage
- Where the db is instantiated/accessed
  - Instantiated by ndx-server config in `src/server/app.coffee` (`database: 'vs'`, table list).
  - Accessed through `ndx.database` in controllers/services.
- Common access patterns (helpers/services, direct calls, etc.)
  - SQL-like calls: `ndx.database.exec('SELECT ...', params)` and `ndx.database.exec('UPDATE ...', params)`.
  - High-level update helper: `ndx.database.update('users', patch, where)`.
  - Direct table object access for swap logic: `ndx.database.getDb()` then mutate `tables.props.data` / `tables.tmpprops.data`.

### 4.2 Collections (or equivalent)

#### users
- **Shape:** Known fields used in code: `_id`, `local`, `facebook`, `dezrez`, `roles`, `lastLogin`, `lastRefresh`, `properties`.
- **Relationships:** `users.dezrez.Id` links to upstream Dezrez person id.
- **Where used:** `src/server/app.coffee`, `src/server/controllers/dezrez.coffee`.
- **Typical operations:** update timestamps, update Dezrez payload, update user properties, permission-filtered select/all.

#### props
- **Shape:** Cached external property object with fields observed in code: `RoleId`, `RoleType.SystemName`, `RoleStatus.SystemName`, `RoomCountsDescription.*`, `PropertyType.SystemName`, `Price.PriceValue`, `Address.*`, derived `stc`, `NoRooms`, `SearchField`, `displayAddress`.
- **Relationships:** None explicit; `RoleId` used as unique lookup key in API handler.
- **Where used:** `src/server/controllers/property.coffee`, `src/server/services/property.coffee`.
- **Typical operations:** filtered reads (`SELECT`), full table replacement from `tmpprops`.

#### tmpprops
- **Shape:** Same as `props` records during refresh staging.
- **Relationships:** Staging source for `props` replacement.
- **Where used:** `src/server/services/property.coffee`.
- **Typical operations:** repeated bulk inserts (`INSERT INTO tmpprops VALUES ?`), then reset to empty array.

### 4.3 High-value queries / operations
- Property search with dynamic filters/sort/paging
  - Lives in `src/server/controllers/property.coffee`
  - Touches `props`
  - Uses dynamic SQL string composition and two-pass query (count + paged fetch)
- Property detail lookup plus similar-properties query
  - Lives in `src/server/controllers/property.coffee`
  - Touches `props`
  - Performs primary lookup by `RoleId` then similarity query with LIMIT 4
- User Dezrez/profile updates
  - Lives in `src/server/controllers/dezrez.coffee` and passport listeners in `src/server/app.coffee`
  - Touches `users`
  - Uses both helper update and SQL update
- Property cache rebuild pipeline
  - Lives in `src/server/services/property.coffee`
  - Touches `tmpprops`, `props`
  - Inserts every remote page row into staging then swaps full table (`props = tmpprops`) and clears staging
- Potential performance-sensitive loops/scans
  - `/api/search` full `SELECT *` for total before paged read
  - `/api/dezrez/role/:type` loops roles then per-role external API calls (N+1 remote requests)
  - `fetchProperties` paginates remote API until `CurrentCount < PageSize`

## 5) ndx-database triggers (MUST be detailed)

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `users.select` permission hook | On `select` access checks for `users` | `users` | `src/server/app.coffee` (`ndx.database.permissions.set`) | For non-admin callback path, filters result set to current user only | Mutates `args.objs` array in-place before permission callback |
| `users.all` permission hook | On non-select `all` permission checks for `users` | `users` | `src/server/app.coffee` (`ndx.database.permissions.set`) | Allows if role is admin/superadmin, or if `args.where._id === args.user._id` | Access control decision only |
| `passport:login` listener | On passport `login` event | `users` | `src/server/app.coffee` (`ndx.passport.on('login')`) | Updates `lastLogin` for logged-in user | DB write to `users` |
| `passport:refreshLogin` listener | On passport `refreshLogin` event | `users` | `src/server/app.coffee` (`ndx.passport.on('refreshLogin')`) | Updates `lastRefresh` for user | DB write to `users` |
| Internal ndx-database change triggers | Unknown (inside ndx packages) | Likely `users` (from `restTables`) | Unknown in `/src/server` | Likely used by `ndx-rest` to detect db mutations | Likely websocket notifications; not explicit in repo code under scope |

### Trigger: users.select permission hook
- **Defined in:** `src/server/app.coffee:(permissions config callback)`
- **Fires on:** permission evaluation for `select` on `users`.
- **Applies to:** `users` reads when callback branch executes.
- **Logic:** iterates `args.objs` backward; removes any object whose `_id` is not current user `_id`; then `cb true`.
- **DB side effects:** None direct.
- **External side effects:** None.
- **Realtime side effects:** None explicit.
- **Notes:** This is an authorization/data-filter hook, not a data mutation trigger.

### Trigger: users.all permission hook
- **Defined in:** `src/server/app.coffee:(permissions config callback)`
- **Fires on:** permission evaluation for `all` actions on `users`.
- **Applies to:** `users` action checks with `args.user` and optional `args.where`.
- **Logic:** if user+where present, only allow own `_id`; admin roles can bypass via role list.
- **DB side effects:** None direct.
- **External side effects:** None.
- **Realtime side effects:** None explicit.
- **Notes:** Callback has mixed return styles (`cb(...)` and bare `return true`), behavior of bare return depends on ndx permission engine internals.

### Trigger: passport:login listener
- **Defined in:** `src/server/app.coffee:(login event handler)`
- **Fires on:** passport login event.
- **Applies to:** authenticated user row in `users`.
- **Logic:** `ndx.database.update('users', {lastLogin: now}, {_id: obj._id})`.
- **DB side effects:** Updates one user record.
- **External side effects:** None.
- **Realtime side effects:** Unknown; if ndx-rest watches `users`, this update may emit.
- **Notes:** Event source is passport, not db-triggered.

### Trigger: passport:refreshLogin listener
- **Defined in:** `src/server/app.coffee:(refreshLogin event handler)`
- **Fires on:** passport session refresh event.
- **Applies to:** authenticated user row in `users`.
- **Logic:** `ndx.database.update('users', {lastRefresh: now}, {_id: obj._id})`.
- **DB side effects:** Updates one user record.
- **External side effects:** None.
- **Realtime side effects:** Unknown; may emit if internal rest hooks exist.
- **Notes:** Same caveat as login listener.

### Trigger: Internal ndx-database change triggers
- **Defined in:** Unknown (not visible in `/src/server`; likely inside `ndx-rest`/`ndx-database` packages).
- **Fires on:** Unknown; inferred to involve table mutation events.
- **Applies to:** At least `users` inferred from `restTables: ['users']`.
- **Logic:** Unknown.
- **DB side effects:** Unknown.
- **External side effects:** Unknown.
- **Realtime side effects:** Likely pushes db changes to connected clients.
- **Notes:** Confirm by inspecting package internals (`node_modules/ndx-rest`, `node_modules/ndx-database*`) or runtime instrumentation.

## 6) ndx-rest realtime/websocket contract

### 6.1 Websocket setup
- Where websocket server is created/attached
  - **Unknown** in `/src/server`. No direct `socket.io`/`ndx-socket` bootstrap code found.
- How ndx-rest is initialized and connected to db
  - Inferred via `ndx-server` plugin loading + `restTables: ['users']` in `src/server/app.coffee`.
  - No explicit `ndx.rest` invocation in scope.
- Namespaces/paths if defined
  - **Unknown** (not defined in `/src/server`).

### 6.2 Event inventory (frontend notifications)

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| Users-table realtime events | Inferred db writes to `users` (e.g., `/api/dezrez/update`, login/refresh updates) | Unknown | Unknown | Inferred from `src/server/app.coffee` `restTables: ['users']`; concrete event code not present |

### 6.3 Subscriptions & scoping model
- How clients subscribe (rooms/topics/collection-level)
  - **Unknown** (not explicit in `/src/server`).
- Per-user/per-case scoping rules (if any)
  - **Unknown** for websocket layer.
  - DB read permissions for `users` are explicit (self-only for non-admin paths) and may indirectly affect rest access.
- Any dedupe/throttle behavior (if any)
  - **Unknown**.

## 7) Cross-cutting domain flows (API + DB + realtime)

### Flow: Property search
1. API entrypoint(s): `POST /api/search`.
2. DB operations: query `props` twice (count + page).
3. Triggers fired: no explicit local triggers.
4. Realtime events emitted: none explicit.
5. Resulting state changes: none (read-only).

### Flow: Property detail with similar listings
1. API entrypoint(s): `GET /api/property/:id`.
2. DB operations: fetch one `props` row by `RoleId`; query similar rows.
3. Triggers fired: none explicit.
4. Realtime events emitted: none explicit.
5. Resulting state changes: none in local DB; response enriched with `similar`.

### Flow: Webhook-driven property cache refresh
1. API entrypoint(s): `POST /webhook`.
2. DB operations: remote page fetch loop; insert rows into `tmpprops`; replace `props.data`; clear `tmpprops.data`.
3. Triggers fired: unknown internal table-change hooks.
4. Realtime events emitted: unknown.
5. Resulting state changes: full refresh of in-memory property cache; outbound webhook fanout.

### Flow: User links account to Dezrez identity
1. API entrypoint(s): `POST /api/dezrez/email` or `POST /api/dezrez/findbyemail`.
2. DB operations: when one match found, update `users.dezrez`.
3. Triggers fired: potential internal rest/db mutation hooks; explicit none in app code.
4. Realtime events emitted: unknown (inferred possible on `users`).
5. Resulting state changes: user record stores external Dezrez profile.

### Flow: User updates saved properties
1. API entrypoint(s): `POST /api/dezrez/update-user-props`.
2. DB operations: `users` update of `properties` by current `_id`.
3. Triggers fired: potential internal mutation hooks.
4. Realtime events emitted: unknown.
5. Resulting state changes: persisted user-specific property list.

### Flow: Auth session activity timestamps
1. API entrypoint(s): not direct HTTP route; passport login/refresh events.
2. DB operations: update `users.lastLogin` / `users.lastRefresh`.
3. Triggers fired: passport listeners in `app.coffee`.
4. Realtime events emitted: unknown; possibly users table notifications.
5. Resulting state changes: per-user audit-ish timestamp updates.

### Flow: Aggregated role subresource retrieval
1. API entrypoint(s): `GET /api/dezrez/role/:type`.
2. DB operations: none local.
3. Triggers fired: none.
4. Realtime events emitted: none.
5. Resulting state changes: none; response composed from multiple Dezrez API calls.

## 8) Integration points visible in `/src/server`
- Dezrez API (HTTP)
  - purpose: property/person/role/event data retrieval and token auth.
  - where configured: `src/server/services/dezrez.coffee` (`envUrls`, token refresh, `agencyId`).
  - where invoked: `src/server/controllers/dezrez.coffee`, `src/server/controllers/property.coffee` (direct property detail call), `src/server/services/property.coffee` (search feed).
  - failure handling: mixed; many handlers forward `next(err)`, some return fallback arrays/errors, property detail route may return `undefined` body on error path.
- Outbound webhooks (HTTP POST)
  - purpose: notify agency/lettings downstream after property refresh.
  - where configured: env vars `VS_AGENCY_WEBHOOK`, `VS_LETTINGS_WEBHOOK`.
  - where invoked: `src/server/services/property.coffee` inside `/webhook` refresh promise.
  - failure handling: not handled (`.end()` without callback).
- Static asset exposure
  - purpose: serve icon assets path expected by external/legacy frontend paths.
  - where configured/invoked: `src/server/app.coffee` via `ndx.app.use('/wp-content/...', ndx.static('./public/img/icons'))`.
  - failure handling: default static middleware behavior.

## 9) Unknowns & follow-ups (actionable)
- Unknown exact ndx-rest websocket event names/channels/payloads; only `restTables: ['users']` is explicit in `src/server/app.coffee`.
- Unknown websocket server path/namespace/auth handshake; no explicit socket setup found in `/src/server`.
- Unknown exact ndx-server auto-loader behavior (which files are auto-mounted and in what order) beyond visible chain calls in `app.coffee`.
- Unknown schema/index constraints for `users`, `props`, `tmpprops`; none declared explicitly in `/src/server`.
- Unknown whether db writes in this code trigger automatic ndx-rest broadcasts; confirm by inspecting package internals or runtime logging.
- Follow-up files to inspect next:
  - `node_modules/ndx-server/*` for controller/service autoload and middleware order.
  - `node_modules/ndx-rest/*` for subscription/event contract.
  - `node_modules/ndx-database*/*` for trigger APIs and mutation events.
  - Any runtime config files that set ndx package options outside `/src/server`.
