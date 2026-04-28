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
import { users } from './users';

export const EMBEDDING_DIMENSIONS = 1024;

export const REPORT_STATUSES = [
  'new',
  'triaged',
  'in_progress',
  'resolved',
  'wontfix',
  'duplicate',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SEVERITIES = ['blocker', 'high', 'medium', 'low'] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export const SPARTEN = [
  'bu',
  'gf',
  'risikoleben',
  'kvv',
  'kvz',
  'hausrat',
  'phv',
  'wohngebaeude',
  'kfz',
  'basis_rente',
  'private_rente',
  'comparit',
] as const;
export type Sparte = (typeof SPARTEN)[number];

export const bugReports = pgTable(
  'bug_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').$type<ReportStatus>().notNull().default('new'),
    severity: text('severity')
      .$type<ReportSeverity>()
      .notNull()
      .default('medium'),
    sparte: text('sparte').$type<Sparte>(),
    capturedContext: jsonb('captured_context'),
    aiProposedTicket: jsonb('ai_proposed_ticket'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    jiraIssueKey: text('jira_issue_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'bug_reports_status_check',
      sql`${table.status} IN ('new','triaged','in_progress','resolved','wontfix','duplicate')`
    ),
    severityCheck: check(
      'bug_reports_severity_check',
      sql`${table.severity} IN ('blocker','high','medium','low')`
    ),
    sparteCheck: check(
      'bug_reports_sparte_check',
      sql`${table.sparte} IS NULL OR ${table.sparte} IN ('bu','gf','risikoleben','kvv','kvz','hausrat','phv','wohngebaeude','kfz','basis_rente','private_rente','comparit')`
    ),
    reporterIdx: index('bug_reports_reporter_idx').on(table.reporterId),
    statusIdx: index('bug_reports_status_idx').on(table.status),
    createdAtIdx: index('bug_reports_created_at_idx').on(table.createdAt),
  })
);

export type BugReport = typeof bugReports.$inferSelect;
export type NewBugReport = typeof bugReports.$inferInsert;
