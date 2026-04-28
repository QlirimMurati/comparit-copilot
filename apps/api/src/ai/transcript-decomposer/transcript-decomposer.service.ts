import type Anthropic from '@anthropic-ai/sdk';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  transcriptNodes,
  transcriptSessions,
  type TranscriptNode,
  type TranscriptSession,
} from '../../db/schema';
import { AnthropicService } from '../anthropic.service';
import {
  TRANSCRIPT_DECOMPOSER_SYSTEM,
  TRANSCRIPT_TOOLS,
} from './transcript-decomposer.schema';

const MODEL = 'claude-opus-4-7';
const MAX_TOOL_LOOPS = 8;

export interface TranscriptTreeNode {
  id: string;
  parentId: string | null;
  nodeType: 'epic' | 'story' | 'subtask';
  title: string;
  description: string | null;
  labels: string[];
  estimateHours: number | null;
  sortOrder: number;
  children: TranscriptTreeNode[];
}

export interface TranscriptTreeResult {
  session: TranscriptSession;
  epics: TranscriptTreeNode[];
  assistantText: string;
  isComplete: boolean;
}

@Injectable()
export class TranscriptDecomposerService {
  private readonly logger = new Logger('TranscriptDecomposer');

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    @Optional() private readonly realtime?: RealtimeGateway
  ) {}

  async start(input: {
    rawTranscript: string;
    title?: string | null;
  }): Promise<TranscriptTreeResult> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }

    const [session] = await this.db
      .insert(transcriptSessions)
      .values({
        rawTranscript: input.rawTranscript,
        title: input.title ?? null,
      })
      .returning();

    const assistantText = await this.runAgent(session.id, null);
    return this.buildResult(session.id, assistantText);
  }

  async refine(
    sessionId: string,
    instruction: string
  ): Promise<TranscriptTreeResult> {
    if (!this.anthropic.isConfigured) {
      throw new ServiceUnavailableException(
        'AI is not configured (set ANTHROPIC_API_KEY)'
      );
    }
    await this.requireSession(sessionId);
    const assistantText = await this.runAgent(sessionId, instruction);
    return this.buildResult(sessionId, assistantText);
  }

  async getTree(sessionId: string): Promise<TranscriptTreeResult> {
    await this.requireSession(sessionId);
    return this.buildResult(sessionId, '');
  }

  private async requireSession(id: string): Promise<TranscriptSession> {
    const rows = await this.db
      .select()
      .from(transcriptSessions)
      .where(eq(transcriptSessions.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Transcript session ${id} not found`);
    }
    return rows[0];
  }

  private async runAgent(
    sessionId: string,
    instruction: string | null
  ): Promise<string> {
    const session = await this.requireSession(sessionId);
    let nodes = await this.loadNodes(sessionId);

    const userMessage = this.buildUserPrompt(session, nodes, instruction);

    const apiMessages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    let assistantText = '';

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const response = await this.anthropic.client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: TRANSCRIPT_DECOMPOSER_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: TRANSCRIPT_TOOLS,
        messages: apiMessages,
      });

      for (const block of response.content) {
        if (block.type === 'text') assistantText += block.text;
      }

      if (response.stop_reason !== 'tool_use') break;
      apiMessages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await this.handleTool(
          sessionId,
          block,
          nodes
        );
        if (result.completed) {
          await this.db
            .update(transcriptSessions)
            .set({ status: 'complete', updatedAt: new Date() })
            .where(eq(transcriptSessions.id, sessionId));
        }
        nodes = result.nodes;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    if (instruction !== null) {
      await this.db
        .update(transcriptSessions)
        .set({
          updatedAt: new Date(),
          instructions: this.appendInstruction(session.instructions, instruction),
        })
        .where(eq(transcriptSessions.id, sessionId));
    }

    return assistantText.trim();
  }

  private buildUserPrompt(
    session: TranscriptSession,
    nodes: TranscriptNode[],
    instruction: string | null
  ): string {
    const tree = formatTreeText(nodes);
    return [
      '## Raw transcript',
      session.rawTranscript,
      '',
      '## Current tree',
      tree || '_(empty — start by adding epics)_',
      ...(instruction ? ['', '## New refinement instruction', instruction] : []),
      '',
      'Decompose the transcript into Epics → Stories → Subtasks using the tools provided. When done, call complete_decomposition and write a short summary.',
    ].join('\n');
  }

  private appendInstruction(prev: unknown, next: string): string[] {
    const arr = Array.isArray(prev) ? (prev as string[]) : [];
    return [...arr, next];
  }

  private async handleTool(
    sessionId: string,
    block: Anthropic.ToolUseBlock,
    currentNodes: TranscriptNode[]
  ): Promise<{
    nodes: TranscriptNode[];
    content: string;
    isError: boolean;
    completed?: boolean;
  }> {
    const args = (block.input ?? {}) as Record<string, unknown>;

    try {
      if (block.name === 'add_epic') {
        const node = await this.insertNode(sessionId, {
          parentId: null,
          nodeType: 'epic',
          title: requireString(args, 'title'),
          description: optString(args, 'description'),
          labels: optLabels(args),
          estimateHours: optInt(args, 'estimate_hours'),
        });
        return {
          nodes: [...currentNodes, node],
          content: `Epic created: ${node.id}`,
          isError: false,
        };
      }
      if (block.name === 'add_story') {
        const epicId = requireString(args, 'epic_id');
        if (!currentNodes.some((n) => n.id === epicId && n.nodeType === 'epic')) {
          return {
            nodes: currentNodes,
            content: `Unknown epic_id: ${epicId}`,
            isError: true,
          };
        }
        const node = await this.insertNode(sessionId, {
          parentId: epicId,
          nodeType: 'story',
          title: requireString(args, 'title'),
          description: optString(args, 'description'),
          labels: optLabels(args),
          estimateHours: optInt(args, 'estimate_hours'),
        });
        return {
          nodes: [...currentNodes, node],
          content: `Story created: ${node.id}`,
          isError: false,
        };
      }
      if (block.name === 'add_subtask') {
        const storyId = requireString(args, 'story_id');
        if (
          !currentNodes.some(
            (n) => n.id === storyId && n.nodeType === 'story'
          )
        ) {
          return {
            nodes: currentNodes,
            content: `Unknown story_id: ${storyId}`,
            isError: true,
          };
        }
        const node = await this.insertNode(sessionId, {
          parentId: storyId,
          nodeType: 'subtask',
          title: requireString(args, 'title'),
          description: optString(args, 'description'),
          labels: optLabels(args),
          estimateHours: optInt(args, 'estimate_hours'),
        });
        return {
          nodes: [...currentNodes, node],
          content: `Subtask created: ${node.id}`,
          isError: false,
        };
      }
      if (block.name === 'update_node') {
        const id = requireString(args, 'id');
        const node = currentNodes.find((n) => n.id === id);
        if (!node) {
          return {
            nodes: currentNodes,
            content: `Unknown node id: ${id}`,
            isError: true,
          };
        }
        const patch: Partial<TranscriptNode> = {};
        if (typeof args['title'] === 'string') patch.title = args['title'];
        if ('description' in args) patch.description = optString(args, 'description');
        if ('labels' in args) patch.labels = optLabels(args);
        if ('estimate_hours' in args)
          patch.estimateHours = optInt(args, 'estimate_hours');
        const [updated] = await this.db
          .update(transcriptNodes)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(transcriptNodes.id, id))
          .returning();
        return {
          nodes: currentNodes.map((n) => (n.id === id ? updated : n)),
          content: `Updated: ${id}`,
          isError: false,
        };
      }
      if (block.name === 'complete_decomposition') {
        return {
          nodes: currentNodes,
          content: 'Decomposition complete',
          isError: false,
          completed: true,
        };
      }
      return {
        nodes: currentNodes,
        content: `Unknown tool: ${block.name}`,
        isError: true,
      };
    } catch (err) {
      this.logger.warn(`Tool ${block.name} failed: ${(err as Error).message}`);
      return {
        nodes: currentNodes,
        content: `Tool error: ${(err as Error).message}`,
        isError: true,
      };
    }
  }

  private async insertNode(
    sessionId: string,
    input: {
      parentId: string | null;
      nodeType: 'epic' | 'story' | 'subtask';
      title: string;
      description: string | null;
      labels: string[] | null;
      estimateHours: number | null;
    }
  ): Promise<TranscriptNode> {
    const sortOrder = await this.nextSortOrder(sessionId, input.parentId);
    const [row] = await this.db
      .insert(transcriptNodes)
      .values({
        sessionId,
        parentId: input.parentId,
        nodeType: input.nodeType,
        title: input.title,
        description: input.description,
        labels: input.labels,
        estimateHours: input.estimateHours,
        sortOrder,
      })
      .returning();
    this.realtime?.emitTranscriptNodeAdded({
      sessionId,
      nodeId: row.id,
      parentId: row.parentId,
      nodeType: row.nodeType,
      title: row.title,
    });
    return row;
  }

  private async nextSortOrder(
    sessionId: string,
    parentId: string | null
  ): Promise<number> {
    const all = await this.loadNodes(sessionId);
    return all.filter((n) => n.parentId === parentId).length;
  }

  private async loadNodes(sessionId: string): Promise<TranscriptNode[]> {
    return this.db
      .select()
      .from(transcriptNodes)
      .where(eq(transcriptNodes.sessionId, sessionId))
      .orderBy(asc(transcriptNodes.sortOrder), asc(transcriptNodes.createdAt));
  }

  private async buildResult(
    sessionId: string,
    assistantText: string
  ): Promise<TranscriptTreeResult> {
    const session = await this.requireSession(sessionId);
    const nodes = await this.loadNodes(sessionId);
    const epics = buildTree(nodes);
    return {
      session,
      epics,
      assistantText,
      isComplete: session.status === 'complete',
    };
  }
}

function buildTree(nodes: TranscriptNode[]): TranscriptTreeNode[] {
  const byId = new Map<string, TranscriptTreeNode>();
  for (const n of nodes) {
    byId.set(n.id, {
      id: n.id,
      parentId: n.parentId,
      nodeType: n.nodeType,
      title: n.title,
      description: n.description,
      labels: Array.isArray(n.labels) ? (n.labels as string[]) : [],
      estimateHours: n.estimateHours,
      sortOrder: n.sortOrder,
      children: [],
    });
  }
  const roots: TranscriptTreeNode[] = [];
  for (const n of nodes) {
    const view = byId.get(n.id)!;
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(view);
    } else {
      roots.push(view);
    }
  }
  const sortRec = (arr: TranscriptTreeNode[]): void => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const x of arr) sortRec(x.children);
  };
  sortRec(roots);
  return roots;
}

function formatTreeText(nodes: TranscriptNode[]): string {
  const tree = buildTree(nodes);
  const lines: string[] = [];
  const walk = (n: TranscriptTreeNode, depth: number): void => {
    const indent = '  '.repeat(depth);
    const labels = n.labels.length ? ` [${n.labels.join(', ')}]` : '';
    const est = n.estimateHours != null ? ` (~${n.estimateHours}h)` : '';
    const tag =
      n.nodeType === 'epic' ? 'EPIC' : n.nodeType === 'story' ? 'STORY' : 'SUB';
    lines.push(`${indent}- [${n.id}] ${tag}: ${n.title}${labels}${est}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const r of tree) walk(r, 0);
  return lines.join('\n');
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`Missing or empty string '${key}'`);
  }
  return v;
}

function optString(
  obj: Record<string, unknown>,
  key: string
): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function optInt(
  obj: Record<string, unknown>,
  key: string
): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null;
}

function optLabels(obj: Record<string, unknown>): string[] | null {
  const v = obj['labels'];
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string');
}

