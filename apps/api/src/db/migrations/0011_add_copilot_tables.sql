CREATE TABLE IF NOT EXISTS "copilot_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "title" TEXT,
  "state" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "copilot_sessions_user_idx"
  ON "copilot_sessions" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "copilot_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" UUID NOT NULL REFERENCES "copilot_sessions"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "stop_reason" TEXT,
  "input_tokens" TEXT,
  "output_tokens" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "copilot_messages_role_check" CHECK (role IN ('user','assistant'))
);

CREATE INDEX IF NOT EXISTS "copilot_messages_session_idx"
  ON "copilot_messages" ("session_id", "created_at");
