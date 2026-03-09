# API XRAY — vs-maintenance

## 1) Quick orientation
- Purpose of this service (1–2 paragraphs, based on evidence)

This service is an `ndx-server` API app backed by an in-memory `ndxdb` database configured with three tables: `users`, `tasks`, and `jobtypes` (`src/server/app.coffee`). The app itself defines very little custom server code; most API surface is auto-mounted by `ndx-*` modules that `ndx-server` discovers in `node_modules` and initializes at startup.

The domain-specific custom behavior in `/src/server` is: (1) seed `jobtypes` on DB ready, (2) expose `/env.js`, and (3) react to `tasks` insert/update by looking up the assigned user and logging that user object. The rest of the HTTP CRUD and websocket database notifications come from `ndx-rest`, `ndx-socket`, and other ndx plugins.

- Key entrypoints (file paths)
- `src/server/app.coffee` (main app/bootstrap config)
- `src/server/controllers/env.coffee` (custom HTTP endpoint)
- `src/server/services/task-email.coffee` (custom DB listeners)
- `node_modules/ndx-server/build/index.js` (server/module autoload behavior)

- Key ndx-server plugins/packages used (bullet list)
- `ndx-rest` (table CRUD endpoints + DB change->socket bridge)
- `ndx-socket` (socket.io server + `insert/update/delete` events)
- `ndx-passport` + `ndx-auth` (login/signup/token/forgot/invite/auth utility routes)
- `ndx-user-roles` (role-aware `ndx.authenticate` override + user role mutators)
- `ndx-permissions` (DB pre-hooks/select hooks + socket-side event permission hooks)
- `ndx-file-upload` (upload/download endpoints)
- `ndx-database-backup` (backup list/restore endpoints)
- `ndx-connect` (raw SQL exec endpoint)
- `ndx-profiler` (profiling endpoints + DB op counters)
- `ndx-superadmin` (default superadmin seed trigger)
- `ndx-cors` (CORS middleware)
- `ndx-mailgun-api` (email integration service used by invite/forgot flows when configured)

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)

`src/server/app.coffee` calls `require('ndx-server').config(...).use(...).start()`. Config sets DB name/storage, tables, invite/forgot flags, upload serving, and a public user projection. The `.use` callback registers a DB `ready` listener that seeds `jobtypes` if empty.

`ndx-server` creates `ndx.database` via `ndxdb` (`node_modules/ndx-server/build/index.js`, `config` + `start`) and then auto-loads every top-level `node_modules/ndx-*` module (except `ndx-server` itself) sorted by `loadOrder`, plus `server/services/**/*.js` and `server/controllers/**/*.js`.

- Middleware pipeline (in order, if determinable)

From `node_modules/ndx-server/build/index.js` and loaded modules:
1. `compression()`
2. `helmet()`
3. request logging (`morgan`) if enabled
4. maintenance middleware (`maintenance.js`)
5. session middleware (`express-session` + memory store)
6. `cookie-parser`
7. JSON parsing (or E2E encryption parse/decrypt/encrypt path)
8. token/auth context middleware: `ndx.app.use('/*', ...)` then `ndx.app.use('/api/*', ...)` (`node_modules/ndx-server/build/controllers/token.js`)
9. plugin middleware/routes loaded from `ndx-*` modules (CORS, user roles, passport init, etc.)
10. custom `src/server` `.use` callback(s)
11. custom `server/controllers` handlers (compiled from `src/server/controllers` in normal build flow)
12. final error handler (`ndx.app.use(function(err, req, res, next){...})`)

- Router mounting points / base paths
- `/api/*`: protected/auth-context APIs (token middleware)
- `/auth/*`: token endpoints (`ndx-auth`)
- `/rest/endpoints`: REST endpoint discovery (`ndx-rest`)
- `/invite/*`, `/forgot*`, `/get-forgot-code`: invite/forgot flows (`ndx-passport`)
- `/env.js`: custom controller (`src/server/controllers/env.coffee`)

- Error handling approach (if present)

A final Express error middleware returns `status = err.status || 500`; body is `err.message`/`err.toString()` (string) or JSON if message is object-like (`node_modules/ndx-server/build/index.js`). Many handlers throw strings/objects directly.

