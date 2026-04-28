import type Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, cosineDistance, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module';
import { bugReports, ticketsCache } from '../../db/schema';
import { REPORT_SEVERITIES, SPARTEN } from '../../db/schema';
import { findOrCreateReporter } from '../../users/find-or-create-reporter';
import { AnthropicService } from '../anthropic.service';
import { CodeLocalizerService } from '../code-localizer.service';
import { DedupService } from '../dedup.service';
import { EmbedQueueService } from '../embed.queue';
import { TranscriptDecomposerService } from '../transcript-decomposer/transcript-decomposer.service';
import { TriageQueueService } from '../triage.queue';
import { VoyageService } from '../voyage.service';
import { CopilotSessionService } from './copilot-session.service';
import type { CopilotBugDraft, CopilotState, CopilotStreamEvent } from './copilot.types';

const MODEL = 'claude-opus-4-7';
const MAX_TOOL_LOOPS = 8;

const SYSTEM_PROMPT = `You are the Comparit Copilot — an internal AI assistant for developers, QAs, and POs at Comparit.

You have these capabilities via tools:
1. **Bug reporting** — gather bug details conversationally, then submit
2. **Duplicate detection** — find similar existing reports and Jira tickets
3. **Jira search** — full-text search in the Jira cache
4. **Code analysis** — locate source files for a bug (needs a submitted report ID)
5. **Transcript decomposition** — break meeting transcripts into Epic → Story → Subtask

RULES:
- When a user wants to report a bug: ask one focused question at a time. Call update_bug_draft as you learn each field. When title + description + severity are set, call submit_bug_report.
- After submitting a bug, offer to check for duplicates and find affected code.
- When a user pastes a long text that looks like a meeting transcript, call decompose_transcript immediately.
- Be concise — 1–2 sentences per turn.
- When severity is unclear, ask: "How critical is this? (blocker / high / medium / low)"
- Do not ask for the user's email or identity.
- Reply in the user's language (German if the first message is German).`;

