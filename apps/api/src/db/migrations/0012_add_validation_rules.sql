CREATE TABLE IF NOT EXISTS "validation_rules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sparte" TEXT NOT NULL,
  "field_path" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "validators" JSONB NOT NULL,
  "enum_values" TEXT[],
  "human_rule" TEXT NOT NULL,
  "synonyms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source" TEXT NOT NULL DEFAULT 'seed',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "validation_rules_sparte_field_uq"
  ON "validation_rules" ("sparte", "field_path");
