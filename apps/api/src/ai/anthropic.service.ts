import type Anthropic from '@anthropic-ai/sdk';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandInput,
  type ConverseStreamCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────────
// Direct Anthropic API (commented out — switched to AWS Bedrock).
// To revert: uncomment the block below, comment out the Bedrock block, and
// restore ANTHROPIC_API_KEY in .env.
// ─────────────────────────────────────────────────────────────────────────────
// import Anthropic from '@anthropic-ai/sdk';
//
// const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
// if (!apiKey) { ... }
// this._client = new Anthropic({ apiKey });
// ─────────────────────────────────────────────────────────────────────────────
//
// Anthropic via AnthropicBedrock (also commented out — Anthropic models on
// Bedrock require explicit account-level access; switched to Amazon Nova Pro
// which is generally available).
// ─────────────────────────────────────────────────────────────────────────────
// import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
//
// const bedrock = new AnthropicBedrock({
//   awsAccessKey: accessKeyId,
//   awsSecretKey: secretAccessKey,
//   awsSessionToken: sessionToken,
//   awsRegion: region,
// });
// this._client = bedrock as unknown as Anthropic;
// ─────────────────────────────────────────────────────────────────────────────

const NOVA_MODEL_ID =
  process.env.BEDROCK_MODEL_ID?.trim() || 'amazon.nova-pro-v1:0';

@Injectable()
export class AnthropicService implements OnModuleInit {
  private readonly logger = new Logger('AnthropicService');
  // The exposed `client` keeps the Anthropic SDK shape so the 10+ AI services
  // (intake, qa, triage, code-localizer, ticket-polisher, …) compile and run
  // unchanged. Underneath, calls are translated to Bedrock's Converse API and
  // routed to amazon.nova-pro-v1:0.
  private _client: Anthropic | null = null;

  onModuleInit(): void {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
    const region = process.env.AWS_REGION?.trim() || 'eu-central-1';

    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set — AI endpoints will return a configuration error'
      );
      return;
    }

    const bedrock = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
      },
    });

    this._client = makeNovaAdapter(bedrock, this.logger) as unknown as Anthropic;
    this.logger.log(
      `Bedrock Nova adapter initialised (region=${region}, model=${NOVA_MODEL_ID}, sts=${sessionToken ? 'yes' : 'no'})`
    );
  }

  get client(): Anthropic {
    if (!this._client) {
      throw new Error(
        'Bedrock client is not configured. Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN for STS) in .env to enable AI features.'
      );
    }
    return this._client;
  }

  get isConfigured(): boolean {
    return this._client !== null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic-shape → Bedrock Converse adapter (text + tool-use only).
//
// The codebase calls `client.messages.create({ model, system, messages, tools,
// tool_choice, max_tokens, temperature, thinking, ... })` and expects an
// Anthropic Message back. This adapter:
//   • translates the request into a Converse payload,
//   • forces the modelId to NOVA_MODEL_ID (caller's `model` literal is
//     ignored — every existing service passes Claude IDs),
//   • silently drops `thinking` (Nova has no equivalent),
//   • translates the Converse response back into an Anthropic-shape Message.
//
// Streaming is NOT implemented — the few endpoints that use the streaming
// variant will need a follow-up for ConverseStreamCommand.
// ─────────────────────────────────────────────────────────────────────────────

type AnthropicReq = {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string | Array<{ type: 'text'; text: string }>;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'tool'; name: string };
  stop_sequences?: string[];
  thinking?: unknown;
};

