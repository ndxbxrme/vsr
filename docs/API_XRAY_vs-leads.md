# API XRAY — vs-leads

## 1) Quick orientation
- Purpose of this service (1–2 paragraphs, based on evidence)

This service is an `ndx-server` backend that persists lead/instruction/offer data in an `ndx-database` in-memory/local-storage-backed store and exposes API behavior through explicit routes plus auto-loaded ndx plugins. Evidence: [`src/server/app.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/app.coffee) configures `database: 'db'`, `localStorage: './data'`, and declares core tables (`users`, `leads`, `shorttoken`, `emailtemplates`, `offers`, `offerslettings`, `instructions`).

Operationally, the backend ingests lead-like data from external systems (Gravity Forms, Rightmove, OnTheMarket), enriches records via DB triggers, sends email notifications based on templates, and provides a PDF export endpoint for lettings offers. Evidence lives in [`src/server/services/gravity.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/gravity.coffee), [`src/server/services/rightmove.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/rightmove.coffee), [`src/server/services/onthemarket.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/onthemarket.coffee), [`src/server/services/decorator.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/decorator.coffee), and [`src/server/services/emails.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/emails.coffee).

- Key entrypoints (file paths)
- [`src/server/app.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/app.coffee)
- [`src/server/controllers/env.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/controllers/env.coffee)
- [`src/server/controllers/offerslettings.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/controllers/offerslettings.coffee)
- [`src/server/services/*.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services)

- Key ndx-server plugins/packages used (bullet list)
- `ndx-server` (bootstrap wrapper; app startup in [`src/server/app.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/app.coffee))
- `ndx-rest` (declared dependency in [`package.json`](/home/kieron/code/vitalspace-remake/vs-leads/package.json); explicit initialization not present in `/src/server`)
- `ndx-socket` (declared dependency; explicit setup not present in `/src/server`)
- `ndx-passport` (used explicitly via `ndx.passport` in [`src/server/services/gmail-auth.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/gmail-auth.coffee))
- `ndx-mailgun-api` / email plugin (used via `ndx.email.send` in [`src/server/services/decorator.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/decorator.coffee), [`src/server/services/emails.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/emails.coffee), [`src/server/services/gravity.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/services/gravity.coffee))
- `ndx-auth`, `ndx-cors`, `ndx-permissions`, `ndx-short-token`, `ndx-user-roles`, `ndx-superadmin`, `ndx-database-backup`, `ndx-connect`, `ndx-modified` (all present as dependencies in [`package.json`](/home/kieron/code/vitalspace-remake/vs-leads/package.json); no explicit wiring shown in `/src/server`)

## 2) Server bootstrap (ndx-server on Express)
- How the server starts (file path + explanation)

[`src/server/app.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/app.coffee) does:
1. `require 'ndx-server'`
2. `.config({...})` with DB/table/auth flags
3. `.start()`

This is the only explicit startup path in `/src/server`.

- Middleware pipeline (in order, if determinable)

Unknown (not determinable from `/src/server`). The Express middleware chain appears to be assembled internally by `ndx-server` and installed `ndx-*` packages.

- Router mounting points / base paths

Explicitly mounted route paths in `/src/server` are direct paths on `ndx.app`:
- `/env.js`
- `/offerpdf/:id`
- `/api/google`
- `/api/google/callback`

Additional mounted base paths from `ndx-rest`/other plugins are Unknown from `/src/server` code.

- Error handling approach (if present)

No centralized error middleware is visible in `/src/server`. Handlers mostly do inline checks/logging:
- `GET /offerpdf/:id` returns `404` if record not found.
- Ingest services mostly swallow/log errors and continue callbacks.

## 3) HTTP API surface
Provide a table for **all** endpoints discovered.

| Method | Path | Handler (file:function) | Input (params/body/query) | Output | Side effects |
|---|---|---|---|---|---|
| GET | `/env.js` | `src/server/controllers/env.coffee:module.exports::<route handler>` | none | JavaScript payload defining Angular `env` constant with `PROPERTY_URL`, `PROPERTY_TOKEN` from env vars | none |
| GET | `/offerpdf/:id` | `src/server/controllers/offerslettings.coffee:module.exports::<route handler>` | `params.id` | `200` PDF stream or `404 'Application not found'` | DB read `offerslettings` by `uid`; generates PDF in-memory and streams response |
| GET | `/api/google` | `src/server/services/gmail-auth.coffee:module.exports::<route handler>` | OAuth request context | Passport auth redirect flow response (redirect/challenge) | Starts Google OAuth via `ndx.passport.authenticate('google', scope)` |
| GET | `/api/google/callback` | `src/server/services/gmail-auth.coffee:module.exports::authed` | OAuth callback query (provider-driven) | Passport-controlled response; failure redirect to `/`; success behavior is effectively logging only | Passport callback auth; logs authenticated user |
| Unknown | Unknown (likely plugin-generated by `ndx-rest`/`ndx-server`) | Unknown | Unknown | Unknown | Unknown |

Then, for each endpoint, add a short subsection:

### GET /env.js
- **Handler:** `src/server/controllers/env.coffee:module.exports::<route handler>`
- **Purpose:** Exposes selected runtime env config to client JS via an Angular module constant.
- **Request:** No parameters/body/query.
- **Response:** `200` with `Content-Type: application/javascript`; body includes `PROPERTY_URL` and `PROPERTY_TOKEN`.
- **DB touches:** None.
- **Triggers involved:** None.
- **Realtime effects:** None explicit.
- **Notes:** Assumes Angular global/module semantics in generated script.

### GET /offerpdf/:id
- **Handler:** `src/server/controllers/offerslettings.coffee:module.exports::<route handler>`
- **Purpose:** Fetches a lettings offer record and renders a tenancy application PDF.
- **Request:** `params.id` used as `uid` lookup in `offerslettings`.
- **Response:** `404` text if no record; otherwise `200` streamed PDF with `Content-Disposition` attachment.
- **DB touches:** `selectOne('offerslettings', { uid: applicationId })`.
- **Triggers involved:** None directly (read-only endpoint).
- **Realtime effects:** None explicit.
- **Notes:** Handler assumes nested fields exist (`formData.applicant`, `formData.applicant2`) and may fail if malformed records are stored.

### GET /api/google
- **Handler:** `src/server/services/gmail-auth.coffee:module.exports::<route handler>`
- **Purpose:** Initiates Google OAuth2 authentication.
- **Request:** Standard browser OAuth entry; no app-defined body/params.
- **Response:** Provider redirect/challenge handled by Passport middleware.
- **DB touches:** None in visible code.
- **Triggers involved:** None.
- **Realtime effects:** None explicit.
- **Notes:** Scope requested includes Gmail modify and Google Talk plus email.

### GET /api/google/callback
- **Handler:** `src/server/services/gmail-auth.coffee:module.exports::authed`
- **Purpose:** OAuth callback endpoint for Google strategy.
- **Request:** Provider callback query params.
- **Response:** On auth failure redirects to `/`; on success executes `authed` callback (logs user).
- **DB touches:** None in visible code.
- **Triggers involved:** None.
- **Realtime effects:** None explicit.
- **Notes:** `authed` is declared `(res, req)` (parameter order appears inverted vs Express convention), so runtime behavior of `req.user` logging may be unreliable.

### Unknown (plugin-generated)
- **Handler:** `Unknown`
- **Purpose:** `ndx-rest` likely exposes REST-style database routes, but exact endpoints are not declared in `/src/server`.
- **Request:** Unknown.
- **Response:** Unknown.
- **DB touches:** Likely table CRUD, unconfirmed from local server code.
- **Triggers involved:** Likely DB triggers, unconfirmed.
- **Realtime effects:** Likely websocket notifications, unconfirmed.
- **Notes:** Searched `/src/server` for explicit `ndx.rest`, route mounts, socket event names and found none.

## 4) ndx-database model & access patterns
### 4.1 Database instance & usage
- Where the db is instantiated/accessed

`ndx-database` is configured via `database: 'db'` in [`src/server/app.coffee`](/home/kieron/code/vitalspace-remake/vs-leads/src/server/app.coffee). Access is through `ndx.database` in controllers/services.

- Common access patterns (helpers/services, direct calls, etc.)

Common patterns used:
- Reads: `select`, `selectOne`
- Writes: `insert`
- Event hooks: `on('ready'|'preInsert'|'preUpdate'|'insert'|'update', ...)`

Most writes happen in ingest services (`gravity`, `rightmove`, `onthemarket`) after dedupe checks using `select ... uid`.

### 4.2 Collections (or equivalent)
For each collection:

#### users
- **Shape:** At least `roles` object and `local.email`.
- **Relationships:** Referenced as notification recipients, not foreign-key enforced.
- **Where used:** `src/server/services/emails.coffee`.
- **Typical operations:** `select` filtered by role existence (`where.roles[sendTo].$nn`).

#### leads
- **Shape:** Inferred fields include `uid`, `date`, `email`, `user`, `comments`, `roleId`, `propertyId`, `property`, `roleType`, `price`, `source`, `method`, plus decorated `applicant`, `s`, and lifecycle flags (`deleted`, `booked` seen in trigger logic).
- **Relationships:** Linkage to property/role IDs from upstream systems (Dezrez/Gravity payloads).
- **Where used:** `gravity.coffee`, `rightmove.coffee`, `onthemarket.coffee`, `decorator.coffee`, `emails.coffee`.
- **Typical operations:** Deduped insert by `uid`; trigger-driven enrich/update/email notification.

#### shorttoken
- **Shape:** Unknown.
- **Relationships:** Unknown.
- **Where used:** Not referenced in `/src/server` beyond table config.
- **Typical operations:** Unknown.

#### emailtemplates
- **Shape:** At least `name`, `action`, `sendTo` and email content fields expected by `ndx.email.send`.
- **Relationships:** Used by lead/offer events to render outbound mail.
- **Where used:** `emails.coffee`, `decorator.coffee`, `gravity.coffee`.
- **Typical operations:** `select` by `action`; `selectOne` by `name`.

#### offers
- **Shape:** Inferred from Gravity template: `uid`, applicant/contact/conveyancer fields, `propertyId`, `offerAmount`, `roleId`, `address`, `image`, `price`, `uploads`.
- **Relationships:** Tied to property/role IDs.
- **Where used:** `gravity.coffee`.
- **Typical operations:** Deduped `select` by `uid`, then `insert`.

#### offerslettings
- **Shape:** Inferred from Gravity lettings template: `uid`, `propertyId`, `email`, `roleId`, `address`, `image`, `price`, `lengthOfTenancy`, `comments`, nested `applicant`, `applicant2`, `rent_details`, `consent`, `source`, `method`.
- **Relationships:** Referenced by `/offerpdf/:id` on `uid`.
- **Where used:** `gravity.coffee`, `controllers/offerslettings.coffee`.
- **Typical operations:** Deduped `select` (`uid`, `deleted: null`), then `insert`; `selectOne` for PDF export.

#### instructions
- **Shape:** Inferred fields: `uid`, `address`, `vendorName`, `email`, `user`, `askingPrice`, `fee`, `instructedOn`.
- **Relationships:** Ingested from Gravity form 41.
- **Where used:** `gravity.coffee`.
- **Typical operations:** Deduped `select` by `uid`, then `insert`.

### 4.3 High-value queries / operations
List the important query-like behaviors (even if not SQL), e.g. “find open cases by user”, “update milestone”, etc.
- Deduped lead ingestion by unique external UID
- Where it lives (file path): `src/server/services/gravity.coffee`, `src/server/services/rightmove.coffee`, `src/server/services/onthemarket.coffee`
- Collections touched: `leads`
- Any performance-sensitive loops or scans: Pollers run every 5 minutes; each cycle can iterate all remote results and run per-item `select` + conditional `insert`.

- Deduped offer/lettings/instruction ingestion
- Where it lives (file path): `src/server/services/gravity.coffee`
- Collections touched: `offers`, `offerslettings`, `instructions`
- Any performance-sensitive loops or scans: Repeated polling and per-record existence checks on `uid`.

- Template-based recipient expansion for event notifications
- Where it lives (file path): `src/server/services/emails.coffee`
- Collections touched: `emailtemplates`, `users`
- Any performance-sensitive loops or scans: Nested `async.each` over templates, then recipient groups, then users.

- PDF retrieval by application UID
- Where it lives (file path): `src/server/controllers/offerslettings.coffee`
- Collections touched: `offerslettings`
- Any performance-sensitive loops or scans: Single lookup; no visible pagination/index hints.

## 5) ndx-database triggers (MUST be detailed)
Create an inventory table:

| Trigger | When it fires | Collection(s) | Defined in | What it does | Side effects |
|---|---|---|---|---|---|
| `ready` (gravity bootstrap) | DB signals ready | global | `src/server/services/gravity.coffee` | Schedules and immediately runs Gravity polling fetcher | Repeated external API calls; inserts into multiple collections; possible email sends via downstream logic |
| `ready` (rightmove bootstrap) | DB signals ready | global | `src/server/services/rightmove.coffee` | Schedules and immediately runs Rightmove polling fetcher | External API calls; Dezrez lookups; inserts into `leads` |
| `ready` (onthemarket bootstrap) | DB signals ready | global | `src/server/services/onthemarket.coffee` | Schedules and immediately runs OnTheMarket polling fetcher | External API calls; Dezrez lookups; inserts into `leads` |
| `preInsert` (`decorate`) | Before insert | `leads` | `src/server/services/decorator.coffee` | Computes `applicant` and searchable `s` fields from lead data | Mutates object before write |
| `preUpdate` (`decorate`) | Before update | `leads` | `src/server/services/decorator.coffee` | Recomputes `applicant` and `s` unless deleted | Mutates object before write |
| `insert` (`sendEmail` auto-response) | After insert | `leads` | `src/server/services/decorator.coffee` | Sends auto-response email by roleType template | Outbound email via `ndx.email.send` |
| `insert` (`emails` action notifier) | After insert | `leads` | `src/server/services/emails.coffee` | Builds action (`leadAdded`/`valuationAdded`) and fan-outs template-driven notifications | Reads templates/users, sends emails |
| `update` (`emails` action notifier) | After update | `leads` | `src/server/services/emails.coffee` | Builds action for booked/deleted updates and sends notifications | Reads templates/users, sends emails |

Then, for each trigger:

### Trigger: ready (gravity bootstrap)
- **Defined in:** `src/server/services/gravity.coffee:module.exports::<ready handler>`
- **Fires on:** custom DB event `ready`.
- **Applies to:** global DB readiness.
- **Logic:** starts interval (`5 * 60 * 1000`) and invokes `ndx.gravity.fetch()`, which chains form fetches for IDs 26, 16, 31, 24, 41.
- **DB side effects:** conditional inserts to `leads`, `instructions`, `offers`, `offerslettings`.
- **External side effects:** Gravity Forms API calls; offer notification emails on insert path.
- **Realtime side effects:** Unknown explicit websocket emission in `/src/server`; DB writes may indirectly trigger ndx-rest/sockets.
- **Notes:** No backoff/lock visible; overlapping runs are possible if a cycle exceeds interval.

### Trigger: ready (rightmove bootstrap)
- **Defined in:** `src/server/services/rightmove.coffee:module.exports::<ready handler>`
- **Fires on:** custom DB event `ready`.
- **Applies to:** global DB readiness.
- **Logic:** schedules and runs `ndx.rightmove.fetch()`.
- **DB side effects:** deduped inserts to `leads`.
- **External side effects:** HTTPS Rightmove calls with cert/key; Dezrez enrichment API calls.
- **Realtime side effects:** Unknown explicit websocket emission; potential indirect via DB change propagation.
- **Notes:** Poll window `period` shrinks from 72h to 1h to 0.3h after successful cycles.

### Trigger: ready (onthemarket bootstrap)
- **Defined in:** `src/server/services/onthemarket.coffee:module.exports::<ready handler>`
- **Fires on:** custom DB event `ready`.
- **Applies to:** global DB readiness.
- **Logic:** schedules and runs `ndx.onthemarket.fetch()`.
- **DB side effects:** deduped inserts to `leads`.
- **External side effects:** HTTPS OnTheMarket calls with PEM cert; Dezrez enrichment API calls.
- **Realtime side effects:** Unknown explicit websocket emission; potential indirect via DB change propagation.
- **Notes:** Wrapped in try/catch in `fetch`; limited error handling.

### Trigger: preInsert (decorate)
- **Defined in:** `src/server/services/decorator.coffee:decorate`
- **Fires on:** `preInsert`.
- **Applies to:** only when `args.table is 'leads'`.
- **Logic:** if not deleted, compose `applicant` from `user` name fields and build normalized searchable string `s` using applicant/address/postcode lowercased.
- **DB side effects:** mutates inserted lead object fields.
- **External side effects:** none.
- **Realtime side effects:** none directly.
- **Notes:** Runs asynchronously via registration inside `setImmediate`.

### Trigger: preUpdate (decorate)
- **Defined in:** `src/server/services/decorator.coffee:decorate`
- **Fires on:** `preUpdate`.
- **Applies to:** only `leads`; skips mutation when `args.obj.deleted` is truthy.
- **Logic:** same enrichment as `preInsert`.
- **DB side effects:** mutates updated lead object fields.
- **External side effects:** none.
- **Realtime side effects:** none directly.
- **Notes:** Deleted records bypass string/applicant recomputation.

### Trigger: insert (auto-response email)
- **Defined in:** `src/server/services/decorator.coffee:sendEmail`
- **Fires on:** `insert`.
- **Applies to:** `leads` with `lead.email`.
- **Logic:** looks up template `Auto Response - <roleType>` and sends email to lead address.
- **DB side effects:** reads `emailtemplates` only.
- **External side effects:** outbound email send.
- **Realtime side effects:** none explicit.
- **Notes:** Errors are caught/logged and do not block callback.

### Trigger: insert (action notifier)
- **Defined in:** `src/server/services/emails.coffee:<insert handler>`
- **Fires on:** `insert`.
- **Applies to:** `leads`.
- **Logic:** action key = `valuationAdded` if `roleType === 'Valuation'`, else `leadAdded`; then `sendEmails(action, lead, user)`.
- **DB side effects:** reads `emailtemplates` by `action`; may read `users` by roles for recipient expansion.
- **External side effects:** outbound email(s) to applicant and/or users.
- **Realtime side effects:** none explicit.
- **Notes:** `sendEmails` called regardless of whether `action` is empty; behavior then depends on templates found.

### Trigger: update (action notifier)
- **Defined in:** `src/server/services/emails.coffee:<update handler>`
- **Fires on:** `update`.
- **Applies to:** `leads`.
- **Logic:** base action `valuation` or `lead`; suffix `Booked` if `changes.booked`; suffix `Deleted` if `changes.deleted` transitioned from unset.
- **DB side effects:** reads `emailtemplates` and possibly `users`.
- **External side effects:** outbound email(s).
- **Realtime side effects:** none explicit.
- **Notes:** Multiple suffixes can concatenate (e.g., `leadBookedDeleted`) depending on change set.

## 6) ndx-rest realtime/websocket contract
### 6.1 Websocket setup
- Where websocket server is created/attached

Unknown in `/src/server`. No explicit `socket.io`, websocket server construction, or `ndx.rest` setup call is present.

- How ndx-rest is initialized and connected to db

Implicit/Unknown from `/src/server`. `ndx-rest` is a dependency in [`package.json`](/home/kieron/code/vitalspace-remake/vs-leads/package.json), and `ndx-server` startup may auto-load plugins, but no local explicit init code exists.

- Namespaces/paths if defined

Unknown.

### 6.2 Event inventory (frontend notifications)
Provide a table:

| Event/channel | Triggered by | Payload shape | Filtering/scoping | Defined in |
|---|---|---|---|---|
| Unknown | Likely DB mutations (`insert`/`update`/etc.) if `ndx-rest` auto-broadcast is enabled | Unknown | Unknown | Not explicitly defined in `/src/server` |

### 6.3 Subscriptions & scoping model
- How clients subscribe (rooms/topics/collection-level)

Unknown from `/src/server`.

- Per-user/per-case scoping rules (if any)

Unknown from `/src/server`.

- Any dedupe/throttle behavior (if any)

Unknown from `/src/server`.

## 7) Cross-cutting domain flows (API + DB + realtime)
Pick the **top 5–10** most important workflows you can infer from code (e.g., “create matter”, “update milestone”, “upload doc metadata”, etc.). For each:

### Flow: Gravity selling/letting lead ingestion
1. API entrypoint(s): No local HTTP endpoint; periodic fetch started by DB `ready` trigger in `gravity.coffee`.
2. DB operations: fetch form 26 entries, map via template, dedupe `select leads by uid`, then `insert leads`.
3. Triggers fired: `preInsert` (`decorate`), `insert` (`decorator.sendEmail`), `insert` (`emails` notifier).
4. Realtime events emitted: Unknown explicit events; potential implicit ndx-rest events if enabled.
5. Resulting state changes: New lead records with decorated search fields and possible outbound email notifications.

### Flow: Gravity valuation lead ingestion
1. API entrypoint(s): periodic fetch in `gravity.coffee` (form 16).
2. DB operations: map entry to valuation-shaped lead, dedupe insert into `leads`.
3. Triggers fired: same lead insert trigger chain as above.
4. Realtime events emitted: Unknown explicit.
5. Resulting state changes: valuation leads stored; action keys resolve as `valuationAdded` for notifier templates.

### Flow: Gravity sales offer ingestion
1. API entrypoint(s): periodic fetch in `gravity.coffee` (form 31).
2. DB operations: parse hidden role/property fields, dedupe `offers` by `uid`, insert on miss.
3. Triggers fired: no collection-specific custom triggers found for `offers`.
4. Realtime events emitted: Unknown explicit.
5. Resulting state changes: new `offers` records; sends `New Offer` email template to `sales@vitalspace.co.uk`.

### Flow: Gravity lettings application ingestion
1. API entrypoint(s): periodic fetch in `gravity.coffee` (form 24).
2. DB operations: map nested applicant/application structure, dedupe `offerslettings` by `uid` + `deleted:null`, insert on miss.
3. Triggers fired: no custom `offerslettings` triggers found.
4. Realtime events emitted: Unknown explicit.
5. Resulting state changes: new `offerslettings` records; sends `New Lettings Offer` email to `lettings@vitalspace.co.uk`.

### Flow: Rightmove email lead ingestion with Dezrez enrichment
1. API entrypoint(s): periodic fetch in `rightmove.coffee` after DB `ready`.
2. DB operations: request Rightmove export window, per item fetch Dezrez role/property, dedupe insert into `leads`.
3. Triggers fired: lead preInsert/insert trigger chain.
4. Realtime events emitted: Unknown explicit.
5. Resulting state changes: enriched lead records inserted from Rightmove feed.

### Flow: OnTheMarket email lead ingestion with Dezrez enrichment
1. API entrypoint(s): periodic fetch in `onthemarket.coffee` after DB `ready`.
2. DB operations: request OnTheMarket export window, per item fetch Dezrez role/property, dedupe insert into `leads`.
3. Triggers fired: lead preInsert/insert trigger chain.
4. Realtime events emitted: Unknown explicit.
5. Resulting state changes: enriched lead records inserted from OnTheMarket feed.

### Flow: Lead update notification workflow
1. API entrypoint(s): Any update path that mutates `leads` (explicit update endpoint not found in `/src/server`; likely plugin-driven).
2. DB operations: `update leads` occurs elsewhere; trigger reads `args.changes` and lead data.
3. Triggers fired: `preUpdate` decorate, then `update` email notifier.
4. Realtime events emitted: Unknown explicit; potential implicit DB-change push.
5. Resulting state changes: updated lead + possible action-based email notifications (booked/deleted combinations).

### Flow: Offer lettings PDF export
1. API entrypoint(s): `GET /offerpdf/:id`.
2. DB operations: `selectOne offerslettings` by `uid`.
3. Triggers fired: none.
4. Realtime events emitted: none explicit.
5. Resulting state changes: no DB mutation; generated PDF returned to caller.

## 8) Integration points visible in `/src/server`
Only include what is actually used by `/src/server`.
- Other internal services called (HTTP/RPC)

`ndx.dezrez` wrapper around external Dezrez API
- purpose | where configured | where invoked | failure handling (if visible)
- Fetch role/property details and provide authenticated API helper | `src/server/services/dezrez.coffee` (`ndx.dezrez.get/post`) | invoked in `rightmove.coffee` and `onthemarket.coffee` | callback-style; errors generally skip enrichment path, limited explicit recovery

- Email sending (ndx-email usage)

`ndx.email.send`
- purpose | where configured | where invoked | failure handling (if visible)
- Send template-driven auto-response and notifications | plugin config implicit (`ndx-mailgun-api` dependency in `package.json`) | `decorator.coffee`, `emails.coffee`, `gravity.coffee` | mostly fire-and-forget; one try/catch in `decorator.sendEmail`

- Webhooks in/out (if present)

Inbound polling integrations (not webhook listeners) for Gravity/Rightmove/OnTheMarket.
- purpose | where configured | where invoked | failure handling (if visible)
- Pull external lead/application feeds | configs/env usage in `gravity.coffee`, `rightmove.coffee`, `onthemarket.coffee` | started from `ready` triggers and interval timers | errors logged or period reset; callbacks continue

- File/document generation (if present)

PDF generation via `pdfkit`.
- purpose | where configured | where invoked | failure handling (if visible)
- Generate tenancy application PDF from stored lettings offer | implementation in `controllers/offerslettings.coffee` | `GET /offerpdf/:id` | `404` on missing record; no explicit catch around PDF generation

## 9) Unknowns & follow-ups (actionable)
- Exact `ndx-rest` HTTP endpoint inventory cannot be confirmed from `/src/server`; searched for explicit `ndx.rest` init and route declarations and found none.
- Exact websocket event names/channels/payloads/scoping cannot be confirmed from `/src/server`; no local socket emit/on wiring is present.
- Middleware/auth pipeline order for auto-mounted plugin routes is hidden inside `ndx-server`/plugin internals.
- Update/delete API entrypoints for `leads` are not explicit in local server files, but update triggers exist; source of those updates is likely plugin-generated endpoints.
- Index/constraint definitions for tables are not explicit in `/src/server`; dedupe relies on app-level `select` by `uid` before insert.
- `users`, `shorttoken`, and `emailtemplates` full schemas are implicit in usage only.
- Next files to inspect for confirmation:
- `node_modules/ndx-server/*` for plugin loading and route mount rules.
- `node_modules/ndx-rest/*` for concrete REST/websocket contract (paths, events, subscription model).
- `node_modules/ndx-database*/*` for trigger semantics and execution ordering.