## 3) HTTP API surface
Provide a table for **all** endpoints discovered.

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| GET | `/env.js` | `src/server/controllers/env.coffee:(anonymous route)` | none | JS payload defining Angular `env` constants | none |
| POST | `/auth/token` | `node_modules/ndx-auth/build/app.js:(anonymous route)` | `Authorization: Basic base64(email:password)` | `{accessToken, refreshToken, expires}` or 401 | `select users` |
| POST | `/auth/refresh` | `node_modules/ndx-auth/build/app.js:(anonymous route)` | `body.refreshToken` or `body.token` | new token pair or 401 | none |
| POST | `/api/generate_cors_token` | `node_modules/ndx-auth/build/app.js:(anonymous route)` | auth: `superadmin`; body `{name, hours}` | `{token}` | `insert users` |
| POST | `/api/revoke_cors_token` | `node_modules/ndx-auth/build/app.js:(anonymous route)` | auth: `superadmin`; body `{name|id|token}` | `OK` | `delete users` |
| POST | `/api/refresh-login` | `node_modules/ndx-passport/build/index.js:(anonymous route)` | auth cookie/bearer | serialized user or empty string | passport callback (`refreshLogin`) |
| GET | `/api/logout` | `node_modules/ndx-passport/build/index.js:(anonymous route)` | auth cookie/bearer | redirect `/` | clears token cookie |
| POST | `/api/update-password` | `node_modules/ndx-passport/build/index.js:(anonymous route)` | body `{oldPassword,newPassword}` | `OK` or 401 | `update users.local.password` |
| POST | `/api/signup` | `node_modules/ndx-passport/build/index.js:passport local-signup + postAuthenticate` | body creds (`email`,`password` by default fields) | user id text or 401 | `insert users` |
| POST | `/api/login` | `node_modules/ndx-passport/build/index.js:passport local-login + postAuthenticate` | body creds | user id text or 401 | `select users`; set auth cookie |
| GET | `/api/connect/local` | `node_modules/ndx-passport/build/index.js:(empty handler)` | auth context | no body defined | none |
| POST | `/api/connect/local` | `node_modules/ndx-passport/build/index.js:passport authorize` | creds | framework-dependent | likely user link attempt |
| GET | `/api/unlink/local` | `node_modules/ndx-passport/build/index.js:(anonymous route)` | auth context | redirect `/profile` | calls `user.save` on mutated `local` |
| GET | `/badlogin` | `node_modules/ndx-passport/build/index.js:(anonymous route)` | none | throws 401 with login message | none |
| POST | `/get-forgot-code` | `node_modules/ndx-passport/build/forgot.js:(anonymous route)` | body `{email}` | reset URL string or error | `select users`; optional email send |
| POST | `/forgot-update/:code` | `node_modules/ndx-passport/build/forgot.js:(anonymous route)` | `params.code`, body `{password}` | `OK` or error | `update users.local.password` |
| POST | `/invite/accept` | `node_modules/ndx-passport/build/invite.js:(anonymous route)` | body `{code,user}` | `OK` or error | `select users`; `insert users`; optional short-token remove |
| GET | `/invite/:code` | `node_modules/ndx-passport/build/invite.js:(anonymous route)` | `params.code` | redirect `/invited?...` | none |
| POST | `/api/get-invite-code` | `node_modules/ndx-passport/build/invite.js:(anonymous route)` | auth required; body invite user | invite URL (text) or json error | `select users`; optional email send |
| POST | `/api/upload` | `node_modules/ndx-file-upload/build/index.js:(anonymous route)` | multipart file(s) + body metadata | JSON uploaded file metadata array | filesystem write; optional S3 upload |
| GET | `/api/download/:data` | `node_modules/ndx-file-upload/build/index.js:(anonymous route)` | base64-encoded JSON in `:data` | file stream response | filesystem read/write; optional S3 fetch |
| GET | `/api/backup/list` | `node_modules/ndx-database-backup/build/app.js:(anonymous route)` | auth: `superadmin` | JSON array of backup filenames | filesystem glob |
| POST | `/api/backup/restore` | `node_modules/ndx-database-backup/build/app.js:(anonymous route)` | auth: `superadmin`; body `{fileName}` | `OK` or error | DB restore from file stream |
| POST | `/api/database/exec` | `node_modules/ndx-connect/build/app.js:(anonymous route)` | auth: `superadmin`; body `{sql,props,notCritical}` | raw `ndx.database.exec` output | arbitrary DB mutation/query |
| GET | `/api/profiler` | `node_modules/ndx-profiler/build/index.js:(anonymous route)` | auth required | profiler JSON | reads live metrics |
| GET | `/api/profiler/history` | `node_modules/ndx-profiler/build/index.js:(anonymous route)` | auth required | profiler history array | reads in-memory history |
| GET | `/rest/endpoints` | `node_modules/ndx-rest/build/index.js:(anonymous route)` | none | `{autoId,endpoints,restrict,server}` | none |
| GET | `/api/<table>` + `/api/<table>/:id` | `node_modules/ndx-rest/build/index.js:selectFn` | auth required; optional `:id` | item or paged list envelope | `select` |
| GET | `/api/<table>/:id/all` | `node_modules/ndx-rest/build/index.js:selectFn(all=true)` | auth required; `:id` | single item (all mode) | `select` with elevated read |
| POST | `/api/<table>/search` | `node_modules/ndx-rest/build/index.js:selectFn` | auth required; body filter/paging | paged list envelope | `select` |
| POST | `/api/<table>/search/all` | `node_modules/ndx-rest/build/index.js:selectFn(all=true)` | auth required; body filter/paging | paged list envelope | `select` with elevated read |
| POST | `/api/<table>/modified` | `node_modules/ndx-rest/build/index.js:modifiedFn` | auth required | `{maxModified}` | reads max modified |
| POST | `/api/<table>` + `/api/<table>/:id` | `node_modules/ndx-rest/build/index.js:upsertFn` | auth required; body object | inserted/updated object or error | `upsert` -> insert/update |
| PUT | `/api/<table>` + `/api/<table>/:id` | `node_modules/ndx-rest/build/index.js:upsertFn` | auth required; body object | inserted/updated object or error | `upsert` -> insert/update |
| DELETE | `/api/<table>/:id` | `node_modules/ndx-rest/build/index.js:deleteFn` | auth required; `:id` | `OK` | hard delete or soft-delete update |

