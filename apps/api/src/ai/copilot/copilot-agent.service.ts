import type Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, cosineDistance, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module';
import { bugReports, ticketsCache } from '../../db/schema';
import { REPORT_SEVERITIES, SPARTEN } from '../../db/schema';
import { findOrCreateReporter } from '../../users/find-or-create-reporter';
import { PrefillService } from '../../prefill/prefill.service';
import { ValidationRulesService } from '../../validation-rules/validation-rules.service';
import { AnthropicService } from '../anthropic.service';
import { CodeLocalizerService } from '../code-localizer.service';
import { DedupService } from '../dedup.service';
import { EmbedQueueService } from '../embed.queue';
import { TranscriptDecomposerService } from '../transcript-decomposer/transcript-decomposer.service';
import { TriageQueueService } from '../triage.queue';
import { VoyageService } from '../voyage.service';
import { CopilotSessionService } from './copilot-session.service';
import type { CopilotBugDraft, CopilotState, CopilotStreamEvent } from './copilot.types';

// Haiku 4.5 — much faster first-token + turn time than Opus, plenty for the
// agent's task (gather fields, route tool calls, summarise results). Bump back
// to claude-opus-4-7 if quality regresses on edge cases.
const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_LOOPS = 8;

const SYSTEM_PROMPT = `You are the Comparit Copilot — an internal AI assistant for developers, QAs, and POs at Comparit.

You have these capabilities via tools:
1. **Ticket creation** — gather details for a bug OR a feature request conversationally, then submit
2. **Duplicate detection** — find similar existing reports and Jira tickets
3. **Jira search** — full-text search in the Jira cache
4. **Code analysis** — locate source files from a free-form description (no saved report needed) or from a submitted reportId
5. **Transcript decomposition** — break meeting transcripts into Epic → Story → Subtask

RULES:
- NO PREAMBLE. Skip pleasantries ("I'd be happy to help", "Sure, let me…"). Lead with the question or action.
- One focused question per turn — never stack two.
- Max 1 sentence of context before the question, usually zero.
- DON'T RE-ASK. If the user already answered it (even implicitly), don't re-ask the same field with different wording.
- BATCH INFERENCES. If a single user message gives you 2+ fields at once ("login button is dead, blocking the whole flow, BU sparte"), call update_bug_draft ONCE with all of them — don't drip-feed.
- When the user wants to create a ticket but it's unclear if it's a bug or a feature, ask once: "Bug, feature, or something else?" Then proceed.
- For bug intake: gather title, description, severity, sparte conversationally. When all set, submit.
- For feature intake: gather title, description, sparte. Severity = priority — default "low" unless user pushes higher ("urgent", "blocker for the demo"). Then submit.
- TICKET TYPE — set on update_bug_draft as soon as it's clear from one sentence:
    bug   → "doesn't work / broken / wrong / missing / geht nicht / fehler"
    feature → "could you add / it would be nice / wäre cool / hinzufügen / verbesserung"
- SEVERITY INFERENCE — don't ask if you can read it:
    blocker = "prod down / nothing works / users can't log in"
    high    = "major feature broken / many users affected / regression"
    medium  = "noticeable but workable / has a workaround"
    low     = "cosmetic / nitpick / minor"
  Only ask "How critical is this?" if none of those map.
- SPARTE INFERENCE — pull from current page context if available (route shows /bu, /kfz, etc.) before asking. Cues: "Berufsunfähigkeit" → bu, "KFZ / Auto / Kasko" → kfz, "Risikoleben" → risikoleben, "Hausrat" → hausrat, "PHV / Haftpflicht" → phv, etc.
- Address the user by their first name when one is in the captured context — sparingly, not every turn.
- After submitting a ticket, follow up with ONE short line offering the most relevant next step ("Check duplicates?" OR "Find affected files?" — pick the better fit, don't list both).
- TOOL RESULTS — narrate, don't dump. After search_jira returns 10 hits, highlight the top 1-2 with a one-line "why this matches"; don't reformat all 10. After find_affected_code, give the strongest 1-2 candidates with a one-sentence rationale.
- When a user pastes a long text that looks like a meeting transcript, call decompose_transcript immediately.
- After decompose_transcript, when the user asks to create the tickets, call submit_bug_report ONCE PER TICKET with all fields inline (title, description, severity, type, optional sparte). Do NOT call update_bug_draft for each — the draft buffer is single-slot and gets overwritten. Inline args produce one distinct ticket per call.
- Do not ask for the user's email or identity.
- LANGUAGE: detect the language of the user's MOST RECENT message and reply in that language. Switch dynamically — if the user wrote German earlier and now types in English, your next reply is in English. Match every turn to the user's current message, never lock to the first message's language. Default to German only if the current message is empty/ambiguous.`;

