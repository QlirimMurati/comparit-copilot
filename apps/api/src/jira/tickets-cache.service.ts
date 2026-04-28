import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq, inArray, isNull } from 'drizzle-orm';
import { VoyageService } from '../ai/voyage.service';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  ticketsCache,
  type NewTicketCache,
  type TicketCache,
} from '../db/schema';
import { JiraClient, type JiraIssueRaw } from './jira.client';
import { JqlBuilderService } from './jql-builder.service';

const EMBED_BATCH_SIZE = 64;

@Injectable()
export class TicketsCacheService {
  private readonly logger = new Logger('TicketsCache');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jira: JiraClient,
    private readonly jql: JqlBuilderService,
    @Optional() private readonly voyage?: VoyageService
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
      const upsertedKeys: string[] = [];
      for (const raw of res.issues) {
        await this.upsertFromRaw(raw);
        upsertedKeys.push(raw.key);
        processed++;
      }
      // Best-effort: embed any rows in this page that don't have an
      // embedding yet (covers both fresh inserts and existing rows whose
      // summary/description changed).
      await this.embedMissingFor(upsertedKeys);
      pageToken = res.isLast === false ? res.nextPageToken : undefined;
    } while (pageToken && pages < maxPages);

    this.logger.log(`Sync done: ${processed} issues across ${pages} page(s)`);
    return { processed, pages };
  }

  /**
   * Embed any rows in `keys` that currently have a NULL embedding. Voyage
   * is optional — if not configured, this is a no-op.
   */
  async embedMissingFor(keys: string[]): Promise<number> {
    if (!this.voyage || !this.voyage.isConfigured) return 0;
    if (keys.length === 0) return 0;

    const rows = await this.db
      .select()
      .from(ticketsCache)
      .where(inArray(ticketsCache.jiraIssueKey, keys));

    const todo = rows.filter((r) => r.embedding == null);
    if (todo.length === 0) return 0;

    let embedded = 0;
    for (let i = 0; i < todo.length; i += EMBED_BATCH_SIZE) {
      const slice = todo.slice(i, i + EMBED_BATCH_SIZE);
      try {
        const vectors = await this.voyage.embedTextBatch(
          slice.map((r) => buildEmbeddingText(r)),
          'document'
        );
        for (let j = 0; j < slice.length; j++) {
          await this.db
            .update(ticketsCache)
            .set({ embedding: vectors[j], updatedAt: new Date() })
            .where(eq(ticketsCache.id, slice[j].id));
          embedded++;
        }
      } catch (err) {
        this.logger.warn(
          `Embed batch failed (size=${slice.length}): ${(err as Error).message}`
        );
      }
    }
    if (embedded > 0) {
      this.logger.log(`Embedded ${embedded} ticket(s)`);
    }
    return embedded;
  }

  /** Embed every row in tickets_cache that's missing an embedding. */
  async embedAllMissing(): Promise<number> {
    if (!this.voyage || !this.voyage.isConfigured) return 0;
    const rows = await this.db
      .select({ key: ticketsCache.jiraIssueKey })
      .from(ticketsCache)
      .where(isNull(ticketsCache.embedding))
      .limit(1000);
    return this.embedMissingFor(rows.map((r) => r.key));
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

    // If summary or description changed, null the embedding so the
    // next sync re-embeds with the fresh content.
    const prev = existing[0];
    const contentChanged =
      prev.summary !== values.summary ||
      prev.description !== values.description;
    const [row] = await this.db
      .update(ticketsCache)
      .set({
        ...values,
        ...(contentChanged ? { embedding: null } : {}),
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
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

function buildEmbeddingText(t: TicketCache): string {
  const parts: string[] = [
    `Issue: ${t.jiraIssueKey}`,
    `Project: ${t.projectKey}`,
  ];
  if (t.issueType) parts.push(`Type: ${t.issueType}`);
  if (t.status) parts.push(`Status: ${t.status}`);
  if (t.priority) parts.push(`Priority: ${t.priority}`);
  parts.push('', `Title: ${t.summary}`);
  if (t.description) parts.push('', 'Description:', t.description);
  if (Array.isArray(t.labels) && t.labels.length > 0) {
    parts.push('', `Labels: ${(t.labels as string[]).join(', ')}`);
  }
  if (Array.isArray(t.components) && t.components.length > 0) {
    parts.push(`Components: ${(t.components as string[]).join(', ')}`);
  }
  return parts.join('\n');
}
