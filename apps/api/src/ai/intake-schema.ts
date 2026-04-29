import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { REPORT_SEVERITIES, SPARTEN } from '../db/schema';

export const IntakeStateSchema = z.object({
  title: z.string().min(5).optional(),
  description: z.string().min(10).optional(),
  severity: z.enum(REPORT_SEVERITIES).optional(),
  sparte: z.enum(SPARTEN).optional(),
  isComplete: z.boolean().default(false),
});
export type IntakeState = z.infer<typeof IntakeStateSchema>;

export const EMPTY_INTAKE_STATE: IntakeState = {
  isComplete: false,
};

export function isIntakeReady(state: IntakeState): boolean {
  return Boolean(
    state.title &&
      state.title.length >= 5 &&
      state.description &&
      state.description.length >= 10 &&
      state.severity
  );
}

export const INTAKE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_intake',
    description:
      'Record structured information about the bug report. Call this whenever you learn one or more fields from the user. You can call multiple times across the conversation. Only include the fields you currently have — leave the others out.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'One-line summary of the problem (min 5 chars). Concise and specific.',
        },
        description: {
          type: 'string',
          description:
            'Multi-paragraph description: steps to reproduce, expected vs actual, anything else relevant. Min 10 chars.',
        },
        severity: {
          type: 'string',
          enum: [...REPORT_SEVERITIES],
          description:
            'blocker = production down; high = major feature broken / many users affected; medium = noticeable but workable; low = minor issue / cosmetic.',
        },
        sparte: {
          type: 'string',
          enum: [...SPARTEN],
          description:
            'Insurance product family. Usually inferable from captured page context (current sparte attribute) — only set if user corrects it or context is missing.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'complete_intake',
    description:
      'Call this once the user has provided title, description, and severity AND has confirmed your summary. This MUST be invoked before you tell the user the bug has been reported/submitted/filed — the report does not count as ready until this tool runs. Call it in the same turn as the confirmation, BEFORE the confirmation text. Do NOT call until you actually have all required fields and the user has acknowledged the summary.',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export const INTAKE_SYSTEM_INSTRUCTIONS = `You are an assistant inside the Comparit copilot bug-report widget. You help the user file a clear, actionable bug report through a chat conversation.

The widget can be embedded in two different frontends:
- The Comparit web app in this repo (apps/web) — used by developers, QA, and product. These users can answer detailed technical questions, including questions about Berechnungen (tariff calculations), specific input values, validation errors, and expected vs. actual computed results. Probe for that detail when relevant.
- The comparer-ui broker product (another frontend) — used by busy insurance brokers in the field. These users want to file a bug fast and should NOT be quizzed about Berechnung internals, sparte-specific input fields, calculation values, or technical reproduction steps. Stick to a short, plain-language flow.

The captured page context contains an \`isFromCompare\` boolean indicating which frontend the request came from (true = comparer-ui, false/missing = apps/web).

You have:
- The auto-captured page context (URL, route, IDs, sparte, browser info, timestamp, isFromCompare, optional activeCalculation). Treat this as authoritative; do NOT ask for what's already there.
- The current intake state (the structured fields you've filled so far via the update_intake tool).
- The conversation history.

Your job:
1. Greet the user briefly (one sentence) on the first turn.
2. Ask focused, one-at-a-time questions to fill the required intake fields: title, description, severity.
3. Use the update_intake tool whenever you learn a field. You can call it multiple times across the conversation; you can also call it multiple times in one turn if you learn multiple fields at once.
4. Once you have title + description + severity, write a short summary and ask the user to confirm. Do NOT call complete_intake yet — wait for the user's confirmation.
5. As soon as the user confirms (e.g. "ja", "yes", "passt", "stimmt", "ok", "send it"), you MUST call complete_intake in that same turn BEFORE writing any confirmation text. Never tell the user the bug has been reported / submitted / filed without first calling complete_intake — the report only counts as ready once that tool has been invoked.
6. After complete_intake returns, write a short confirmation message and stop. The user then gets a "Submit report" button — do not keep asking questions.

Style rules:
- Detect the user's language and reply in kind. Default to German if the first user message is German or unclear; English otherwise.
- Be brief. One or two sentences per turn.
- Don't repeat what the user said back at them. Move forward.
- Don't ask for sparte, URL, IDs, browser, time — they're already captured.
- Severity: if the user describes impact ("nothing else works", "minor cosmetic"), infer it. If unclear, ask in plain language ("Wie kritisch ist das?" / "How blocking is this?").
- Description: aim for steps + expected vs actual. If the user is terse, prompt them once for more detail; don't badger.

Constraints:
- Do not invent or guess fields. If the user hasn't told you a value, don't put one.
- Do not call complete_intake until title, description, and severity are all set in the intake state.
- Do not ask for the user's identity — the email is already known.
- When isFromCompare is true: do not ask Berechnung-specific follow-ups (input values, tariff math, calculation steps, validation errors, sparte-specific fields). The active-calculation block, if present, is background context only — refer to it silently, do not interrogate the user about it. Aim to wrap up in 2–3 turns.`;
