CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'bug' NOT NULL,
	"reporter_email" text,
	"captured_context" jsonb,
	"intake_state" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"bug_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_sessions_kind_check" CHECK ("chat_sessions"."kind" IN ('bug','transcript','qa')),
	CONSTRAINT "chat_sessions_status_check" CHECK ("chat_sessions"."status" IN ('active','submitted','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"stop_reason" text,
	"input_tokens" text,
	"output_tokens" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" IN ('user','assistant','system'))
);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_bug_report_id_bug_reports_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."bug_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_sessions_status_idx" ON "chat_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_sessions_created_at_idx" ON "chat_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_session_idx" ON "chat_messages" USING btree ("session_id","created_at");