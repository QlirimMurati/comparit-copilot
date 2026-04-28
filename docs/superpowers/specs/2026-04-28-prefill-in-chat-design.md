# Prefill Validation In Copilot Chat — Design

**Date:** 2026-04-28
**Status:** Draft (pending user review)
**Builds on:** `docs/superpowers/specs/2026-04-28-prefill-tab-integration-design.md`

## Goal

Extend the Comparit Copilot chat (the master agent at `apps/api/src/ai/copilot/`) so that when a user pastes prefill JSON into the chat, the agent automatically validates it against the comparit Pool API schema and reports issues conversationally — including missing required fields. Stage selection happens via a `/stage <live|qa|dev>` directive in chat; default is QA.

## Non-goals

- Changing the Prefill tab UI or its `validate()` behavior.
- Adding a stage toggle to the chat UI.
- Parallel validation of multiple JSON objects in one message (validate the first, mention the rest exists if relevant).
- Custom chat-side error-table rendering — output is conversational text.

## Decisions (locked from brainstorm)

| # | Decision |
|---|---|
| Trigger | **A — auto-detect.** System prompt teaches the agent: when a pasted message contains a JSON object with a `sparte` field or a `prefillData` wrapper, immediately call `validate_prefill`. |
| Missing fields | **B — chat-only missing detection.** Prefill tab `validate()` unchanged. Chat path uses a new `validateForChat()` that also reports missing required fields. |
| Stage default | Default `qa`. `/stage <live\|qa\|dev>` directive in chat persists the stage on the session for follow-ups. |
| Output | **A — conversational summary.** Agent paraphrases the structured tool result. Caps at 5 issues, offers "list the rest". |
| Implementation | **A — new `PrefillService.validateForChat()` method.** Wraps existing `validate()` and adds required-field walking. |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ apps/web (Copilot chat — unchanged template)                    │
│   user pastes JSON in chat input                                │
│                          │                                      │
│                          ▼ POST /api/copilot/sessions/:id/msg   │
├────────────────────────────────────────────────────────────────┤
│ apps/api/src/ai/copilot/                                        │
│   copilot.controller.ts                                         │
│     └─ pre-parses "/stage <live|qa|dev>"                        │
│        → updates session state.prefillStage                     │
│        → strips the directive from userText                     │
│        → if directive only, short-circuits with system reply    │
│                          │                                      │
│   copilot-agent.service.ts                                      │
│     ├─ SYSTEM_PROMPT augmented:                                 │
│     │    "When user pastes JSON containing a `sparte` field or  │
│     │     a `prefillData` wrapper, call validate_prefill        │
│     │     immediately. Current stage: <state.prefillStage>"     │
│     ├─ COPILOT_TOOLS gets `validate_prefill`                    │
│     └─ executeTool case → PrefillService.validateForChat()      │
│                          │                                      │
├────────────────────────────────────────────────────────────────┤
│ apps/api/src/prefill/                                           │
│   prefill.service.ts                                            │
│     ├─ validate(req)         (existing — Prefill tab)           │
│     └─ validateForChat(req)  (NEW)                              │
│         1. loadSchema(stage) with static fallback (reuse)       │
│         2. parseAndUnwrap → existing type errors                │
│         3. walk Swagger `required` arrays for missing fields    │
│         4. return { valid, typeErrors, missingRequired,         │
│                     fieldCount, stage, schemaSource, sparte }   │
└────────────────────────────────────────────────────────────────┘
```

## Backend changes

### `apps/api/src/prefill/lib/swagger-loader.ts`

Extend `LoadedSchema` to carry per-Sparte required arrays — top-level and a flat dotted-path map for nested objects:

```ts
export interface LoadedSchema {
  enums: Record<string, readonly string[]>;
  prefillSchemas: Record<
    string,
    {
      fields: Record<string, FieldDef>;
      required: string[];                    // top-level
      requiredByPath: Record<string, string[]>; // 'einstieg' -> ['typ','tarif'], etc.
    }
  >;
  loadedAt: number;
  stage: string;
}
```

The loader already holds the resolved SwaggerSchema for each `<Sparte>PrefillDataInput`. We persist `schema.required ?? []` on top-level, and recurse into nested object schemas (and their `allOf` parents) populating `requiredByPath` with dotted-path keys.

### `apps/api/src/prefill/lib/schema.ts` (static fallback)

The static `prefillSchemas` constant is extended with an empty `required: []` and `requiredByPath: {}` per sparte. We don't know required-field info from the static dump; the chat tool will skip the missing-required check when `schemaSource === 'static'` and note this in its result.

### `apps/api/src/prefill/prefill.types.ts`

```ts
export interface MissingField {
  path: string;
}

