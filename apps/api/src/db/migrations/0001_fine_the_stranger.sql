CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"sparte" text,
	"captured_context" jsonb,
	"jira_issue_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_reports_status_check" CHECK ("bug_reports"."status" IN ('new','triaged','in_progress','resolved','wontfix','duplicate')),
	CONSTRAINT "bug_reports_severity_check" CHECK ("bug_reports"."severity" IN ('blocker','high','medium','low')),
	CONSTRAINT "bug_reports_sparte_check" CHECK ("bug_reports"."sparte" IS NULL OR "bug_reports"."sparte" IN ('bu','gf','risikoleben','kvv','kvz','hausrat','phv','wohngebaeude','kfz','basis_rente','private_rente','comparit'))
);
--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_reports_reporter_idx" ON "bug_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "bug_reports_status_idx" ON "bug_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bug_reports_created_at_idx" ON "bug_reports" USING btree ("created_at");