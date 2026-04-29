import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { bugReports, type BugReport } from '../db/schema';
import { JiraClient } from './jira.client';
import { JqlBuilderService } from './jql-builder.service';
import { TicketsCacheService } from './tickets-cache.service';

/**
 * LV-project required custom fields. Discovered from
 * GET /rest/api/3/issue/createmeta/LV/issuetypes/10004 on 2026-04-29.
 * Field/option ids are stable as long as the Jira admin doesn't recreate them.
 */
const LV_FIELD = {
  PRODUCT: 'customfield_10133',
  SPARTE: 'customfield_10203',
  TASK_AREA: 'customfield_10124',
  ACCOUNT: 'customfield_10120',
  BILLING: 'customfield_10126',
} as const;

const LV_OPTION = {
  PRODUCT_CPIT_APP: '10670',
  TASK_AREA_BUG: '10454', // Fehlerbehebung / Troubleshooting
  TASK_AREA_FEATURE: '10394', // Weiterentwicklung / Feature Development
  ACCOUNT_INTERN: '3',
  BILLING_KEINS: '10548',
  // Sparte options
  SPARTE_INTERN: '11173',
  SPARTE_KFZ: '11179',
  SPARTE_LV: '11174',
  SPARTE_LV_AV: '11178',
  SPARTE_LV_BU: '11177',
  SPARTE_LV_DD: '11777',
  SPARTE_LV_GF: '11175',
  SPARTE_LV_RLV: '11176',
} as const;

function sparteLabelFromOptionId(optionId: string): string {
  switch (optionId) {
    case LV_OPTION.SPARTE_INTERN: return 'Intern';
    case LV_OPTION.SPARTE_KFZ:    return 'KFZ';
    case LV_OPTION.SPARTE_LV:     return 'LV';
    case LV_OPTION.SPARTE_LV_AV:  return 'LV AV';
    case LV_OPTION.SPARTE_LV_BU:  return 'LV BU';
    case LV_OPTION.SPARTE_LV_DD:  return 'LV DD';
    case LV_OPTION.SPARTE_LV_GF:  return 'LV GF';
    case LV_OPTION.SPARTE_LV_RLV: return 'LV RLV';
    default: return 'Intern';
  }
}

/** Map our internal sparte enum → Jira's LV "Sparte" option id. */
function mapSparteToLvOption(sparte: string | null): string {
  switch (sparte) {
    case 'bu': return LV_OPTION.SPARTE_LV_BU;
    case 'gf': return LV_OPTION.SPARTE_LV_GF;
    case 'risikoleben': return LV_OPTION.SPARTE_LV_RLV;
    case 'kfz': return LV_OPTION.SPARTE_KFZ;
    case 'comparit': return LV_OPTION.SPARTE_INTERN;
    // kvv, kvz, hausrat, phv, wohngebaeude, basis_rente, private_rente — no
    // 1:1 LV option, fall back to Intern. Override via Jira UI if needed.
    default: return LV_OPTION.SPARTE_INTERN;
  }
}

export interface JiraPushPreview {
  reportId: string;
  projectKey: string;
  issueType: string;
  summary: string;
  description: string;
  labels: string[];
  /** Jira priority name derived from the report's severity. */
  priority: string;
  /**
   * Display-only summary of the LV-required custom fields filled by defaults.
   * Frontend renders these so the user sees exactly what will be created.
   */
  customFieldsDisplay: { name: string; value: string }[];
  /** SHA-256 of the canonicalised payload — confirm endpoint requires it. */
  previewHash: string;
  /** Plain-language warning for the user-facing UI. */
  warning: string;
}

