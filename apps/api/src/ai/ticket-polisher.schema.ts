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
          'One-line ticket title — concrete, scannable, no marketing fluff. Always in English, even if the transcript is in German or another language.',
      },
      description: {
        type: 'string',
        minLength: 20,
        maxLength: 8000,
        description:
          'Body for the Jira ticket. Format with bold section labels followed by bullet lists. Do NOT use Markdown headers (##) or blockquotes (>). Sections: a short summary paragraph, then **Steps to reproduce:** (numbered or "- " bullets), **Expected:**, **Actual:**, **Acceptance criteria:** ("- " bullets, one per criterion), optional **Environment / Notes:**. Keep it self-contained — a developer should be able to act on it without reading the chat transcript.',
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

# CRITICAL: OUTPUT LANGUAGE IS ENGLISH (overrides everything below)

The polished Jira ticket is ALWAYS written in English, no matter what language the reporter, transcript, or original bug-report fields are in. This is non-negotiable.

- title → English. Translate German / French / Italian / any other source on the fly.
- description → English. All prose, all section labels, all bullets. The fixed section labels are: **Steps to reproduce:**, **Expected:**, **Actual:**, **Acceptance criteria:**, **User goal:**, **Why / Motivation:**, **What needs to happen:**, **Notes:**, **Environment / Notes:**.
- repro_steps[] → English sentences.
- expected, actual → English.
- proposedLabels → already English (lowercase tags).

Translate, don't transliterate. "Klick auf Senden passiert nichts" → "Clicking the Submit button does nothing", not "Klick on Senden happens nothing".

KEEP AS-IS (do NOT translate):
- Sparte codes (BU, KFZ, GF, …), route paths (/bu/antrag), product names (Cpit.App, Comparit), URLs, IDs.
- Error messages quoted verbatim from logs / network errors — wrap in backticks.
- Identifiers from the user (Tarif names, field names like "Beruf & Risiken" if used as a UI element name — quote it).

If you ever produce a non-English title or description, you have made a mistake — start over and translate.

You will receive:
- The original bug report (title, description, severity, sparte if known).
- The captured page context (URL, route, IDs, browser).
- The full chat transcript between the reporter and the intake assistant (may be empty).
- The intake state (structured fields the intake assistant filled in).

Your job is to call the \`submit_polished_ticket\` tool exactly once with a polished version of the ticket. Do not write any prose outside the tool call.

Rules:
- Do not invent facts. If steps to reproduce are unclear, write the best-effort version and add a note in the description that some details were inferred.
- Keep it concrete. No "I think", no apologies, no greetings.
- The Markdown description must stand on its own without reference to the chat transcript.
- Use the captured page context (URL, sparte, IDs) when relevant — do not omit them just because they were not literally typed by the reporter.
- proposedType:
    "bug"   — something is broken (default for reports). Description sections (use **bold labels + "- " bullets**, never ## headers or > quotes):
              short summary paragraph,
              **Steps to reproduce:** ("- " bullets, one per step),
              **Expected:**, **Actual:** (one short bullet or sentence each),
              **Acceptance criteria:** ("- " bullets — what does "fixed" look like; written as testable statements),
              optional **Environment / Notes:**.
              Fill repro_steps + expected + actual.
    "story" — user-visible feature, change, or improvement. Description sections (bold labels + bullets):
              short summary paragraph,
              **User goal:**, **Why / Motivation:**,
              **Acceptance criteria:** ("- " bullets, one per criterion).
              Emit repro_steps as []; expected/actual as "—".
    "task"  — config / follow-up / non-defect work. Mirror "story" structure (no repro_steps), but use **What needs to happen:** and **Notes:** instead of user-goal sections. Always include **Acceptance criteria:** bullets.
- The description must NOT contain "##", "###", or "> " — use bold labels and "- " bullets so it renders as readable bullets in Jira and the chat widget.
- Do not call any tool other than \`submit_polished_ticket\`. Do not produce text content alongside the tool call.`;
