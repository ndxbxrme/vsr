# FRONTEND XRAY — vs-app

## 1) Quick orientation
This frontend is a multi-tenant AngularJS 1.x shell that aggregates multiple legacy line-of-business apps into one runtime: main app shell, agency (sales/conveyancing), lettings, maintenance, maintenance leads, leads, SMS, and admin. Evidence: root app in `src/index.js` creates `vs-app` with dependencies from the `sites` registry, and all feature bundles are imported via `src/imports.js`.

The UI appears to support property lifecycle operations (instructions, marketing, offers, case progression), lead intake/management, maintenance issue/task workflows, user/admin setup, and SMS/admin utilities. Route/state naming and duplicated modules indicate historical mergers.

Primary entrypoints and boot order:
1. `src/index.html` (`ng-app="vs-app"`, root `<div ui-view>` shell)
2. `src/index.js` (builds `sites` config, socket factory, `RestClient(mainmodule)`, env constants)
3. `src/imports.js` (imports all site modules/routes/directives/services)
4. `src/imports_local.js` (imports `sites/main/*` shell feature files)

Angular root module names:
- Root shell: `vs-app`
- Aggregated feature modules: `ndx`, `vs-agency`, `vs-lettings`, `vs-lettings-inner`, `vs-maintenance`, `vs-maintenance-leads`, `vs-leads`, `vs-sms`, `vs-admin`

High-level feature areas inferred:
- Main shell/auth/navigation (`src/sites/main/*`)
- Agency conveyancing flows (`src/sites/agency/routes/*`)
- Lettings workflows (`src/sites/lettings/routes/*`)
- Maintenance calendar/tasks (`src/sites/maintenance/*`)
- Maintenance leads/issues/contractors/landlords (`src/sites/maintenance_leads/*`)
- Leads CRM (`src/sites/leads/*`)
- Admin + SMS tooling (`src/sites/admin/*`, `src/sites/sms/*`)

## 2) App bootstrap & runtime structure
- How Angular is bootstrapped:
  - Primary runtime uses `ng-app="vs-app"` in `src/index.html`.
  - No manual `angular.bootstrap(...)` found in app code.
  - Legacy standalone site HTML entrypoints also exist (`src/sites/*/index.html`) with their own `ng-app` declarations.

- Root module definition location:
  - `src/index.js:76` — `angular.module('vs-app', Object.values(sites).map(site => site.module))`

- Module dependency graph:
  - `vs-app` -> `ndx`, `vs-lettings`, `vs-maintenance`, `vs-maintenance-leads`, `vs-agency`, `vs-leads`, `vs-sms`, `vs-admin` (`src/index.js`)
  - `vs-agency` -> `ndx`, `ui.router`, `agency-date-swiper`, `multi-check`, `ui.gravatar`, `ngFileUpload` (`src/sites/agency/app.js`)
  - `vs-lettings` -> `ndx`, `ui.router`, `multi-check`, `ui.gravatar`, `ngFileUpload`, `vs-lettings-inner`, `lettings-date-swiper`, `yaru22.angular-timeago`, `angular-flipclock` (`src/sites/lettings/app.js`)
  - `vs-lettings-inner` -> feature submodule used by many lettings routes/directives (`src/sites/lettings/app.js`)
  - `vs-maintenance` -> `ndx`, `ui.router`, `ui.gravatar`, `ui.select2`, `maintenance-date-swiper`, `ngFileUpload`, `ng-sumoselect` (`src/sites/maintenance/app.js`)
  - `vs-maintenance-leads` -> `ndx`, `ui.router`, `ngFileUpload`, `ui.gravatar`, `ng-sumoselect`, `maintenance-leads-date-swiper` (`src/sites/maintenance_leads/app.js`)
  - `vs-leads` -> `ndx`, `ui.router`, `ng-sumoselect`, `ui.gravatar`, `multi-check` (`src/sites/leads/app.js`)
  - `vs-sms` -> `ndx`, `ui.router`, `ng-sumoselect` (`src/sites/sms/app.js`)
  - `vs-admin` -> `ndx`, `ui.router`, `ng-sumoselect` (`src/sites/admin/app.js`)
  - Shared infra module `ndx` provides `Auth` and `rest` providers (`src/services/ndx-auth.js`, `src/services/ndx-rest-client.js`)

- Global run/config blocks (what they configure):
  - URL fallback + HTML5 mode in each app (`$urlRouterProvider.otherwise('/')`, `$locationProvider.html5Mode(true)`) in `src/sites/*/app.js`
  - Main runtime state helpers/body classes/breadcrumb writes/modal helpers in `src/sites/main/app.js`
  - Auth bootstrap + transition guard is global in `src/services/ndx-auth.js` (`$transitions.onBefore`, role checks, title updates)
  - REST data layer wires dynamic endpoints + socket-driven cache invalidation in `src/services/ndx-rest-client.js`
  - `src/index.js` sets `sites` host URLs and initializes socket.io per site

## 3) Routing / navigation map (MUST be complete)
### 3.1 Router type
- `ui-router` is the active router (evidence: module deps include `ui.router` across all site apps, widespread `$stateProvider.state(...)`, root and site templates use `ui-view`).
- No app usage of `ngRoute`/`$routeProvider` found under app code (only vendored library under `src/third_party/angular-route`).

