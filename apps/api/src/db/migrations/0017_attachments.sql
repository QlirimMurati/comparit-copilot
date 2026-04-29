CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
  copilot_session_id uuid REFERENCES copilot_sessions(id) ON DELETE SET NULL,
  bug_report_id uuid REFERENCES bug_reports(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'screenshot',
  filename text,
  content_type text NOT NULL DEFAULT 'image/png',
  size_bytes integer NOT NULL,
  width integer,
  height integer,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attachments_kind_check'
  ) THEN
    ALTER TABLE attachments ADD CONSTRAINT attachments_kind_check
      CHECK (kind IN ('screenshot','upload'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS attachments_chat_session_idx
  ON attachments (chat_session_id) WHERE chat_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_copilot_session_idx
  ON attachments (copilot_session_id) WHERE copilot_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_bug_report_idx
  ON attachments (bug_report_id) WHERE bug_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_created_at_idx
  ON attachments (created_at);
