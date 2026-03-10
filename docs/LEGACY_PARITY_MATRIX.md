# Legacy-to-New Parity Matrix

## 1. Purpose

This document maps the legacy VitalSpace platform to the target platform and classifies each capability as:

- `MVP`: required for first side-by-side operational rollout
- `Later`: retain conceptually, but not required for first rollout
- `Drop/Rethink`: do not carry forward as-is

The aim is controlled parity, not full historical duplication.

## 2. Parity Rules

- `MVP` means enough parity to support real operations alongside the legacy system.
- `Later` means the feature has value, but should not block the shared platform, sales, or lettings rollout.
- `Drop/Rethink` means the current implementation is either duplicate, too legacy-specific, or better replaced with a cleaner design.
- Operational parity matters more than screen-by-screen parity.
- Admin/debug endpoints that only exist because of the legacy architecture should not be preserved automatically.

## 3. Matrix

| Legacy Area | Legacy Capability | Legacy Source | Target Context / Module | Decision | Notes |
|---|---|---|---|---|---|
| Main shell | Unified app shell across modules | `vs-app` | Frontend shell, tenancy, access control | `MVP` | Rebuild as one Vue app, not multiple runtimes under one shell. |
| Auth | Local login, invite, forgot password | main app + `ndx-passport` flows | Identity, Tenancy, Access Control | `MVP` | Required from day one. |
| Auth | OAuth/OIDC login | not present as full user auth in legacy | Identity | `MVP` | New requirement, not parity-only. |
| Users | Cross-site user management | main users/admin flows | Identity, Access Control | `MVP` | Needed for internal rollout and tenant admin. |
| Tenancy | Multi-tenant whitelabel support | not present in legacy | Tenancy | `MVP` | New requirement, must exist before rollout. |
| Domains | Subdomains and custom domains | not present in legacy | Tenancy | `MVP` | Needed for SaaS direction and whitelabel structure. |
| Realtime | Socket-driven live refresh | `ndx-rest` + `ndx-rest-client` | Realtime | `MVP` | Preserve the live-update feel with explicit events and smarter client invalidation. |
| Property | Property search and detail retrieval | `vs-property`, `vs-dezrez`, frontend property consumers | Property, Integrations | `MVP` | Critical dependency for sales and lettings. |
| Property | Cached property sync via webhook/polling | `vs-property`, `vs-dezrez` | Integrations, Property | `MVP` | Rebuild as explicit sync jobs and webhook ingestion. |
| Property | Raw status/debug webhook counters | `/status`, webhook count endpoints | Integrations, Admin | `Drop/Rethink` | Replace with proper observability and admin health views. |
| Sales | Sales dashboard | `vs-agency` dashboard | Sales, Reporting | `MVP` | Operational parity required. |
| Sales | Sales case detail/workspace | `agency_case` | Cases, Sales, Communications, Files | `MVP` | One of the most important launch workflows. |
| Sales | Sales case list | `agency_cases` | Cases, Sales | `MVP` | Required for everyday use. |
| Sales | Sales offer workflow | `agency_offer`, `agency_offers-list` | Sales, Cases | `MVP` | Required for real usage. |
| Sales | Advance progression requests | bespoke progression endpoints/modals | Cases, Sales, Communications | `MVP` | Keep behavior, but model as explicit workflow actions. |
| Sales | Progression milestones and automations | `vs-agency` progressions/milestones | Cases, Sales, Communications | `MVP` | Core parity requirement. |
| Sales | Client management list/detail | `agency_client-management-*` | Sales, Cases, Property | `Later` | Valuable, but secondary to core case flow. |
| Sales | Solicitors screen | `agency_solicitors` | Contacts, Sales | `Later` | Can follow once core case/contact model exists. |
| Sales | Birthdays screen | `agency_birthdays` | CRM, Reporting | `Later` | Client uses this, so retain the capability, but redesign it as a cleaner CRM/reporting feature rather than carrying the legacy screen forward as-is. |
| Sales | New instruction screen | `agency_new-instruction` | CRM, Sales | `Later` | Likely relevant, but can follow core case parity. |
| Sales | Cleanup screen | `agency_cleanup` | Admin | `Drop/Rethink` | Usually a symptom of data/process debt in the old system. |
| Sales | Marketing screen and outbound marketing email | `agency_marketing`, send email endpoints | CRM, Communications | `Later` | Keep concept, but not first-wave conveyancing MVP. |
| Sales | Agreed reporting | `agency_agreed` | Reporting, Sales | `Later` | Useful, but not as critical as live case handling. |
| Lettings | Lettings dashboard | `vs-lettings` dashboard | Lettings, Reporting | `MVP` | Operational parity required. |
| Lettings | Lettings case detail/workspace | `lettings_case` | Cases, Lettings, Communications, Files | `MVP` | Core workflow. |
| Lettings | Lettings case list | `lettings_cases` | Cases, Lettings | `MVP` | Required for everyday use. |
| Lettings | Lettings offers/applications | `lettings_offer`, `lettings_offers-list`, `lettings_accept` | Lettings, Cases | `MVP` | Core operational requirement. |
| Lettings | Lettings progression milestones and automations | `vs-lettings` progressions/milestones | Cases, Lettings, Communications | `MVP` | Core parity requirement. |
| Lettings | Agreed lets reporting | `lettings_agreed`, `/api/agreed/search` | Reporting, Lettings | `MVP` | Explicitly called out in the blueprint as an operational report. |
| Lettings | Available inventory view | `lettings_available` | Property, Lettings | `Later` | Useful, but can follow core case workflows. |
| Lettings | Marketing screen | `lettings_marketing` | CRM, Communications | `Later` | Not launch-critical. |
| Leads | Lead dashboard | `vs-leads` dashboard | Leads, Reporting | `Later` | Keep in roadmap, not in first operational rollout. |
| Leads | Lead list/detail/history | `leads_leads`, `leads_lead`, `leads_history` | Leads | `Later` | Important module, but intentionally sequenced after sales/lettings core. |
| Leads | Lead ingestion from Gravity/Rightmove/OnTheMarket | `vs-leads` services | Integrations, Leads | `Later` | Rebuild after shared platform and case model are proven. |
| Leads | Offer/instruction intake storage | `offers`, `offerslettings`, `instructions` ingestion | Leads, Lettings, Sales | `Later` | Can be absorbed into cleaner intake flows. |
| Leads | Offer PDF generation | `/offerpdf/:id` | Leads, Files | `Later` | Retain if still operationally needed; not first-wave. |
| Maintenance | Calendar/tasks dashboard | `vs-maintenance` | Maintenance | `Later` | Retain as module, but after core conveyancing rollout. |
| Maintenance Leads | Issue list/detail | `maintenance_leads_issues`, `maintenance_leads_issue` | Maintenance | `Later` | Important module, but deliberately sequenced later. |
| Maintenance Leads | Contractors and landlords management | `maintenance_leads_contractors`, `maintenance_leads_landlords` | Maintenance, Contacts | `Later` | Keep, but not first-wave. |
| Maintenance Leads | Works orders / create works order | `maintenance_leads_worksorders`, create works order | Maintenance, Files, Communications | `Later` | Useful but not launch-critical. |
| Maintenance Leads | Message center and inbound email threading | message center, `/api/mailin` | Maintenance, Communications | `Later` | Keep conceptually; rebuild cleanly when maintenance module starts. |
| Maintenance Leads | Chase/inform/complete bespoke routes | `/api/chase/*`, `/api/inform/*`, `/api/complete/*` | Maintenance, Communications | `Later` | Replace with explicit command-style APIs, not ad hoc routes. |
| Templates | Email template management | setup/template screens across modules | Communications | `MVP` | Needed for operational workflow parity. |
| Templates | SMS template management | admin and module setup screens | Communications | `MVP` | Needed where milestone automation depends on SMS. |
| Templates | HTML/Jade template rendering in-app | template render directives | Communications, Frontend | `Later` | Keep template editing/viewing, but not legacy rendering mechanics. |
| Invites | Per-module invite code generation | setup screens calling invite endpoints | Identity, Access Control | `MVP` | Needed for staff onboarding. |
| Profile | User profile screens | main and agency profile flows | Identity | `MVP` | Keep a simpler unified profile/settings area. |
| Setup | Module-specific setup screens | agency/lettings/leads/maintenance setup | Tenancy, Access Control, Communications, Cases | `MVP` | But rebuild as a cleaner tenant admin/settings area, not separate legacy setup pages. |
| Workflow config | Progression template management | agency/lettings setup | Cases | `MVP` | Required so the client can adapt workflows. |
| Targets | Dashboard targets | `targets` in agency/lettings | Reporting | `Later` | Likely useful, but can follow core dashboard parity. |
| Boards | Admin boards management | admin boards | Admin, Reporting | `Later` | Keep only if still tied to live workflows. |
| SMS admin | SMS dashboard/schedule/templates | `vs-sms`, admin sms templates | Communications, Admin | `Later` | Templates are MVP; schedule/dashboard can follow. |
| Admin | Windows/misdescriptions/epc/kadmin screens | admin routes | Admin | `Drop/Rethink` | Carry forward only if a real business use is confirmed. Default is no. |
| Files | Uploads for case/task/issue workflows | upload flows across modules | Files | `MVP` | Required by core case workflows. |
| Files | Upload PDF endpoint | bespoke maintenance upload-pdf flow | Files, Maintenance | `Later` | Revisit when maintenance is rebuilt. |
| Communications | Milestone-triggered email/SMS | agency/lettings/maintenance services | Communications, Cases, Sales, Lettings, Maintenance | `MVP` | Core operational parity. |
| Communications | Marketing/broadcast style sends | send marketing/new sales/reduction emails | Communications, CRM | `Later` | Useful, but not required for initial parallel run. |
| Reporting | Main combined dashboard | main dashboard | Reporting | `Later` | Build product dashboards first; combined executive dashboard can follow. |
| Reporting | Required operational reports | agreed lets, sales pipeline essentials | Reporting | `MVP` | Limit to reports needed for day-to-day operation. |
| Search | Generic CRUD/search over tables via `ndx-rest` | broad legacy pattern | Per-context APIs + Reporting/Search read models | `Drop/Rethink` | Replace with explicit APIs; do not recreate generic table exposure. |
| Permissions | Role-aware route access | legacy Auth + site roles | Access Control | `MVP` | Must exist from the start. |
| Debug/admin APIs | raw DB exec, backup restore, profiler style endpoints | `ndx-connect`, backup, profiler | Admin, Ops | `Drop/Rethink` | Replace with proper operational tooling, not exposed generic database powers. |
| Integrations | Dezrez role/property/offers/viewings/events | `vs-dezrez`, `vs-property` | Integrations, Property, Sales, Lettings | `MVP` | Highest-priority integration. |
| Integrations | Fixflo issue sync and PDF proxy | maintenance leads | Integrations, Maintenance | `Later` | Needed when maintenance comes over. |
| Integrations | Gmail auth helper | `vs-leads` Google flow | Integrations, Identity | `Drop/Rethink` | Only rebuild if a real product need remains. |