### 3.2 Route/state inventory
| URL | Route/State | Template | Controller | Resolves/Guards | Feature area | Defined in |
|---|---|---|---|---|---|---|
| `/admin/boards` | `admin_boards` | `<admin-boards></admin-boards>` | Unknown | `data.auth` superadmin | Admin | `src/sites/admin/routes/boards/boards.routes.js` |
| `/admin` | `admin_dashboard` | `<admin-dashboard></admin-dashboard>` | Unknown | `data.auth` superadmin | Admin | `src/sites/admin/routes/dashboard/dashboard.routes.js` |
| `/admin/epc` | `admin_epc` | `<admin-epc></admin-epc>` | Unknown | `data.auth` superadmin | Admin | `src/sites/admin/routes/epc/epc.routes.js` |
| `/admin/kadmin` | `admin_kadmin` | `<admin-kadmin></admin-kadmin>` | Unknown | `data.auth` superadmin | Admin | `src/sites/admin/routes/kadmin/kadmin.routes.js` |
| `/admin/misdescriptions` | `admin_misdescriptions` | `<admin-misdescriptions></admin-misdescriptions>` | Unknown | `data.auth` superadmin | Admin | `src/sites/admin/routes/misdescriptions/misdescriptions.routes.js` |
| `/admin/windows` | `admin_windows` | `<admin-windows></admin-windows>` | Unknown | `data.auth` superadmin | Admin | `src/sites/admin/routes/windows/windows.routes.js` |
| `/agency/agreed` | `agency_agreed` | `require("./agreed.html")` | `agencyAgreedCtrl` | `resolve.user = Auth.getPromise([...])` | Agency | `src/sites/agency/routes/agreed/agreed.routes.js` |
| `/agency/agreed` | `agency_agreed` | `require("./agreed.html")` | `agencyAgreedCtrl` | duplicate legacy route file | Agency | `src/sites/agency/routes/agreed - Copy/agreed.routes.js` |
| `/agency/birthdays` | `agency_birthdays` | `require("./birthdays.html")` | `agencyBirthdaysCtrl` | `resolve.user` restricted admin/superadmin | Agency | `src/sites/agency/routes/birthdays/birthdays.routes.js` |
| `/agency/case/:roleId` | `agency_case` | `require("./case.html")` | `agencyCaseCtrl` | `resolve.user = Auth.getPromise([...])` | Agency | `src/sites/agency/routes/case/case.routes.js` |
| `/agency/cases` | `agency_cases` | `require("./cases.html")` | `agencyCasesCtrl` | `resolve.user = Auth.getPromise([...])` | Agency | `src/sites/agency/routes/cases/cases.routes.js` |
| `/agency/cleanup` | `agency_cleanup` | `require("./cleanup.html")` | `agencyCleanupCtrl` | admin/superadmin guard | Agency | `src/sites/agency/routes/cleanup/cleanup.routes.js` |
| `/agency/client-management/:id` | `agency_client-management-details` | `require("./client-management-details.html")` | `agencyClientManagementDetailsCtrl` | guarded | Agency | `src/sites/agency/routes/client-management-details/client-management-details.routes.js` |
| `/agency/client-management/roleid/:roleid` | `agency_client-management-details-roleid` | `require("./client-management-details.html")` | `agencyClientManagementDetailsCtrl` | guarded | Agency | `src/sites/agency/routes/client-management-details/client-management-details.routes.js` |
| `/agency/client-management` | `agency_client-management-list` | `require("./client-management-list.html")` | `agencyClientManagementListCtrl` | guarded | Agency | `src/sites/agency/routes/client-management-list/client-management-list.routes.js` |
| `/agency/coming-soon` | `agency_coming-soon` | `<agency-coming-soon>` | Unknown | superadmin via state data | Agency | `src/sites/agency/routes/coming-soon/coming-soon.routes.js` |
| `/agency` | `agency_dashboard` | `require("./dashboard.html")` | `agencyDashboardCtrl` | `resolve.user = Auth.getPromise()` | Agency | `src/sites/agency/routes/dashboard/dashboard.routes.js` |
| `/agency/dashboard-item/:id/:type` | `agency_dashboardItem` | `require("./dashboard-item.html")` | `agencyDashboardItemCtrl` | admin/superadmin guard | Agency | `src/sites/agency/routes/dashboard-item/dashboard-item.routes.js` |
| `/agency/invited` | `agency_invited` | `require("./invited.html")` | `agencyInvitedCtrl` | no resolve | Agency | `src/sites/agency/routes/invited/invited.routes.js` |
| `/agency/marketing` | `agency_marketing` | `require("./marketing.html")` | `agencyMarketingCtrl` | guarded | Agency | `src/sites/agency/routes/marketing/marketing.routes.js` |
| `/agency/new-instruction` | `agency_new-instruction` | `<agency-new-instruction>` | Unknown | superadmin via state data | Agency | `src/sites/agency/routes/new-instruction/new-instruction.routes.js` |
| `/agency/offer/:id` | `agency_offer` | `require("./offer.html")` | `agencyOfferCtrl` | guarded | Agency | `src/sites/agency/routes/offer/offer.routes.js` |
| `/agency/offer/roleid/:roleid` | `agency_offer-roleid` | `require("./offer.html")` | `agencyOfferCtrl` | guarded | Agency | `src/sites/agency/routes/offer/offer.routes.js` |
| `/agency/offers` | `agency_offers-list` | `require("./offers-list.html")` | `agencyOffersListCtrl` | guarded | Agency | `src/sites/agency/routes/offers-list/offers-list.routes.js` |
| `/agency/offers/historic` | `agency_offers-list_historic` | `require("./offers-list.html")` | `agencyOffersListCtrl` | guarded | Agency | `src/sites/agency/routes/offers-list/offers-list.routes.js` |
| `/agency/profile` | `agency_profile` | `require("./profile.html")` | `agencyProfileCtrl` | guarded | Agency | `src/sites/agency/routes/profile/profile.routes.js` |
| `/agency/setup` | `agency_setup` | `require("./setup.html")` | `agencySetupCtrl` | admin/superadmin guard | Agency | `src/sites/agency/routes/setup/setup.routes.js` |
| `/agency/solicitors` | `agency_solicitors` | `require("./solicitors.html")` | `agencySolicitorsCtrl` | guarded | Agency | `src/sites/agency/routes/solicitors/solicitors.routes.js` |
| `/agency/template/:id/:type` | `agency_template` | `require("./template.html")` | `agencyTemplateCtrl` | admin/superadmin guard | Agency | `src/sites/agency/routes/template/template.routes.js` |
| `/?view` | `dashboard` | main dashboard html | `mainDashboardCtrl` | no explicit resolve | Main | `src/sites/main/dashboard/dashboard.js` |
| `/?view` | `dashboard` | duplicate component variant | `mainDashboardCtrl` | legacy duplicate | Main | `src/components/dashboard/dashboard.js` |
| `/forgot` | `forgot` | `<forgot>` | Unknown | none | Main | `src/sites/main/forgot/forgot.js` |
| `/forgot` | `forgot` | `<forgot>` | Unknown | legacy duplicate | Main | `src/components/forgot/forgot.js` |
| `/forgot/:code` | `forgot-response` | `<forgot-code>` | Unknown | none | Main | `src/sites/main/forgot/forgot.js` |
| `/forgot/:code` | `forgot-response` | `<forgot-code>` | Unknown | legacy duplicate | Main | `src/components/forgot/forgot.js` |
| `/invited/:code` | `invited` | `<invited>` | Unknown | none | Main | `src/sites/main/invited/invited.js` |
| `/invited/:code` | `invited` | `<invited>` | Unknown | legacy duplicate | Main | `src/components/invited/invited.js` |
| `/leads` | `leads_dashboard` | `<leads-dashboard>` | Unknown | state `data.auth` in route file | Leads | `src/sites/leads/routes/dashboard/dashboard.routes.js` |
| `/leads/history` | `leads_history` | `require("./history.html")` | `leadsHistoryCtrl` | role guard from `data.auth` | Leads | `src/sites/leads/routes/history/history.routes.js` |
| `/leads/invite/:code` | `leads_invited` | `require("./invited.html")` | `leadsInvitedCtrl` | none | Leads | `src/sites/leads/routes/invited/invited.routes.js` |
| `/leads/lead/:_id` | `leads_lead` | `require("./lead.html")` | `leadsLeadCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/lead/lead.routes.js` |
| `/leads/lead` | `leads_lead-new` | `require("./lead.html")` | `leadsLeadCtrl` | same guard | Leads | `src/sites/leads/routes/lead/lead.routes.js` |
| `/leads/lead/:_id/all` | `leads_leadDeleted` | `require("./lead.html")` | `leadsLeadCtrl` | same guard | Leads | `src/sites/leads/routes/lead/lead.routes.js` |
| `/leads/leads` | `leads_leads` | `require("./leads.html")` | `leadsLeadsCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/leads/leads.routes.js` |
| `/leads/letting` | `leads_letting` | `require("./leads.html")` | `leadsLeadsCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/leads/leads.routes.js` |
| `/leads/selling` | `leads_selling` | `require("./leads.html")` | `leadsLeadsCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/leads/leads.routes.js` |
| `/leads/setup` | `leads_setup` | `require("./setup.html")` | `leadsSetupCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/setup/setup.routes.js` |
| `/leads/template/:id/:type` | `leads_template` | `require("./template.html")` | `leadsTemplateCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/template/template.routes.js` |
| `/leads/valuation` | `leads_valuation` | `require("./leads.html")` | `leadsLeadsCtrl` | role guard via `data.auth` | Leads | `src/sites/leads/routes/leads/leads.routes.js` |
| `/lettings/accept` | `lettings_accept` | `require("./accept.html")` | `lettingsAcceptCtrl` | `resolve.user = Auth.getPromise([...])` | Lettings | `src/sites/lettings/routes/accept/accept.routes.js` |
| `/lettings/agreed` | `lettings_agreed` | `require("./agreed.html")` | `lettingsAgreedCtrl` | guarded | Lettings | `src/sites/lettings/routes/agreed/agreed.routes.js` |
| `/lettings/available` | `lettings_available` | `require("./available.html")` | `lettingsAvailableCtrl` | guarded | Lettings | `src/sites/lettings/routes/available/available.routes.js` |
| `/lettings/case/:roleId` | `lettings_case` | `require("./case.html")` | `lettingsCaseCtrl` | guarded | Lettings | `src/sites/lettings/routes/case/case.routes.js` |
| `/lettings/cases` | `lettings_cases` | `require("./cases.html")` | `lettingsCasesCtrl` | guarded | Lettings | `src/sites/lettings/routes/cases/cases.routes.js` |
| `/lettings/coming-soon` | `lettings_coming-soon` | `<lettings-coming-soon>` | Unknown | superadmin state data | Lettings | `src/sites/lettings/routes/coming-soon/coming-soon.routes.js` |
| `/lettings` | `lettings_dashboard` | `<lettings-dashboard>` | Unknown | no resolve | Lettings | `src/sites/lettings/routes/dashboard/dashboard.routes.js` |
| `/lettings/dashboard-item/:id/:type` | `lettings_dashboardItem` | `require("./dashboard-item.html")` | `lettingsDashboardItemCtrl` | admin/superadmin guard | Lettings | `src/sites/lettings/routes/dashboard-item/dashboard-item.routes.js` |
| `/lettings/marketing` | `lettings_marketing` | `require("./marketing.html")` | `lettingsMarketingCtrl` | guarded | Lettings | `src/sites/lettings/routes/marketing/marketing.routes.js` |
| `/lettings/offer/:id` | `lettings_offer` | `require("./offer.html")` | `lettingsOfferCtrl` | guarded | Lettings | `src/sites/lettings/routes/offer/offer.routes.js` |
| `/lettings/offer/roleid/:roleid` | `lettings_offer-roleid` | `require("./offer.html")` | `lettingsOfferCtrl` | guarded | Lettings | `src/sites/lettings/routes/offer/offer.routes.js` |
| `/lettings/offers` | `lettings_offers-list` | `require("./offers-list.html")` | `lettingsOffersListCtrl` | guarded | Lettings | `src/sites/lettings/routes/offers-list/offers-list.routes.js` |
| `/lettings/offers/historic` | `lettings_offers-list_historic` | `require("./offers-list.html")` | `lettingsOffersListCtrl` | guarded | Lettings | `src/sites/lettings/routes/offers-list/offers-list.routes.js` |
| `/lettings/setup` | `lettings_setup` | `require("./setup.html")` | `lettingsSetupCtrl` | admin/superadmin guard | Lettings | `src/sites/lettings/routes/setup/setup.routes.js` |
| `/lettings/template/:id/:type` | `lettings_template` | `require("./template.html")` | `lettingsTemplateCtrl` | admin/superadmin guard | Lettings | `src/sites/lettings/routes/template/template.routes.js` |
| `/profile` | `main_profile` | `<profile>` | Unknown | `data.title` only | Main | `src/sites/main/profile/profile.js` |
| `/profile/:id` | `main_profile-id` | `<profile>` | Unknown | `data.auth` superadmin | Main | `src/sites/main/profile/profile.js` |
| `/setup` | `main_setup` | `<main-setup>` | Unknown | `data.auth` admin | Main | `src/sites/main/setup/setup.js` |
| `/users` | `main_users` | `require("./users.html")` | `mainUsersCtrl` | `data.auth` superadmin | Main | `src/sites/main/users/users.js` |
| `/users` | `main_users` | component duplicate | `mainUsersCtrl` | legacy duplicate | Main | `src/components/users/users.js` |
| `/maintenance` | `maintenance_dashboard` | `require("./dashboard.html")` | `maintenanceDashboardCtrl` | `resolve.user = Auth.getPromise()` | Maintenance | `src/sites/maintenance/routes/dashboard/dashboard.routes.js` |
| `/maintenance_leads/contractor/:_id` | `maintenance_leads_contractor` | `require("./contractor.html")` | `maintenance_leadsContractorCtrl` | state `data.auth` in route | Maintenance Leads | `src/sites/maintenance_leads/routes/contractor/contractor.routes.js` |
| `/maintenance_leads/contractors` | `maintenance_leads_contractors` | `require("./contractors.html")` | `maintenance_leadsContractorsCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/contractors/contractors.routes.js` |
| `/maintenance_leads/create-works-order/:_id` | `maintenance_leads_createworksorder` | `require("./create-works-order.html")` | `maintenance_leadsCreateWorksOrderCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/create-works-order/create-works-order.routes.js` |
| `/maintenance_leads` | `maintenance_leads_dashboard` | `<maintenanceleads-dashboard>` | Unknown | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/dashboard/dashboard.routes.js` |
| `/maintenance_leads/diary/:_id` | `maintenance_leads_diary` | `require("./diary.html")` | `maintenance_leadsDiaryCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/diary/diary.routes.js` |
| `/maintenance_leads/historic` | `maintenance_leads_historic` | `require("./historic.html")` | `maintenance_leadsHistoricCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/historic/historic.routes.js` |
| `/maintenance_leads/issue/:_id` | `maintenance_leads_issue` | `require("./issue.html")` | `maintenance_leadsIssueCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/issue/issue.routes.js` |
| `/maintenance_leads/issues` | `maintenance_leads_issues` | `require("./issues.html")` | `maintenance_leadsIssuesCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/issues/issues.routes.js` |
| `/maintenance_leads/landlord/:_id` | `maintenance_leads_landlord` | `require("./landlord.html")` | `maintenance_leadslandlordCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/landlord/landlord.routes.js` |
| `/maintenance_leads/landlords` | `maintenance_leads_landlords` | `require("./landlords.html")` | `maintenance_leadslandlordsCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/landlords/landlords.routes.js` |
| `/maintenance_leads/setup` | `maintenance_leads_setup` | `require("./setup.html")` | `maintenance_leadsSetupCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/setup/setup.routes.js` |
| `/maintenance_leads/template/:id/:type` | `maintenance_leads_template` | `require("./template.html")` | `maintenance_leadsTemplateCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/template/template.routes.js` |
| `/maintenance_leads/works-orders` | `maintenance_leads_worksorders` | `require("./works-orders.html")` | `maintenance_leadsWorksOrdersCtrl` | guarded by state data | Maintenance Leads | `src/sites/maintenance_leads/routes/works-orders/works-orders.routes.js` |
| `/maintenance/setup` | `maintenance_setup` | `require("./setup.html")` | `maintenanceSetupCtrl` | admin/superadmin resolve | Maintenance | `src/sites/maintenance/routes/setup/setup.routes.js` |
| `/profile` | `profile` | `<profile>` | Unknown | legacy component route | Main | `src/components/profile/profile.js` |
| `/profile/:id` | `profile-id` | `<profile>` | Unknown | legacy component route | Main | `src/components/profile/profile.js` |
| `/setup` | `setup` | `<main-setup>` | Unknown | legacy component route | Main | `src/components/setup/setup.js` |
| `/sms` | `sms_dashboard` | `<sms-dashboard>` | Unknown | superadmin by state data | SMS | `src/sites/sms/routes/dashboard/dashboard.routes.js` |
| `/sms/schedule` | `sms_schedule` | `<sms-schedule>` | Unknown | superadmin by state data | SMS | `src/sites/sms/routes/schedule/schedule.routes.js` |
| `/admin/sms-templates` | `sms_templates` | `<sms-templates>` | Unknown | superadmin by state data | Admin | `src/sites/admin/routes/sms-templates/sms-templates.routes.js` |
| `/template/:id/:type` | `template` | `<main-template>` | Unknown | `data.auth` admin | Main | `src/sites/main/template/template.js` |
| `/template/:id/:type` | `template` | component duplicate | Unknown | legacy duplicate | Main | `src/components/template/template.js` |

### /agency/case/:roleId (`agency_case`)
- **Purpose:** primary sales/conveyancing case workspace.
- **UI composition:** large case template (`src/sites/agency/routes/case/case.html`), milestone/progression directives, board/admin sections.
- **Data needs:** property detail fetches from `${env.PROPERTY_URL}/property`, search from `${env.PROPERTY_URL}/search`, ndx lists (`agency:progressions`, `main:boards`).
- **State interactions:** uses shared `agencyProperty`, `AgencyProgressionPopup`, `breadcrumbs`; listens/cleans on `$destroy`.
- **Notes:** heavy cross-domain coupling (property admin functions imported from shared JS utility).

### /agency/offer/:id (`agency_offer`)
- **Purpose:** offer handling for sales pipeline.
- **UI composition:** offer form + property admin action blocks.
- **Data needs:** `agencyProperty` cache, API posts to `/api/properties/:id`, progression APIs.
- **State interactions:** shared singleton service + modal helpers.
- **Notes:** duplicate sibling state `/agency/offer/roleid/:roleid` indicates backward URL compatibility seam.

### /agency/client-management/:id (`agency_client-management-details`)
- **Purpose:** detailed client management view for a property.
- **UI composition:** large detail template (`client-management-details.html`), boards/progression widgets.
- **Data needs:** `agency:clientmanagement`, `main:boards`, external Dezrez stats/events endpoints.
- **State interactions:** `breadcrumbs.setInfo`, `$scope.$on('$destroy')` cleanup.
- **Notes:** mixes internal API and hard-coded external host calls.

### /agency (dashboard)
- **Purpose:** sales dashboard.
- **UI composition:** dashboard card lists and charts.
- **Data needs:** ndx lists (`agency:properties`, `agency:dashboard`, `agency:progressions`, `agency:clientmanagement`, `main:users`, `main:propertyadmin`) plus static JSON `public/data`.
- **State interactions:** depends on `Auth` role checks in controller logic.
- **Notes:** dashboard logic duplicated conceptually in `mainDashboardCtrl`.

### /agency/setup
- **Purpose:** configure users/templates/dashboard/progressions for agency site.
- **UI composition:** setup forms, template editors.
- **Data needs:** `agency:progressions`, `agency:users`, template lists; `/api/get-invite-code`, `/api/properties/reset-progressions`.
- **State interactions:** list/save via shared rest wrapper.
- **Notes:** similar pattern duplicated in lettings and maintenance leads setup routes.

### /lettings/case/:roleId (`lettings_case`)
- **Purpose:** lettings case management (parallel to agency case).
- **UI composition:** large case template (`src/sites/lettings/routes/case/case.html`) + progression widgets.
- **Data needs:** property search/fetch via `${env.PROPERTY_URL}`, ndx lists (`lettings:progressions`, `main:boards`), upload endpoints.
- **State interactions:** `lettingsProperty`, `LettingsProgressionPopup`, breadcrumbs.
- **Notes:** near-copy architecture of agency case with module-specific names.

### /lettings/offer/:id (`lettings_offer`)
- **Purpose:** lettings offer workflow.
- **UI composition:** offer template with acceptance/progression data.
- **Data needs:** role-based fetch and posts to `/api/properties/:id`, `/api/agreed/search`.
- **State interactions:** Auth gating and root modal helpers.
- **Notes:** companion `roleid` state again suggests migration seam.

### /lettings/agreed
- **Purpose:** agreed lets + target tracking.
- **UI composition:** list/table views with target controls.
- **Data needs:** `/api/agreed/search`, `lettings:targets`, `lettings:properties`.
- **State interactions:** list save/delete and throttled refresh through rest provider.
- **Notes:** strongly coupled to backend response shape.

### /lettings/available
- **Purpose:** available lettings inventory view.
- **UI composition:** table/list of properties.
- **Data needs:** `${env.PROPERTY_URL}/search` dynamic route-based rest call.
- **State interactions:** local scope filters and `$destroy` handling.
- **Notes:** uses shared external property API model used across multiple modules.

### /lettings (dashboard)
- **Purpose:** lettings dashboard summary.
- **UI composition:** custom dashboard directive `<lettings-dashboard>`.
- **Data needs:** `lettings:properties`, `lettings:dashboard`, `lettings:progressions`, and route-based property search.
- **State interactions:** root auth/state helpers.
- **Notes:** implemented as directive controller-style, not component.

### /maintenance_leads/issue/:_id
- **Purpose:** maintenance issue detail and task execution.
- **UI composition:** large issue template (`issue.html`/`issue.jade`), task popup, message center.
- **Data needs:** lists (`maintenance_leads:tasks`, `contractors`, `landlords`), endpoints `/api/notes/:id`, `/api/chase/*`, `/api/inform/*`, `/api/complete/:id`.
- **State interactions:** emits `swiper:show`, listens for `set-date`, uses `breadcrumbs` and popup service.
- **Notes:** central workflow with dense coupling to custom event bus and bespoke endpoints.

### /maintenance_leads/issues
- **Purpose:** active issue queue.
- **UI composition:** issue table listing and status filters.
- **Data needs:** `maintenance_leads:issues` list with sort/filter.
- **State interactions:** uses shared `Sorter` utility and list refresh.
- **Notes:** ties into calendar/task popups from same module.

### /maintenance_leads/works-orders
- **Purpose:** outstanding works-order view.
- **UI composition:** works-order table.
- **Data needs:** `maintenance_leads:issues` filtered by works-order signals.
- **State interactions:** uses `DbItem` lookup service for enrichment.
- **Notes:** linked to PDF upload/generation flow in create-works-order modal.

### /maintenance_leads/create-works-order/:_id
- **Purpose:** create works order from issue.
- **UI composition:** long form + PDF generation UI.
- **Data needs:** contractor/landlord lists, `/api/upload-pdf`, `/api/issues/:id`, `/api/tasks`.
- **State interactions:** modal/result flows and form-driven async updates.
- **Notes:** HTML-to-PDF + upload workflow is rebuild-risk hotspot.

### /maintenance
- **Purpose:** maintenance calendar dashboard.
- **UI composition:** calendar + task popup directives.
- **Data needs:** `maintenance:tasks` and user lists.
- **State interactions:** `$rootScope` events (`toolbar:date-tap`, `set-date`, `swiper:show`).
- **Notes:** gesture-heavy date swiper directives with manual `$apply`.

### /maintenance/setup
- **Purpose:** maintenance setup/users.
- **UI composition:** setup form.
- **Data needs:** `maintenance:users`, `/api/get-invite-code`.
- **State interactions:** rest save/list helpers.
- **Notes:** same setup pattern as other modules.

### /leads/lead/:_id (`leads_lead`)
- **Purpose:** view/edit lead record.
- **UI composition:** lead detail form with source/property selectors.
- **Data needs:** route-based property search, `/api/leads/:id` updates.
- **State interactions:** Auth + breadcrumbs + confirmation modal.
- **Notes:** uses bespoke lead status model with many conditional fields.

### /leads/leads (`leads_leads`)
- **Purpose:** lead queue (selling/letting/valuation variants).
- **UI composition:** shared template with route-specific filters.
- **Data needs:** `leads:leads` with where clauses by roleType/booked.
- **State interactions:** Sorter-based filtering.
- **Notes:** same controller reused across 4 states.

### /leads/history
- **Purpose:** historic leads and restore flow.
- **UI composition:** historic table list.
- **Data needs:** `leads:leads` queries + `/api/leads/:id` restore-style posts.
- **State interactions:** list reload after updates.
- **Notes:** uses same entity with soft-delete style flags.

### /users (`main_users`)
- **Purpose:** cross-site user/role administration from shell.
- **UI composition:** users management table + modal (`new-user.html`).
- **Data needs:** lists from all site user endpoints, user search, send invite/reset APIs.
- **State interactions:** uses root `modal`, `auth`, and list save/delete wrappers.
- **Notes:** strong coupling across all site schemas (`user.local.sites[site]`).

### /?view (`dashboard`)
- **Purpose:** merged super-dashboard showing sales and lettings slices.
- **UI composition:** main dashboard with tabbed `view` parameter.
- **Data needs:** mixed `agency:*`, `lettings:*`, `leads:*`, `main:*` endpoints and route-based property search.
- **State interactions:** role-aware visibility and breadcrumbs.
- **Notes:** canonical “agglomeration” surface where multiple domains meet.

### /template/:id/:type (`template` / `agency_template` / `lettings_template` / `leads_template` / `maintenance_leads_template`)
- **Purpose:** template/email rendering editors across modules.
- **UI composition:** shared template render directives (`templateRender`, `jadeRender`).
- **Data needs:** module-specific template endpoints + property lookups.
- **State interactions:** state params drive template type/id resolution.
- **Notes:** repeated route shape across modules; strong candidate for consolidated rebuild feature.

## 4) UI building blocks
### 4.1 Layout/shell
- App shell components/directives:
  - `menu` (`src/sites/main/menu/menu.js`)
  - `breadcrumbs` (`src/sites/main/breadcrumbs/breadcrumbs.js`)
  - `login` (`src/sites/main/login/login.js`)
  - `footer` (`src/sites/main/footer/footer.js`)
  - progression/task/date popup directives in root HTML (`src/index.html`)
- View composition:
  - Root shell uses single `ui-view` (`src/index.html`)
  - No nested named views found; composition is template directives inside each state template.

### 4.2 Directives/components inventory
| Name | Type (directive/component) | Inputs/Bindings | Outputs/Events | What it renders/does | Used by | Defined in |
|---|---|---|---|---|---|---|
| `menu` | directive | isolate `{}` | reads root `state()` | top navigation + dashboard tab state | root shell | `src/sites/main/menu/menu.js` |
| `breadcrumbs` | directive | none | none | recent/favorites breadcrumb UI | root shell | `src/sites/main/breadcrumbs/breadcrumbs.js` |
| `login` | directive | isolate `{}` | submits auth calls | login/signup form | root shell | `src/sites/main/login/login.js` |
| `footer` | directive | isolate `{}` | none | footer/version | root shell | `src/sites/main/footer/footer.js` |
| `mainSetup` | directive | isolate `{}` | none | main setup view | `main_setup` state | `src/sites/main/setup/setup.js` |
| `profile` | directive | isolate `{}` | none | profile UI | profile states | `src/sites/main/profile/profile.js` |
| `forgot`, `forgotCode` | directive | isolate `{}` | state nav after success | forgot/reset flow | forgot states | `src/sites/main/forgot/forgot.js` |
| `invited` | directive | isolate `{}` | registration submit | invite acceptance flow | invited states | `src/sites/main/invited/invited.js` |
| `mainTemplate` | directive | isolate `{}` | none | template host view | template states | `src/sites/main/template/template.js` |
| `agencyProgression`, `agencyMilestone`, `agencyProgressionPopup` | directive | milestone/progression attrs | emits/listens `set-date`, `swiper:*` | progression timeline + popup actions | agency case/offer/details | `src/sites/agency/directives/*` |
| `lettingsProgression`, `lettingsMilestone`, `lettingsProgressionPopup` | directive | milestone attrs | emits/listens `set-date`, `swiper:*` | lettings progression widgets | lettings case/offer | `src/sites/lettings/directives/*` |
| `agencyDateSwiper`, `lettingsDateSwiper`, `maintenanceDateSwiper`, `maintenanceLeadsDateSwiper` | directive | `config` object | emits `toolbar:date-tap`, `set-date` | swipe date toolbar using HammerJS | progression/task/calendar UIs | `src/sites/*/directives/date-swiper/*.d.js` |
| `maintenanceCalendar`, `calendar` | directive | calendar config via scope | listens `toolbar:date-tap` | task/issue calendar grids | maintenance + maintenance leads dashboards | `src/sites/maintenance/directives/calendar/*`, `src/sites/maintenance_leads/directives/calendar/*` |
| `maintenanceTaskPopup`, `taskPopup` | directive | reads popup service state | issue/task actions trigger API | floating popup editor for task actions | maintenance modules | `src/sites/maintenance/directives/task-popup/*`, `src/sites/maintenance_leads/directives/task-popup/*` |
| `maintenanceTask`, `task` | directive | task object | opens popup service | task row/card rendering | calendars + issue views | `src/sites/maintenance/directives/task/*`, `src/sites/maintenance_leads/directives/task/*` |
| `messageCenter` | directive | uses issue context | sends message-center API | issue email/message panel | maintenance issue page | `src/sites/maintenance_leads/directives/message-center/message-center.d.js` |
| `lettingsDashboard`, `leadsDashboard`, `maintenanceleadsDashboard` | directive | isolate `{}` | none | dashboard page rendering | corresponding dashboard states | `src/sites/lettings/routes/dashboard/dashboard.ctrl.js`, `src/sites/leads/routes/dashboard/dashboard.ctrl.js`, `src/sites/maintenance_leads/routes/dashboard/dashboard.ctrl.js` |
| `adminDashboard`, `adminBoards`, `adminWindows`, `adminEpc`, `adminKadmin`, `adminMisdescriptions`, `smsTemplates`, `smsDashboard`, `smsSchedule` | directive | isolate `{}` | local actions only | route-level admin/sms screens | admin/sms routes | `src/sites/admin/routes/*/*.ctrl.js`, `src/sites/sms/routes/*/*.ctrl.js` |
| `agencyDateInput`, `leadsDateInput`, `numeric`, `paging`, `popout`, `header` | directive | mostly `ngModel`/config attrs | form/input events | shared form controls and UI helpers | leads/agency forms | `src/sites/leads/directives/*`, `src/sites/agency/directives/date-input/*` |
| `templateRender`, `jadeRender`, `agencyTemplateRender`, `agencyJadeRender` | directive | `data`, `ngModel` | `$timeout` rerender | render HTML/Jade templates inside iframe/div | template states across modules | `src/sites/*/directives/*render*` |
| `contactDetails`, `tenantDetails`, `chainItem`, `mobileMenu`, `flipClock` | directive | simple attrs | none | domain-specific partials | agency/lettings flows | `src/sites/agency/directives/*`, `src/sites/lettings/directives/*` |

### 4.3 Controllers (legacy) inventory
| Controller | Used by (routes/templates) | Responsibilities | Key deps/services | Defined in |
|---|---|---|---|---|
| `mainDashboardCtrl` | `dashboard` | merged sales+lettings dashboard | `Auth`, `$scope.list`, `$http`, `env` | `src/sites/main/dashboard/dashboard.js` |
| `mainUsersCtrl` | `main_users` | cross-site user role management | `$scope.list`, `$http.sites`, modal helper | `src/sites/main/users/users.js` |
| `agencyCaseCtrl` | `agency_case` | sales case workflow | `agencyProperty`, `AgencyProgressionPopup`, `Upload`, shared property-admin helpers | `src/sites/agency/routes/case/case.ctrl.js` |
| `agencyOfferCtrl` | `agency_offer*` | offer workflow + property admin actions | `agencyProperty`, `Auth`, `Upload` | `src/sites/agency/routes/offer/offer.ctrl.js` |
| `agencyClientManagementDetailsCtrl` | `agency_client-management-details*` | client mgmt detail + stats/events | `agencyProperty`, `$http`, external Dezrez calls | `src/sites/agency/routes/client-management-details/client-management-details.ctrl.js` |
| `agencyDashboardCtrl` | `agency_dashboard` | sales dashboard lists | `$scope.list`, `$http`, `env` | `src/sites/agency/routes/dashboard/dashboard.ctrl.js` |
| `agencySetupCtrl` | `agency_setup` | setup users/templates/progressions | `$scope.list`, `$http` | `src/sites/agency/routes/setup/setup.ctrl.js` |
| `agencyAgreedCtrl` | `agency_agreed` | agreed pipeline and targets | `$scope.list`, `$http` | `src/sites/agency/routes/agreed/agreed.ctrl.js` |
| `lettingsCaseCtrl` | `lettings_case` | lettings case workflow | `lettingsProperty`, `LettingsProgressionPopup`, `Upload` | `src/sites/lettings/routes/case/case.ctrl.js` |
| `lettingsOfferCtrl` | `lettings_offer*` | lettings offer details | `Auth`, `$http`, route params | `src/sites/lettings/routes/offer/offer.ctrl.js` |
| `lettingsAgreedCtrl` | `lettings_agreed` | agreed lets/targets | `$scope.list`, `$http`, `$timeout` | `src/sites/lettings/routes/agreed/agreed.ctrl.js` |
| `lettingsAvailableCtrl` | `lettings_available` | available listings | `$scope.list`, `env` | `src/sites/lettings/routes/available/available.ctrl.js` |
| `lettingsSetupCtrl` | `lettings_setup` | setup and invite/reset progression | `$http`, `LettingsProgressionPopup` | `src/sites/lettings/routes/setup/setup.ctrl.js` |
| `leadsLeadCtrl` | `leads_lead*` | lead create/edit/status | `$scope.list`, `$http`, `Auth`, `Confirmer` | `src/sites/leads/routes/lead/lead.ctrl.js` |
| `leadsLeadsCtrl` | `leads_leads/selling/letting/valuation` | list/filter leads | `Sorter`, `$scope.list` | `src/sites/leads/routes/leads/leads.ctrl.js` |
| `leadsHistoryCtrl` | `leads_history` | historic lead list/restore | `$scope.list`, `$http` | `src/sites/leads/routes/history/history.ctrl.js` |
| `maintenanceDashboardCtrl` | `maintenance_dashboard` | calendar host + popup link | `MaintenanceTaskPopup` | `src/sites/maintenance/routes/dashboard/dashboard.ctrl.js` |
| `maintenanceTaskCtrl` | task modal | task edit/chase/inform/upload | `MaintenanceTaskPopup`, `$http`, `Upload` | `src/sites/maintenance/modals/task/task.ctrl.js` |
| `maintenance_leadsIssueCtrl` | `maintenance_leads_issue` | issue detail, notes, chase/inform/complete | `TaskPopup`, `$http`, `Upload`, `breadcrumbs` | `src/sites/maintenance_leads/routes/issue/issue.ctrl.js` |
| `maintenance_leadsWorksOrdersCtrl` | `maintenance_leads_worksorders` | works order list | `Sorter`, `DbItem` | `src/sites/maintenance_leads/routes/works-orders/works-orders.ctrl.js` |

## 5) Services, factories, and shared utilities (MUST be detailed)
| Service/Factory | Purpose | Public API (methods) | State held? | Used by | Defined in |
|---|---|---|---|---|---|
| `Auth` (provider) | auth/session/role guard + transition coordination | `getPromise`, `getUser`, `checkRoles`, `isAuthorized`, `canEdit`, `logOut`, `onUser`, navigation helpers | yes (`user`, last/prev state, settings) | all modules via root `auth` and route resolves | `src/services/ndx-auth.js` |
| `rest` (provider) | central CRUD/list/single wrapper with cache + socket refresh | `save`, `delete`, `search`, `list`, `single`, `register`, `clearCache`, `lockAll`, loading/status methods | yes (endpoint registry/cache/refresh state) | all controllers/directives via `$scope.list`/`$scope.single` | `src/services/ndx-rest-client.js` |
| `socket` | socket.io client array per site | returns `[{name, io}]` sockets | yes (per-site socket instances) | `Auth`, `rest` | `src/index.js` |
| `breadcrumbs` | route history/favorites in localStorage | `push`, `setInfo`, `getHistory`, `getFavorites`, `getRecent`, `getSiteAndTitle` | yes (history/allHistory/favorites) | shell/menu/feature controllers | `src/sites/main/breadcrumbs/breadcrumbs.js` |
| `AgencyProgressionPopup` | popup state + milestone actions for agency | `show/hide`, getters, `setCompleted`, `setProgressing`, `setDate`, `addNote`, progression setters | yes (active element/milestone/property/scope) | agency directives/controllers | `src/sites/agency/services/progression-popup.s.js` |
| `LettingsProgressionPopup` | popup state + milestone actions for lettings | same API as agency variant | yes | lettings directives/controllers | `src/sites/lettings/services/progression-popup.s.js` |
| `agencyProperty` | singleton selected agency property | `get`, `set` | yes (single property ref) | agency case/offer/details + popup service | `src/sites/agency/services/property.s.js` |
| `lettingsProperty` | singleton selected lettings property | `get`, `set` | yes | lettings case/offer + popup service | `src/sites/lettings/services/property.s.js` |
| `MaintenanceTaskPopup` | floating popup positioning/state for maintenance tasks | `setTask/getTask`, `show/hide/getHidden`, `cancelBubble` | yes (task, DOM anchor, visibility) | maintenance task/calendar directives | `src/sites/maintenance/services/task-popup.s.js` |
| `TaskPopup` | maintenance-leads popup state (task + contractors) | `setTask/getTask`, `setContractors/getContractors`, `show/hide/getHidden`, `cancelBubble` | yes | maintenance-leads issue/calendar directives | `src/sites/maintenance_leads/services/task-popup.s.js` |
| `maintenanceProperty` | in-memory property catalog for maintenance | `fetchProperties`, `getProperties`, `getProperty` | yes (fetched properties array) | maintenance workflows | `src/sites/maintenance/services/property.js` |
| `DbItem` | entity lookup/caching for IDs in maintenance leads | `get`, `getEntity`, `getObject`, `clearCache` | yes (cache map) | maintenance-leads works/historic | `src/sites/maintenance_leads/services/db-item.js` |
| `FileUtils` (duplicated) | upload helper closure for scope binding | `uploadFn` | implicit via scope flags | lettings + maintenance-leads | `src/sites/lettings/services/file-utils.js`, `src/sites/maintenance_leads/services/file-utils.js` |
| `messagele` / `messagela` / `messageml` | static i18n/message dictionaries with template interpolation | `m(key,obj)` | yes (messages object) | templates across each module | `src/sites/lettings/services/message.js`, `src/sites/leads/services/message.js`, `src/sites/maintenance_leads/services/message.js` |
| `datePicker` (provider) | leads date-picker widget config/formatting | provider config + directive support | yes | leads forms | `src/sites/leads/directives/date-picker/date-picker.js` |

Callouts:
- API wrappers (core): `rest` + `$scope.list/$scope.single` APIs in `src/services/ndx-rest-client.js`
- Session/user services: `Auth`, plus `main_users` user management controllers
- Caching layers: `rest` endpoint cache + `DbItem` cache + localStorage breadcrumbs
- God services:
  - `Auth` combines token refresh, socket binding, role checks, state memory, title handling.
  - `rest` combines endpoint discovery, socket merge, cache invalidation, data transform, and scope helpers.

## 6) Data flow & state management
- Where truth lives:
  - Entity truth often in backend + `rest`-managed list/single objects.
  - UI-local truth often in singleton services (`agencyProperty`, `lettingsProperty`, popup services).
  - Global cross-feature state on `$rootScope` prototype (`auth`, `state`, `modal`, `list`, `single`, `m*` helpers).

- Eventing patterns:
  - Heavy `$rootScope` bus for date/popup interactions: `toolbar:date-tap`, `set-date`, `swiper:show/hide/set` in date swiper + popup directives.
  - Socket events handled centrally in `rest` (`update/insert/delete`) and `Auth` (`connect`, `user` emit).

- Digest-cycle considerations:
  - Manual `scope.$apply()` used in HammerJS gesture handlers (date swipers/date picker).
  - Frequent `$timeout` usage to bridge async UI placement/state updates.

- Notable anti-patterns/hotspots:
  - Global root prototype augmentation from multiple files (`src/services/ndx-auth.js`, `src/services/ndx-rest-client.js`, `src/sites/main/app.js`).
  - Cross-module mutable singleton state (`agencyProperty`, `lettingsProperty`) creates hidden coupling.
  - Duplicated/legacy code paths (`src/components/*` and `src/sites/main/*` duplicates; `agreed - Copy`).
  - Inline direct DOM/jQuery manipulations for popup positioning and class mutations.

## 7) API contracts used by the frontend
### 7.1 HTTP calls inventory
| Endpoint (path pattern) | Method | Called from | Purpose | Request shape | Response shape | Notes |
|---|---|---|---|---|---|---|
| `/rest/endpoints` (per site base URL) | GET | `src/services/ndx-rest-client.js` | discover available tables/endpoints | none | `{endpoints:[], autoId, server}` | Drives dynamic endpoint map and maintenance-mode flag |
| `/api/<endpoint>` | POST | `rest.list` | list whole table | none | transformed to `{items,total,page...}` | Built as `$http.sites[site].url + '/api/' + endpoint` |
| `/api/<endpoint>/search` | POST | `rest.search` | filtered list/search | generic `where/sort/page` args | transformed list payload | Core data access pattern via `$scope.list(...)` |
| `/api/<endpoint>/:id` (+`/all`) | GET | `rest.single`, DbItem helpers | fetch single item | id path | item object | `/all` used for expanded payload |
| `/api/<endpoint>/:id` | POST | `rest.save` + many controllers | upsert/update item | full entity object | saved entity | rest wrapper chooses token per site |
| `/api/<endpoint>/:id` | DELETE | `rest.delete` + task modals | delete entity | none | status | Used in task delete flows |
| `/api/login` | POST | `src/sites/main/login/login.js` | authenticate user | `{email,password}` | `{token,...}` | token persisted in localStorage |
| `/api/refresh-login` | POST | `src/services/ndx-auth.js` | refresh session/tokens | null body, auth header | user with `local.sites[*].token` | called on load + every minute |
| `/api/forgot-password` | POST | forgot/users flows | send reset email | `{email}` | status | main site endpoint |
| `/api/user-code` | POST | invited flow | resolve invite code to user | `{code}` | `{user}` | main site |
| `/api/complete-registration` | POST | invited flow | set password/finish registration | `{user,password}` | status | main site |
| `/invite/accept` | POST | agency/leads invited controllers | accept invite | code/password payload | status | relative path (not per-site base) |
| `/api/get-invite-code` | POST | setup controllers (agency/lettings/maintenance/leads) | generate invite for user | new-user payload | code/user payload | repeated across modules |
| `/api/send-new-user-email` | POST | users controllers | send invite email | user payload | status | main site |
| `/api/upload` | POST | file utils + issue/task/case uploads | file upload | multipart files | document metadata array | called via `Upload.upload` |
| `/api/upload-pdf` | POST | maintenance_leads works-order flows | upload generated PDF | `{base64/name/...}` | uploaded document metadata | used after html2pdf generation |
| `/api/milestone/start`, `/api/milestone/completed` | POST | progression popup services | change progression milestone status | `{milestone, roleId}` | status | agency + lettings modules |
| `/api/properties/advance-progression` | POST | advance progression modals | advance progression step | modal data payload | status | agency + lettings |
| `/api/properties/send-*` (accept/request/marketing/reduction/new-sales/new-lettings) | POST | marketing/accept/request controllers | outbound comms | property/contact payload | status | module-specific email triggers |
| `/api/agreed/search` | POST | agreed controllers + main dashboard | agreed pipeline query | search filters | list payload | appears in multiple dashboards |
| `/api/chase/*`, `/api/chase-invoice/*`, `/api/inform/*`, `/api/complete/:issueId`, `/api/notes/:issueId`, `/api/message-center/send` | GET/POST | maintenance_leads issue/task/message flows | maintenance workflow actions | issue/task/message payload | status/updated item | bespoke maintenance-leads endpoints |
| `${env.PROPERTY_URL}/search`, `${env.PROPERTY_URL}/property` | POST/GET | agency/lettings/leads/maintenance controllers | external property service queries | provider-specific body | provider-specific collection/item | uses static `PROPERTY_TOKEN` in `env` |

Notes:
- Base URLs are computed from `sites` in `src/index.js` (e.g., `https://server.vitalspace.co.uk/{app}`) and attached to `$http.sites`.
- Dynamic route endpoint construction is pervasive in `rest` provider and `$scope.list` usage.
- Most-used logical endpoints via `$scope.list`: `leads:leads`, `maintenance_leads:issues`, `main:users`, `agency:properties`, `lettings:properties`.

### 7.2 Error handling & loading states
- Common patterns:
  - Controller-level `.then(..., err => ...)` with local flags/messages.
  - no centralized toast/retry strategy beyond `alert.log(...)` helper usage.
  - rest wrapper sets `obj.error` and clears items on failures in `search/list/single`.
- Global `$http` interceptors:
  - Unknown (no `$httpProvider.interceptors.push(...)` found in app code under `/src/sites`, `/src/services`, `/src/components`).

## 8) Realtime / websockets contract (if present)
- Library/setup:
  - `socket.io-client` in `src/index.js`, one socket per site namespace path (`/{site.ws}/socket.io`, websocket transport).
- Connection lifecycle:
  - On socket connect: `Auth` emits `user` if logged in; `rest` emits `rest` to request sync.
  - On logout/login refresh, `Auth` re-emits `user`/`null` across all sockets.
- Event/channel inventory:

| Event/channel | Payload shape | What triggers UI updates | Where handled | Notes |
|---|---|---|---|---|
| `connect` | none | re-auth and rest sync | `src/services/ndx-auth.js`, `src/services/ndx-rest-client.js` | active |
| `user` (emit) | user object or null | server-side socket identity | emitted from `Auth` | active emit only |
| `rest` (emit) | `{}` | server-side rest subscription | emitted from `rest` on connect | active emit only |
| `update` | `{table, id}` | marks endpoint cache stale, schedules refresh | `rest.socketRefresh` | active |
| `insert` | `{table, id}` | same as update | `rest.socketRefresh` | active |
| `delete` | `{table, id}` | same as update | `rest.socketRefresh` | active |
| `newIssue` | issue payload | intended alert popup | `src/sites/main/app.js`, `src/sites/maintenance_leads/app.js` | currently disabled by `if (false && socket)` |
| `newMessage` | message payload | intended alert popup | same as above | currently disabled |

- State merge strategy:
  - Socket events invalidate endpoint cache and mark `endpoints[site:table].needsRefresh`, then `callRefreshFns(true)` repulls data through registered list/single refresh handlers.

## 9) Templates & view layer
- Template locations:
  - Mostly external template files imported with `require('./x.html').default` in routes/directives.
  - Some inline templates for small directives (`<div class="template-render"></div>`, `<iframe></iframe>`, `<sms-dashboard>` style state templates).
- Conventions:
  - Route templates under `src/sites/<site>/routes/<feature>/*.html`
  - Directive templates under `src/sites/<site>/directives/<name>/*.html`
  - Some `.jade` files remain alongside `.html` equivalents (legacy artifacts)
- Heavy/complex templates (top 10 by size):
  - `src/sites/agency/routes/case/case.html` (Agency)
  - `src/sites/agency/routes/client-management-details/client-management-details.html` (Agency)
  - `src/sites/lettings/routes/case/case.html` (Lettings)
  - `src/sites/main/dashboard/dashboard.html` (Main)
  - `src/sites/lettings/routes/offer/offer.html` (Lettings)
  - `src/sites/maintenance_leads/routes/create-works-order/create-works-order.html` (Maintenance Leads)
  - `src/sites/maintenance_leads/routes/issue/issue.html` (Maintenance Leads)
  - `src/sites/maintenance_leads/routes/dashboard/dashboard.html` (Maintenance Leads)
  - `src/sites/agency/routes/offer/offer.html` (Agency)
  - `src/sites/lettings/routes/marketing/marketing.html` (Lettings)
- Custom filters used extensively:
  - `timeAgo`, `currencyFormat`, `byStatus`, `flatten`, plus agency-specific filters (`getFees`, `daysSince`, `getFeedbackCount`, `hasDocument`, `numMailouts`, `viewingContacted`).

## 10) “Unholy agglomeration” findings (merge seams)
- Duplicate modules/routes/components for same feature:
  - `src/components/*` duplicates `src/sites/main/*` for `dashboard`, `forgot`, `invited`, `profile`, `setup`, `template`, `users` states/directives.
- Duplicate route file copies:
  - `src/sites/agency/routes/agreed - Copy/agreed.routes.js` and matching controller duplicate `agency_agreed` state.
- Multiple parallel entry architectures:
  - Unified root (`src/index.html`, `vs-app`) plus legacy standalone app entry HTML files under `src/sites/*/index.html`.
- Competing shared utility copies:
  - `src/services/property-admin-functions.js` and `src/sites/agency/services/property-admin-functions.js` both exist with overlapping logic.
- Inconsistent naming conventions:
  - state names use mixed hyphen/underscore patterns (`agency_client-management-details`, `maintenance_leads_createworksorder`, `lettings_offers-list_historic`).
- Competing auth guard styles:
  - both `resolve.user = Auth.getPromise(...)` and `data.auth` declarations are used; `Auth` transition hook enforces `data.auth`, while resolve also appears widely.
- Route alias seams:
  - duplicate semantic routes (`/agency/offer/:id` and `/agency/offer/roleid/:roleid`; same for lettings).
- Adapter-style glue:
  - central `sites` map in `src/index.js` adapts modules to per-site URL/token/socket configs and allows cross-site user role synchronization.

## 11) Rebuild blueprint inputs (actionable extraction)
### 11.1 Suggested modern app boundaries
- Proposed feature/module split:
  - Shell Core: auth/session, nav, route guards, breadcrumb/history, modal system.
  - Agency Domain: dashboard, cases, offers, client management, setup, templates, marketing.
  - Lettings Domain: dashboard, cases, offers, agreed/available/marketing/setup/template.
  - Maintenance Leads Domain: issues/issue detail, contractors/landlords, works orders, diary/historic, setup.
  - Maintenance Domain: calendar/tasks/setup.
  - Leads Domain: dashboard, lead detail/list/history/setup/template.
  - Admin/SMS Domain: admin boards/windows/epc/misdescriptions/kadmin + SMS schedule/dashboard/templates.
- Shared/common layers:
  - API client + endpoint registry, auth/role policy, realtime sync client, uploader, date/event bus, messaging/i18n, domain entity adapters.

### 11.2 Candidate domain model (frontend)
- Core entities referenced repeatedly:
  - `User`, `SiteRole`, `Property`, `Case`, `Progression`, `Milestone`, `Offer`, `Lead`, `Issue`, `Task`, `Contractor`, `Landlord`, `Board`, `Template` (email/sms), `Target`, `DashboardMetric`.
- Shaping/normalization evidence:
  - Partial transform in `rest` (`objtrans` listTransform, endpoint transforms).
  - Ad-hoc mapping in controllers (`RoleId`/`roleId` coercions, status/date coercion).
  - No consistent centralized domain normalization layer.

### 11.3 Top refactor targets to de-risk rebuilding (ranked)
1. Extract/replace `rest` + `$scope.list/$scope.single` global API abstraction.
   - Why: highest coupling point for data flow, caching, socket sync, and controller lifecycle.
   - Where: `src/services/ndx-rest-client.js` + all route controllers using `.list(...)`.
   - Effort: L
2. Consolidate auth/guards into explicit route guard service.
   - Why: current mix of `resolve` and `data.auth` causes hidden behavior and migration risk.
   - Where: `src/services/ndx-auth.js`, all `*.routes.js`.
   - Effort: M
3. Unify duplicate main/components code and remove dead copies.
   - Why: duplicate states/components increase ambiguity and regression risk.
   - Where: `src/components/*` vs `src/sites/main/*`.
   - Effort: M
4. Replace `$rootScope` event bus date/popup system with explicit local state stores.
   - Why: implicit coupling and digest timing complexity.
   - Where: date-swiper/calendar/progression popup directives across agency/lettings/maintenance.
   - Effort: M
5. Isolate property-admin workflow utility into typed domain service.
   - Why: business-critical logic currently mixed into controllers + duplicate utility files.
   - Where: `src/services/property-admin-functions.js`, case/offer/detail controllers.
   - Effort: M
6. Standardize endpoint client contracts for bespoke maintenance APIs.
   - Why: many custom endpoints with controller-level composition (`/chase`, `/inform`, `/complete`, message-center).
   - Where: `src/sites/maintenance_leads/routes/issue/issue.ctrl.js`, related popups/directives.
   - Effort: M

## 12) Unknowns & follow-ups (actionable)
- Unknowns from `/src` only:
  - Exact backend payload schemas for many dynamic `rest` endpoints discovered at runtime from `/rest/endpoints`.
  - Complete semantics of roles/permissions by site beyond string checks.
  - Whether standalone `src/sites/*/index.html` entries are still deployed in production or only historical.
- Likely hidden behavior locations:
  - Runtime endpoint metadata from server (`/rest/endpoints`).
  - Third-party bundled libs loaded externally in HTML.
  - Commented-out imports/routes in `src/imports.js` can alter active surface when toggled.
- Suggested next steps:
  - Instrument `rest.search/list/single` to log endpoint + shape at runtime for one full user session per domain.
  - Add transition tracing in `Auth` (`onBefore`/`data.auth`) to confirm real guard behavior.
  - Capture socket event samples (`update/insert/delete` payloads) and map to entity refresh behavior.
  - Snapshot API contracts for top 20 endpoints used in core workflows (`agency_case`, `lettings_case`, `maintenance_leads_issue`, `main_users`, `leads_lead`).