function makeNovaAdapter(client: BedrockRuntimeClient, logger: Logger) {
  return {
    messages: {
      async create(req: AnthropicReq): Promise<unknown> {
        if (req.thinking) {
          logger.debug?.(
            'thinking block requested — silently dropped (Nova has no equivalent)'
          );
        }

        const converseInput = anthropicToConverse(req);
        const command = new ConverseCommand(
          converseInput as unknown as ConverseCommandInput,
        );

        let response;
        try {
          response = await client.send(command);
        } catch (err) {
          logger.error(
            `Bedrock Converse call failed: ${(err as Error).message}`
          );
          throw err;
        }

        return converseToAnthropic(response, req);
      },

      stream(req: AnthropicReq): NovaMessageStream {
        if (req.thinking) {
          logger.debug?.(
            'thinking block requested — silently dropped (Nova has no equivalent)'
          );
        }
        return new NovaMessageStream(client, req, logger);
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strip Nova's inline <thinking>…</thinking> markup from text. Nova lacks
// Anthropic's structured `thinking` content blocks, so when a prompt instructs
// the model to reason first it emits the tags as raw text. The streaming
// version handles tag boundaries that may split across deltas.
// ─────────────────────────────────────────────────────────────────────────────

const THINK_OPEN = '<thinking>';
const THINK_CLOSE = '</thinking>';

class ThinkingStripper {
  private buf = '';
  private inside = false;

  push(piece: string): string {
    this.buf += piece;
    return this.consume(false);
  }

  end(): string {
    return this.consume(true);
  }

  private consume(final: boolean): string {
    let out = '';
    // longest tag prefix we might be straddling: max(len OPEN, len CLOSE) - 1
    const safeEdge = Math.max(THINK_OPEN.length, THINK_CLOSE.length) - 1;
    while (this.buf.length) {
      if (this.inside) {
        const close = this.buf.indexOf(THINK_CLOSE);
        if (close >= 0) {
          this.buf = this.buf.slice(close + THINK_CLOSE.length);
          this.inside = false;
        } else if (final) {
          this.buf = '';
        } else if (this.buf.length > safeEdge) {
          // drop the safe interior, keep the tail in case </thinking> is straddling
          this.buf = this.buf.slice(this.buf.length - safeEdge);
          break;
        } else {
          break;
        }
      } else {
        const open = this.buf.indexOf(THINK_OPEN);
        if (open >= 0) {
          out += this.buf.slice(0, open);
          this.buf = this.buf.slice(open + THINK_OPEN.length);
          this.inside = true;
        } else if (final) {
          out += this.buf;
          this.buf = '';
        } else if (this.buf.length <= safeEdge) {
          break;
        } else {
          const emitLen = this.buf.length - safeEdge;
          out += this.buf.slice(0, emitLen);
          this.buf = this.buf.slice(emitLen);
          break;
        }
      }
    }
    return out;
  }
}

function stripThinkingFull(text: string): string {
  // Non-streaming variant — just remove all matched <thinking>…</thinking> blocks.
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<thinking>[\s\S]*$/g, '') // unterminated tail
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming — wraps ConverseStreamCommand and re-emits Anthropic-shape events
// so consumers can `for await (event of stream)` and `await stream.finalMessage()`
// exactly like the Anthropic SDK.
// ─────────────────────────────────────────────────────────────────────────────

type AnthropicTextDelta = {
  type: 'content_block_delta';
  index: number;
  delta: { type: 'text_delta'; text: string };
};
type AnthropicJsonDelta = {
  type: 'content_block_delta';
  index: number;
  delta: { type: 'input_json_delta'; partial_json: string };
};
type AnthropicBlockStart = {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
};
type AnthropicBlockStop = { type: 'content_block_stop'; index: number };
type AnthropicMessageStart = { type: 'message_start'; message: Record<string, unknown> };
type AnthropicMessageDelta = {
  type: 'message_delta';
  delta: { stop_reason: string; stop_sequence: string | null };
  usage: { input_tokens: number; output_tokens: number };
};
type AnthropicMessageStop = { type: 'message_stop' };
type AnthropicEvent =
  | AnthropicMessageStart
  | AnthropicBlockStart
  | AnthropicTextDelta
  | AnthropicJsonDelta
  | AnthropicBlockStop
  | AnthropicMessageDelta
  | AnthropicMessageStop;

type FinalMessage = {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: unknown[];
  stop_reason: string;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
};

class NovaMessageStream implements AsyncIterable<AnthropicEvent> {
  private readonly client: BedrockRuntimeClient;
  private readonly req: AnthropicReq;
  private readonly logger: Logger;
  private readonly id: string;
  private readonly blocks = new Map<number, Record<string, unknown>>();
  private readonly toolBuffers = new Map<number, string>();
  private readonly strippers = new Map<number, ThinkingStripper>();
  private stopReason = 'end_turn';
  private usage = { input_tokens: 0, output_tokens: 0 };
  private resolveFinal!: (msg: FinalMessage) => void;
  private rejectFinal!: (err: Error) => void;
  private readonly finalP: Promise<FinalMessage>;
  private started = false;

  constructor(client: BedrockRuntimeClient, req: AnthropicReq, logger: Logger) {
    this.client = client;
    this.req = req;
    this.logger = logger;
    this.id = `msg_nova_${Date.now().toString(36)}`;
    this.finalP = new Promise<FinalMessage>((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
  }

  finalMessage(): Promise<FinalMessage> {
    if (!this.started) {
      // Anthropic SDK auto-runs if you await finalMessage() without iterating.
      // Drain the stream to completion.
      void (async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of this) {
          /* drain */
        }
      })();
    }
    return this.finalP;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AnthropicEvent> {
    if (this.started) {
      // Iterating twice — yield from finalised state isn't supported here.
      throw new Error('NovaMessageStream is not re-iterable');
    }
    this.started = true;

    let response;
    try {
      const converse = anthropicToConverse(this.req);
      const command = new ConverseStreamCommand(
        converse as unknown as ConverseStreamCommandInput,
      );
      response = await this.client.send(command);
    } catch (err) {
      this.rejectFinal(err as Error);
      throw err;
    }

    yield {
      type: 'message_start',
      message: {
        id: this.id,
        type: 'message',
        role: 'assistant',
        model: this.req.model || NOVA_MODEL_ID,
        content: [],
        stop_reason: null,
        usage: this.usage,
      },
    } as AnthropicMessageStart;

    const eventStream = response.stream;
    if (!eventStream) {
      this.resolveFinal(this.buildFinal());
      yield { type: 'message_stop' } as AnthropicMessageStop;
      return;
    }

    try {
      for await (const ev of eventStream) {
        if (ev.messageStart) {
          // already emitted message_start
          continue;
        }

        if (ev.contentBlockStart) {
          const cbs = ev.contentBlockStart;
          const idx = cbs.contentBlockIndex ?? 0;
          const start = cbs.start as Record<string, unknown> | undefined;
          if (start && (start as { toolUse?: unknown }).toolUse) {
            const tu = (start as { toolUse: { toolUseId: string; name: string } }).toolUse;
            const block = {
              type: 'tool_use',
              id: tu.toolUseId,
              name: tu.name,
              input: {},
            };
            this.blocks.set(idx, block);
            this.toolBuffers.set(idx, '');
            yield {
              type: 'content_block_start',
              index: idx,
              content_block: {
                type: 'tool_use',
                id: tu.toolUseId,
                name: tu.name,
                input: {},
              },
            } as AnthropicBlockStart;
          }
          // Text blocks don't get a Start in Bedrock — they appear via Delta.
          continue;
        }

        if (ev.contentBlockDelta) {
          const cbd = ev.contentBlockDelta;
          const idx = cbd.contentBlockIndex ?? 0;
          const delta = cbd.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          if (typeof (delta as { text?: string }).text === 'string') {
            if (!this.blocks.has(idx)) {
              this.blocks.set(idx, { type: 'text', text: '' });
              this.strippers.set(idx, new ThinkingStripper());
              yield {
                type: 'content_block_start',
                index: idx,
                content_block: { type: 'text', text: '' },
              } as AnthropicBlockStart;
            }
            const blk = this.blocks.get(idx) as { type: 'text'; text: string };
            const stripper = this.strippers.get(idx)!;
            const cleaned = stripper.push((delta as { text: string }).text);
            if (cleaned) {
              blk.text += cleaned;
              yield {
                type: 'content_block_delta',
                index: idx,
                delta: { type: 'text_delta', text: cleaned },
              } as AnthropicTextDelta;
            }
          } else if ((delta as { toolUse?: { input?: string } }).toolUse) {
            const piece =
              (delta as { toolUse: { input?: string } }).toolUse.input ?? '';
            this.toolBuffers.set(idx, (this.toolBuffers.get(idx) ?? '') + piece);
            yield {
              type: 'content_block_delta',
              index: idx,
              delta: { type: 'input_json_delta', partial_json: piece },
            } as AnthropicJsonDelta;
          }
          // reasoningContent / others — silently ignored.
          continue;
        }

        if (ev.contentBlockStop) {
          const idx = ev.contentBlockStop.contentBlockIndex ?? 0;
          const blk = this.blocks.get(idx);
          if (blk && blk.type === 'tool_use') {
            const buf = this.toolBuffers.get(idx) ?? '';
            try {
              (blk as { input: Record<string, unknown> }).input = buf
                ? JSON.parse(buf)
                : {};
            } catch {
              (blk as { input: Record<string, unknown> }).input = {};
            }
          }
          // Flush any tail text held by the thinking stripper (e.g. content
          // accumulated past the last delta but before close).
          const stripper = this.strippers.get(idx);
          if (stripper) {
            const tail = stripper.end();
            if (tail && blk && blk.type === 'text') {
              (blk as { text: string }).text += tail;
              yield {
                type: 'content_block_delta',
                index: idx,
                delta: { type: 'text_delta', text: tail },
              } as AnthropicTextDelta;
            }
          }
          yield { type: 'content_block_stop', index: idx } as AnthropicBlockStop;
          continue;
        }

        if (ev.messageStop) {
          this.stopReason = mapStopReason(ev.messageStop.stopReason);
          continue;
        }

        if (ev.metadata?.usage) {
          this.usage.input_tokens = ev.metadata.usage.inputTokens ?? this.usage.input_tokens;
          this.usage.output_tokens = ev.metadata.usage.outputTokens ?? this.usage.output_tokens;
        }
      }
    } catch (err) {
      this.rejectFinal(err as Error);
      throw err;
    }

    yield {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason, stop_sequence: null },
      usage: this.usage,
    } as AnthropicMessageDelta;

    yield { type: 'message_stop' } as AnthropicMessageStop;

    this.resolveFinal(this.buildFinal());
  }

  private buildFinal(): FinalMessage {
    const ordered = [...this.blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, blk]) => blk)
      .filter((blk) => {
        // Drop empty text blocks so they don't poison the next turn's history.
        if ((blk as { type?: string }).type === 'text') {
          return String((blk as { text?: string }).text ?? '').trim().length > 0;
        }
        return true;
      });
    return {
      id: this.id,
      type: 'message',
      role: 'assistant',
      model: this.req.model || NOVA_MODEL_ID,
      content: ordered,
      stop_reason: this.stopReason,
      stop_sequence: null,
      usage: this.usage,
    };
  }
}

// ───── request translation ─────

function anthropicToConverse(req: AnthropicReq) {
  const systemBlocks = normaliseSystem(req.system);

  // Bedrock requires:
  //   1. the conversation to start with a user message
  //   2. roles to alternate user / assistant
  // Anthropic is more permissive on both. Normalise here.
  const rawMessages = req.messages.map((m) => ({
    role: m.role,
    content: normaliseContent(m.content),
  }));

  const messages: typeof rawMessages = [];
  for (const m of rawMessages) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) {
      // Merge adjacent same-role messages by concatenating content arrays.
      last.content = [
        ...(last.content as unknown[]),
        ...(m.content as unknown[]),
      ];
    } else {
      messages.push(m);
    }
  }

  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ text: 'Begin.' }] });
  }

  const inferenceConfig: Record<string, unknown> = {};
  if (req.max_tokens != null) inferenceConfig.maxTokens = req.max_tokens;
  if (req.temperature != null) inferenceConfig.temperature = req.temperature;
  if (req.stop_sequences?.length)
    inferenceConfig.stopSequences = req.stop_sequences;

  const out: Record<string, unknown> = {
    modelId: NOVA_MODEL_ID,
    messages,
  };
  if (systemBlocks.length) out.system = systemBlocks;
  if (Object.keys(inferenceConfig).length) out.inferenceConfig = inferenceConfig;

  if (req.tools?.length) {
    out.toolConfig = {
      tools: req.tools.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description ?? t.name,
          inputSchema: { json: t.input_schema },
        },
      })),
      ...(req.tool_choice ? { toolChoice: mapToolChoice(req.tool_choice) } : {}),
    };
  }

  return out;
}

