-- Add fix_versions to tickets_cache so search_jira can filter on it.
-- Stored as a jsonb array of {id, name} objects (Jira's native shape).
ALTER TABLE "tickets_cache" ADD COLUMN IF NOT EXISTS "fix_versions" jsonb;

-- Backfill from the existing `raw` payload so already-synced tickets pick up
-- their fixVersions immediately, without waiting for the next sync cycle.
UPDATE "tickets_cache"
SET "fix_versions" = "raw"->'fields'->'fixVersions'
WHERE "raw"->'fields'->'fixVersions' IS NOT NULL;
