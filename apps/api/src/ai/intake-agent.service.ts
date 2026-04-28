import type Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import {
  INTAKE_SYSTEM_INSTRUCTIONS,
  INTAKE_TOOLS,
  IntakeStateSchema,
  isIntakeReady,
  type IntakeState,
} from './intake-schema';
import { ChatSessionService } from './chat-session.service';
import { FewShotRegistryService } from './few-shot-registry.service';
import { PromptRegistryService } from './prompt-registry.service';
import type { ChatMessage } from '../db/schema';
import type { IntakeStreamEvent } from './intake.types';

const MODEL = 'claude-opus-4-7';
const MAX_TOOL_LOOPS = 4;

export interface AgentTurnInput {
  sessionId: string;
  /** When undefined, we generate the initial assistant greeting (no user input yet). */
  userText?: string;
}

export interface AgentTurnResult {
  assistantText: string;
  intakeState: IntakeState;
  isComplete: boolean;
  stopReason: string | null;
}

@Injectable()
export class IntakeAgentService {
  private readonly logger = new Logger('IntakeAgentService');

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly sessions: ChatSessionService,
    @Optional() private readonly promptRegistry?: PromptRegistryService,
    @Optional() private readonly fewShotRegistry?: FewShotRegistryService
  ) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (!this.anthropic.isConfigured) {
      return {
        assistantText:
          'AI is not configured on this server. Set ANTHROPIC_API_KEY in the API .env to enable the chat assistant. You can still file reports via the form.',
        intakeState: { isComplete: false },
        isComplete: false,
        stopReason: 'unconfigured',
      };
    }

    const session = await this.sessions.getById(input.sessionId);
    let intakeState = (session.intakeState as IntakeState | null) ?? {
      isComplete: false,
    };

    if (input.userText !== undefined) {
      await this.sessions.appendMessage({
        sessionId: input.sessionId,
        role: 'user',
        content: input.userText,
      });
    }

    const history = await this.sessions.listMessages(input.sessionId);
    const fewShots = await this.buildFewShotMessages();
    const apiMessages = [...fewShots, ...this.toApiMessages(history)];

    const systemBlocks = await this.buildSystemBlocks(
      session.capturedContext,
      intakeState
    );

    let stopReason: string | null = null;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let assistantText = '';
    const assistantContentForStorage: Anthropic.ContentBlock[] = [];

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const response = await this.anthropic.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemBlocks,
        tools: INTAKE_TOOLS,
        messages: apiMessages,
      });

      stopReason = response.stop_reason ?? null;
      lastInputTokens += response.usage?.input_tokens ?? 0;
      lastOutputTokens += response.usage?.output_tokens ?? 0;

      for (const block of response.content) {
        assistantContentForStorage.push(block);
        if (block.type === 'text') {
          assistantText += block.text;
        }
      }

      if (response.stop_reason !== 'tool_use') break;

      // Process tool calls and feed results back so the loop can continue.
      apiMessages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const toolResult = this.handleTool(block, intakeState);
        intakeState = toolResult.nextState;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolResult.message,
          is_error: toolResult.isError,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    await this.sessions.appendMessage({
      sessionId: input.sessionId,
      role: 'assistant',
      content: assistantContentForStorage,
      stopReason,
      inputTokens: lastInputTokens,
      outputTokens: lastOutputTokens,
    });

    await this.sessions.setIntakeState(input.sessionId, intakeState);

    return {
      assistantText: assistantText.trim() || '…',
      intakeState,
      isComplete: Boolean(intakeState.isComplete),
      stopReason,
    };
  }

  async *runTurnStream(
    input: AgentTurnInput
  ): AsyncGenerator<IntakeStreamEvent, void> {
    if (!this.anthropic.isConfigured) {
      yield {
        type: 'text_delta',
        text:
          'AI is not configured on this server. Set ANTHROPIC_API_KEY in the API .env to enable the chat assistant. You can still file reports via the form.',
      };
      yield {
        type: 'state',
        intakeState: { isComplete: false },
        isComplete: false,
      };
      yield { type: 'done', stopReason: 'unconfigured' };
      return;
    }

    const session = await this.sessions.getById(input.sessionId);
    let intakeState = (session.intakeState as IntakeState | null) ?? {
      isComplete: false,
    };

    if (input.userText !== undefined) {
      await this.sessions.appendMessage({
        sessionId: input.sessionId,
        role: 'user',
        content: input.userText,
      });
    }

    const history = await this.sessions.listMessages(input.sessionId);
    const fewShots = await this.buildFewShotMessages();
    const apiMessages = [...fewShots, ...this.toApiMessages(history)];

    const systemBlocks = await this.buildSystemBlocks(
      session.capturedContext,
      intakeState
    );

    let stopReason: string | null = null;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    const assistantContentForStorage: Anthropic.ContentBlock[] = [];

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const stream = this.anthropic.client.messages.stream({
        model: MODEL,
        max_tokens: 1024,
        system: systemBlocks,
        tools: INTAKE_TOOLS,
        messages: apiMessages,
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      stopReason = finalMessage.stop_reason ?? null;
      lastInputTokens += finalMessage.usage?.input_tokens ?? 0;
      lastOutputTokens += finalMessage.usage?.output_tokens ?? 0;

      for (const block of finalMessage.content) {
        assistantContentForStorage.push(block);
      }

      if (finalMessage.stop_reason !== 'tool_use') break;

      apiMessages.push({ role: 'assistant', content: finalMessage.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of finalMessage.content) {
        if (block.type !== 'tool_use') continue;
        const toolResult = this.handleTool(block, intakeState);
        intakeState = toolResult.nextState;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: toolResult.message,
          is_error: toolResult.isError,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    await this.sessions.appendMessage({
      sessionId: input.sessionId,
      role: 'assistant',
      content: assistantContentForStorage,
      stopReason,
      inputTokens: lastInputTokens,
      outputTokens: lastOutputTokens,
    });

    await this.sessions.setIntakeState(input.sessionId, intakeState);

    yield {
      type: 'state',
      intakeState,
      isComplete: Boolean(intakeState.isComplete),
    };
    yield { type: 'done', stopReason };
  }

  private async buildSystemBlocks(
    capturedContext: unknown,
    intakeState: IntakeState
  ): Promise<Anthropic.Messages.TextBlockParam[]> {
    const promptText = this.promptRegistry
      ? await this.promptRegistry.getActiveContent('intake')
      : INTAKE_SYSTEM_INSTRUCTIONS;
    return [
      {
        type: 'text',
        text: promptText,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text:
          `## Captured page context\n\`\`\`json\n${JSON.stringify(capturedContext, null, 2)}\n\`\`\`\n\n` +
          `## Current intake state\n\`\`\`json\n${JSON.stringify(intakeState, null, 2)}\n\`\`\``,
      },
    ];
  }

  private async buildFewShotMessages(): Promise<
    Anthropic.Messages.MessageParam[]
  > {
    if (!this.fewShotRegistry) return [];
    const shots = await this.fewShotRegistry.listForAgent('intake');
    if (shots.length === 0) return [];
    const messages: Anthropic.Messages.MessageParam[] = [];
    for (const shot of shots) {
      for (const msg of shot.conversation) {
        messages.push({
          role: msg.role,
          content: [{ type: 'text', text: msg.text }],
        });
      }
    }
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (Array.isArray(last.content) && last.content.length > 0) {
        const lastBlock = last.content[last.content.length - 1] as {
          type?: string;
          cache_control?: { type: 'ephemeral' };
        };
        if (lastBlock.type === 'text') {
          lastBlock.cache_control = { type: 'ephemeral' };
        }
      }
    }
    return messages;
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

  private handleTool(
    block: Anthropic.ToolUseBlock,
    state: IntakeState
  ): {
    nextState: IntakeState;
    message: string;
    isError: boolean;
  } {
    if (block.name === 'update_intake') {
      const partial = this.coerceUpdate(block.input);
      const merged = { ...state, ...partial };
      const parsed = IntakeStateSchema.safeParse(merged);
      if (!parsed.success) {
        this.logger.warn(
          `update_intake validation failed: ${parsed.error.message}`
        );
        return {
          nextState: state,
          message: `Validation error: ${parsed.error.message}`,
          isError: true,
        };
      }
      return {
        nextState: parsed.data,
        message: `Intake state updated: ${JSON.stringify(parsed.data)}`,
        isError: false,
      };
    }

    if (block.name === 'complete_intake') {
      if (!isIntakeReady(state)) {
        return {
          nextState: state,
          message:
            'Cannot complete intake yet — title, description, and severity must all be set first.',
          isError: true,
        };
      }
      return {
        nextState: { ...state, isComplete: true },
        message: 'Intake marked complete. The user can now submit.',
        isError: false,
      };
    }

    return {
      nextState: state,
      message: `Unknown tool: ${block.name}`,
      isError: true,
    };
  }

  private coerceUpdate(input: unknown): Partial<IntakeState> {
    if (!input || typeof input !== 'object') return {};
    const out: Partial<IntakeState> = {};
    const obj = input as Record<string, unknown>;
    if (typeof obj['title'] === 'string') out.title = obj['title'];
    if (typeof obj['description'] === 'string')
      out.description = obj['description'];
    if (typeof obj['severity'] === 'string')
      out.severity = obj['severity'] as IntakeState['severity'];
    if (typeof obj['sparte'] === 'string')
      out.sparte = obj['sparte'] as IntakeState['sparte'];
    return out;
  }
}