function mapToolChoice(tc: NonNullable<AnthropicReq['tool_choice']>) {
  if (tc.type === 'auto') return { auto: {} };
  if (tc.type === 'any') return { any: {} };
  if (tc.type === 'tool') return { tool: { name: tc.name } };
  return { auto: {} };
}

function normaliseSystem(
  system: AnthropicReq['system']
): Array<{ text: string }> {
  if (!system) return [];
  if (typeof system === 'string') return [{ text: system }];
  return system
    .filter((b) => b && (b as { type?: string }).type === 'text')
    .map((b) => ({ text: (b as { text: string }).text }));
}

// Bedrock rejects empty text fields. Use this to push only non-empty text.
function pushText(blocks: unknown[], text: unknown): void {
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (s.trim()) blocks.push({ text: s });
}

function normaliseContent(content: unknown): unknown[] {
  const blocks: unknown[] = [];

  if (typeof content === 'string') {
    pushText(blocks, content);
  } else if (!Array.isArray(content)) {
    pushText(blocks, content);
  } else {
    for (const raw of content) {
      if (!raw) continue;
      if (typeof raw === 'string') {
        pushText(blocks, raw);
        continue;
      }
      const block = raw as Record<string, unknown>;
      switch (block.type) {
        case 'text':
          pushText(blocks, block.text);
          break;
        case 'thinking':
          // Nova has no thinking concept — drop silently.
          break;
        case 'tool_use':
          blocks.push({
            toolUse: {
              toolUseId: String(block.id ?? ''),
              name: String(block.name ?? ''),
              input: (block.input as Record<string, unknown>) ?? {},
            },
          });
          break;
        case 'tool_result': {
          const inner = block.content;
          const arr = Array.isArray(inner) ? inner : [inner];
          const trc: unknown[] = [];
          for (const c of arr) {
            if (c == null) continue;
            if (typeof c === 'string') {
              if (c.trim()) trc.push({ text: c });
            } else if (typeof c === 'object') {
              const obj = c as Record<string, unknown>;
              if (obj.type === 'text') {
                const t = String(obj.text ?? '');
                if (t.trim()) trc.push({ text: t });
              } else {
                const s = JSON.stringify(obj);
                if (s && s.trim() && s !== '{}') trc.push({ text: s });
              }
            }
          }
          blocks.push({
            toolResult: {
              toolUseId: String(block.tool_use_id ?? ''),
              content: trc.length ? trc : [{ text: '(no result)' }],
              ...(block.is_error ? { status: 'error' } : {}),
            },
          });
          break;
        }
        default:
          // Unknown block — coerce to text so the message isn't lost.
          pushText(blocks, JSON.stringify(block));
      }
    }
  }

  // Bedrock requires every message to have at least one non-empty block.
  return blocks.length ? blocks : [{ text: '(no content)' }];
}

