import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const PROMPT_AGENTS = [
  'intake',
  'ticket_polisher',
  'transcript_decomposer',
  'triage',
  'qa_bot',
  'code_localizer',
] as const;
export type PromptAgent = (typeof PROMPT_AGENTS)[number];

export const promptOverrides = pgTable(
  'prompt_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agent: text('agent').$type<PromptAgent>().notNull(),
    content: text('content').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentCheck: check(
      'prompt_overrides_agent_check',
      sql`${table.agent} IN ('intake','ticket_polisher','transcript_decomposer','triage','qa_bot','code_localizer')`
    ),
    agentActiveIdx: index('prompt_overrides_agent_active_idx').on(
      table.agent,
      table.isActive
    ),
  })
);

export type PromptOverride = typeof promptOverrides.$inferSelect;
export type NewPromptOverride = typeof promptOverrides.$inferInsert;
