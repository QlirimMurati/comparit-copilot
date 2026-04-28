import type Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  bugReports,
  chatSessions,
  type BugReport,
  type ChatMessage,
} from '../db/schema';
import { AnthropicService } from './anthropic.service';
import { ChatSessionService } from './chat-session.service';
import {
  PolishedTicketSchema,
  TICKET_POLISHER_SYSTEM_INSTRUCTIONS,
  TICKET_POLISHER_TOOL,
  type PolishedTicket,
} from './ticket-polisher.schema';

const MODEL = 'claude-opus-4-7';

@Injectable()
export class TicketPolisherService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    private readonly sessions: ChatSessionService,
    @Optional() private readonly realtime?: RealtimeGateway
  ) {}

  async polish(reportId: string): Promise<PolishedTicket> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured on this server (set ANTHROPIC_API_KEY)'
      );
    }

    const report = await this.loadReport(reportId);
    const transcript = await this.loadTranscriptForReport(reportId);

    const userPrompt = this.buildUserPrompt(report, transcript);

    const response = await this.anthropic.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: TICKET_POLISHER_SYSTEM_INSTRUCTIONS,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TICKET_POLISHER_TOOL],
      tool_choice: { type: 'tool', name: TICKET_POLISHER_TOOL.name },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === TICKET_POLISHER_TOOL.name
    );
    if (!toolUse) {
      throw new InternalServerErrorException(
        `Polisher did not call ${TICKET_POLISHER_TOOL.name} (stop_reason=${response.stop_reason})`
      );
    }

    const parsed = PolishedTicketSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new InternalServerErrorException(
        `Polisher returned an invalid payload: ${parsed.error.message}`
      );
    }

    await this.db
      .update(bugReports)
      .set({ aiProposedTicket: parsed.data, updatedAt: new Date() })
      .where(eq(bugReports.id, reportId));

    this.realtime?.emitAiProposalReady({
      reportId,
      kind: 'polished_ticket',
    });

    return parsed.data;
  }

  private async loadReport(reportId: string): Promise<BugReport> {
    const rows = await this.db
      .select()
      .from(bugReports)
      .where(eq(bugReports.id, reportId))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Report ${reportId} not found`);
    }
    return rows[0];
  }

  private async loadTranscriptForReport(
    reportId: string
  ): Promise<ChatMessage[]> {
    const sessionRows = await this.db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.bugReportId, reportId))
      .limit(1);
    if (sessionRows.length === 0) return [];
    return this.sessions.listMessages(sessionRows[0].id);
  }

  private buildUserPrompt(
    report: BugReport,
    transcript: ChatMessage[]
  ): string {
    const transcriptBlock = transcript.length
      ? transcript
          .map((m) => {
            const text = this.extractText(m.content);
            return `### ${m.role}\n${text || '(no text content)'}`;
          })
          .join('\n\n')
      : '_(no chat transcript — polish from the report fields and captured context only)_';

    return [
      `## Original report`,
      `- Title: ${report.title}`,
      `- Severity: ${report.severity}`,
      `- Sparte: ${report.sparte ?? '(not set)'}`,
      ``,
      `Description:`,
      report.description,
      ``,
      `## Captured page context`,
      `\`\`\`json`,
      JSON.stringify(report.capturedContext ?? null, null, 2),
      `\`\`\``,
      ``,
      `## Chat transcript`,
      transcriptBlock,
      ``,
      `Now call \`submit_polished_ticket\` with the polished payload.`,
    ].join('\n');
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((block) => {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: string }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          return (block as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
}
