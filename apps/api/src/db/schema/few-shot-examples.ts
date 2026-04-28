import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const FEW_SHOT_AGENTS = [
  'intake',
  'ticket_polisher',
  'transcript_decomposer',
  'triage',
  'qa_bot',
  'code_localizer',
] as const;
export type FewShotAgent = (typeof FEW_SHOT_AGENTS)[number];

export const fewShotExamples = pgTable(
  'few_shot_examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agent: text('agent').$type<FewShotAgent>().notNull(),
    label: text('label').notNull(),
    conversation: jsonb('conversation').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    agentCheck: check(
      'few_shot_examples_agent_check',
      sql`${table.agent} IN ('intake','ticket_polisher','transcript_decomposer','triage','qa_bot','code_localizer')`
    ),
    agentIdx: index('few_shot_examples_agent_idx').on(
      table.agent,
      table.isActive
    ),
  })
);

export type FewShotExample = typeof fewShotExamples.$inferSelect;
export type NewFewShotExample = typeof fewShotExamples.$inferInsert;
