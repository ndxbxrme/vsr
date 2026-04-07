DROP INDEX "workflow_instances_case_idx";--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "track" text DEFAULT 'Primary' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instances_case_track_idx" ON "workflow_instances" USING btree ("case_id","track");