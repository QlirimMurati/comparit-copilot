-- Add `type` column (bug | feature) so a single Reports tab can hold both.
-- Idempotent: safe to re-run if the column / index / constraint already exist.
ALTER TABLE "bug_reports" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'bug';
ALTER TABLE "bug_reports" DROP CONSTRAINT IF EXISTS "bug_reports_type_check";
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_type_check"
  CHECK ("type" IN ('bug','feature'));
CREATE INDEX IF NOT EXISTS "bug_reports_type_idx" ON "bug_reports"("type");

-- Simplify status to 4 values: new, ticket_created, duplicate, declined.
-- Migrate existing rows so the new tighter CHECK constraint passes.
UPDATE "bug_reports" SET "status" = 'new'            WHERE "status" = 'triaged';
UPDATE "bug_reports" SET "status" = 'ticket_created' WHERE "status" IN ('in_progress','resolved');
UPDATE "bug_reports" SET "status" = 'declined'       WHERE "status" = 'wontfix';

ALTER TABLE "bug_reports" DROP CONSTRAINT IF EXISTS "bug_reports_status_check";
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_status_check"
  CHECK ("status" IN ('new','ticket_created','duplicate','declined'));
