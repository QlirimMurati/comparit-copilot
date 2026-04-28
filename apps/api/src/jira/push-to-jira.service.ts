import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports, type BugReport } from '../db/schema';
import { JiraClient } from './jira.client';
import { JqlBuilderService } from './jql-builder.service';
import { TicketsCacheService } from './tickets-cache.service';

export interface JiraPushPreview {
  reportId: string;
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  labels: string[];
  /** SHA-256 of the canonicalised payload — confirm endpoint requires it. */
  previewHash: string;
  /** Plain-language warning for the user-facing UI. */
  warning: string;
}

export interface JiraPushConfirmInput {
  previewHash: string;
}

export interface JiraPushResult {
  jiraIssueKey: string;
  jiraIssueUrl: string;
}

@Injectable()
export class PushToJiraService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jira: JiraClient,
    private readonly jql: JqlBuilderService,
    private readonly cache: TicketsCacheService
  ) {}

  /**
   * Build (but do NOT submit) the Jira payload for a bug report. Returns a
   * previewHash that the confirm endpoint requires — guarantees the user
   * actually saw this payload before consenting.
   */
  async preview(reportId: string): Promise<JiraPushPreview> {
    if (!this.jira.isConfigured) {
      throw new ServiceUnavailableException('Jira client not configured');
    }
    const report = await this.loadReport(reportId);
    if (report.jiraIssueKey) {
      throw new BadRequestException(
        `Report already linked to ${report.jiraIssueKey} — refusing to push again`
      );
    }

    const projectKey = this.resolveProject();
    const issueType = process.env.JIRA_DEFAULT_ISSUE_TYPE?.trim() || 'Bug';

    const polished = (report.aiProposedTicket ?? null) as {
      title?: string;
      description?: string;
      proposedLabels?: string[];
    } | null;

    const summary = (polished?.title ?? report.title).trim();
    const descriptionParts: string[] = [];
    if (polished?.description) {
      descriptionParts.push(polished.description);
    } else {
      descriptionParts.push(report.description);
    }
    descriptionParts.push('', '---', '_Filed via Comparit Copilot._');
    descriptionParts.push(`Internal report id: \`${report.id}\``);
    if (report.severity) descriptionParts.push(`Severity: \`${report.severity}\``);
    if (report.sparte) descriptionParts.push(`Sparte: \`${report.sparte}\``);

    const description = descriptionParts.join('\n');

    const labelSet = new Set<string>();
    if (report.sparte) labelSet.add(report.sparte.toLowerCase());
    labelSet.add('comparit-copilot');
    if (Array.isArray(polished?.proposedLabels)) {
      for (const lbl of polished!.proposedLabels) {
        if (typeof lbl === 'string' && lbl.trim().length > 0) {
          labelSet.add(lbl.trim().toLowerCase().replace(/\s+/g, '-'));
        }
      }
    }
    const labels = [...labelSet];

    const previewHash = canonicalHash({
      reportId,
      projectKey,
      issueType,
      summary,
      description,
      labels,
    });

    return {
      reportId,
      projectKey,
      issueType,
      summary,
      description,
      labels,
      previewHash,
      warning:
        'Confirm to create a real ticket in Jira. This action cannot be undone from copilot — only the issue creator can delete in Jira.',
    };
  }

  /**
   * Verify the user-visible preview hash matches and then actually create
   * the Jira issue. On success, persist jira_issue_key on the report and
   * mirror the new issue into tickets_cache.
   */
  async confirm(
    reportId: string,
    input: JiraPushConfirmInput
  ): Promise<JiraPushResult> {
    if (!input.previewHash || input.previewHash.length < 16) {
      throw new BadRequestException('previewHash required');
    }
    const preview = await this.preview(reportId);
    if (preview.previewHash !== input.previewHash) {
      throw new BadRequestException(
        'previewHash does not match current payload — please re-fetch the preview before confirming'
      );
    }

    const created = await this.jira.createIssue({
      projectKey: preview.projectKey,
      issueType: preview.issueType,
      summary: preview.summary,
      description: preview.description,
      labels: preview.labels,
    });

    const baseUrl = (process.env.JIRA_BASE_URL ?? '').replace(/\/+$/, '');
    const jiraIssueUrl = baseUrl
      ? `${baseUrl}/browse/${created.key}`
      : created.self;

    await this.db
      .update(bugReports)
      .set({ jiraIssueKey: created.key, updatedAt: new Date() })
      .where(eq(bugReports.id, reportId));

    // Best-effort cache mirror — fetch the freshly-created issue so the
    // tickets_cache row has full fields (status, reporter, etc.).
    try {
      const fresh = await this.jira.getIssue(created.key);
      await this.cache.upsertFromRaw(fresh);
    } catch {
      // non-fatal; cache will catch up on next sync
    }

    return { jiraIssueKey: created.key, jiraIssueUrl };
  }

  private async loadReport(id: string): Promise<BugReport> {
    const rows = await this.db
      .select()
      .from(bugReports)
      .where(eq(bugReports.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Report ${id} not found`);
    }
    return rows[0];
  }

  private resolveProject(): string {
    const def = process.env.JIRA_DEFAULT_PROJECT?.trim().toUpperCase() ?? '';
    if (!def) {
      throw new ServiceUnavailableException(
        'JIRA_DEFAULT_PROJECT is not set — cannot decide where to push the issue'
      );
    }
    this.jql.resolveProject(def);
    return def;
  }
}

function canonicalHash(obj: Record<string, unknown>): string {
  const stable = stableStringify(obj);
  return createHash('sha256').update(stable).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}
