# VitalSpace Canonical Schema Draft

## 1. Purpose

This document defines the initial canonical data model for the new VitalSpace platform. It translates the blueprint and bounded-context map into concrete tables, keys, ownership rules, and cross-context relationships.

This is a schema draft, not a final migration file. The goal is to define a stable target model before implementation.

## 2. Global Rules

### Primary Key Strategy

- Every persistent business table should use `id uuid primary key`.
- Legacy external IDs must never be used as the primary key.
- External system IDs should be stored through explicit mapping fields or `external_references`.

### Tenant Strategy

- Most business tables must include `tenant_id uuid not null`.
- Operational tables that are branch-scoped should also include `branch_id uuid null`.
- Truly global platform tables may omit `tenant_id`.
- Uniqueness should usually be enforced within a tenant, not across the whole platform, unless the field is platform-global by nature.

### Standard Columns

Most mutable tables should include:

- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `created_by_user_id uuid null`
- `updated_by_user_id uuid null`
- `archived_at timestamptz null`

Soft deletion should be explicit and rare. Prefer:

- `archived_at` for retired but meaningful records
- `deleted_at` only where hard business deletion semantics are required

### Audit and Realtime Rule

- Important mutations should create `audit_logs` records.
- Mutations that should reach live clients should also create `outbox_events` records.
- Realtime fan-out should happen from explicit application code and consumers, not DB triggers.

### JSON Usage Rule

Use JSON columns only for:

- external payload snapshots
- provider-specific metadata
- low-value configuration blobs

Do not hide core relational business data inside JSON unless there is a strong reason.

## 3. Shared Reference Types

Recommended enums or controlled values:

- `case_type`: `sales`, `lettings`
- `case_status`: domain-specific but normalized at case level
- `workflow_trigger_type`: `manual`, `system`, `integration`, `scheduled`
- `offer_status`: `draft`, `submitted`, `accepted`, `rejected`, `withdrawn`
- `notification_channel`: `email`, `sms`
- `notification_status`: `queued`, `sent`, `failed`, `delivered`, `bounced`
- `domain_type`: `subdomain`, `custom`
- `integration_provider`: `dezrez`, `fixflo`, `gravity_forms`, `rightmove`, `onthemarket`, `mailgun`, `sms_provider`, `stripe`
- `integration_sync_status`: `queued`, `running`, `succeeded`, `failed`, `partial`
- `outbox_status`: `pending`, `published`, `failed`

## 4. Platform Core Tables

## 4.1 Identity

### `users`

Canonical person record for platform login and user identity.

Key columns:

- `id`
- `email` nullable until claimed or invited
- `email_normalized`
- `first_name`
- `last_name`
- `display_name`
- `phone`
- `avatar_file_id`
- `is_platform_admin boolean not null default false`
- `last_login_at`
- `created_at`
- `updated_at`

Constraints:

- unique on `email_normalized` where not null

### `credentials`

Local password credentials for users.

Key columns:

- `id`
- `user_id`
- `password_hash`
- `password_set_at`
- `must_reset boolean not null default false`
- `created_at`
- `updated_at`

Constraints:

- unique on `user_id`

### `oauth_accounts`

External OAuth/OIDC identities linked to users.

Key columns:

- `id`
- `user_id`
- `provider`
- `provider_user_id`
- `email_from_provider`
- `access_token_encrypted` nullable
- `refresh_token_encrypted` nullable
- `token_expires_at` nullable
- `profile_json jsonb`
- `created_at`
- `updated_at`

Constraints:

- unique on `provider`, `provider_user_id`

### `sessions`

Server-side session or refresh-token tracking.

Key columns:

- `id`
- `user_id`
- `session_token_hash`
- `ip_address`
- `user_agent`
- `last_seen_at`
- `expires_at`
- `revoked_at`
- `created_at`

Indexes:

- index on `user_id`
- index on `expires_at`

### `invite_tokens`