/** Map our internal severity → Jira priority name. */
function severityToJiraPriority(severity: string | null): string {
  switch (severity) {
    case 'blocker': return 'Highest';
    case 'high':    return 'High';
    case 'medium':  return 'Medium';
    case 'low':     return 'Low';
    default:        return 'Medium';
  }
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
  private readonly logger = new Logger('PushToJiraService');

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

    const rawSummary = (polished?.title ?? report.title).trim();
    // Comparit convention: every Jira ticket created from the copilot is a
    // UI-app ticket. Prefix the summary so triage in Jira is consistent.
    const summary = /^UI\s*:/i.test(rawSummary)
      ? rawSummary
      : `UI: ${rawSummary}`;
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

    // Comparit convention: every ticket created from the copilot is a
    // UI-app ticket — that's the only Jira label we emit. Sparte / area
    // / etc. are conveyed through the dedicated custom fields below.
    const labels = ['UI'];

    // LV-required custom fields (discovered via Jira's createmeta endpoint).
    // Sparte is derived from the bug report; everything else uses safe defaults.
    const { customFields, customFieldsDisplay } = this.buildLvBugFields(report.sparte);

    // Severity → Jira priority. Default Medium when missing.
    const priority = severityToJiraPriority(report.severity);

    const previewHash = canonicalHash({
      reportId,
      projectKey,
      issueType,
      summary,
      description,
      labels,
      priority,
      customFields,
    });

    return {
      reportId,
      projectKey,
      issueType,
      summary,
      description,
      labels,
      priority,
      customFieldsDisplay,
      previewHash,
      warning:
        'Confirm to create a real ticket in Jira. This action cannot be undone from copilot — only the issue creator can delete in Jira.',
    };
  }

  private buildLvBugFields(sparte: string | null): {
    customFields: Record<string, unknown>;
    customFieldsDisplay: { name: string; value: string }[];
  } {
    const sparteOptionId = mapSparteToLvOption(sparte);
    const customFields = {
      [LV_FIELD.PRODUCT]:    { id: LV_OPTION.PRODUCT_CPIT_APP },
      [LV_FIELD.SPARTE]:     { id: sparteOptionId },
      [LV_FIELD.TASK_AREA]:  { id: LV_OPTION.TASK_AREA_BUG },
      // Account is a Tempo "option2" field — expects a Long, not {id: ...}.
      [LV_FIELD.ACCOUNT]:    Number(LV_OPTION.ACCOUNT_INTERN),
      [LV_FIELD.BILLING]:    { id: LV_OPTION.BILLING_KEINS },
    };
    const customFieldsDisplay = [
      { name: 'Product',           value: 'Cpit.App' },
      { name: 'Sparte',            value: sparteLabelFromOptionId(sparteOptionId) },
      { name: 'Task area',         value: 'Fehlerbehebung / Troubleshooting' },
      { name: 'Account',           value: 'Intern' },
      { name: 'Project (billing)', value: 'Keins' },
    ];
    return { customFields, customFieldsDisplay };
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

    // Re-build customFields the same way preview() did. Hash check above
    // guarantees the bug report's sparte hasn't drifted between preview & confirm.
    const report = await this.loadReport(reportId);
    const { customFields } = this.buildLvBugFields(report.sparte);

    let created;
    try {
      created = await this.jira.createIssue({
        projectKey: preview.projectKey,
        issueType: preview.issueType,
        summary: preview.summary,
        description: preview.description,
        labels: preview.labels,
        priority: preview.priority,
        customFields,
      });
    } catch (err) {
      // JiraClient throws plain Error with the real Jira response in the
      // message; surface that to the user instead of a generic 500.
      if (err instanceof HttpException) throw err;
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.error(`Jira createIssue failed for report ${reportId}: ${raw}`);
      throw new BadGatewayException(
        this.summariseJiraError(raw) || 'Jira create failed'
      );
    }

    const baseUrl = (process.env.JIRA_BASE_URL ?? '').replace(/\/+$/, '');
    const jiraIssueUrl = baseUrl
      ? `${baseUrl}/browse/${created.key}`
      : created.self;

    await this.db
      .update(bugReports)
      .set({
        jiraIssueKey: created.key,
        status: 'ticket_created',
        updatedAt: new Date(),
      })
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

  /**
   * Pull a useful message out of "Jira POST /issue failed: 400 {…json…}".
   * Jira returns errors as either {errorMessages: string[]} or {errors: {field: msg}}.
   */
  private summariseJiraError(raw: string): string {
    const m = raw.match(/Jira [^:]+: (\d+) ([\s\S]*)$/);
    const status = m?.[1];
    const body = m?.[2]?.trim() ?? raw;
    try {
      const parsed = JSON.parse(body) as {
        errorMessages?: string[];
        errors?: Record<string, string>;
      };
      const msgs: string[] = [];
      if (parsed.errorMessages?.length) msgs.push(...parsed.errorMessages);
      if (parsed.errors) {
        for (const [field, msg] of Object.entries(parsed.errors)) {
          msgs.push(`${field}: ${msg}`);
        }
      }
      if (msgs.length) {
        return `Jira ${status ?? ''} — ${msgs.join('; ')}`.trim();
      }
    } catch {
      // not JSON — fall through
    }
    return raw;
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
