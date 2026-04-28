import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const TRANSCRIPT_NODE_TYPES = ['epic', 'story', 'subtask'] as const;
export type TranscriptNodeType = (typeof TRANSCRIPT_NODE_TYPES)[number];

export const TRANSCRIPT_STATUSES = ['active', 'complete', 'abandoned'] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export const transcriptSessions = pgTable(
  'transcript_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title'),
    rawTranscript: text('raw_transcript').notNull(),
    status: text('status').$type<TranscriptStatus>().notNull().default('active'),
    instructions: jsonb('instructions'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'transcript_sessions_status_check',
      sql`${table.status} IN ('active','complete','abandoned')`
    ),
    statusIdx: index('transcript_sessions_status_idx').on(table.status),
  })
);

export const transcriptNodes = pgTable(
  'transcript_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => transcriptSessions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => transcriptNodes.id,
      { onDelete: 'cascade' }
    ),
    nodeType: text('node_type').$type<TranscriptNodeType>().notNull(),
    title: text('title').notNull(),
    description: text('description'),
    labels: jsonb('labels'),
    estimateHours: integer('estimate_hours'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    nodeTypeCheck: check(
      'transcript_nodes_type_check',
      sql`${table.nodeType} IN ('epic','story','subtask')`
    ),
    sessionIdx: index('transcript_nodes_session_idx').on(table.sessionId),
    parentIdx: index('transcript_nodes_parent_idx').on(table.parentId),
  })
);

export type TranscriptSession = typeof transcriptSessions.$inferSelect;
export type NewTranscriptSession = typeof transcriptSessions.$inferInsert;
export type TranscriptNode = typeof transcriptNodes.$inferSelect;
export type NewTranscriptNode = typeof transcriptNodes.$inferInsert;
