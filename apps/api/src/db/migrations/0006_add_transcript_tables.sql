CREATE TABLE "transcript_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"parent_id" uuid,
	"node_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"labels" jsonb,
	"estimate_hours" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_nodes_type_check" CHECK ("transcript_nodes"."node_type" IN ('epic','story','subtask'))
);
--> statement-breakpoint
CREATE TABLE "transcript_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"raw_transcript" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"instructions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_sessions_status_check" CHECK ("transcript_sessions"."status" IN ('active','complete','abandoned'))
);
--> statement-breakpoint
ALTER TABLE "transcript_nodes" ADD CONSTRAINT "transcript_nodes_session_id_transcript_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."transcript_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_nodes" ADD CONSTRAINT "transcript_nodes_parent_id_transcript_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."transcript_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_nodes_session_idx" ON "transcript_nodes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "transcript_nodes_parent_idx" ON "transcript_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "transcript_sessions_status_idx" ON "transcript_sessions" USING btree ("status");