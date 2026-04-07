CREATE TABLE "message_provider_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "provider_key" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "credentials_json_encrypted" jsonb,
  "settings_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_provider_accounts" ADD CONSTRAINT "message_provider_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "message_provider_accounts_tenant_name_idx" ON "message_provider_accounts" USING btree ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX "message_provider_accounts_tenant_channel_idx" ON "message_provider_accounts" USING btree ("tenant_id","channel","status");
--> statement-breakpoint

ALTER TABLE "communication_dispatches"
  ADD COLUMN "provider_account_id" uuid,
  ADD COLUMN "provider_key" text,
  ADD COLUMN "delivery_mode" text DEFAULT 'log_only' NOT NULL,
  ADD COLUMN "original_recipient_email" text,
  ADD COLUMN "original_recipient_phone" text;
--> statement-breakpoint
ALTER TABLE "communication_dispatches" ADD CONSTRAINT "communication_dispatches_provider_account_id_message_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."message_provider_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "communication_dispatches"
SET
  "provider_key" = COALESCE("provider_key", 'log'),
  "original_recipient_email" = COALESCE("original_recipient_email", "recipient_email"),
  "original_recipient_phone" = COALESCE("original_recipient_phone", "recipient_phone");
--> statement-breakpoint

CREATE TABLE "communication_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "dispatch_id" uuid NOT NULL,
  "provider_account_id" uuid,
  "provider_key" text,
  "request_payload_json" jsonb,
  "response_payload_json" jsonb,
  "provider_message_id" text,
  "status" text NOT NULL,
  "error_code" text,
  "error_message" text,
  "attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_attempts" ADD CONSTRAINT "communication_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communication_attempts" ADD CONSTRAINT "communication_attempts_dispatch_id_communication_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."communication_dispatches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communication_attempts" ADD CONSTRAINT "communication_attempts_provider_account_id_message_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."message_provider_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "communication_attempts_dispatch_idx" ON "communication_attempts" USING btree ("dispatch_id");
--> statement-breakpoint
CREATE INDEX "communication_attempts_tenant_status_idx" ON "communication_attempts" USING btree ("tenant_id","status");
