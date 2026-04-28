import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { copilotSessions } from './copilot-sessions';

export const copilotMessages = pgTable(
  'copilot_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => copilotSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: jsonb('content').notNull(),
    stopReason: text('stop_reason'),
    inputTokens: text('input_tokens'),
    outputTokens: text('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roleCheck: check(
      'copilot_messages_role_check',
      sql`${table.role} IN ('user','assistant')`
    ),
    sessionIdx: index('copilot_messages_session_idx').on(
      table.sessionId,
      table.createdAt
    ),
  })
);

export type CopilotMessage = typeof copilotMessages.$inferSelect;
export type NewCopilotMessage = typeof copilotMessages.$inferInsert;