`<table>` above resolves to configured tables from `src/server/app.coffee`: `users`, `tasks`, `jobtypes`.

Then, for each endpoint, add a short subsection:

### GET /env.js
- **Handler:** `src/server/controllers/env.coffee:(route callback)`
- **Purpose:** expose `PROPERTY_URL` and `PROPERTY_TOKEN` env vars to frontend JS.
- **Request:** none.
- **Response:** `200` JavaScript snippet.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** no auth; returns server env values directly.

### POST /auth/token
- **Handler:** `node_modules/ndx-auth/build/app.js:(route callback)`
- **Purpose:** issue bearer-style access/refresh tokens from Basic credentials.
- **Request:** `Authorization: Basic base64(email:password)`.
- **Response:** `200 {accessToken, refreshToken, expires}` or `401`.
- **DB touches:** `users` select by `local.email`.
- **Triggers involved:** `preSelect`, `select` DB hooks.
- **Realtime effects:** none.
- **Notes:** token parse/validation delegates to ndx token helper.

### POST /auth/refresh
- **Handler:** `node_modules/ndx-auth/build/app.js:(route callback)`
- **Purpose:** exchange refresh token for new access/refresh pair.
- **Request:** body `refreshToken` (or `token`).
- **Response:** token pair JSON or `401`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** trusts parsed refresh token prefix `REFRESH`.

### POST /api/generate_cors_token
- **Handler:** `node_modules/ndx-auth/build/app.js:(route callback)`
- **Purpose:** create service user + long token for CORS/service use.
- **Request:** auth role `superadmin`; body `name`, optional `hours`.
- **Response:** `{token}`.
- **DB touches:** `users` insert.
- **Triggers involved:** `preInsert`, `insert` (plus profiler counters).
- **Realtime effects:** `insert` socket event for `users` via ndx-rest/ndx-socket.
- **Notes:** inserted user has blank local password.

### POST /api/revoke_cors_token
- **Handler:** `node_modules/ndx-auth/build/app.js:(route callback)`
- **Purpose:** revoke service token by deleting corresponding user.
- **Request:** auth role `superadmin`; body with `name` or `id` or `token`.
- **Response:** `OK`.
- **DB touches:** `users` delete.
- **Triggers involved:** `preDelete`, `delete`.
- **Realtime effects:** `delete` socket event for `users`.
- **Notes:** delete criteria object can be broad if partial input is provided.

### POST /api/refresh-login
- **Handler:** `node_modules/ndx-passport/build/index.js:(route callback)`
- **Purpose:** return current logged-in user projection.
- **Request:** token cookie/bearer auth context.
- **Response:** user JSON string or empty string.
- **DB touches:** none directly.
- **Triggers involved:** none DB; passport `refreshLogin` callback chain.
- **Realtime effects:** none.
- **Notes:** profiler increments pageViews off passport callback.

### GET /api/logout
- **Handler:** `node_modules/ndx-passport/build/index.js:(route callback)`
- **Purpose:** log user out.
- **Request:** optional current auth.
- **Response:** redirect `/`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** clears `token` cookie and nulls `ndx.user`.

### POST /api/update-password
- **Handler:** `node_modules/ndx-passport/build/index.js:(route callback)`
- **Purpose:** authenticated password change.
- **Request:** body `{oldPassword,newPassword}`.
- **Response:** `OK` or `401` with message.
- **DB touches:** `users` update by auto id.
- **Triggers involved:** `preUpdate`, `update`.
- **Realtime effects:** `update` socket event for `users`.
- **Notes:** fails if user not logged in or has no local credentials.

### POST /api/signup
- **Handler:** `node_modules/ndx-passport/build/index.js:passport local-signup`
- **Purpose:** create local account.
- **Request:** body fields `email/password` (or configured username/password field names).
- **Response:** user id text (`res.send(req.user._id)`) or 401 via `/badlogin`.
- **DB touches:** `users` select for uniqueness, then insert.
- **Triggers involved:** `preSelect/select`, `preInsert/insert`.
- **Realtime effects:** `insert` socket event for `users`.
- **Notes:** code calls `done(null, newUser)` where `newUser` is not defined in scope (likely bug), but inserts user first.

### POST /api/login
- **Handler:** `node_modules/ndx-passport/build/index.js:passport local-login`
- **Purpose:** authenticate local user.
- **Request:** credentials in body.
- **Response:** user id text on success; 401 on fail.
- **DB touches:** `users` select by email.
- **Triggers involved:** `preSelect/select`.
- **Realtime effects:** none.
- **Notes:** also sets auth cookie via `ndx.postAuthenticate`.

### GET /api/connect/local
- **Handler:** `node_modules/ndx-passport/build/index.js:(empty route)`
- **Purpose:** placeholder endpoint.
- **Request:** none documented.
- **Response:** no explicit response body in code.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** behavior is effectively undefined/empty.

### POST /api/connect/local
- **Handler:** `node_modules/ndx-passport/build/index.js:passport.authorize('local-signup')`
- **Purpose:** attach local auth using passport authorize flow.
- **Request:** local signup credentials.
- **Response:** passport-dependent, failure redirects `/badlogin`.
- **DB touches:** likely same as signup path.
- **Triggers involved:** same as signup when insert happens.
- **Realtime effects:** possible `users` insert event.
- **Notes:** output is implicit in passport middleware.

