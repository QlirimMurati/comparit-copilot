CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_key" text NOT NULL,
	"summary" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_cluster_key_unique" UNIQUE("cluster_key")
);
--> statement-breakpoint
ALTER TABLE "bug_reports" ADD COLUMN "cluster_id" uuid;--> statement-breakpoint
CREATE INDEX "incidents_opened_at_idx" ON "incidents" USING btree ("opened_at");