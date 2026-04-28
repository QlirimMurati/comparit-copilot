import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from './bug-reports';
import { SPARTEN, type Sparte } from './bug-reports';

export const CODE_CHUNK_KINDS = [
  'file',
  'function',
  'class',
  'method',
  'window',
] as const;
export type CodeChunkKind = (typeof CODE_CHUNK_KINDS)[number];

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    path: text('path').notNull(),
    sparte: text('sparte').$type<Sparte>(),
    symbol: text('symbol'),
    kind: text('kind').$type<CodeChunkKind>().notNull().default('window'),
    startLine: integer('start_line').notNull().default(1),
    endLine: integer('end_line').notNull().default(1),
    content: text('content').notNull(),
    lastModified: timestamp('last_modified', { withTimezone: true }),
    gitSha: text('git_sha'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'code_chunks_kind_check',
      sql`${table.kind} IN ('file','function','class','method','window')`
    ),
    sparteCheck: check(
      'code_chunks_sparte_check',
      sql`${table.sparte} IS NULL OR ${table.sparte} IN (${sql.raw(SPARTEN.map((s) => `'${s}'`).join(','))})`
    ),
    pathIdx: index('code_chunks_path_idx').on(table.path),
    sparteIdx: index('code_chunks_sparte_idx').on(table.sparte),
  })
);

export type CodeChunk = typeof codeChunks.$inferSelect;
export type NewCodeChunk = typeof codeChunks.$inferInsert;