### GET /api/unlink/local
- **Handler:** `node_modules/ndx-passport/build/index.js:(route callback)`
- **Purpose:** unlink local credentials.
- **Request:** auth context.
- **Response:** redirect `/profile`.
- **DB touches:** non-ndxdb `user.save(...)` call on user object.
- **Triggers involved:** none ndxdb.
- **Realtime effects:** none via ndx-rest.
- **Notes:** this path bypasses `ndx.database` API.

### GET /badlogin
- **Handler:** `node_modules/ndx-passport/build/index.js:(route callback)`
- **Purpose:** central auth failure endpoint.
- **Request:** none.
- **Response:** throws `{status:401,message}`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** message comes from mutable `ndx.passport.loginMessage`.

### POST /get-forgot-code
- **Handler:** `node_modules/ndx-passport/build/forgot.js:(route callback)`
- **Purpose:** generate password-reset link.
- **Request:** body `{email}`.
- **Response:** reset URL string.
- **DB touches:** `users` select by `local.email`.
- **Triggers involved:** `preSelect`, `select`.
- **Realtime effects:** none.
- **Notes:** if email plugin configured, sends mail via `ndx.email.send`.

### POST /forgot-update/:code
- **Handler:** `node_modules/ndx-passport/build/forgot.js:(route callback)`
- **Purpose:** set new password from reset token.
- **Request:** `:code`, body `{password}`.
- **Response:** `OK` or error.
- **DB touches:** `users` update.
- **Triggers involved:** `preUpdate`, `update`.
- **Realtime effects:** `update` socket event for `users`.
- **Notes:** token contains serialized user/email payload.

### POST /invite/accept
- **Handler:** `node_modules/ndx-passport/build/invite.js:(route callback)`
- **Purpose:** consume invite code and create account.
- **Request:** body `{code,user}`.
- **Response:** `OK` or error.
- **DB touches:** `users` select then insert.
- **Triggers involved:** select + insert hook chains.
- **Realtime effects:** `insert` socket event for `users`.
- **Notes:** strips role/type from posted user payload before merge.

### GET /invite/:code
- **Handler:** `node_modules/ndx-passport/build/invite.js:(route callback)`
- **Purpose:** decode invite token and redirect with embedded data.
- **Request:** invite code param.
- **Response:** redirect to `/invited?...`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** no explicit auth.

### POST /api/get-invite-code
- **Handler:** `node_modules/ndx-passport/build/invite.js:(route callback)`
- **Purpose:** generate invite URL for target user.
- **Request:** authenticated user; body with invited user payload (`local.email` etc).
- **Response:** invite URL text or JSON error object.
- **DB touches:** `users` select to detect duplicates.
- **Triggers involved:** `preSelect`, `select`.
- **Realtime effects:** none directly.
- **Notes:** optional email dispatch via `ndx.email.send`; emits passport callbacks (`invited`, `inviteUserExists`).

### POST /api/upload
- **Handler:** `node_modules/ndx-file-upload/build/index.js:(route callback)`
- **Purpose:** upload and store encrypted/gzipped file(s).
- **Request:** authenticated multipart form; files in `file`, optional metadata/folder/tags.
- **Response:** JSON array of uploaded file metadata objects.
- **DB touches:** none.
- **Triggers involved:** none DB.
- **Realtime effects:** none.
- **Notes:** writes local file first; optional async S3 copy.

### GET /api/download/:data
- **Handler:** `node_modules/ndx-file-upload/build/index.js:(route callback)`
- **Purpose:** download stored file using encoded descriptor.
- **Request:** `:data` is base64 JSON containing file descriptor/path.
- **Response:** binary attachment stream.
- **DB touches:** none.
- **Triggers involved:** none DB.
- **Realtime effects:** none.
- **Notes:** this route has no explicit `ndx.authenticate()` in handler; access control relies on outer middleware/public-route behavior.

### GET /api/backup/list
- **Handler:** `node_modules/ndx-database-backup/build/app.js:(route callback)`
- **Purpose:** list backup files.
- **Request:** `superadmin` auth.
- **Response:** JSON file path list.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** depends on configured `backupDir`.

### POST /api/backup/restore
- **Handler:** `node_modules/ndx-database-backup/build/app.js:(route callback)`
- **Purpose:** restore DB snapshot from selected file.
- **Request:** `superadmin` auth; body `{fileName}`.
- **Response:** `OK` or error.
- **DB touches:** full DB restore via `ndx.database.restoreFromBackup(readStream)`.
- **Triggers involved:** ndxdb `restore` callbacks.
- **Realtime effects:** none explicit.
- **Notes:** path is used directly if file exists.

### POST /api/database/exec
- **Handler:** `node_modules/ndx-connect/build/app.js:(route callback)`
- **Purpose:** execute arbitrary SQL against ndxdb.
- **Request:** `superadmin` auth; body `{sql, props, notCritical}`.
- **Response:** raw execution output JSON.
- **DB touches:** arbitrary `select/insert/update/delete` depending on SQL.
- **Triggers involved:** corresponding ndxdb hooks for actual operation.
- **Realtime effects:** if SQL mutates REST tables, emits update/insert/delete socket events.
- **Notes:** high-power endpoint; behavior depends entirely on SQL input.