export interface ValidateForChatRequest {
  json: string;
  sparte?: string; // optional — auto-detected from JSON if omitted
  stage?: PrefillStage;
}

export interface ValidateForChatResponse {
  valid: boolean;
  typeErrors: ValidationError[];
  missingRequired: MissingField[];
  fieldCount: number;
  stage: PrefillStage;
  schemaSource: 'live' | 'static';
  sparte: string;
}
```

### `apps/api/src/prefill/prefill.service.ts`

Add `validateForChat(req: ValidateForChatRequest): Promise<ValidateForChatResponse>`:

1. Resolve sparte: `req.sparte ?? data.sparte ?? data.prefillData?.sparte`. If still unresolved, throw `BadRequestException('Could not detect sparte from input')`.
2. Resolve stage: `req.stage ?? 'qa'`.
3. Reuse the existing `loadSchema` + static-fallback path.
4. Reuse `parseAndUnwrap` to get the data object; reuse `validatePrefill` to compute `typeErrors`.
5. Compute `missingRequired`:
   - If `schemaSource === 'static'` → empty array.
   - Else: walk `prefillSchemas[sparte].required`. For each top-level required key absent from `data`, push `{ path: key }`.
   - For each entry in `requiredByPath`, descend into the matching path in `data`. If parent exists and child key is missing, push `{ path: 'parent.child' }`. (If parent is missing entirely, skip — already reported as a top-level miss.)
6. `valid = typeErrors.length === 0 && missingRequired.length === 0`.

### Tests in `prefill.service.spec.ts`

New `describe('PrefillService.validateForChat')`:

- Reports a top-level required field missing (`einstieg` absent from a Kfz payload).
- Reports a nested required field (`einstieg.typ`).
- Combines type errors + missing fields; `valid` true only when both empty.
- Returns empty `missingRequired` when `schemaSource === 'static'`.
- Auto-detects sparte from `data.sparte` and from `data.prefillData.sparte`.
- Throws `BadRequestException` when sparte cannot be resolved.

## Chat agent changes

### `apps/api/src/ai/copilot/copilot.types.ts`

Extend `CopilotState`:

```ts
export interface CopilotState {
  // … existing fields
  prefillStage?: 'live' | 'qa' | 'dev';
}
```

### `apps/api/src/ai/copilot/copilot.controller.ts`

Add a small helper at the top of the file:

```ts
const STAGE_DIRECTIVE = /^\s*\/stage\s+(live|qa|dev)\b/i;

