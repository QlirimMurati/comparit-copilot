import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  ticketsCache,
  type NewTicketCache,
  type TicketCache,
} from '../db/schema';
import { JiraClient, type JiraIssueRaw } from './jira.client';
import { JqlBuilderService } from './jql-builder.service';

@Injectable()
export class TicketsCacheService {
  private readonly logger = new Logger('TicketsCache');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jira: JiraClient,
    private readonly jql: JqlBuilderService
  ) {}

  /**
   * Run a paged JQL search and upsert all matching issues into tickets_cache.
   * Returns the number of issues processed (created or updated).
   */
  async syncByJql(jqlString: string, opts: { maxPages?: number } = {}): Promise<{
    processed: number;
    pages: number;
  }> {
    let processed = 0;
    let pages = 0;
    let pageToken: string | undefined;
    const maxPages = Math.max(1, Math.min(50, opts.maxPages ?? 20));

    do {
      const res = await this.jira.searchByJql({
        jql: jqlString,
        maxResults: 50,
        nextPageToken: pageToken,
      });
      pages++;
      for (const raw of res.issues) {
        await this.upsertFromRaw(raw);
        processed++;
      }
      pageToken = res.isLast === false ? res.nextPageToken : undefined;
    } while (pageToken && pages < maxPages);

    this.logger.log(`Sync done: ${processed} issues across ${pages} page(s)`);
    return { processed, pages };
  }

  /** Full sync of all allowed projects (paged). */
  async syncAllAllowedProjects(): Promise<{ processed: number; pages: number }> {
    const jqlString = this.jql.build({ orderBy: 'updated' });
    return this.syncByJql(jqlString, { maxPages: 50 });
  }

  /**
   * Delta sync: anything updated in the last N minutes (default 70 to allow
   * for clock skew when scheduled hourly).
   */
  async syncDelta(opts: { sinceMinutes?: number } = {}): Promise<{
    processed: number;
    pages: number;
  }> {
    const sinceMinutes = Math.max(1, opts.sinceMinutes ?? 70);
    const cutoff = `-${sinceMinutes}m`;
    const jqlString = this.jql.build({
      rawJql: `updated >= "${cutoff}"`,
      orderBy: 'updated',
    });
    return this.syncByJql(jqlString);
  }

  /** Upsert a single Jira issue into the cache by jira_issue_key. */
  async upsertFromRaw(raw: JiraIssueRaw): Promise<TicketCache> {
    const values = this.toCache(raw);
    const existing = await this.db
      .select()
      .from(ticketsCache)
      .where(eq(ticketsCache.jiraIssueKey, raw.key))
      .limit(1);

    if (existing.length === 0) {
      const [row] = await this.db
        .insert(ticketsCache)
        .values(values)
        .returning();
      return row;
    }
    const [row] = await this.db
      .update(ticketsCache)
      .set({ ...values, syncedAt: new Date(), updatedAt: new Date() })
      .where(eq(ticketsCache.jiraIssueKey, raw.key))
      .returning();
    return row;
  }

  async findByKey(key: string): Promise<TicketCache | null> {
    const rows = await this.db
      .select()
      .from(ticketsCache)
      .where(eq(ticketsCache.jiraIssueKey, key))
      .limit(1);
    return rows[0] ?? null;
  }

  // ---- internals --------------------------------------------------------

  private toCache(raw: JiraIssueRaw): NewTicketCache {
    const f = raw.fields ?? {};
    return {
      jiraIssueKey: raw.key,
      projectKey: f.project?.key ?? raw.key.split('-')[0] ?? 'UNKNOWN',
      issueType: f.issuetype?.name ?? null,
      summary: f.summary ?? '(no summary)',
      description: this.adfToText(f.description),
      status: f.status?.name ?? null,
      priority: f.priority?.name ?? null,
      assigneeEmail: f.assignee?.emailAddress ?? null,
      assigneeName: f.assignee?.displayName ?? null,
      reporterEmail: f.reporter?.emailAddress ?? null,
      labels: Array.isArray(f.labels) ? f.labels : [],
      components: Array.isArray(f.components)
        ? f.components.map((c) => c.name).filter(Boolean)
        : [],
      raw,
      jiraCreated: f.created ? new Date(f.created) : null,
      jiraUpdated: f.updated ? new Date(f.updated) : null,
      syncStatus: 'active',
    };
  }

  /** Best-effort flatten of Atlassian Document Format to plain text. */
  private adfToText(adf: unknown): string | null {
    if (!adf || typeof adf !== 'object') {
      return typeof adf === 'string' ? adf : null;
    }
    const out: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === 'text' && typeof n.text === 'string') {
        out.push(n.text);
      }
      if (Array.isArray(n.content)) {
        for (const child of n.content) walk(child);
      }
      if (n.type === 'paragraph' || n.type === 'heading') out.push('\n');
    };
    walk(adf);
    const flat = out.join('').trim();
    return flat || null;
  }
}