### GET /api/profiler
- **Handler:** `node_modules/ndx-profiler/build/index.js:(route callback)`
- **Purpose:** expose current process/API/DB counters.
- **Request:** authenticated user.
- **Response:** profiler object.
- **DB touches:** none direct.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** counts are updated by middleware and DB listeners.

### GET /api/profiler/history
- **Handler:** `node_modules/ndx-profiler/build/index.js:(route callback)`
- **Purpose:** expose sampled profiler history.
- **Request:** authenticated user.
- **Response:** array of snapshots.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** history sampled every 10 seconds in-memory.

### GET /rest/endpoints
- **Handler:** `node_modules/ndx-rest/build/index.js:(route callback)`
- **Purpose:** report generated REST endpoints/restrictions.
- **Request:** none.
- **Response:** `{autoId,endpoints,restrict,server}`.
- **DB touches:** none.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** useful for client-side dynamic table discovery.

### REST pattern: GET /api/<table> and GET /api/<table>/:id
- **Handler:** `node_modules/ndx-rest/build/index.js:selectFn(tableName)`
- **Purpose:** table query and single-record fetch.
- **Request:** auth required; `:id` optional; for list mode body-based filtering via downstream middleware usage.
- **Response:** single object (`:id`) or `{total,page,pageSize,items}`.
- **DB touches:** `select`.
- **Triggers involved:** `preSelect`, `select`, `selectTransform`.
- **Realtime effects:** none directly.
- **Notes:** applies soft-delete filter unless overridden.

### REST pattern: GET /api/<table>/:id/all
- **Handler:** `node_modules/ndx-rest/build/index.js:selectFn(tableName, true)`
- **Purpose:** fetch record with elevated/all transform path.
- **Request:** auth required.
- **Response:** single object or `{}`.
- **DB touches:** `select`.
- **Triggers involved:** same select hooks.
- **Realtime effects:** none directly.
- **Notes:** temporarily elevates user role to `system` for select transform context.

### REST pattern: POST /api/<table>/search and /search/all
- **Handler:** `node_modules/ndx-rest/build/index.js:selectFn(...)`
- **Purpose:** filtered search with paging/sort.
- **Request:** auth required; body `{where,sort,page,pageSize,all,showDeleted,...}`.
- **Response:** `{total,page,pageSize,items}`.
- **DB touches:** `select`.
- **Triggers involved:** select hooks.
- **Realtime effects:** none directly.
- **Notes:** `/search/all` uses elevated read path.

### REST pattern: POST /api/<table>/modified
- **Handler:** `node_modules/ndx-rest/build/index.js:modifiedFn`
- **Purpose:** return table max modified timestamp.
- **Request:** auth required.
- **Response:** `{maxModified}`.
- **DB touches:** `maxModified(table)` query.
- **Triggers involved:** none.
- **Realtime effects:** none.
- **Notes:** column used is `modifiedAt`; may be `0` if absent.

### REST pattern: POST/PUT /api/<table> and /api/<table>/:id
- **Handler:** `node_modules/ndx-rest/build/index.js:upsertFn`
- **Purpose:** create or update records.
- **Request:** auth required; body object; optional `:id` route param.
- **Response:** inserted/updated object or error.
- **DB touches:** `upsert` -> `insert` or `update`.
- **Triggers involved:** preInsert/insert or preUpdate/update (plus profiler/task-email/superadmin where applicable by table/event).
- **Realtime effects:** emits `insert` or `update` socket event for REST tables.
- **Notes:** behavior differs by whether record exists for `where`.

### REST pattern: DELETE /api/<table>/:id
- **Handler:** `node_modules/ndx-rest/build/index.js:deleteFn`
- **Purpose:** delete (or soft-delete) record.
- **Request:** auth required; `:id`.
- **Response:** `OK`.
- **DB touches:** `delete` or `update` with `deleted` object when soft-delete enabled.
- **Triggers involved:** preDelete/delete or preUpdate/update.
- **Realtime effects:** `delete` or `update` socket event.
- **Notes:** deletion mode depends on `SOFT_DELETE` setting.

## 4) ndx-database model & access patterns
### 4.1 Database instance & usage
- Where the db is instantiated/accessed

`ndx-server` config defaults `settings.DB_ENGINE = require('ndxdb')` and starts it in server bootstrap (`node_modules/ndx-server/build/index.js`). `src/server/app.coffee` selects DB name `db`, table list, and local storage path. Database handle is exposed as `ndx.database` and used directly throughout plugins/services.

- Common access patterns (helpers/services, direct calls, etc.)

Mostly direct `ndx.database` calls: `select`, `insert`, `update`, `upsert`, `delete`, `count`, `maxModified`, `exec`, `saveDatabase`, `restoreFromBackup`. `ndx-rest` is the primary adapter translating HTTP table routes into those DB calls.

### 4.2 Collections (or equivalent)
For each collection:

#### users
- **Shape:** `_id` (auto id), `email`, `displayName`, `local.email`, `local.password`, `roles`, optional `type`, optional table-reference fields created by permissions helpers.
- **Relationships:** `tasks.assignedTo -> users._id` implied by `src/server/services/task-email.coffee`.
- **Where used:** auth/passport/user-roles/superadmin/task-email; REST CRUD.
- **Typical operations:** select-by-email, insert user, update password, delete service token users, role updates.

