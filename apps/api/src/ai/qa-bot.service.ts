import type Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { eq, ilike } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { codeChunks, type ChatMessage } from '../db/schema';
import { CodeIndexService } from '../index/code-index.service';
import { AnthropicService } from './anthropic.service';
import { ChatSessionService } from './chat-session.service';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_LOOPS = 6;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'semantic_search',
    description:
      'Vector search the codebase for chunks related to the question. Returns up to 8.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 3 },
        sparte: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'grep_chunks',
    description:
      'Substring search across indexed chunks (case-insensitive). Returns up to 20.',
    input_schema: {
      type: 'object',
      required: ['needle'],
      properties: { needle: { type: 'string', minLength: 2 } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_chunk',
    description: 'Read a specific indexed chunk by id.',
    input_schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You are a senior engineer answering questions about the comparer-ui codebase.

Given a user question, use the tools available (semantic_search, grep_chunks, read_chunk) to gather relevant code excerpts BEFORE answering. Always cite the file path and line range when you reference code. If the index does not contain enough material to answer with confidence, say so explicitly — do not invent.

Style:
- One or two short paragraphs; bullet lists for multiple steps.
- Mirror the user's language (German default if unclear).
- Use code fences for snippets, with the language tag.
- Do not paste >40 lines from any single chunk; summarize and cite.`;

export interface QaAskInput {
  sessionId?: string;
  question: string;
  reporterEmail?: string;
}

export interface QaAskResult {
  sessionId: string;
  assistantText: string;
}

@Injectable()
export class QaBotService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    private readonly sessions: ChatSessionService,
    private readonly indexer: CodeIndexService
  ) {}

  async ask(input: QaAskInput): Promise<QaAskResult> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }

    let sessionId = input.sessionId;
    if (!sessionId) {
      const session = await this.sessions.create({
        reporterEmail: input.reporterEmail ?? null,
        capturedContext: null,
      });
      // Patch session.kind = 'qa' would require a setKind method;
      // for the MVP we leave the default 'bug' since chat_sessions.kind
      // is mainly used for filtering. ChatSessionService can grow a
      // setKind helper if needed.
      sessionId = session.id;
    }

    await this.sessions.appendMessage({
      sessionId,
      role: 'user',
      content: input.question,
    });

    const history = await this.sessions.listMessages(sessionId);
    const apiMessages = this.toApiMessages(history);

    let assistantText = '';
    const assistantContentForStorage: Anthropic.ContentBlock[] = [];
    let finishedWithAnswer = false;

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const response = await this.anthropic.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text: SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: TOOLS,
        messages: apiMessages,
      });

      for (const block of response.content) {
        assistantContentForStorage.push(block);
        if (block.type === 'text') assistantText += block.text;
      }

      if (response.stop_reason !== 'tool_use') {
        finishedWithAnswer = true;
        break;
      }
      apiMessages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await this.runTool(block);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    // If the model exhausted the tool loop without producing a final answer,
    // run one more turn WITHOUT tools so it must respond in plain text.
    if (!finishedWithAnswer) {
      const final = await this.anthropic.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text:
              SYSTEM +
              '\n\nThe research phase is over — answer the user now in plain text using only what you have already gathered. No more tool calls.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: apiMessages,
      });
      for (const block of final.content) {
        assistantContentForStorage.push(block);
        if (block.type === 'text') assistantText += block.text;
      }
    }

    await this.sessions.appendMessage({
      sessionId,
      role: 'assistant',
      content: assistantContentForStorage,
    });

    return { sessionId, assistantText: assistantText.trim() || '…' };
  }

  private async runTool(block: Anthropic.ToolUseBlock): Promise<string> {
    const args = (block.input ?? {}) as Record<string, unknown>;
    if (block.name === 'semantic_search') {
      const query = String(args['query'] ?? '');
      const sparte = (args['sparte'] as string | undefined) ?? null;
      const hits = await this.indexer.search({
        query,
        sparte: sparte as never,
        limit: 8,
      });
      return JSON.stringify(
        hits.map((h) => ({
          id: h.id,
          path: h.path,
          symbol: h.symbol,
          startLine: h.startLine,
          endLine: h.endLine,
          distance: h.distance,
          content: h.content.slice(0, 1500),
        }))
      );
    }
    if (block.name === 'grep_chunks') {
      const needle = String(args['needle'] ?? '');
      const rows = await this.db
        .select({
          id: codeChunks.id,
          path: codeChunks.path,
          startLine: codeChunks.startLine,
          endLine: codeChunks.endLine,
        })
        .from(codeChunks)
        .where(ilike(codeChunks.content, `%${needle}%`))
        .limit(20);
      return JSON.stringify(rows);
    }
    if (block.name === 'read_chunk') {
      const id = String(args['id'] ?? '');
      const rows = await this.db
        .select()
        .from(codeChunks)
        .where(eq(codeChunks.id, id))
        .limit(1);
      if (rows.length === 0) return `Chunk ${id} not found`;
      return JSON.stringify({
        path: rows[0].path,
        startLine: rows[0].startLine,
        endLine: rows[0].endLine,
        content: rows[0].content,
      });
    }
    return `Unknown tool: ${block.name}`;
  }

  private toApiMessages(
    history: ChatMessage[]
  ): Anthropic.Messages.MessageParam[] {
    return history
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content as Anthropic.Messages.ContentBlockParam[],
      }));
  }
}