export function extractStageDirective(text: string): {
  stage: 'live' | 'qa' | 'dev' | null;
  cleanedText: string;
} {
  const match = STAGE_DIRECTIVE.exec(text);
  if (!match) return { stage: null, cleanedText: text };
  const stage = match[1].toLowerCase() as 'live' | 'qa' | 'dev';
  const cleaned = text.replace(STAGE_DIRECTIVE, '').trim();
  return { stage, cleanedText: cleaned };
}
```

In the message-handler endpoint, before calling `agent.runStream`:

1. Call `extractStageDirective(userText)`.
2. If `stage` is set, persist it: `await sessions.setState(sessionId, { ...state, prefillStage: stage })`.
3. If `cleanedText` is empty, short-circuit:
   - Append a synthetic assistant message: `Stage set to <STAGE>. Paste prefill JSON to validate.`
   - Stream a single `text_delta` and `done` event with the same text — no Anthropic call.
4. Otherwise pass `cleanedText` (instead of the original `userText`) to `agent.runStream`.

### `apps/api/src/ai/copilot/copilot-agent.service.ts`

Three edits:

**1. System prompt addendum.** Compose the prompt at runtime using session state (the prompt already uses ephemeral cache control — adding session-state interpolation breaks the cache for the suffix only; we put the dynamic part at the very end so the static prefix stays cacheable):

```ts
const PREFILL_ADDENDUM = (stage: 'live' | 'qa' | 'dev') => `

PREFILL VALIDATION:
- When the user pastes JSON containing a \`sparte\` field or a \`prefillData\` wrapper, IMMEDIATELY call validate_prefill.
- Pass the pasted JSON verbatim as the \`json\` argument.
- Pass \`stage: "${stage}"\` (this is the active session stage).
- On result: write a conversational reply. Lead with missing required fields if any, then type errors. Cap the first reply at 5 issues; if there are more, end with "Want me to list the rest?".
- If the result has \`schemaSource: "static"\`, mention "(offline schema; required-field check skipped)".`;
```

`runStream` reads `state.prefillStage ?? 'qa'` and appends `PREFILL_ADDENDUM(stage)` to `SYSTEM_PROMPT` for that turn.

**2. New tool in `COPILOT_TOOLS`:**

```ts
{
  name: 'validate_prefill',
  description:
    'Validate prefill JSON against the comparit Pool API schema. Use when the user pastes prefill data (JSON with a `sparte` field or `prefillData` wrapper).',
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
        description: 'Defaults to the session stage (qa unless overridden by /stage).',
      },
    },
    required: ['json'],
    additionalProperties: false,
  },
},
```

**3. `executeTool` case `validate_prefill`:**

```ts
case 'validate_prefill': {
  const { json, sparte, stage } = input as { json: string; sparte?: string; stage?: 'live'|'qa'|'dev' };
  const result = await this.prefillService.validateForChat({
    json,
    sparte,
    stage: stage ?? state.prefillStage ?? 'qa',
  });
  return {
    nextState: state,
    toolData: result,
    message: JSON.stringify({
      valid: result.valid,
      sparte: result.sparte,
      stage: result.stage,
      schemaSource: result.schemaSource,
      typeErrorCount: result.typeErrors.length,
      missingCount: result.missingRequired.length,
      issues: [
        ...result.missingRequired.map((m) => ({ kind: 'missing', path: m.path })),
        ...result.typeErrors.map((e) => ({ kind: 'type', path: e.path, message: e.message })),
      ].slice(0, 20),
    }),
    isError: false,
  };
}
```

The tool result `message` is structured JSON the agent can read; `toolData` is the full structured result for the UI tool chip.

### `apps/api/src/ai/copilot/copilot.module.ts`

Add `PrefillModule` to imports so the service is injectable into `CopilotAgentService`. Inject `PrefillService` in the constructor.

## Frontend changes

None required for the chat to work — the agent's conversational reply carries the answer.

Optional polish (recommended): wherever the chat UI maps tool names to friendly labels, add `validate_prefill` → `"Validating prefill…"`.

## Error handling

| Case | Behavior |
|---|---|
| Pasted JSON with no `sparte` / `prefillData` | Agent does nothing (system prompt scopes auto-trigger). User can ask explicitly. |
| Trailing junk in pasted JSON | Reuses `parseAndUnwrap` — strips it. |
| Sparte unresolved | Tool returns `is_error: true` with "Could not detect sparte"; agent asks the user. |
| Invalid JSON | Tool returns `is_error: true` with parse error; agent paraphrases. |
| Live Swagger fetch fails | Static fallback; `schemaSource: 'static'`; `missingRequired` empty; agent notes the limitation. |
| `/stage live` then paste | Controller persists stage; agent sees current stage in prompt. |
| Two prefill JSONs in one message | Validates the first (existing `extractFirstJson` semantics). |
| `/stage` only, no other text | Controller short-circuits with "Stage set to <STAGE>." — no Anthropic call. |
| `/stage <invalid>` (e.g. `/stage prod`) | Regex doesn't match → treated as plain text. |

## Testing

### Backend

`apps/api/src/prefill/prefill.service.spec.ts` — add `describe('validateForChat')`:
- Top-level missing → `missingRequired` includes that path.
- Nested missing (`einstieg.typ`) → `missingRequired` includes the dotted path.
- Combined type + missing errors; `valid` only when both empty.
- `schemaSource === 'static'` → `missingRequired` empty.
- Auto-detect sparte from `data.sparte` and from `data.prefillData.sparte`.
- Throws `BadRequestException` when sparte cannot be resolved.

`apps/api/src/ai/copilot/copilot.controller.spec.ts` (new or extend existing): unit test for `extractStageDirective` covering `/stage qa`, `/stage LIVE`, `/stagger` (no match), `/stage qa some text` (cleanedText preserved). If the file does not exist, a small standalone unit test for the helper is acceptable.

`apps/api/src/ai/copilot/copilot-agent.service.spec.ts` (extend or create): mocks `PrefillService` and asserts the `validate_prefill` case calls `validateForChat` with the expected stage from session state.

### Manual smoke test

1. Start api + web. Open the copilot chat at `http://localhost:4240/copilot`.
2. Paste `{"sparte":"Kfz","einstieg":"oops"}` → expect a conversational reply that mentions missing required fields (e.g. "fahrzeug, versicherungsnehmer …") and the `einstieg` type error.
3. Type `/stage live` → expect a "Stage set to LIVE." reply.
4. Paste the same JSON again → reply now reflects LIVE schema state.
5. Type `/stage qa some other question` → expect the stage to update AND the agent to answer the question.

## Out of scope

- Custom chat-side error-table component.
- Stage toggle in chat UI.
- Validating multiple JSON objects per message.
- Persisting the stage across sessions (state is per-session today).
- Editing / re-prompting the static `schema.ts` to include `required` lists (would mean copying ~1000 more lines from the Pool API; live fetch covers this).
