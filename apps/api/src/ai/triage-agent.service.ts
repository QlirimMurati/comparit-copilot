import type Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Database } from '../db/db.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  REPORT_SEVERITIES,
  SPARTEN,
  bugReports,
  type BugReport,
} from '../db/schema';
import { AnthropicService } from './anthropic.service';
import { DedupService } from './dedup.service';

const MODEL = 'claude-sonnet-4-6';
const CONFIDENCE_FLOOR = 0.55;

export const TriageProposalSchema = z.object({
  proposedSeverity: z.object({
    value: z.enum(REPORT_SEVERITIES),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).max(500),
  }),
  proposedSparte: z
    .object({
      value: z.enum(SPARTEN),
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(1).max(500),
    })
    .nullable(),
  suggestedAssignee: z
    .object({
      userId: z.string().uuid().nullable(),
      reason: z.string().min(1).max(500),
      confidence: z.number().min(0).max(1),
    })
    .nullable(),
  similarReportIds: z.array(z.string().uuid()).max(10),
  generatedAt: z.string(),
});
export type TriageProposal = z.infer<typeof TriageProposalSchema>;

const TRIAGE_TOOL: Anthropic.Tool = {
  name: 'submit_triage',
  description:
    'Emit the triage proposal. Call exactly once. Each proposal includes a confidence in [0,1].',
  input_schema: {
    type: 'object',
    required: ['proposedSeverity'],
    properties: {
      proposedSeverity: {
        type: 'object',
        required: ['value', 'confidence', 'rationale'],
        properties: {
          value: { type: 'string', enum: [...REPORT_SEVERITIES] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      proposedSparte: {
        type: 'object',
        required: ['value', 'confidence', 'rationale'],
        properties: {
          value: { type: 'string', enum: [...SPARTEN] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
      suggestedAssigneeReason: {
        type: 'string',
        description:
          'Free-text reason for the suggested assignee, e.g. "fixed 3 similar reports in this sparte". Server picks the actual userId from history.',
      },
    },
    additionalProperties: false,
  },
};

const TRIAGE_SYSTEM = `You are a senior triage engineer for the Comparit comparer-ui codebase. Given a freshly-submitted bug report and the most similar historical reports, you propose:

1. A severity level (blocker, high, medium, low). Calibrate against the impact described and the similarity profile of the historical reports.
2. A sparte correction if the captured/declared sparte looks wrong.
3. An optional reason for an assignee (the server picks the actual userId based on who fixed the similar reports).

Each proposal needs a confidence in [0, 1]. Use sub-0.6 confidence when unsure. Do not invent.

Return via the submit_triage tool. Do not call any other tool.`;

@Injectable()
export class TriageAgentService {
  private readonly logger = new Logger('TriageAgent');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    private readonly dedup: DedupService,
    @Optional() private readonly realtime?: RealtimeGateway
  ) {}

  async triage(reportId: string): Promise<TriageProposal | null> {
    if (!this.anthropic.isConfigured) return null;

    const report = await this.loadReport(reportId);
    if (!report) {
      this.logger.warn(`Report ${reportId} not found — skipping triage`);
      return null;
    }

    let similar: Array<{ id: string; title: string; severity: string }> = [];
    try {
      const candidates = await this.dedup.checkDuplicate({
        title: report.title,
        description: report.description,
        sparte: report.sparte,
        limit: 5,
        maxDistance: 0.5,
      });
      similar = candidates.map((c) => ({
        id: c.id,
        title: c.title,
        severity: c.severity,
      }));
    } catch (err) {
      this.logger.warn(
        `Similar lookup failed for report ${reportId}: ${(err as Error).message}`
      );
    }

    const userPrompt = this.buildPrompt(report, similar);

    const response = await this.anthropic.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: TRIAGE_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: TRIAGE_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === TRIAGE_TOOL.name
    );
    if (!toolUse) {
      throw new InternalServerErrorException(
        'Triage agent did not call submit_triage'
      );
    }

    const raw = toolUse.input as {
      proposedSeverity?: {
        value: string;
        confidence: number;
        rationale: string;
      };
      proposedSparte?: {
        value: string;
        confidence: number;
        rationale: string;
      };
      suggestedAssigneeReason?: string;
    };

    const sparteFields =
      raw.proposedSparte &&
      raw.proposedSparte.confidence >= CONFIDENCE_FLOOR
        ? {
            value: raw.proposedSparte.value as TriageProposal['proposedSparte'] extends infer T
              ? T extends { value: infer V }
                ? V
                : never
              : never,
            confidence: raw.proposedSparte.confidence,
            rationale: raw.proposedSparte.rationale,
          }
        : null;

    const assigneeUserId = await this.pickAssigneeFromSimilar(similar.map((s) => s.id));

    const candidate: TriageProposal = {
      proposedSeverity: {
        value: raw.proposedSeverity!
          .value as TriageProposal['proposedSeverity']['value'],
        confidence: raw.proposedSeverity!.confidence,
        rationale: raw.proposedSeverity!.rationale,
      },
      proposedSparte: sparteFields as TriageProposal['proposedSparte'],
      suggestedAssignee:
        raw.suggestedAssigneeReason && assigneeUserId
          ? {
              userId: assigneeUserId,
              reason: raw.suggestedAssigneeReason,
              confidence: Math.min(1, raw.proposedSeverity!.confidence),
            }
          : null,
      similarReportIds: similar.map((s) => s.id),
      generatedAt: new Date().toISOString(),
    };

    const parsed = TriageProposalSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new InternalServerErrorException(
        `Triage produced an invalid payload: ${parsed.error.message}`
      );
    }

    await this.db
      .update(bugReports)
      .set({ aiProposedTriage: parsed.data, updatedAt: new Date() })
      .where(eq(bugReports.id, reportId));

    this.realtime?.emitAiProposalReady({ reportId, kind: 'triage' });
    return parsed.data;
  }

  private async loadReport(id: string): Promise<BugReport | null> {
    const rows = await this.db
      .select()
      .from(bugReports)
      .where(eq(bugReports.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  private async pickAssigneeFromSimilar(
    similarIds: string[]
  ): Promise<string | null> {
    if (similarIds.length === 0) return null;
    const rows = await this.db
      .select({
        reporterId: bugReports.reporterId,
        jiraIssueKey: bugReports.jiraIssueKey,
        status: bugReports.status,
      })
      .from(bugReports);
    const candidates = rows.filter(
      (r) =>
        similarIds.includes(
          (r as unknown as { id?: string }).id ?? ''
        ) ||
        (r.jiraIssueKey && r.status === 'ticket_created')
    );
    void candidates;
    // Conservative MVP: return null until W7 (Jira sync) provides the
    // resolver-by-issue-key mapping. Revisit once tickets_cache exists.
    return null;
  }

  private buildPrompt(
    report: BugReport,
    similar: Array<{ id: string; title: string; severity: string }>
  ): string {
    return [
      `## Bug report`,
      `Id: ${report.id}`,
      `Title: ${report.title}`,
      `Declared severity: ${report.severity}`,
      `Declared sparte: ${report.sparte ?? '(not set)'}`,
      ``,
      `Description:`,
      report.description,
      ``,
      `Captured page context:`,
      `\`\`\`json`,
      JSON.stringify(report.capturedContext ?? null, null, 2),
      `\`\`\``,
      ``,
      `## Top similar historical reports`,
      similar.length
        ? similar
            .map(
              (s, i) =>
                `${i + 1}. [${s.id}] severity=${s.severity} — ${s.title}`
            )
            .join('\n')
        : '_(none above similarity threshold)_',
      ``,
      `Now call submit_triage with severity, optional sparte correction, and optional suggested assignee reason.`,
    ].join('\n');
  }
}