#### tasks
- **Shape:** explicitly confirmed field: `assignedTo`; other fields are **Unknown** from server code.
- **Relationships:** belongs to/assigned to `users` via `assignedTo`.
- **Where used:** REST CRUD; custom task-email trigger listens on insert/update.
- **Typical operations:** generic REST select/search/upsert/delete.

#### jobtypes
- **Shape:** seeded object includes `{type, jobs}` plus auto `_id`.
- **Relationships:** none explicit.
- **Where used:** startup seed (`src/server/app.coffee`); REST CRUD.
- **Typical operations:** count-on-ready; optional seed insert; generic REST CRUD.

### 4.3 High-value queries / operations
- **Seed default job types**
- Where: `src/server/app.coffee`
- Collections: `jobtypes`
- Pattern: `count('jobtypes')` then conditional `insert`
- Perf notes: trivial single-table count + single insert.

- **Task-assignee lookup on task writes**
- Where: `src/server/services/task-email.coffee`
- Collections: `tasks`, `users`
- Pattern: on task insert/update, `select users where _id=assignedTo`
- Perf notes: one select per task write.

- **Generic REST table search**
- Where: `node_modules/ndx-rest/build/index.js`
- Collections: all configured REST tables (`users`,`tasks`,`jobtypes`)
- Pattern: POST `/api/<table>/search` -> `ndx.database.select(table, req.body, cb)`
- Perf notes: filtering/sorting built dynamically; large in-memory scans possible.

- **Arbitrary SQL execution**
- Where: `node_modules/ndx-connect/build/app.js`
- Collections: any
- Pattern: POST `/api/database/exec` -> `ndx.database.exec(sql, props, notCritical)`
- Perf notes: caller-controlled SQL, potentially expensive.

- **Backup restore**
- Where: `node_modules/ndx-database-backup/build/app.js` + `ndxdb`
- Collections: whole DB snapshot
- Pattern: stream file into `restoreFromBackup`
- Perf notes: full dataset rewrite.

## 5) ndx-database triggers (MUST be detailed)
Create an inventory table:

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `ready` (seed jobtypes) | DB ready | `jobtypes` | `src/server/app.coffee` | seeds default job type if table empty | `insert jobtypes` |
| `insert` (task-email) | after insert | `tasks` (conditional) | `src/server/services/task-email.coffee` | lookup assigned user | logs user object |
| `update` (task-email) | after update | `tasks` (conditional) | `src/server/services/task-email.coffee` | lookup assigned user | logs user object |
| `ready` (superadmin seed) | DB ready | `users` | `node_modules/ndx-superadmin/build/app.js` | ensure superadmin user exists | inserts default superadmin user |
| `update` bridge | after update | REST tables | `node_modules/ndx-rest/build/index.js` | call `ndx.socket.dbFn(args)` | websocket `update` events |
| `insert` bridge | after insert | REST tables | `node_modules/ndx-rest/build/index.js` | call `ndx.socket.dbFn(args)` | websocket `insert` events |
| `delete` bridge | after delete | REST tables | `node_modules/ndx-rest/build/index.js` | call `ndx.socket.dbFn(args)` | websocket `delete` events |
| `preSelect` | before select | all (permission-mapped) | `node_modules/ndx-permissions/build/index.js` | permission check gate | can block selects |
| `select` | after select | all (permission-mapped) | `node_modules/ndx-permissions/build/index.js` | permission check + optional transform | filters/transforms output |
| `preUpdate` | before update | all (permission-mapped) | `node_modules/ndx-permissions/build/index.js` | permission check + optional transform | can block/reshape updates |
| `preInsert` | before insert | all (permission-mapped) | `node_modules/ndx-permissions/build/index.js` | permission check + optional transform | can block/reshape inserts |
| `preDelete` | before delete | all (permission-mapped) | `node_modules/ndx-permissions/build/index.js` | permission check gate | can block deletes |
| `insert` profiler | after insert | all | `node_modules/ndx-profiler/build/index.js` | increment counters | in-memory metrics |
| `update` profiler | after update | all | `node_modules/ndx-profiler/build/index.js` | increment counters | in-memory metrics |
| `delete` profiler | after delete | all | `node_modules/ndx-profiler/build/index.js` | increment counters | in-memory metrics |
| `select` profiler | after select | all | `node_modules/ndx-profiler/build/index.js` | increment counters | in-memory metrics |

Then, for each trigger:

### Trigger: `ready` (jobtypes seed)
- **Defined in:** `src/server/app.coffee:(ndx.database.on 'ready')`
- **Fires on:** DB engine readiness.
- **Applies to:** `jobtypes`.
- **Logic:** count rows; if `0`, insert `{type:'default', jobs:'Cleaning\nPainting'}`.
- **DB side effects:** conditional insert.
- **External side effects:** none.
- **Realtime side effects:** possible `insert` socket event via ndx-rest bridge (if `jobtypes` is in REST endpoints, which it is).
- **Notes:** idempotent per boot unless table emptied.

### Trigger: `insert`/`update` (task-email)
- **Defined in:** `src/server/services/task-email.coffee:sendEmail`
- **Fires on:** `insert` and `update` DB events.
- **Applies to:** only when `args.table === 'tasks'` and `args.obj` exists.
- **Logic:** select `users` by `_id = args.obj.assignedTo`; log first matched user.
- **DB side effects:** read-only select.
- **External side effects:** console logging only (no email dispatch in current code).
- **Realtime side effects:** none directly.
- **Notes:** executes on every task write; callback always returns truthy (`cb? true`).