const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_bug_draft',
    description:
      'Record bug report fields as you gather them conversationally. Call whenever you learn title, description, severity, or sparte. Can be called multiple times.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'One-line bug summary (min 5 chars).' },
        description: {
          type: 'string',
          description: 'Steps to reproduce + expected vs actual (min 10 chars).',
        },
        severity: {
          type: 'string',
          enum: [...REPORT_SEVERITIES],
          description: 'blocker=prod down; high=major feature broken; medium=noticeable; low=minor.',
        },
        sparte: {
          type: 'string',
          enum: [...SPARTEN],
          description: 'Insurance product family if known.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_bug_report',
    description:
      'Create the bug report once title, description, and severity are all set. Call only when you have all three required fields.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'check_duplicates',
    description: 'Semantically search for similar existing bug reports and Jira tickets.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_jira',
    description:
      'Search the Jira ticket cache. Combines semantic similarity (when `query` is given) with optional filters (assignee, status, issueType, label, project). Returns up to `limit` results sorted by relevance. All filters are AND-ed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Topic, issue description, or keywords. Used for semantic similarity search and substring matching.',
        },
        status: {
          type: 'string',
          description: 'Exact Jira status (e.g. "To Do", "In Progress", "Done", "Open", "Closed"). Case-sensitive.',
        },
        assignee: {
          type: 'string',
          description: 'Assignee name or email — substring match against both fields.',
        },
        issueType: {
          type: 'string',
          description: 'Jira issue type (e.g. "Bug", "Story", "Task", "Epic", "Sub-task").',
        },
        project: {
          type: 'string',
          description: 'Project key (e.g. "LV"). Restricts to one project.',
        },
        label: {
          type: 'string',
          description: 'Label that must be attached to the ticket.',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (1–25, default 10).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'find_affected_code',
    description:
      'Locate source files most likely related to a bug. Requires a submitted bug report ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reportId: { type: 'string', description: 'UUID of the bug report to localize.' },
      },
      required: ['reportId'],
      additionalProperties: false,
    },
  },
  {
    name: 'decompose_transcript',
    description:
      'Break a meeting or planning transcript into a structured Epic → Story → Subtask hierarchy.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'The full transcript text.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

@Injectable()
export class CopilotAgentService {
  private readonly logger = new Logger('CopilotAgentService');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    private readonly sessions: CopilotSessionService,
    private readonly dedup: DedupService,
    private readonly embedQueue: EmbedQueueService,
    private readonly triageQueue: TriageQueueService,
    private readonly voyage: VoyageService,
    @Optional() private readonly codeLocalizer?: CodeLocalizerService,
    @Optional() private readonly transcriptDecomposer?: TranscriptDecomposerService
  ) {}

  async *runStream(input: {
    sessionId: string;
    userId: string;
    userEmail: string;
    userText: string;
  }): AsyncGenerator<CopilotStreamEvent, void> {
    if (!this.anthropic.isConfigured) {
      yield { type: 'text_delta', text: 'AI is not configured (set ANTHROPIC_API_KEY).' };
      yield { type: 'done', stopReason: 'unconfigured' };
      return;
    }

    const session = await this.sessions.getById(input.sessionId);
    let state: CopilotState = (session.state as CopilotState) ?? {};

    await this.sessions.appendMessage({
      sessionId: input.sessionId,
      role: 'user',
      content: input.userText,
    });

    // Auto-title the session after the first user message
    if (!session.title) {
      const titlePreview = input.userText.slice(0, 60).trim();
      await this.sessions.setTitle(input.sessionId, titlePreview);
    }

    const history = await this.sessions.listMessages(input.sessionId);
    const apiMessages = this.toApiMessages(history);

    type Turn = {
      role: 'assistant' | 'user';
      content: Anthropic.ContentBlock[] | Anthropic.Messages.ToolResultBlockParam[];
    };
    const turnsToPersist: Turn[] = [];
    let stopReason: string | null = null;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    const allToolResults: { toolName: string; data: unknown }[] = [];

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const stream = this.anthropic.client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: COPILOT_TOOLS,
        messages: apiMessages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      stopReason = finalMessage.stop_reason ?? null;
      lastInputTokens += finalMessage.usage?.input_tokens ?? 0;
      lastOutputTokens += finalMessage.usage?.output_tokens ?? 0;
      turnsToPersist.push({ role: 'assistant', content: finalMessage.content });

      if (finalMessage.stop_reason !== 'tool_use') break;

      apiMessages.push({ role: 'assistant', content: finalMessage.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of finalMessage.content) {
        if (block.type !== 'tool_use') continue;

        yield { type: 'tool_start', toolName: block.name };

        const result = await this.executeTool(
          block.name,
          block.input as Record<string, unknown>,
          state,
          input
        );
        state = result.nextState;

        if (result.toolData !== undefined) {
          allToolResults.push({ toolName: block.name, data: result.toolData });
          yield { type: 'tool_result', toolName: block.name, data: result.toolData, isError: result.isError };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result.message === 'string'
            ? result.message
            : JSON.stringify(result.message),
          is_error: result.isError,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
      turnsToPersist.push({ role: 'user', content: toolResults });
    }

    await this.sessions.setState(input.sessionId, state);

    let lastAssistantIdx = -1;
    for (let i = turnsToPersist.length - 1; i >= 0; i--) {
      if (turnsToPersist[i].role === 'assistant') { lastAssistantIdx = i; break; }
    }
    for (let i = 0; i < turnsToPersist.length; i++) {
      const turn = turnsToPersist[i];
      await this.sessions.appendMessage({
        sessionId: input.sessionId,
        role: turn.role,
        content: turn.content,
        stopReason: i === lastAssistantIdx ? stopReason : null,
        inputTokens: i === lastAssistantIdx ? lastInputTokens : undefined,
        outputTokens: i === lastAssistantIdx ? lastOutputTokens : undefined,
      });
    }

    yield { type: 'done', stopReason };
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    state: CopilotState,
    ctx: { sessionId: string; userId: string; userEmail: string }
  ): Promise<{ nextState: CopilotState; message: unknown; toolData?: unknown; isError: boolean }> {
    try {
      switch (name) {
        case 'update_bug_draft': {
          const draft: CopilotBugDraft = { ...(state.bugDraft ?? {}) };
          if (typeof input['title'] === 'string') draft.title = input['title'];
          if (typeof input['description'] === 'string') draft.description = input['description'];
          if (typeof input['severity'] === 'string') draft.severity = input['severity'] as CopilotBugDraft['severity'];
          if (typeof input['sparte'] === 'string') draft.sparte = input['sparte'];
          return {
            nextState: { ...state, bugDraft: draft },
            message: `Draft updated: ${JSON.stringify(draft)}`,
            isError: false,
          };
        }

        case 'submit_bug_report': {
          const draft = state.bugDraft ?? {};
          if (!draft.title || draft.title.length < 5) {
            return { nextState: state, message: 'Cannot submit — title is missing or too short.', isError: true };
          }
          if (!draft.description || draft.description.length < 10) {
            return { nextState: state, message: 'Cannot submit — description is missing or too short.', isError: true };
          }
          if (!draft.severity) {
            return { nextState: state, message: 'Cannot submit — severity is required.', isError: true };
          }
          const reporterId = await findOrCreateReporter(this.db, ctx.userEmail);
          const [row] = await this.db
            .insert(bugReports)
            .values({
              reporterId,
              title: draft.title.trim(),
              description: draft.description.trim(),
              severity: draft.severity,
              sparte: draft.sparte as typeof bugReports.$inferInsert['sparte'] ?? null,
              capturedContext: { copilotSessionId: ctx.sessionId },
            })
            .returning({ id: bugReports.id, status: bugReports.status, createdAt: bugReports.createdAt });
          await this.embedQueue.enqueueReportEmbedding(row.id);
          await this.triageQueue.enqueueReportTriage(row.id);
          const data = { reportId: row.id, title: draft.title, status: row.status };
          return {
            nextState: { ...state, bugDraft: undefined, lastBugReportId: row.id },
            message: `Bug report created: ${row.id}`,
            toolData: data,
            isError: false,
          };
        }

        case 'check_duplicates': {
          if (!this.dedup) {
            return { nextState: state, message: 'Dedup service unavailable.', isError: true };
          }
          const title = String(input['title'] ?? '');
          const description = String(input['description'] ?? '');
          const result = await this.dedup.checkDuplicateAcrossSources({ title, description });
          return {
            nextState: state,
            message: JSON.stringify(result),
            toolData: result,
            isError: false,
          };
        }

        case 'search_jira': {
          const query = String(input['query'] ?? '').trim();
          const status = typeof input['status'] === 'string' ? input['status'].trim() : '';
          const assignee = typeof input['assignee'] === 'string' ? input['assignee'].trim() : '';
          const issueType = typeof input['issueType'] === 'string' ? input['issueType'].trim() : '';
          const project = typeof input['project'] === 'string' ? input['project'].trim().toUpperCase() : '';
          const label = typeof input['label'] === 'string' ? input['label'].trim() : '';
          const rawLimit = typeof input['limit'] === 'number' ? input['limit'] : 10;
          const limit = Math.min(25, Math.max(1, Math.floor(rawLimit)));

          if (!query && !status && !assignee && !issueType && !project && !label) {
            return {
              nextState: state,
              message: 'Provide at least one of: query, status, assignee, issueType, project, label.',
              isError: true,
            };
          }

          const conditions: SQL[] = [];
          if (status) conditions.push(eq(ticketsCache.status, status));
          if (issueType) conditions.push(eq(ticketsCache.issueType, issueType));
          if (project) conditions.push(eq(ticketsCache.projectKey, project));
          if (assignee) {
            const a = `%${assignee}%`;
            const cond = or(
              ilike(ticketsCache.assigneeName, a),
              ilike(ticketsCache.assigneeEmail, a)
            );
            if (cond) conditions.push(cond);
          }
          if (label) {
            // labels is a jsonb array; ? operator checks "contains key/element"
            conditions.push(sql`${ticketsCache.labels} ?? ${label}`);
          }

          const baseSelect = {
            jiraIssueKey: ticketsCache.jiraIssueKey,
            projectKey: ticketsCache.projectKey,
            summary: ticketsCache.summary,
            status: ticketsCache.status,
            priority: ticketsCache.priority,
            issueType: ticketsCache.issueType,
            assigneeName: ticketsCache.assigneeName,
            assigneeEmail: ticketsCache.assigneeEmail,
            labels: ticketsCache.labels,
            jiraUpdated: ticketsCache.jiraUpdated,
          };

          // Semantic search path: requires Voyage + a textual query + at least
          // one ticket with an embedding. Falls back to ILIKE if Voyage isn't
          // configured or there's no query.
          if (query && this.voyage.isConfigured) {
            try {
              const queryVec = await this.voyage.embedText(query, 'query');
              const distance = cosineDistance(ticketsCache.embedding, queryVec);
              const where = and(isNotNull(ticketsCache.embedding), ...conditions);
              const rows = await this.db
                .select({ ...baseSelect, distance: sql<number>`${distance}`.as('distance') })
                .from(ticketsCache)
                .where(where)
                .orderBy(distance)
                .limit(limit);
              return {
                nextState: state,
                message: JSON.stringify(rows),
                toolData: { tickets: rows, mode: 'semantic' },
                isError: false,
              };
            } catch (e) {
              this.logger.warn(`Voyage embed failed, falling back to ILIKE: ${(e as Error).message}`);
            }
          }

          // Keyword / filter-only path
          if (query) {
            const q = `%${query}%`;
            const cond = or(
              ilike(ticketsCache.summary, q),
              ilike(ticketsCache.description, q)
            );
            if (cond) conditions.push(cond);
          }
          const where = conditions.length > 0 ? and(...conditions) : undefined;
          const rows = await this.db
            .select(baseSelect)
            .from(ticketsCache)
            .where(where)
            .limit(limit);
          return {
            nextState: state,
            message: JSON.stringify(rows),
            toolData: { tickets: rows, mode: query ? 'keyword' : 'filter' },
            isError: false,
          };
        }

        case 'find_affected_code': {
          const reportId = String(input['reportId'] ?? '');
          if (!reportId) return { nextState: state, message: 'reportId is required', isError: true };
          if (!this.codeLocalizer) {
            return { nextState: state, message: 'Code localizer not available.', isError: true };
          }
          const result = await this.codeLocalizer.localize(reportId);
          return {
            nextState: state,
            message: JSON.stringify(result),
            toolData: result,
            isError: false,
          };
        }

        case 'decompose_transcript': {
          const text = String(input['text'] ?? '').trim();
          if (!text) return { nextState: state, message: 'text is required', isError: true };
          if (!this.transcriptDecomposer) {
            return { nextState: state, message: 'Transcript decomposer not available.', isError: true };
          }
          const result = await this.transcriptDecomposer.start({ rawTranscript: text });
          const data = { sessionId: result.session.id, epics: result.epics, assistantText: result.assistantText };
          return {
            nextState: { ...state, lastTranscriptId: result.session.id },
            message: `Transcript decomposed into session ${result.session.id}`,
            toolData: data,
            isError: false,
          };
        }

        default:
          return { nextState: state, message: `Unknown tool: ${name}`, isError: true };
      }
    } catch (err) {
      this.logger.error(`Tool ${name} failed: ${(err as Error).message}`, (err as Error).stack);
      return { nextState: state, message: `Tool failed: ${(err as Error).message}`, isError: true };
    }
  }

  private toApiMessages(history: Array<{ role: string; content: unknown }>): Anthropic.Messages.MessageParam[] {
    const result: Anthropic.Messages.MessageParam[] = [];
    for (const m of history) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const blocks = m.content as Anthropic.Messages.ContentBlockParam[];
      if (!Array.isArray(blocks)) continue;

      // Include all blocks — tool_use + tool_result pairs must travel together for Claude
      const filtered = blocks.filter((b) => {
        if (!b || typeof b !== 'object') return false;
        return true;
      });
      if (filtered.length === 0) continue;
      result.push({ role: m.role as 'user' | 'assistant', content: filtered });
    }
    return result;
  }
}