function prefillAddendum(stage: 'live' | 'qa' | 'dev'): string {
  return `\n\nPREFILL VALIDATION:
- When the user pastes JSON containing a \`sparte\` field or a \`prefillData\` wrapper, IMMEDIATELY call validate_prefill.
- Pass the pasted JSON verbatim as the \`json\` argument.
- Pass \`stage: "${stage}"\` (this is the active session stage).
- On result: write a conversational reply. Lead with missing required fields if any, then type errors. Cap the first reply at 5 issues; if there are more, end with "Want me to list the rest?".
- If the result has \`schemaSource: "static"\`, mention "(offline schema; required-field check skipped)".

FIELD-RULE LOOKUP:
- When the user asks about a Sparte field (German labels like Geburtsdatum, Versicherungssumme, Karenzzeit, etc.), call lookup_field_rule first.
- ANSWER FORMAT — for each matched rule, output ONLY:
    1. **Inhaltlich** — the rule's \`humanRule\` text (verbatim or lightly rephrased; do NOT shorten or truncate).
    2. **Erlaubte Werte** — the \`enumValues\` list, one per line, complete. If \`enumValues\` is null or empty, omit this section.
  Do NOT include: field path, internal type, validator kinds, synonyms, rule id, source, timestamps, sparte tags inside the bullet — keep those out of the answer.
- If multiple rules match (same field across Sparten), output one block per Sparte with a single heading line "**<Sparte>**" then the two sections above. Show ALL matches, never cap. Never write "Want me to list the rest?" or any similar truncation prompt — return everything.
- If lookup returns 0 rows: say so plainly and suggest 2–3 close alternatives based on the wording. No tool re-call.
- When the user says "remember/save/add 'X' as synonym for Y": call add_field_synonym after a fresh lookup_field_rule to get the rule id.`;
}