### Trigger: `ready` (superadmin seed)
- **Defined in:** `node_modules/ndx-superadmin/build/app.js`
- **Fires on:** DB ready.
- **Applies to:** `users` table.
- **Logic:** select `email=superadmin@admin.com`; if absent insert default superadmin/password `admin`.
- **DB side effects:** select + optional insert.
- **External side effects:** console warnings.
- **Realtime side effects:** optional `users` insert socket event.
- **Notes:** default credential warning prints if unchanged.

### Trigger: ndx-rest DB change bridge (`insert`/`update`/`delete`)
- **Defined in:** `node_modules/ndx-rest/build/index.js`
- **Fires on:** post-mutation DB events.
- **Applies to:** REST endpoint tables (`users`,`tasks`,`jobtypes`).
- **Logic:** if changed table is in endpoints, call `ndx.socket.dbFn(args)`.
- **DB side effects:** none.
- **External side effects:** websocket emits from `ndx-socket`.
- **Realtime side effects:** emits event name equal to op (`insert|update|delete`) payload `{table,id}`.
- **Notes:** this is the core backend->frontend realtime bridge.

### Trigger: ndx-permissions pre/post DB hooks
- **Defined in:** `node_modules/ndx-permissions/build/index.js`
- **Fires on:** `preSelect`, `select`, `preUpdate`, `preInsert`, `preDelete`.
- **Applies to:** any table covered by runtime permission config (`dbPermissions`).
- **Logic:** evaluate role/function permissions; optionally transform objects.
- **DB side effects:** none directly.
- **External side effects:** can deny operations by callback false.
- **Realtime side effects:** indirect (blocked writes prevent ndx-rest/socket events).
- **Notes:** actual configured permissions are **Unknown** (no `ndx.database.permissions.set(...)` in `/src/server`).

### Trigger: ndx-profiler DB op counters
- **Defined in:** `node_modules/ndx-profiler/build/index.js`
- **Fires on:** `insert/update/delete/select`.
- **Applies to:** all tables.
- **Logic:** increments in-memory counter buckets.
- **DB side effects:** none.
- **External side effects:** none.
- **Realtime side effects:** none.
- **Notes:** excludes requests to `/api/profiler` from some counters via `isProfiler` flag.

## 6) ndx-rest realtime/websocket contract
### 6.1 Websocket setup
- Where websocket server is created/attached

`ndx-socket` creates socket.io on `ndx.server` with `socketio.listen(ndx.server)` (`node_modules/ndx-socket/build/index.js`). No custom namespace/path is set, so default socket.io endpoint applies.

- How ndx-rest is initialized and connected to db

`ndx-rest` initializes routes in `setImmediate(...)`, derives endpoints from `ndx.settings.TABLES`, and registers DB listeners on `update/insert/delete`. Those listeners call `ndx.socket.dbFn(args)` for endpoint tables (`node_modules/ndx-rest/build/index.js`).

- Namespaces/paths if defined

No explicit namespace/room path definitions are present in backend code.

### 6.2 Event inventory (frontend notifications)
Provide a table:

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| `insert` (socket event) | DB `insert` on REST table via `ndx-rest` bridge | `{table, id}` | only sockets with `socket.user` set; additional callback gating via `ndx.socket.on('insert', ...)` | `node_modules/ndx-socket/build/index.js` + `node_modules/ndx-rest/build/index.js` |
| `update` (socket event) | DB `update` on REST table via `ndx-rest` bridge | `{table, id}` | same as above | same |
| `delete` (socket event) | DB `delete` on REST table via `ndx-rest` bridge | `{table, id}` | same as above | same |
| `connection` callback (server-side hook) | socket connect | socket object | internal hook for plugins (profiler) | `node_modules/ndx-socket/build/index.js` |
| `disconnect` callback (server-side hook) | socket disconnect | socket object | internal hook for plugins (profiler) | `node_modules/ndx-socket/build/index.js` |
| `user` socket inbound event | client sends user object | arbitrary user object | sets `socket.user` for future emits | `node_modules/ndx-socket/build/index.js` |

### 6.3 Subscriptions & scoping model
- How clients subscribe (rooms/topics/collection-level)

No rooms/namespaces/topic subscriptions are implemented. All connected sockets with a set `socket.user` are iterated for each DB mutation event.

- Per-user/per-case scoping rules (if any)

No table/record-level scoping is built into emit payload generation. Optional gating exists through `ndx.socket.on('insert'|'update'|'delete', callback)` hooks (used by `ndx-permissions`), but emitted payload remains `{table,id}` only.

- Any dedupe/throttle behavior (if any)

No dedupe or throttle logic was found.

## 7) Cross-cutting domain flows (API + DB + realtime)
Pick the **top 5–10** most important workflows you can infer from code (e.g., “create matter”, “update milestone”, “upload doc metadata”, etc.). For each:

