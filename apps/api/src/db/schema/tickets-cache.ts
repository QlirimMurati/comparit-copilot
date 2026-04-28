import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from './bug-reports';

export const TICKET_SYNC_STATUSES = ['active', 'stale', 'deleted'] as const;
export type TicketSyncStatus = (typeof TICKET_SYNC_STATUSES)[number];

export const ticketsCache = pgTable(
  'tickets_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraIssueKey: text('jira_issue_key').notNull().unique(),
    projectKey: text('project_key').notNull(),
    issueType: text('issue_type'),
    summary: text('summary').notNull(),
    description: text('description'),
    status: text('status'),
    priority: text('priority'),
    assigneeEmail: text('assignee_email'),
    assigneeName: text('assignee_name'),
    reporterEmail: text('reporter_email'),
    labels: jsonb('labels'),
    components: jsonb('components'),
    raw: jsonb('raw'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    syncStatus: text('sync_status')
      .$type<TicketSyncStatus>()
      .notNull()
      .default('active'),
    jiraCreated: timestamp('jira_created', { withTimezone: true }),
    jiraUpdated: timestamp('jira_updated', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    syncStatusCheck: check(
      'tickets_cache_sync_status_check',
      sql`${table.syncStatus} IN ('active','stale','deleted')`
    ),
    projectKeyIdx: index('tickets_cache_project_key_idx').on(table.projectKey),
    statusIdx: index('tickets_cache_status_idx').on(table.status),
    jiraUpdatedIdx: index('tickets_cache_jira_updated_idx').on(
      table.jiraUpdated
    ),
  })
);

export type TicketCache = typeof ticketsCache.$inferSelect;
export type NewTicketCache = typeof ticketsCache.$inferInsert;