const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_bug_draft',
    description:
      'Record ticket fields as you gather them conversationally. Call whenever you learn title, description, severity, sparte, or type (bug | feature). Can be called multiple times.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'One-line summary (min 5 chars).' },
        description: {
          type: 'string',
          description: 'Steps to reproduce + expected vs actual for bugs; user goal + motivation for features (min 10 chars).',
        },
        severity: {
          type: 'string',
          enum: [...REPORT_SEVERITIES],
          description: 'blocker=prod down; high=major feature broken; medium=noticeable; low=minor. For features, treat as priority and default to "low" unless user pushes higher.',
        },
        sparte: {
          type: 'string',
          enum: [...SPARTEN],
          description: 'Insurance product family if known.',
        },
        type: {
          type: 'string',
          enum: ['bug', 'feature'],
          description: 'Ticket type. Default to "bug" if unclear; ask the user once if ambiguous.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_bug_report',
    description:
      'Create one ticket. Two ways to call this: (a) pass all fields inline (title/description/severity/type, optional sparte) — REQUIRED when creating multiple tickets in one turn (e.g. after decompose_transcript); (b) call with no args to use the in-memory draft built up via update_bug_draft (single-ticket conversational flow). When in doubt, pass fields inline — it is always safe.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'One-line summary (min 5 chars).' },
        description: {
          type: 'string',
          description: 'Steps to reproduce + expected vs actual for bugs; user goal + motivation for features (min 10 chars).',
        },
        severity: {
          type: 'string',
          enum: [...REPORT_SEVERITIES],
          description: 'blocker / high / medium / low. For features default to "low" unless user pushes higher.',
        },
        sparte: {
          type: 'string',
          enum: [...SPARTEN],
          description: 'Insurance product family if known.',
        },
        type: {
          type: 'string',
          enum: ['bug', 'feature'],
          description: 'Ticket type. Default to "bug" if unclear.',
        },
      },
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
      'Search the Jira ticket cache. Combines semantic similarity (when `query` is given) with optional filters (assignee, status, issueType, label, project, fixVersion). Returns up to `limit` results sorted by relevance. All filters are AND-ed.',
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
        fixVersion: {
          type: 'string',
          description: 'Fix version filter. Pass whatever fragment the user gave — usually just the date (e.g. "29.04.26", "15.09"). Do NOT add "Update" or any prefix; the LV team names versions "Update <date>" so a bare date matches via substring. Examples: "29.04.26" matches "Update 29.04.26"; "29.01" matches "Update 29.01.2025".',
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
      'Locate source files most likely related to a bug or feature description. Pass either a free-form query (preferred — works without a saved report) or a submitted reportId.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Free-form description (title + reproduction text) of what to localize. Use this when no reportId exists yet.',
        },
        sparte: {
          type: 'string',
          description: 'Optional sparte to scope the search.',
        },
        reportId: {
          type: 'string',
          description: 'UUID of a submitted bug report. If provided, takes precedence over query.',
        },
      },
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
  {
    name: 'validate_prefill',
    description:
      'Validate prefill JSON against the comparit Pool API schema. Use when the user pastes prefill data — JSON containing a `sparte` field or a `prefillData` wrapper.',
    input_schema: {
      type: 'object' as const,
      properties: {
        json: {
          type: 'string',
          description: 'The raw prefill JSON exactly as pasted by the user.',
        },
        sparte: {
          type: 'string',
          description:
            'Optional. Auto-detected from the JSON when omitted. Override only if the user explicitly says which Sparte.',
        },
        stage: {
          type: 'string',
          enum: ['live', 'qa', 'dev'],
          description:
            'Defaults to the session stage (qa unless overridden by /stage).',
        },
      },
      required: ['json'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_field_rule',
    description:
      'Look up validation rules for a Sparte field. Use when the user asks "what are the rules for X?", "what is allowed for Y?", or asks about specific German field names like Geburtsdatum, Versicherungssumme, Beitragszahlung, etc. Matches by field name, dotted path, or synonym (case-insensitive).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Field name or related term the user mentioned.',
        },
        sparte: {
          type: 'string',
          enum: ['Kfz', 'Bu', 'Rlv', 'Pr', 'Br', 'Gf', 'Hr', 'Wg', 'Kvv', 'Kvz', 'Phv'],
          description: 'Optional. Restrict results to one Sparte.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_field_synonym',
    description:
      'Add a synonym to an existing field rule. Use when the user explicitly asks to remember an alternate name for a field (e.g. "remember that DOB means Geburtsdatum").',
    input_schema: {
      type: 'object' as const,
      properties: {
        ruleId: {
          type: 'string',
          description: 'The rule UUID returned by lookup_field_rule.',
        },
        synonym: {
          type: 'string',
          description: 'The new synonym to add.',
        },
      },
      required: ['ruleId', 'synonym'],
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
    private readonly prefill: PrefillService,
    private readonly validationRules: ValidationRulesService,
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
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prefillAddendum(state.prefillStage ?? 'qa') },
        ],
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
          if (input['type'] === 'bug' || input['type'] === 'feature') {
            draft.type = input['type'];
          }
          return {
            nextState: { ...state, bugDraft: draft },
            message: `Draft updated: ${JSON.stringify(draft)}`,
            isError: false,
          };
        }

        case 'submit_bug_report': {
          // Inline-args path takes precedence over the draft buffer so the
          // agent can create multiple tickets in one turn with distinct
          // fields per call (e.g. after decompose_transcript).
          const inline = input as Partial<CopilotBugDraft>;
          const usingInline =
            typeof inline.title === 'string' || typeof inline.description === 'string';
          const fields: CopilotBugDraft = usingInline
            ? { ...(state.bugDraft ?? {}), ...inline }
            : { ...(state.bugDraft ?? {}) };

          if (!fields.title || fields.title.length < 5) {
            return { nextState: state, message: 'Cannot submit — title is missing or too short.', isError: true };
          }
          if (!fields.description || fields.description.length < 10) {
            return { nextState: state, message: 'Cannot submit — description is missing or too short.', isError: true };
          }
          if (!fields.severity) {
            return { nextState: state, message: 'Cannot submit — severity is required.', isError: true };
          }
          const reporterId = await findOrCreateReporter(this.db, ctx.userEmail);
          const ticketType = fields.type ?? 'bug';
          const [row] = await this.db
            .insert(bugReports)
            .values({
              reporterId,
              title: fields.title.trim(),
              description: fields.description.trim(),
              severity: fields.severity,
              sparte: fields.sparte as typeof bugReports.$inferInsert['sparte'] ?? null,
              type: ticketType,
              capturedContext: { copilotSessionId: ctx.sessionId },
            })
            .returning({ id: bugReports.id, status: bugReports.status, createdAt: bugReports.createdAt });
          await this.embedQueue.enqueueReportEmbedding(row.id);
          await this.triageQueue.enqueueReportTriage(row.id);
          const data = { reportId: row.id, title: fields.title, status: row.status, type: ticketType };
          // Only clear the draft buffer when it was actually used (no inline
          // args). Inline submissions don't touch the buffer so a parallel
          // single-ticket conversational flow stays intact.
          const nextDraft = usingInline ? state.bugDraft : undefined;
          return {
            nextState: { ...state, bugDraft: nextDraft, lastBugReportId: row.id },
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
          const fixVersion = typeof input['fixVersion'] === 'string' ? input['fixVersion'].trim() : '';
          const rawLimit = typeof input['limit'] === 'number' ? input['limit'] : 10;
          const limit = Math.min(25, Math.max(1, Math.floor(rawLimit)));

          if (!query && !status && !assignee && !issueType && !project && !label && !fixVersion) {
            return {
              nextState: state,
              message: 'Provide at least one of: query, status, assignee, issueType, project, label, fixVersion.',
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
          if (fixVersion) {
            // fix_versions is a jsonb array of {id, name}; check any element's
            // name field contains the substring (case-insensitive).
            conditions.push(sql`EXISTS (
              SELECT 1 FROM jsonb_array_elements(${ticketsCache.fixVersions}) AS fv
              WHERE fv->>'name' ILIKE ${'%' + fixVersion + '%'}
            )`);
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
            fixVersions: ticketsCache.fixVersions,
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
          if (!this.codeLocalizer) {
            return { nextState: state, message: 'Code localizer not available.', isError: true };
          }
          const reportId = String(input['reportId'] ?? '').trim();
          const query = String(input['query'] ?? '').trim();
          const sparte = (String(input['sparte'] ?? '').trim() || null) as
            | 'bu' | 'gf' | 'risikoleben' | 'kvv' | 'kvz' | 'hausrat'
            | 'phv' | 'wohngebaeude' | 'kfz' | 'basis_rente' | 'private_rente' | 'comparit'
            | null;
          if (!reportId && !query) {
            return { nextState: state, message: 'Provide either query or reportId', isError: true };
          }
          const result = reportId
            ? await this.codeLocalizer.localize(reportId)
            : await this.codeLocalizer.localizeFromText({ query, sparte });
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

        case 'validate_prefill': {
          const json = String(input['json'] ?? '');
          const sparte =
            typeof input['sparte'] === 'string' ? (input['sparte'] as string) : undefined;
          const reqStage =
            typeof input['stage'] === 'string'
              ? (input['stage'] as 'live' | 'qa' | 'dev')
              : undefined;
          try {
            const result = await this.prefill.validateForChat({
              json,
              sparte,
              stage: reqStage ?? state.prefillStage ?? 'qa',
            });
            const issues = [
              ...result.missingRequired.map((m) => ({
                kind: 'missing' as const,
                path: m.path,
              })),
              ...result.typeErrors.map((e) => ({
                kind: 'type' as const,
                path: e.path,
                message: e.message,
              })),
            ].slice(0, 20);
            return {
              nextState: state,
              toolData: result,
              message: JSON.stringify({
                valid: result.valid,
                sparte: result.sparte,
                stage: result.stage,
                schemaSource: result.schemaSource,
                missingCount: result.missingRequired.length,
                typeErrorCount: result.typeErrors.length,
                issues,
              }),
              isError: false,
            };
          } catch (err) {
            return {
              nextState: state,
              message: (err as Error).message,
              isError: true,
            };
          }
        }

        case 'lookup_field_rule': {
          const query = String(input['query'] ?? '');
          const sparteFilter =
            typeof input['sparte'] === 'string'
              ? (input['sparte'] as string)
              : undefined;
          const rules = await this.validationRules.lookup(query, sparteFilter);
          return {
            nextState: state,
            toolData: rules,
            message: JSON.stringify({
              count: rules.length,
              rules: rules.map((r) => ({
                id: r.id,
                sparte: r.sparte,
                label: r.label,
                humanRule: r.humanRule,
                enumValues: r.enumValues,
              })),
            }),
            isError: false,
          };
        }

        case 'add_field_synonym': {
          const ruleId = String(input['ruleId'] ?? '');
          const synonym = String(input['synonym'] ?? '');
          try {
            const updated = await this.validationRules.addSynonym(
              ruleId,
              synonym,
            );
            return {
              nextState: state,
              toolData: { ruleId: updated.id, synonyms: updated.synonyms },
              message: `Synonym "${synonym}" added to ${updated.label} (${updated.sparte}).`,
              isError: false,
            };
          } catch (err) {
            return {
              nextState: state,
              message: (err as Error).message,
              isError: true,
            };
          }
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
