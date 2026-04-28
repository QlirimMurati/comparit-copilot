CREATE TABLE "tickets_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_issue_key" text NOT NULL,
	"project_key" text NOT NULL,
	"issue_type" text,
	"summary" text NOT NULL,
	"description" text,
	"status" text,
	"priority" text,
	"assignee_email" text,
	"assignee_name" text,
	"reporter_email" text,
	"labels" jsonb,
	"components" jsonb,
	"raw" jsonb,
	"embedding" vector(1024),
	"sync_status" text DEFAULT 'active' NOT NULL,
	"jira_created" timestamp with time zone,
	"jira_updated" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_cache_jira_issue_key_unique" UNIQUE("jira_issue_key"),
	CONSTRAINT "tickets_cache_sync_status_check" CHECK ("tickets_cache"."sync_status" IN ('active','stale','deleted'))
);
--> statement-breakpoint
CREATE INDEX "tickets_cache_project_key_idx" ON "tickets_cache" USING btree ("project_key");--> statement-breakpoint
CREATE INDEX "tickets_cache_status_idx" ON "tickets_cache" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_cache_jira_updated_idx" ON "tickets_cache" USING btree ("jira_updated");