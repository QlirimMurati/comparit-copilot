import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const copilotSessions = pgTable(
  'copilot_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title'),
    state: jsonb('state').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('copilot_sessions_user_idx').on(table.userId, table.createdAt),
  })
);

export type CopilotSession = typeof copilotSessions.$inferSelect;
export type NewCopilotSession = typeof copilotSessions.$inferInsert;