### Flow: Startup initialization
1. API entrypoint(s): server boot (`src/server/app.coffee`, `ndx-server start`).
2. DB operations: `jobtypes` count + conditional insert; superadmin select + optional insert.
3. Triggers fired: `ready` listeners in app and ndx-superadmin.
4. Realtime events emitted: possible `insert` events for seeded records.
5. Resulting state changes: baseline `jobtypes` and default superadmin user may be created.

### Flow: User signup
1. API entrypoint(s): `POST /api/signup`.
2. DB operations: select user by email; insert new user.
3. Triggers fired: permissions pre/select/preInsert/insert, profiler insert/select.
4. Realtime events emitted: `insert` for `users`.
5. Resulting state changes: new user row + auth cookie/token response path.

### Flow: Task create/update via REST
1. API entrypoint(s): `POST/PUT /api/tasks` or `/api/tasks/:id`.
2. DB operations: upsert -> insert/update on `tasks`.
3. Triggers fired: permissions preInsert/preUpdate, task-email listener, profiler counters, ndx-rest bridge listeners.
4. Realtime events emitted: `insert` or `update` with `{table:'tasks',id}`.
5. Resulting state changes: task persisted, assignee user looked up/logged.

### Flow: Password reset
1. API entrypoint(s): `POST /get-forgot-code`, `POST /forgot-update/:code`.
2. DB operations: select user by email; update `users.local.password`.
3. Triggers fired: select/update hook chains.
4. Realtime events emitted: `update` for `users` on password change.
5. Resulting state changes: reset token URL issued; user password replaced.

### Flow: Invite user
1. API entrypoint(s): `POST /api/get-invite-code`, `POST /invite/accept`.
2. DB operations: select user by email; insert invited user on accept.
3. Triggers fired: select/insert hook chains; passport invite callbacks.
4. Realtime events emitted: `insert` for `users` on accepted invite.
5. Resulting state changes: invite URL generated; invited account created.

### Flow: Generic table CRUD (users/tasks/jobtypes)
1. API entrypoint(s): `/api/<table>`, `/api/<table>/:id`, `/search`, `/modified`, `DELETE`.
2. DB operations: select/upsert/delete/maxModified.
3. Triggers fired: permission hooks + profiler + ndx-rest socket bridge + table-specific listeners.
4. Realtime events emitted: mutation ops emit `{table,id}`.
5. Resulting state changes: table records mutate according to request.

### Flow: Backup restore
1. API entrypoint(s): `POST /api/backup/restore`.
2. DB operations: restore entire DB from backup stream.
3. Triggers fired: ndxdb `restore` callbacks.
4. Realtime events emitted: none explicit in restore path.
5. Resulting state changes: in-memory DB replaced from backup snapshot.

### Flow: File upload/download
1. API entrypoint(s): `POST /api/upload`, `GET /api/download/:data`.
2. DB operations: none.
3. Triggers fired: none ndxdb.
4. Realtime events emitted: none.
5. Resulting state changes: encrypted files stored/retrieved from disk (and optionally S3).

## 8) Integration points visible in `/src/server`
Only include what is actually used by `/src/server`.
- Other internal services called (HTTP/RPC)
- None explicit from `/src/server` code.

- Email sending (ndx-email usage)
- Purpose: forgot/invite email delivery.
- Where configured: `node_modules/ndx-mailgun-api/build/index.js` initializes `ndx.email` if `EMAIL_API_KEY` + `EMAIL_BASE_URL` are present.
- Where invoked: `node_modules/ndx-passport/build/forgot.js` and `node_modules/ndx-passport/build/invite.js`.
- Failure handling: errors routed to `ndx-mailgun-api` internal `error` callbacks; route handlers generally do not block on send completion.

- Webhooks in/out (if present)
- None found.

- File/document generation (if present)
- Purpose: binary file upload/download with local storage and optional S3 mirroring.
- Where configured: `node_modules/ndx-file-upload/build/index.js` via env/settings for AWS and encryption.
- Where invoked: `/api/upload`, `/api/download/:data` routes.
- Failure handling: upload path logs write errors/callback errors; download path logs stream/decrypt errors and may return empty response if file unavailable and AWS disabled.

## 9) Unknowns & follow-ups (actionable)
- `package.json` uses version ranges (`^`) and no lockfile is present. Exact runtime behavior can drift by install date/version. I analyzed currently installed versions (`npm ls`), but another install may differ.
- `ndx-server` auto-loads `server/services/**/*.js` and `server/controllers/**/*.js`; repo contains `/src/server` CoffeeScript, so behavior depends on build output parity. I did not find generated `server/` sources in this repo.
- Field-level schema for `tasks` is mostly implicit; only `assignedTo` is confirmed in `/src/server`.
- No explicit `ndx.database.permissions.set(...)` or `ndx.rest.permissions.set(...)` is present in `/src/server`, so permission policy content is Unknown at app level.
- `ndx-permissions` references `objtrans` without an import in installed `build/index.js`; transformer branches may throw if exercised.
- Socket client authentication is implicit (`socket.on('user', userObj)`), with no server-side token verification in `ndx-socket`.
- Potential callback argument mismatch in `ndx-socket` (`asyncCallback(myargs.op, args, ...)` uses `args` not `myargs`) may bypass intended per-user socket filtering logic in permission callbacks.
- Error object handling in `ndx-server` checks `Object.prototype.toString.call(message === '[object Object]')`, which appears incorrect; response formatting for object errors may be inconsistent.
