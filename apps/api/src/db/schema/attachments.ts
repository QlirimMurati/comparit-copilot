import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bugReports } from './bug-reports';
import { chatSessions } from './chat-sessions';
import { copilotSessions } from './copilot-sessions';

export const ATTACHMENT_KINDS = ['screenshot', 'upload'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatSessionId: uuid('chat_session_id').references(() => chatSessions.id, {
      onDelete: 'set null',
    }),
    copilotSessionId: uuid('copilot_session_id').references(
      () => copilotSessions.id,
      { onDelete: 'set null' }
    ),
    bugReportId: uuid('bug_report_id').references(() => bugReports.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').$type<AttachmentKind>().notNull().default('screenshot'),
    filename: text('filename'),
    contentType: text('content_type').notNull().default('image/png'),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: bytea('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'attachments_kind_check',
      sql`${table.kind} IN ('screenshot','upload')`
    ),
    chatSessionIdx: index('attachments_chat_session_idx').on(
      table.chatSessionId
    ),
    copilotSessionIdx: index('attachments_copilot_session_idx').on(
      table.copilotSessionId
    ),
    bugReportIdx: index('attachments_bug_report_idx').on(table.bugReportId),
    createdAtIdx: index('attachments_created_at_idx').on(table.createdAt),
  })
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