Invitation records for joining a tenant or branch.

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `email_normalized`
- `invited_by_user_id`
- `token_hash`
- `expires_at`
- `accepted_at`
- `created_at`

### `password_reset_tokens`

Password reset requests.

Key columns:

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `used_at`
- `created_at`

## 4.2 Tenancy

### `tenants`

Agency-level tenant record.

Key columns:

- `id`
- `name`
- `slug`
- `status`
- `onboarding_state`
- `primary_brand_id` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `slug`

### `brands`

Whitelabel brand settings for a tenant.

Key columns:

- `id`
- `tenant_id`
- `name`
- `logo_file_id` nullable
- `theme_json jsonb`
- `email_from_name`
- `email_reply_to`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `name`

### `branches`

Operational branch within a tenant.

Key columns:

- `id`
- `tenant_id`
- `brand_id` nullable
- `name`
- `slug`
- `timezone`
- `phone`
- `email`
- `address_line_1`
- `address_line_2`
- `city`
- `postcode`
- `country_code`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `slug`

### `tenant_domains`

Domain bindings for subdomains and custom domains.

Key columns:

- `id`
- `tenant_id`
- `brand_id` nullable
- `domain`
- `domain_type`
- `is_primary boolean not null default false`
- `verification_status`
- `verified_at` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `domain`

### `feature_flags`

Tenant-scoped feature controls.

Key columns:

- `id`
- `tenant_id`
- `key`
- `enabled boolean not null default false`
- `config_json jsonb`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `key`

## 4.3 Access Control

### `roles`

Tenant-defined or platform-defined roles.

Key columns:

- `id`
- `tenant_id` nullable for platform roles
- `key`
- `name`
- `scope_type`
- `is_system boolean not null default false`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `key`

### `permissions`

Named permissions used by roles.

Key columns:

- `id`
- `key`
- `name`
- `description`

Constraints:

- unique on `key`

### `role_permissions`

Join table between roles and permissions.

Key columns:

- `role_id`
- `permission_id`

Constraints:

- primary key on `role_id`, `permission_id`

### `memberships`

User membership inside a tenant, optionally scoped to a branch.

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `user_id`
- `status`
- `joined_at`
- `left_at` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `branch_id`, `user_id`

### `membership_roles`

Join table between memberships and roles.

Key columns:

- `membership_id`
- `role_id`

Constraints:

- primary key on `membership_id`, `role_id`

## 4.4 Billing Placeholder

### `plans`

Key columns:

- `id`
- `key`
- `name`
- `is_active`
- `limits_json jsonb`
- `created_at`
- `updated_at`

### `subscriptions`

Key columns:

