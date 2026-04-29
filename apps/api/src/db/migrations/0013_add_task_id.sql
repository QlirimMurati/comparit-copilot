ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "task_id" TEXT;
ALTER TABLE "bug_reports" ADD COLUMN IF NOT EXISTS "task_id" TEXT;

CREATE INDEX IF NOT EXISTS "chat_sessions_task_id_idx" ON "chat_sessions" ("task_id");
CREATE INDEX IF NOT EXISTS "bug_reports_task_id_idx" ON "bug_reports" ("task_id");
