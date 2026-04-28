import type Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  bugReports,
  codeChunks,
  type BugReport,
} from '../db/schema';
import { CodeIndexService } from '../index/code-index.service';
import { AnthropicService } from './anthropic.service';

const MODEL = 'claude-opus-4-7';
const MAX_TOOL_LOOPS = 6;

export interface LocalizationCandidate {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface LocalizationResult {
  candidates: LocalizationCandidate[];
  summary: string;
  generatedAt: string;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'semantic_search',
    description:
      'Vector search the codebase for chunks semantically related to a query. Returns up to 8 candidates.',
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
      'Substring search across indexed code chunks (case-insensitive). Returns up to 20 chunks containing the literal string.',
    input_schema: {
      type: 'object',
      required: ['needle'],
      properties: {
        needle: { type: 'string', minLength: 2 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'find_symbol',
    description:
      'Find indexed chunks whose symbol field matches the given identifier (substring match).',
    input_schema: {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: { type: 'string', minLength: 2 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_chunk',
    description:
      'Read a specific indexed chunk by id (returns the full content, path, lines).',
    input_schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_localization',
    description:
      'Emit the final ranked list of candidate locations (max 8). Each has a confidence label and a one-line rationale. Call exactly once at the end.',
    input_schema: {
      type: 'object',
      required: ['candidates', 'summary'],
      properties: {
        summary: { type: 'string', minLength: 5, maxLength: 1000 },
        candidates: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            required: ['path', 'startLine', 'endLine', 'confidence', 'rationale'],
            properties: {
              path: { type: 'string' },
              symbol: { type: 'string' },
              startLine: { type: 'integer', minimum: 1 },
              endLine: { type: 'integer', minimum: 1 },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              rationale: { type: 'string', minLength: 1, maxLength: 400 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You are a code localizer. Given a bug report (title, description, captured context), find the most likely file/function locations in the comparer-ui codebase using the tools available:

- semantic_search: vector similarity search
- grep_chunks: literal substring search
- find_symbol: search by identifier
- read_chunk: read a specific chunk in detail

Strategy: start broad (semantic_search), narrow with grep/find_symbol, read promising chunks, then call submit_localization once with up to 8 candidates ranked by likelihood. Use confidence labels honestly: "high" only when the chunk contains the exact symbol/string the bug names; "medium" when the area is correct; "low" for plausible-but-uncertain.

If you cannot find any plausible candidate, call submit_localization with an empty candidates array and a summary explaining what's missing (e.g. "code index appears not to cover the affected sparte").`;

@Injectable()
export class CodeLocalizerService {
  private readonly logger = new Logger('CodeLocalizer');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    private readonly indexer: CodeIndexService
  ) {}

  async localize(reportId: string): Promise<LocalizationResult> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }
    const report = await this.loadReport(reportId);

    const apiMessages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: this.buildPrompt(report) },
    ];

    let final: LocalizationResult | null = null;
    let summaryText = '';

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
        if (block.type === 'text') summaryText += block.text;
      }

      if (response.stop_reason !== 'tool_use') break;
      apiMessages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'submit_localization') {
          final = this.parseSubmit(block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'localization recorded',
          });
        } else {
          const result = await this.runTool(block, report);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      apiMessages.push({ role: 'user', content: toolResults });

      if (final) break;
    }

    const result: LocalizationResult = final ?? {
      candidates: [],
      summary: summaryText.trim() || 'No localization produced.',
      generatedAt: new Date().toISOString(),
    };

    const existing =
      (report.aiProposedTicket as Record<string, unknown> | null) ?? {};
    await this.db
      .update(bugReports)
      .set({
        aiProposedTicket: { ...existing, localization: result },
        updatedAt: new Date(),
      })
      .where(eq(bugReports.id, reportId));

    return result;
  }

  private async runTool(
    block: Anthropic.ToolUseBlock,
    report: BugReport
  ): Promise<string> {
    const args = (block.input ?? {}) as Record<string, unknown>;
    try {
      if (block.name === 'semantic_search') {
        const query = String(args['query'] ?? '');
        const sparte = (args['sparte'] as string | undefined) ?? null;
        const hits = await this.indexer.search({
          query,
          sparte: (sparte ?? report.sparte) as never,
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
          }))
        );
      }
      if (block.name === 'grep_chunks') {
        const needle = String(args['needle'] ?? '');
        const rows = await this.db
          .select({
            id: codeChunks.id,
            path: codeChunks.path,
            symbol: codeChunks.symbol,
            startLine: codeChunks.startLine,
            endLine: codeChunks.endLine,
          })
          .from(codeChunks)
          .where(ilike(codeChunks.content, `%${needle}%`))
          .limit(20);
        return JSON.stringify(rows);
      }
      if (block.name === 'find_symbol') {
        const sym = String(args['symbol'] ?? '');
        const rows = await this.db
          .select({
            id: codeChunks.id,
            path: codeChunks.path,
            symbol: codeChunks.symbol,
            startLine: codeChunks.startLine,
            endLine: codeChunks.endLine,
          })
          .from(codeChunks)
          .where(
            and(
              eq(codeChunks.symbol, sym),
              eq(codeChunks.kind, codeChunks.kind)
            )
          )
          .orderBy(asc(codeChunks.path))
          .limit(20);
        if (rows.length > 0) return JSON.stringify(rows);
        // Fallback: substring on path
        const pathRows = await this.db
          .select({
            id: codeChunks.id,
            path: codeChunks.path,
            symbol: codeChunks.symbol,
            startLine: codeChunks.startLine,
            endLine: codeChunks.endLine,
          })
          .from(codeChunks)
          .where(ilike(codeChunks.path, `%${sym}%`))
          .limit(20);
        return JSON.stringify(pathRows);
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
    } catch (err) {
      this.logger.warn(
        `Tool ${block.name} failed: ${(err as Error).message}`
      );
      return `Tool error: ${(err as Error).message}`;
    }
  }

  private parseSubmit(input: unknown): LocalizationResult {
    const obj = (input ?? {}) as {
      candidates?: Array<{
        path?: string;
        symbol?: string;
        startLine?: number;
        endLine?: number;
        confidence?: string;
        rationale?: string;
      }>;
      summary?: string;
    };
    const candidates: LocalizationCandidate[] = (obj.candidates ?? [])
      .filter(
        (c) =>
          typeof c.path === 'string' &&
          typeof c.startLine === 'number' &&
          typeof c.endLine === 'number' &&
          (c.confidence === 'high' ||
            c.confidence === 'medium' ||
            c.confidence === 'low') &&
          typeof c.rationale === 'string'
      )
      .map((c) => ({
        path: c.path!,
        symbol: c.symbol ?? null,
        startLine: c.startLine!,
        endLine: c.endLine!,
        confidence: c.confidence as 'high' | 'medium' | 'low',
        rationale: c.rationale!,
      }))
      .slice(0, 8);
    return {
      candidates,
      summary: obj.summary ?? '',
      generatedAt: new Date().toISOString(),
    };
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

  private buildPrompt(report: BugReport): string {
    return [
      `## Bug report`,
      `Title: ${report.title}`,
      `Severity: ${report.severity}`,
      `Sparte: ${report.sparte ?? '(not set)'}`,
      ``,
      `Description:`,
      report.description,
      ``,
      `Captured page context:`,
      `\`\`\`json`,
      JSON.stringify(report.capturedContext ?? null, null, 2),
      `\`\`\``,
      ``,
      `Use the tools to find candidate code locations. End with submit_localization.`,
    ].join('\n');
  }
}