- `id`
- `tenant_id`
- `plan_id`
- `provider` nullable
- `provider_subscription_id` nullable
- `status`
- `trial_ends_at` nullable
- `current_period_ends_at` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`

### `billing_events`

Key columns:

- `id`
- `tenant_id`
- `subscription_id` nullable
- `provider`
- `event_type`
- `payload_json jsonb`
- `occurred_at`
- `created_at`

## 5. Property and Contact Tables

### `properties`

Canonical property record.

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `external_display_id` nullable
- `address_line_1`
- `address_line_2`
- `locality`
- `town`
- `county`
- `postcode`
- `country_code`
- `display_address`
- `property_type`
- `bedrooms` nullable
- `bathrooms` nullable
- `receptions` nullable
- `status`
- `marketing_status`
- `created_at`
- `updated_at`

Indexes:

- index on `tenant_id`, `postcode`
- index on `tenant_id`, `status`

### `contacts`

Canonical person or company contact record.

Key columns:

- `id`
- `tenant_id`
- `type`
- `full_name`
- `first_name`
- `last_name`
- `company_name`
- `email`
- `phone`
- `mobile`
- `created_at`
- `updated_at`

Indexes:

- index on `tenant_id`, `full_name`
- index on `tenant_id`, `email`

### `contact_methods`

Additional contact channels.

Key columns:

- `id`
- `contact_id`
- `method_type`
- `value`
- `is_primary`
- `created_at`

### `property_contacts`

Relationship between properties and contacts.

Key columns:

- `id`
- `tenant_id`
- `property_id`
- `contact_id`
- `relationship_type`
- `is_primary`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `property_id`, `contact_id`, `relationship_type`

### `external_references`

Generic mapping table from internal records to external systems.

Key columns:

- `id`
- `tenant_id` nullable
- `provider`
- `entity_type`
- `entity_id`
- `external_type`
- `external_id`
- `external_parent_id` nullable
- `metadata_json jsonb`
- `last_seen_at` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `provider`, `entity_type`, `external_id`

## 6. Leads Tables

These can be introduced after the core case platform, but they should align to the canonical model from the start.

### `lead_sources`

Key columns:

- `id`
- `tenant_id`
- `key`
- `name`
- `provider` nullable
- `config_json jsonb`
- `created_at`
- `updated_at`

### `leads`

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `lead_source_id` nullable
- `assigned_membership_id` nullable
- `status`
- `lead_type`
- `contact_id` nullable
- `property_id` nullable
- `summary`
- `notes_text` nullable
- `received_at`
- `converted_at` nullable
- `created_at`
- `updated_at`

Indexes:

- index on `tenant_id`, `status`
- index on `tenant_id`, `received_at`

### `lead_activities`

Key columns:

- `id`
- `tenant_id`
- `lead_id`
- `activity_type`
- `body`
- `performed_by_user_id` nullable
- `performed_at`
- `created_at`

## 7. Core Case Tables

## 7.1 Shared Cases

### `cases`

Shared case record for sales and lettings.

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `case_type`
- `property_id`
- `status`
- `opened_at`
- `closed_at` nullable
- `owner_membership_id` nullable
- `source_lead_id` nullable
- `summary`
- `created_at`
- `updated_at`

Constraints:

- index on `tenant_id`, `case_type`, `status`
- index on `property_id`

### `case_parties`

People and organizations connected to a case.

Key columns:

- `id`
- `tenant_id`
- `case_id`
- `contact_id`
- `role_type`
- `side`
- `is_primary`
- `created_at`
- `updated_at`

### `notes`

Shared notes usable across cases and maintenance.

Key columns:

- `id`
- `tenant_id`
- `subject_type`
- `subject_id`
- `body`
- `visibility`
- `created_by_user_id`
- `created_at`
- `updated_at`

Indexes:

- index on `tenant_id`, `subject_type`, `subject_id`

### `timeline_events`

Append-only operational timeline.

Key columns:

- `id`
- `tenant_id`
- `subject_type`
- `subject_id`
- `event_type`
- `title`
- `body`
- `actor_user_id` nullable
- `actor_type`
- `metadata_json jsonb`
- `occurred_at`
- `created_at`

Indexes:

- index on `tenant_id`, `subject_type`, `subject_id`, `occurred_at`

## 7.2 Workflow Engine

### `workflow_templates`

Tenant-scoped workflow definitions.

Key columns:

- `id`
- `tenant_id`
- `case_type`
- `name`
- `is_default`
- `version`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `case_type`, `name`, `version`

### `workflow_template_stages`

Stages belonging to a template.

Key columns:

- `id`
- `workflow_template_id`
- `stage_key`
- `name`
- `sequence_no`
- `config_json jsonb`
- `created_at`
- `updated_at`

Constraints:

- unique on `workflow_template_id`, `stage_key`
- unique on `workflow_template_id`, `sequence_no`

### `workflow_instances`

Applied workflow for a case.

Key columns:

- `id`
- `tenant_id`
- `case_id`
- `workflow_template_id`
- `current_stage_id` nullable
- `status`
- `started_at`
- `completed_at` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `case_id`

### `workflow_instance_stages`

Per-case stage state.

Key columns:

- `id`
- `tenant_id`
- `workflow_instance_id`
- `workflow_template_stage_id`
- `status`
- `started_at` nullable
- `completed_at` nullable
- `due_at` nullable
- `metadata_json jsonb`
- `created_at`
- `updated_at`

Constraints:

- unique on `workflow_instance_id`, `workflow_template_stage_id`

### `workflow_events`

Append-only history of workflow transitions and automations.

Key columns:

- `id`
- `tenant_id`
- `workflow_instance_id`
- `workflow_instance_stage_id` nullable
- `trigger_type`
- `event_type`
- `body`
- `actor_user_id` nullable
- `occurred_at`
- `created_at`

## 8. Sales Tables

### `sales_cases`

Sales-specific extension of a shared case.

Key columns:

- `case_id`
- `tenant_id`
- `listing_price_amount` nullable
- `agreed_price_amount` nullable
- `commission_amount` nullable
- `solicitor_status` nullable
- `chain_position` nullable
- `created_at`
- `updated_at`

Constraints:

- primary key on `case_id`

### `sales_offers`

Key columns:

- `id`
- `tenant_id`
- `case_id`
- `offered_by_contact_id` nullable
- `amount`
- `status`
- `submitted_at`
- `responded_at` nullable
- `metadata_json jsonb`
- `created_at`
- `updated_at`

Indexes:

- index on `tenant_id`, `case_id`, `status`

## 9. Lettings Tables

### `lettings_cases`

Lettings-specific extension of a shared case.

Key columns:

- `case_id`
- `tenant_id`
- `asking_rent_amount` nullable
- `agreed_rent_amount` nullable
- `tenancy_length_months` nullable
- `move_in_date` nullable
- `landlord_contact_id` nullable
- `created_at`
- `updated_at`

Constraints:

- primary key on `case_id`

### `lettings_applications`

Key columns:

- `id`
- `tenant_id`
- `case_id`
- `primary_applicant_contact_id`
- `status`
- `submitted_at`
- `decision_at` nullable
- `form_payload_json jsonb`
- `created_at`
- `updated_at`

### `lettings_offers`

Key columns:

- `id`
- `tenant_id`
- `case_id`
- `applicant_contact_id` nullable
- `amount`
- `status`
- `submitted_at`
- `responded_at` nullable
- `metadata_json jsonb`
- `created_at`
- `updated_at`

## 10. Maintenance Tables

These can be phased later, but the target model should be consistent now.

### `contractors`

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `name`
- `email`
- `phone`
- `trade_type`
- `status`
- `created_at`
- `updated_at`

### `landlords`

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `contact_id` nullable
- `name`
- `email`
- `phone`
- `created_at`
- `updated_at`

### `issues`

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `property_id` nullable
- `landlord_id` nullable
- `reported_by_contact_id` nullable
- `assigned_contractor_id` nullable
- `title`
- `description`
- `status`
- `priority`
- `reported_at`
- `completed_at` nullable
- `created_at`
- `updated_at`

Indexes:

- index on `tenant_id`, `status`
- index on `tenant_id`, `assigned_contractor_id`

### `tasks`

Key columns:

- `id`
- `tenant_id`
- `issue_id`
- `contractor_id` nullable
- `title`
- `description`
- `status`
- `due_at` nullable
- `completed_at` nullable
- `created_at`
- `updated_at`

### `message_threads`

Key columns:

- `id`
- `tenant_id`
- `subject_type`
- `subject_id`
- `channel_type`
- `created_at`
- `updated_at`

### `messages`

Key columns:

- `id`
- `tenant_id`
- `message_thread_id`
- `direction`
- `channel_type`
- `from_value`
- `to_value`
- `subject`
- `body_text`
- `body_html` nullable
- `provider_message_id` nullable
- `sent_at` nullable
- `received_at` nullable
- `created_at`

Indexes:

- index on `tenant_id`, `message_thread_id`, `created_at`

## 11. Communications Tables

### `email_templates`

Key columns:

- `id`
- `tenant_id`
- `brand_id` nullable
- `key`
- `name`
- `subject_template`
- `body_html_template`
- `body_text_template` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `brand_id`, `key`

### `sms_templates`

Key columns:

- `id`
- `tenant_id`
- `brand_id` nullable
- `key`
- `name`
- `body_template`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `brand_id`, `key`

### `notifications`

Requested notification send records.

Key columns:

- `id`
- `tenant_id`
- `subject_type`
- `subject_id`
- `channel`
- `template_id` nullable
- `recipient`
- `status`
- `queued_at`
- `sent_at` nullable
- `failed_at` nullable
- `error_message` nullable
- `payload_json jsonb`
- `created_at`
- `updated_at`

### `notification_deliveries`

Provider delivery status history.

Key columns:

- `id`
- `tenant_id`
- `notification_id`
- `provider`
- `provider_message_id` nullable
- `status`
- `payload_json jsonb`
- `occurred_at`
- `created_at`

### `inbound_messages`

Parsed inbound provider webhooks.

Key columns:

- `id`
- `tenant_id` nullable
- `provider`
- `channel`
- `external_message_id` nullable
- `from_value`
- `to_value`
- `subject` nullable
- `body_text`
- `payload_json jsonb`
- `received_at`
- `processed_at` nullable
- `created_at`

## 12. Files Tables

### `file_objects`

Canonical uploaded or generated file metadata.

Key columns:

- `id`
- `tenant_id`
- `storage_provider`
- `storage_key`
- `original_name`
- `content_type`
- `size_bytes`
- `checksum_sha256` nullable
- `uploaded_by_user_id` nullable
- `created_at`

Constraints:

- unique on `storage_provider`, `storage_key`

### `file_attachments`

Polymorphic link between files and records.

Key columns:

- `id`
- `tenant_id`
- `file_object_id`
- `subject_type`
- `subject_id`
- `attachment_type`
- `created_by_user_id` nullable
- `created_at`

Indexes:

- index on `tenant_id`, `subject_type`, `subject_id`

## 13. Audit and Realtime Tables

### `audit_logs`

Append-only audit history.

Key columns:

- `id`
- `tenant_id` nullable
- `actor_user_id` nullable
- `actor_type`
- `entity_type`
- `entity_id`
- `action`
- `summary`
- `metadata_json jsonb`
- `occurred_at`
- `created_at`

Indexes:

- index on `tenant_id`, `entity_type`, `entity_id`, `occurred_at`

### `outbox_events`

Transactional event records for workers and realtime fan-out.

Key columns:

- `id`
- `tenant_id` nullable
- `event_name`
- `entity_type`
- `entity_id`
- `mutation_type`
- `channel_key`
- `payload_json jsonb`
- `status`
- `available_at`
- `published_at` nullable
- `failed_at` nullable
- `error_message` nullable
- `created_at`

Indexes:

- index on `status`, `available_at`
- index on `tenant_id`, `entity_type`, `entity_id`

`outbox_events` is the schema anchor for the explicit realtime model. Application services should create these rows in the same transaction as the business mutation. Workers can then publish them to Socket.IO, queues, or both.

## 14. Reporting Tables

These should stay read-model-oriented and can be added incrementally.

### `dashboard_metrics`

Key columns:

- `id`
- `tenant_id`
- `branch_id` nullable
- `metric_key`
- `dimension_key` nullable
- `dimension_value` nullable
- `metric_date`
- `metric_value_numeric` nullable
- `metric_value_json jsonb` nullable
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `branch_id`, `metric_key`, `dimension_key`, `dimension_value`, `metric_date`

### `search_documents`

Optional denormalized search/read model.

Key columns:

- `id`
- `tenant_id`
- `document_type`
- `document_id`
- `title`
- `body_text`
- `metadata_json jsonb`
- `updated_at`

Indexes:

- index on `tenant_id`, `document_type`, `document_id`

## 15. Integration Tables

### `integration_accounts`

Tenant-scoped integration configuration.

Key columns:

- `id`
- `tenant_id`
- `provider`
- `name`
- `status`
- `credentials_json_encrypted jsonb`
- `settings_json jsonb`
- `created_at`
- `updated_at`

Constraints:

- unique on `tenant_id`, `provider`, `name`

### `integration_mappings`

Maps provider records to internal entities when the generic `external_references` table is not enough.

Key columns:

- `id`
- `tenant_id`
- `integration_account_id`
- `entity_type`
- `entity_id`
- `external_type`
- `external_id`
- `metadata_json jsonb`
- `created_at`
- `updated_at`

Constraints:

- unique on `integration_account_id`, `entity_type`, `external_id`

### `webhook_events`

Recorded inbound webhook deliveries.

Key columns:

- `id`
- `tenant_id` nullable
- `integration_account_id` nullable
- `provider`
- `event_type`
- `signature_valid boolean`
- `payload_json jsonb`
- `received_at`
- `processed_at` nullable
- `processing_status`
- `error_message` nullable
- `created_at`

Indexes:

- index on `provider`, `received_at`
- index on `processing_status`

### `integration_sync_runs`

Batch or scheduled sync execution history.

Key columns:

- `id`
- `tenant_id`
- `integration_account_id`
- `provider`
- `sync_type`
- `status`
- `started_at`
- `finished_at` nullable
- `records_seen` nullable
- `records_created` nullable
- `records_updated` nullable
- `records_failed` nullable
- `error_summary` nullable
- `metadata_json jsonb`
- `created_at`

## 16. Critical Relationships

The main relationship spine should be:

- `tenant -> branches`
- `tenant -> brands`
- `tenant -> memberships -> users`
- `tenant -> properties`
- `tenant -> contacts`
- `property -> cases`
- `case -> workflow_instance`
- `case -> sales_case` or `case -> lettings_case`
- `case -> notes`
- `case -> timeline_events`
- `case -> file_attachments`
- `issue -> tasks`
- `issue -> message_threads -> messages`
- `tenant -> integration_accounts -> integration_sync_runs`
- any major mutation -> `audit_logs` and `outbox_events`

## 17. Launch Scope Recommendation

The first implementation pass should create these tables first:

- `users`
- `credentials`
- `oauth_accounts`
- `sessions`
- `tenants`
- `brands`
- `branches`
- `tenant_domains`
- `feature_flags`
- `roles`
- `permissions`
- `role_permissions`
- `memberships`
- `membership_roles`
- `properties`
- `contacts`
- `property_contacts`
- `external_references`
- `cases`
- `case_parties`
- `notes`
- `timeline_events`
- `workflow_templates`
- `workflow_template_stages`
- `workflow_instances`
- `workflow_instance_stages`
- `workflow_events`
- `sales_cases`
- `sales_offers`
- `lettings_cases`
- `lettings_applications`
- `lettings_offers`
- `email_templates`
- `sms_templates`
- `notifications`
- `notification_deliveries`
- `file_objects`
- `file_attachments`
- `audit_logs`
- `outbox_events`
- `integration_accounts`
- `webhook_events`
- `integration_sync_runs`

Leads, maintenance, reporting, and billing placeholder tables can follow after the shared platform core is working.

## 18. Open Modeling Questions

These should be resolved before writing production migrations:

- whether `notes` should remain fully polymorphic or be split into case and issue notes
- whether `messages` should stay generic across domains or remain maintenance-first initially
- whether workflow automations need first-class schema tables in v1 or can live in template config JSON
- how much reporting should be relational tables versus generated views/materialized views
- whether contact addresses need their own normalized table in v1
- whether `external_references` alone is sufficient or if more provider-specific mapping tables will be needed early

## 19. Recommendation

Implement the shared platform core, shared case model, sales/lettings extensions, audit, outbox, and integrations first. That gives the project the minimum stable schema required for side-by-side rollout, OAuth, tenancy, files, notifications, and realtime updates without rebuilding legacy coupling.
