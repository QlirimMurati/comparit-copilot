import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bugReports } from './bug-reports';

export const CHAT_KINDS = ['bug', 'transcript', 'qa'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export const CHAT_STATUSES = ['active', 'submitted', 'abandoned'] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<ChatKind>().notNull().default('bug'),
    reporterEmail: text('reporter_email'),
    capturedContext: jsonb('captured_context'),
    intakeState: jsonb('intake_state'),
    status: text('status').$type<ChatStatus>().notNull().default('active'),
    bugReportId: uuid('bug_report_id').references(() => bugReports.id, {
      onDelete: 'set null',
    }),
    taskId: text('task_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'chat_sessions_kind_check',
      sql`${table.kind} IN ('bug','transcript','qa')`
    ),
    statusCheck: check(
      'chat_sessions_status_check',
      sql`${table.status} IN ('active','submitted','abandoned')`
    ),
    statusIdx: index('chat_sessions_status_idx').on(table.status),
    createdAtIdx: index('chat_sessions_created_at_idx').on(table.createdAt),
    taskIdIdx: index('chat_sessions_task_id_idx').on(table.taskId),
  })
);

export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
