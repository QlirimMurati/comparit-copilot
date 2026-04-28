import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { desc, eq } from 'drizzle-orm';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DRIZZLE, type Database } from '../db/db.module';
import {
  PROMPT_AGENTS,
  chatMessages,
  chatSessions,
  type ChatMessage,
  type PromptAgent,
} from '../db/schema';
import { AnthropicService } from './anthropic.service';
import { INTAKE_TOOLS } from './intake-schema';
import { PromptRegistryService } from './prompt-registry.service';

interface CreatePromptInput {
  agent: PromptAgent;
  content: string;
  isActive?: boolean;
  note?: string;
}

interface UpdatePromptInput {
  content?: string;
  isActive?: boolean;
  note?: string;
}

interface ReplayInput {
  agent: PromptAgent;
  candidateContent: string;
  /** Number of recent sessions to replay against (max 20). */
  limit?: number;
}

const REPLAY_DEFAULT = 5;
const REPLAY_MAX = 20;
const REPLAY_MODEL = 'claude-opus-4-7';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'qa_lead')
@Controller('admin/prompts')
export class AdminPromptsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly registry: PromptRegistryService,
    private readonly anthropic: AnthropicService
  ) {}

  @Get()
  async list(@Query('agent') agent?: string) {
    if (agent && !PROMPT_AGENTS.includes(agent as PromptAgent)) {
      throw new BadRequestException(`invalid agent '${agent}'`);
    }
    const rows = await this.registry.list(
      agent ? (agent as PromptAgent) : undefined
    );
    return { rows };
  }

  @Get('active')
  async getActive(@Query('agent') agent: string) {
    if (!PROMPT_AGENTS.includes(agent as PromptAgent)) {
      throw new BadRequestException(`invalid agent '${agent}'`);
    }
    const a = agent as PromptAgent;
    return {
      agent: a,
      active: await this.registry.getActiveContent(a),
      default: await this.registry.getDefaultContent(a),
    };
  }

  @Post()
  async create(@Body() body: CreatePromptInput) {
    if (!PROMPT_AGENTS.includes(body.agent)) {
      throw new BadRequestException(`invalid agent '${body.agent}'`);
    }
    if (!body.content || body.content.trim().length < 10) {
      throw new BadRequestException('content must be at least 10 chars');
    }
    return this.registry.create(body);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: UpdatePromptInput) {
    if (
      body.content !== undefined &&
      (!body.content || body.content.trim().length < 10)
    ) {
      throw new BadRequestException('content must be at least 10 chars');
    }
    const row = await this.registry.update(id, body);
    if (!row) throw new NotFoundException(`prompt override ${id} not found`);
    return row;
  }

  @Post('replay')
  async replay(@Body() body: ReplayInput) {
    if (!PROMPT_AGENTS.includes(body.agent)) {
      throw new BadRequestException(`invalid agent '${body.agent}'`);
    }
    if (!body.candidateContent || body.candidateContent.trim().length < 10) {
      throw new BadRequestException(
        'candidateContent must be at least 10 chars'
      );
    }
    if (!this.anthropic.isConfigured) {
      throw new BadRequestException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }
    if (body.agent !== 'intake') {
      throw new BadRequestException(
        'replay currently only supports the intake agent'
      );
    }

    const limit = Math.min(REPLAY_MAX, Math.max(1, body.limit ?? REPLAY_DEFAULT));

    const sessions = await this.db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.kind, 'bug'))
      .orderBy(desc(chatSessions.createdAt))
      .limit(limit);

    const results: Array<{
      sessionId: string;
      originalAssistantText: string;
      candidateAssistantText: string;
    }> = [];

    for (const s of sessions) {
      const messages = await this.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, s.id))
        .orderBy(desc(chatMessages.createdAt));
      const ordered = [...messages].reverse();
      if (ordered.length < 2) continue;

      const lastAssistantIdx = ordered
        .map((m, i) => ({ m, i }))
        .reverse()
        .find((x) => x.m.role === 'assistant');
      if (!lastAssistantIdx) continue;

      const original = this.extractText(lastAssistantIdx.m.content);
      const apiMessages = this.toApiMessages(
        ordered.slice(0, lastAssistantIdx.i)
      );

      try {
        const response = await this.anthropic.client.messages.create({
          model: REPLAY_MODEL,
          max_tokens: 1024,
          system: [{ type: 'text', text: body.candidateContent }],
          tools: INTAKE_TOOLS,
          messages: apiMessages,
        });
        const candidate = response.content
          .filter(
            (b): b is Anthropic.TextBlock => b.type === 'text'
          )
          .map((b) => b.text)
          .join('');
        results.push({
          sessionId: s.id,
          originalAssistantText: original,
          candidateAssistantText: candidate,
        });
      } catch (err) {
        results.push({
          sessionId: s.id,
          originalAssistantText: original,
          candidateAssistantText: `<replay error: ${(err as Error).message}>`,
        });
      }
    }

    return { compared: results.length, results };
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
      .join('');
  }
}
