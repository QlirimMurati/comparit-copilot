CREATE TABLE "few_shot_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"label" text NOT NULL,
	"conversation" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "few_shot_examples_agent_check" CHECK ("few_shot_examples"."agent" IN ('intake','ticket_polisher','transcript_decomposer','triage','qa_bot','code_localizer'))
);
--> statement-breakpoint
CREATE TABLE "prompt_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_overrides_agent_check" CHECK ("prompt_overrides"."agent" IN ('intake','ticket_polisher','transcript_decomposer','triage','qa_bot','code_localizer'))
);
--> statement-breakpoint
CREATE INDEX "few_shot_examples_agent_idx" ON "few_shot_examples" USING btree ("agent","is_active");--> statement-breakpoint
CREATE INDEX "prompt_overrides_agent_active_idx" ON "prompt_overrides" USING btree ("agent","is_active");