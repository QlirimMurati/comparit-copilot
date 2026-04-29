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
import { KnowledgeService } from './knowledge.service';
import { PromptRegistryService } from './prompt-registry.service';
import type { ChatMessage } from '../db/schema';
import type { IntakeStreamEvent } from './intake.types';

const MODEL = 'claude-opus-4-7';
const MAX_TOOL_LOOPS = 4;

export interface ActiveCalc {
  sparte: string | null;
  values: Record<string, unknown>;
  errors: { controlPath: string; errors: Record<string, unknown> }[];
  capturedAt: string;
}

export function buildActiveCalcBlock(active: ActiveCalc): string {
  const errorLines = active.errors.length
    ? active.errors
        .map((e) => `  - ${e.controlPath}: ${Object.keys(e.errors).join(', ')}`)
        .join('\n')
    : '  (none)';

  return [
    `## ACTIVE-CALCULATION CONTEXT`,
    `The user is currently looking at this calculation. These are AUTHORITATIVE values — quote them back when answering. Do NOT say "ich habe darauf keinen Zugriff".`,
    ``,
    `Sparte: ${active.sparte ?? 'unknown'}`,
    ``,
    `Form values (JSON):`,
    '```json',
    JSON.stringify(active.values, null, 2),
    '```',
    ``,
    `Validation errors visible to the user:`,
    errorLines,
  ].join('\n');
}

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
    @Optional() private readonly fewShotRegistry?: FewShotRegistryService,
    @Optional() private readonly knowledge?: KnowledgeService
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

    // Claude requires the conversation to end with a user message. On
    // /chat/start (no userText) and when the last persisted turn is an
    // assistant turn (e.g. only few-shots loaded), synthesize a kickoff.
    const last = apiMessages[apiMessages.length - 1];
    if (!last || last.role !== 'user') {
      apiMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: '[system] Continue the intake — greet the user (if first turn) or ask the next focused question.',
          },
        ],
      });
    }

    const systemBlocks = await this.buildSystemBlocks(
      session.capturedContext,
      intakeState
    );

    let stopReason: string | null = null;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let assistantText = '';
    type Turn = {
      role: 'assistant' | 'user';
      content:
        | Anthropic.ContentBlock[]
        | Anthropic.Messages.ToolResultBlockParam[];
    };
    const turnsToPersist: Turn[] = [];

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
        if (block.type === 'text') {
          assistantText += block.text;
        }
      }
      turnsToPersist.push({ role: 'assistant', content: response.content });

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
      turnsToPersist.push({ role: 'user', content: toolResults });
    }

    // Persist each iteration's assistant + tool-result-as-user messages in
    // order so the next turn replays a valid tool_use → tool_result sequence.
    let lastAssistantIdx = -1;
    for (let i = turnsToPersist.length - 1; i >= 0; i--) {
      if (turnsToPersist[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
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

    // Claude requires the conversation to end with a user message. On
    // /chat/start (no userText) and when the last persisted turn is an
    // assistant turn (e.g. only few-shots loaded), synthesize a kickoff.
    const last = apiMessages[apiMessages.length - 1];
    if (!last || last.role !== 'user') {
      apiMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: '[system] Continue the intake — greet the user (if first turn) or ask the next focused question.',
          },
        ],
      });
    }

    const systemBlocks = await this.buildSystemBlocks(
      session.capturedContext,
      intakeState
    );

    let stopReason: string | null = null;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    type Turn = {
      role: 'assistant' | 'user';
      content:
        | Anthropic.ContentBlock[]
        | Anthropic.Messages.ToolResultBlockParam[];
    };
    const turnsToPersist: Turn[] = [];

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

      turnsToPersist.push({ role: 'assistant', content: finalMessage.content });

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
      turnsToPersist.push({ role: 'user', content: toolResults });
    }

    let lastAssistantIdx = -1;
    for (let i = turnsToPersist.length - 1; i >= 0; i--) {
      if (turnsToPersist[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
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

    const blocks: Anthropic.Messages.TextBlockParam[] = [
      {
        type: 'text',
        text: promptText,
        cache_control: { type: 'ephemeral' },
      },
    ];

    const knowledgeText = this.knowledge?.get();
    if (knowledgeText) {
      blocks.push({
        type: 'text',
        text: `## Reference knowledge\n\n${knowledgeText}`,
        cache_control: { type: 'ephemeral' },
      });
    }

    blocks.push({
      type: 'text',
      text:
        `## Captured page context\n\`\`\`json\n${JSON.stringify(capturedContext, null, 2)}\n\`\`\`\n\n` +
        `## Current intake state\n\`\`\`json\n${JSON.stringify(intakeState, null, 2)}\n\`\`\``,
    });

    const active = (
      capturedContext as { activeCalculation?: ActiveCalc | null } | null
    )?.activeCalculation;
    if (
      active &&
      (active.sparte ||
        Object.keys(active.values ?? {}).length > 0 ||
        (active.errors ?? []).length > 0)
    ) {
      blocks.push({
        type: 'text',
        text: buildActiveCalcBlock(active),
      });
    }

    // Surface recent console + network errors as a dedicated block so the
    // model doesn't have to dig through the JSON dump above. The widget
    // refreshes these on every chat message.
    const ctx = capturedContext as
      | {
          consoleErrors?: Array<{
            level?: string;
            message?: string;
            stack?: string;
            timestamp?: string;
          }>;
          networkErrors?: Array<{
            url?: string;
            method?: string;
            status?: number;
            statusText?: string;
            timestamp?: string;
          }>;
        }
      | null
      | undefined;
    const consoleErrors = (ctx?.consoleErrors ?? []).slice(-15);
    const networkErrors = (ctx?.networkErrors ?? []).slice(-15);
    if (consoleErrors.length > 0 || networkErrors.length > 0) {
      const lines: string[] = [
        '## RECENT BROWSER ERRORS — authoritative',
        '',
        'These came from the user\'s open page just now. Treat them as facts',
        'about what is broken — do not ask the user to repeat them.',
        '',
      ];
      if (consoleErrors.length > 0) {
        lines.push('### Console errors');
        for (const e of consoleErrors) {
          const ts = e.timestamp ? ` @ ${e.timestamp}` : '';
          const lvl = e.level ?? 'error';
          lines.push(`- [${lvl}]${ts}  ${e.message ?? '(no message)'}`);
          if (e.stack) {
            const firstFrame = e.stack.split('\n').slice(0, 2).join(' | ');
            lines.push(`    at: ${firstFrame}`);
          }
        }
        lines.push('');
      }
      if (networkErrors.length > 0) {
        lines.push('### Network errors');
        for (const n of networkErrors) {
          const ts = n.timestamp ? ` @ ${n.timestamp}` : '';
          lines.push(
            `- ${n.method ?? 'GET'} ${n.url ?? '?'} → ${n.status ?? '?'} ${n.statusText ?? ''}${ts}`,
          );
        }
        lines.push('');
      }
      blocks.push({ type: 'text', text: lines.join('\n') });
    }

    const isFromCompare =
      (capturedContext as { isFromCompare?: boolean } | null)?.isFromCompare ===
      true;
    if (isFromCompare) {
      blocks.push({
        type: 'text',
        text: [
          `## ORIGIN: comparer-ui (broker product)`,
          `This conversation is with a busy insurance broker, not a developer or QA.`,
          `- Do NOT ask Berechnung-specific questions (input values, calculation math, validation errors, sparte field internals).`,
          `- Treat any active-calculation context as silent background — do not quiz the user about it.`,
          `- Keep it short: gather title, description, and severity in plain language, then wrap up in 2–3 turns.`,
        ].join('\n'),
      });
    }

    return blocks;
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
    // Replay only the user-visible conversation (text + plain user input).
    // Tool calls happen WITHIN a single turn's loop and their effect is
    // captured in `intakeState` — replaying tool_use without paired tool_result
    // (or vice versa) would 400 from Claude. Strip both kinds of blocks here.
    const result: Anthropic.Messages.MessageParam[] = [];
    for (const m of history) {
      if (m.role === 'system') continue;
      const role: 'assistant' | 'user' =
        m.role === 'assistant' ? 'assistant' : 'user';
      const blocks = m.content as Anthropic.Messages.ContentBlockParam[];
      if (!Array.isArray(blocks)) continue;

      const filtered = blocks.filter((b) => {
        if (!b || typeof b !== 'object') return false;
        const t = (b as { type?: string }).type;
        return t !== 'tool_use' && t !== 'tool_result';
      });
      if (filtered.length === 0) continue;

      result.push({ role, content: filtered });
    }
    return result;
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
