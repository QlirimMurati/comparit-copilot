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
import { chatSessions } from './chat-sessions';

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').$type<MessageRole>().notNull(),
    content: jsonb('content').notNull(),
    stopReason: text('stop_reason'),
    inputTokens: text('input_tokens'),
    outputTokens: text('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    roleCheck: check(
      'chat_messages_role_check',
      sql`${table.role} IN ('user','assistant','system')`
    ),
    sessionIdx: index('chat_messages_session_idx').on(
      table.sessionId,
      table.createdAt
    ),
  })
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