// ───── response translation ─────

type ConverseRes = {
  output?: {
    message?: {
      role?: 'assistant';
      content?: Array<Record<string, unknown>>;
    };
  };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

function converseToAnthropic(res: ConverseRes, req: AnthropicReq) {
  const out = res.output?.message;
  const novaContent = out?.content ?? [];

  const content: Record<string, unknown>[] = [];
  for (const blk of novaContent) {
    if (blk.text != null) {
      const cleaned = stripThinkingFull(String(blk.text));
      if (cleaned) content.push({ type: 'text', text: cleaned });
      continue;
    }
    if (blk.toolUse) {
      const t = blk.toolUse as {
        toolUseId: string;
        name: string;
        input: Record<string, unknown>;
      };
      content.push({
        type: 'tool_use',
        id: t.toolUseId,
        name: t.name,
        input: t.input ?? {},
      });
      continue;
    }
    if (blk.toolResult) {
      const t = blk.toolResult as {
        toolUseId: string;
        content: Array<{ text?: string }>;
      };
      content.push({
        type: 'tool_result',
        tool_use_id: t.toolUseId,
        content: (t.content || []).map((c) => ({
          type: 'text',
          text: String(c.text ?? ''),
        })),
      });
      continue;
    }
    content.push({ type: 'text', text: JSON.stringify(blk) });
  }

  const stopReason = mapStopReason(res.stopReason);

  return {
    id: `msg_nova_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: req.model || NOVA_MODEL_ID,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.inputTokens ?? 0,
      output_tokens: res.usage?.outputTokens ?? 0,
    },
  };
}

function mapStopReason(reason?: string): string {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'content_filtered':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}