## 4. MVP Summary

The first side-by-side operational rollout should include:

- unified shell, auth, invites, profile, and tenant-aware access control
- OAuth/OIDC plus local auth
- explicit realtime live refresh
- property search/detail and Dezrez integration
- sales dashboard, case list, case detail, offers, progression workflows
- lettings dashboard, case list, case detail, offers/applications, progression workflows
- agreed lets and other essential operational reports only
- template management for email/SMS
- file uploads
- workflow template management
- tenant settings/admin sufficient to operate the product

## 5. Deferred Summary

The following should stay in scope for the platform, but not block first rollout:

- client management detail/list
- solicitors management
- marketing screens and broadcast campaigns
- lead management and lead ingestion module
- maintenance and maintenance-leads module
- advanced dashboards and targets
- SMS scheduling/dashboard tooling
- custom PDF generation and works-order tooling

## 6. Drop or Rethink Summary

These should not be carried over by default:

- duplicate route/state variants kept only for backward compatibility
- generic `ndx-rest` style table exposure
- raw status/debug webhook endpoints
- cleanup and data-fix screens that exist because of legacy implementation issues
- profiler, backup restore, and direct DB exec style app endpoints
- niche admin screens unless they are shown to have active business value

## 7. Recommendation

Use this matrix as a delivery gate. Any feature not marked `MVP` should need an explicit reason to move into the first rollout. That is the only practical way to deliver a stable shared platform, retain the workflows the client actually depends on, and avoid rebuilding the legacy sprawl under a newer stack.
