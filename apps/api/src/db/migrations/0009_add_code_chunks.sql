CREATE TABLE "code_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"sparte" text,
	"symbol" text,
	"kind" text DEFAULT 'window' NOT NULL,
	"start_line" integer DEFAULT 1 NOT NULL,
	"end_line" integer DEFAULT 1 NOT NULL,
	"content" text NOT NULL,
	"last_modified" timestamp with time zone,
	"git_sha" text,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_chunks_kind_check" CHECK ("code_chunks"."kind" IN ('file','function','class','method','window')),
	CONSTRAINT "code_chunks_sparte_check" CHECK ("code_chunks"."sparte" IS NULL OR "code_chunks"."sparte" IN ('bu','gf','risikoleben','kvv','kvz','hausrat','phv','wohngebaeude','kfz','basis_rente','private_rente','comparit'))
);
--> statement-breakpoint
CREATE INDEX "code_chunks_path_idx" ON "code_chunks" USING btree ("path");--> statement-breakpoint
CREATE INDEX "code_chunks_sparte_idx" ON "code_chunks" USING btree ("sparte");