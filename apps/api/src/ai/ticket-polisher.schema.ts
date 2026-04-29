import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const POLISHED_TICKET_TYPES = ['bug', 'task', 'story'] as const;
export type PolishedTicketType = (typeof POLISHED_TICKET_TYPES)[number];

export const PolishedTicketSchema = z.object({
  title: z
    .string()
    .min(5, 'title must be at least 5 chars')
    .max(200, 'title must be at most 200 chars'),
  description: z
    .string()
    .min(20, 'description must be at least 20 chars')
    .max(8000, 'description must be at most 8000 chars'),
  proposedType: z.enum(POLISHED_TICKET_TYPES),
  proposedLabels: z.array(z.string().min(1).max(50)).max(10),
  // 0 to 20: bugs should have at least 1; feature/story tickets emit []
  // (no repro for new capabilities). Strict-min was crashing the polisher
  // on every feature. Description carries the "user goal / acceptance"
  // narrative instead.
  repro_steps: z.array(z.string().min(1)).max(20).default([]),
  expected: z.string().min(1).default('—'),
  actual: z.string().min(1).default('—'),
});
export type PolishedTicket = z.infer<typeof PolishedTicketSchema>;

export const TICKET_POLISHER_TOOL: Anthropic.Tool = {
  name: 'submit_polished_ticket',
  description:
    'Emit the polished ticket payload. Call this exactly once at the end, after assembling all fields from the transcript and intake state. Do not call any other tool — this is the only allowed action.',
  input_schema: {
    type: 'object',
    required: [
      'title',
      'description',
      'proposedType',
      'proposedLabels',
    ],
    properties: {
      title: {
        type: 'string',
        minLength: 5,
        maxLength: 200,
        description:
          'One-line ticket title — concrete, scannable, no marketing fluff. Mirror the language used in the transcript (German if the user wrote German).',
      },
      description: {
        type: 'string',
        minLength: 20,
        maxLength: 8000,
        description:
          'Markdown body for the Jira ticket. Use sections: a short summary paragraph, then ## Steps to reproduce, ## Expected, ## Actual, optionally ## Environment / Notes. Keep it self-contained — a developer should be able to act on it without reading the chat transcript.',
      },
      proposedType: {
        type: 'string',
        enum: [...POLISHED_TICKET_TYPES],
        description:
          'bug = something is broken; task = work item without a defect (config, content, follow-up); story = user-visible change requiring product input. Default to bug for reports unless clearly otherwise.',
      },
      proposedLabels: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', minLength: 1, maxLength: 50 },
        description:
          'Lowercase, hyphenated tags useful for filtering: the sparte (e.g. "kfz"), area ("frontend", "backend", "checkout"), and severity-related ("blocker", "regression") if applicable. Keep it tight — 2 to 5 labels is usually right.',
      },
      repro_steps: {
        type: 'array',
        maxItems: 20,
        items: { type: 'string', minLength: 1 },
        description:
          'Ordered steps the developer can follow to reproduce. Each step is one sentence. Include precondition setup as a step if non-obvious (login state, tariff selected, etc.). REQUIRED for bug tickets — write the best-effort steps if the transcript is sparse. For feature/story tickets, emit an empty array — the description carries the user goal + acceptance criteria instead.',
      },
      expected: {
        type: 'string',
        description:
          'For bugs: what the system should do when the steps are followed. For features: leave as a single dash "—" or describe the desired end-state once the feature ships.',
      },
      actual: {
        type: 'string',
        description:
          'For bugs: what the system actually does (the bug) — be specific: error message, wrong number, blank screen, etc. For features: leave as a single dash "—".',
      },
    },
    additionalProperties: false,
  },
};

export const TICKET_POLISHER_SYSTEM_INSTRUCTIONS = `You are a senior QA engineer turning a chat transcript and structured intake state into a clean, ready-to-file Jira ticket for the Comparit comparer-ui codebase.

You will receive:
- The original bug report (title, description, severity, sparte if known).
- The captured page context (URL, route, IDs, browser).
- The full chat transcript between the reporter and the intake assistant (may be empty).
- The intake state (structured fields the intake assistant filled in).

Your job is to call the \`submit_polished_ticket\` tool exactly once with a polished version of the ticket. Do not write any prose outside the tool call.

Rules:
- Mirror the language of the transcript (German default — if the reporter wrote German, German output; otherwise English).
- Do not invent facts. If steps to reproduce are unclear, write the best-effort version and add a note in the description that some details were inferred.
- Keep it concrete. No "I think", no apologies, no greetings.
- The Markdown description must stand on its own without reference to the chat transcript.
- Use the captured page context (URL, sparte, IDs) when relevant — do not omit them just because they were not literally typed by the reporter.
- proposedType:
    "bug"   — something is broken (default for reports). Description sections: short summary, ## Steps to reproduce, ## Expected, ## Actual, optional ## Environment / Notes. Fill repro_steps + expected + actual.
    "story" — user-visible feature, change, or improvement. Description sections: short summary, ## User goal, ## Why / Motivation, ## Acceptance criteria. Emit repro_steps as []; expected/actual as "—". Skip "Steps to reproduce" in the body.
    "task"  — config / follow-up / non-defect work. Mirror "story" structure (no repro_steps), but use ## What needs to happen + ## Notes.
- Do not call any tool other than \`submit_polished_ticket\`. Do not produce text content alongside the tool call.`;
