# Prefill Validation In Copilot Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Add a `validate_prefill` tool to the Copilot chat agent so pasted prefill JSON is auto-validated (including missing-required-field detection), with stage selection via a `/stage <live|qa|dev>` directive (default `qa`).

**Architecture:** Extend the existing `PrefillModule` with a chat-flavored `validateForChat()` that adds missing-required walking on top of the existing `validate()`. Wire `PrefillModule` into `CopilotModule`; add a new tool to the agent's `COPILOT_TOOLS` array; pre-parse `/stage` in `CopilotController` and persist on session state; append a small per-turn addendum to the system prompt that tells the agent the active stage.

**Tech Stack:** NestJS 10, Anthropic SDK (`@anthropic-ai/sdk`), Drizzle for session state, Jest + `@nestjs/testing`.

**Spec:** `docs/superpowers/specs/2026-04-28-prefill-in-chat-design.md`.

**Implementation refinement vs spec:** the spec proposes adding `required: []` to the static `schema.ts` fallback. We do this **structurally** instead — only the live `LoadedSchema` carries `required` / `requiredByPath`. When `validateForChat` falls back to the static source, `missingRequired` is reported as empty and the agent's reply mentions the limitation. Net effect: identical behavior, no changes to the 1120-line static `schema.ts` file.

**Conventions to follow (verified in repo):**
- Existing chat agent file: `apps/api/src/ai/copilot/copilot-agent.service.ts` — agentic loop with `Anthropic.Tool[]` and an `executeTool` switch.
- Tool result protocol: `{ nextState, message, toolData?, isError }` (see `update_bug_draft` / `submit_bug_report`).
- Session state persisted via `CopilotSessionService.setState`; current `CopilotState` interface in `copilot.types.ts`.
- Controller pattern: `apps/api/src/ai/copilot/copilot.controller.ts`, `POST /copilot/sessions/:id/message`, JWT-guarded, streams SSE via `agent.runStream`.

---

## Task 1: Extend swagger-loader to capture required arrays

**Files:**
- Modify: `apps/api/src/prefill/lib/swagger-loader.ts`

- [ ] **Step 1: Update the `LoadedSchema` interface to include required + nested required**

Replace lines 39–44 of `apps/api/src/prefill/lib/swagger-loader.ts`:

```ts
export interface LoadedSchema {
  enums: Record<string, readonly string[]>;
  prefillSchemas: Record<
    string,
    {
      fields: Record<string, FieldDef>;
      required: string[];
      requiredByPath: Record<string, string[]>;
    }
  >;
  loadedAt: number;
  stage: string;
}
```

- [ ] **Step 2: Add a helper that walks a SwaggerSchema and collects required dotted paths**

Insert this after the `convertProperties` function (around line 152) in `apps/api/src/prefill/lib/swagger-loader.ts`:

```ts
function collectRequiredByPath(
  schema: SwaggerSchema,
  allSchemas: Record<string, SwaggerSchema>,
  prefix: string,
  out: Record<string, string[]>,
): void {
  const props = { ...(schema.properties ?? {}) };
  const requiredHere = [...(schema.required ?? [])];

  if (schema.allOf) {
    for (const part of schema.allOf) {
      if (part.$ref) {
        const resolved = resolveRef(part.$ref, allSchemas);
        Object.assign(props, resolved.properties ?? {});
        for (const r of resolved.required ?? []) requiredHere.push(r);
      } else {
        Object.assign(props, part.properties ?? {});
        for (const r of part.required ?? []) requiredHere.push(r);
      }
    }
  }

  if (prefix && requiredHere.length > 0) {
    out[prefix] = Array.from(new Set(requiredHere));
  }

  for (const [key, prop] of Object.entries(props)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    let target: SwaggerSchema | null = null;
    if (prop.$ref) {
      const resolved = resolveRef(prop.$ref, allSchemas);
      if (resolved.type === 'object' || resolved.properties || resolved.allOf) {
        target = resolved;
      }
    } else if (prop.type === 'object' && (prop.properties || prop.allOf)) {
      target = prop;
    }
    if (target) {
      collectRequiredByPath(target, allSchemas, nextPath, out);
    }
  }
}
```

- [ ] **Step 3: Populate `required` + `requiredByPath` inside `loadSchema`**

In `apps/api/src/prefill/lib/swagger-loader.ts`, replace the per-Sparte loop near the bottom of `loadSchema` (around lines 178–187) with:

```ts
  // Extract prefill schemas per sparte
  const prefillSchemas: Record<
    string,
    {
      fields: Record<string, FieldDef>;
      required: string[];
      requiredByPath: Record<string, string[]>;
    }
  > = {};
  for (const [sparte, prefix] of Object.entries(sparteToSchemaName)) {
    const schemaName = `${prefix}PrefillDataInput`;
    const schema = allSchemas[schemaName];
    if (!schema) continue;

    const requiredByPath: Record<string, string[]> = {};
    collectRequiredByPath(schema, allSchemas, '', requiredByPath);

    prefillSchemas[sparte] = {
      fields: convertProperties(schema, allSchemas),
      required: Array.from(new Set(schema.required ?? [])),
      requiredByPath,
    };
  }
```

- [ ] **Step 4: Build to verify compilation**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/lib/swagger-loader.ts
git commit -m "feat(prefill): expose required + requiredByPath on LoadedSchema"
```

---

## Task 2: Add ValidateForChat types

**Files:**
- Modify: `apps/api/src/prefill/prefill.types.ts`

- [ ] **Step 1: Append new interfaces**

Add to `apps/api/src/prefill/prefill.types.ts`:

```ts
export interface MissingField {
  path: string;
}

export interface ValidateForChatRequest {
  json: string;
  sparte?: string;
  stage?: PrefillStage;
}

export interface ValidateForChatResponse {
  valid: boolean;
  typeErrors: import('./lib/validator').ValidationError[];
  missingRequired: MissingField[];
  fieldCount: number;
  stage: PrefillStage;
  schemaSource: 'live' | 'static';
  sparte: string;
}
```

- [ ] **Step 2: Build to confirm**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.types.ts
git commit -m "feat(prefill): types for validateForChat"
```

---

## Task 3: validateForChat happy-path test + minimal implementation

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.ts`
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/prefill/prefill.service.spec.ts`:

```ts
describe('PrefillService.validateForChat', () => {
  function liveSchemaMock() {
    return {
      stage: 'live' as const,
      loadedAt: Date.now(),
      enums: { KfzNutzungstypEnum: ['Privat', 'Gewerblich'] },
      prefillSchemas: {
        Kfz: {
          fields: {
            sparte: { type: 'string', nullable: false },
            einstieg: {
              type: 'object',
              nullable: false,
              objectSchema: {
                typ: { type: 'string', nullable: false },
                tarif: { type: 'string', nullable: false },
              },
            },
            fahrzeug: { type: 'object', nullable: false },
          },
          required: ['einstieg', 'fahrzeug'],
          requiredByPath: { einstieg: ['typ', 'tarif'] },
        },
      },
    };
  }

  async function build(): Promise<PrefillService> {
    const moduleRef = await Test.createTestingModule({
      providers: [PrefillService],
    }).compile();
    return moduleRef.get(PrefillService);
  }

  beforeEach(() => {
    jest.spyOn(swaggerLoader, 'loadSchema').mockResolvedValue(liveSchemaMock());
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns valid: true when nothing is missing and types match', async () => {
    const svc = await build();
    const json = JSON.stringify({
      sparte: 'Kfz',
      einstieg: { typ: 'A', tarif: 'B' },
      fahrzeug: {},
    });
    const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
    expect(result.valid).toBe(true);
    expect(result.typeErrors).toEqual([]);
    expect(result.missingRequired).toEqual([]);
    expect(result.sparte).toBe('Kfz');
    expect(result.stage).toBe('live');
    expect(result.schemaSource).toBe('live');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -15`
Expected: FAIL — "svc.validateForChat is not a function".

- [ ] **Step 3: Add `validateForChat` to `PrefillService`**

Append the method to `apps/api/src/prefill/prefill.service.ts` (inside the class, after `validate`):

```ts
async validateForChat(
  req: ValidateForChatRequest,
): Promise<ValidateForChatResponse> {
  const stage: PrefillStage = req.stage ?? 'qa';

  let cleanJson: string;
  let data: Record<string, unknown>;
  try {
    cleanJson = extractFirstJson(req.json);
    data = parseAndUnwrap(req.json);
  } catch {
    throw new BadRequestException(
      'Invalid JSON — could not extract a valid JSON object from the input',
    );
  }
  void cleanJson; // not surfaced on chat response

  const detected =
    req.sparte ??
    (typeof data['sparte'] === 'string' ? (data['sparte'] as string) : undefined) ??
    (typeof (data['prefillData'] as { sparte?: unknown } | undefined)?.sparte ===
    'string'
      ? ((data['prefillData'] as { sparte: string }).sparte)
      : undefined);
  if (!detected) {
    throw new BadRequestException('Could not detect sparte from input');
  }

  let liveSource:
    | { enums: typeof staticEnums; prefillSchemas: Record<string, { fields: Record<string, unknown>; required?: string[]; requiredByPath?: Record<string, string[]> }> }
    | null = null;
  let schemaSource: 'live' | 'static' = 'live';
  try {
    const loaded = await loadSchema(stage);
    liveSource = {
      enums: loaded.enums as typeof staticEnums,
      prefillSchemas: loaded.prefillSchemas,
    };
  } catch (err) {
    this.logger.warn(
      `Live schema load failed for stage=${stage}; using static fallback. ${
        (err as Error).message
      }`,
    );
    schemaSource = 'static';
  }

  const sourceForValidator = liveSource ?? {
    enums: staticEnums,
    prefillSchemas: staticPrefillSchemas,
  };

  if (!sourceForValidator.prefillSchemas[detected]) {
    throw new BadRequestException(
      `Unknown sparte "${detected}". Valid: ${Object.keys(
        sourceForValidator.prefillSchemas,
      ).join(', ')}`,
    );
  }

  const typeErrors = validatePrefill(
    detected,
    data,
    sourceForValidator as { enums: typeof staticEnums; prefillSchemas: typeof staticPrefillSchemas },
  );

  const missingRequired: MissingField[] = [];
  if (schemaSource === 'live' && liveSource) {
    const sparteSchema = liveSource.prefillSchemas[detected];
    const topRequired = sparteSchema.required ?? [];
    for (const key of topRequired) {
      if (data[key] === undefined || data[key] === null) {
        missingRequired.push({ path: key });
      }
    }
    const nested = sparteSchema.requiredByPath ?? {};
    for (const [parentPath, keys] of Object.entries(nested)) {
      const parent = getByPath(data, parentPath);
      if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
        const obj = parent as Record<string, unknown>;
        for (const k of keys) {
          if (obj[k] === undefined || obj[k] === null) {
            missingRequired.push({ path: `${parentPath}.${k}` });
          }
        }
      }
    }
  }

  return {
    valid: typeErrors.length === 0 && missingRequired.length === 0,
    typeErrors,
    missingRequired,
    fieldCount: Object.keys(data).length,
    stage,
    schemaSource,
    sparte: detected,
  };
}
```

Add the helper at the bottom of the file (outside the class):

```ts
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
```

Add the new imports at the top of `apps/api/src/prefill/prefill.service.ts`:

```ts
import type {
  MissingField,
  PrefillStage,
  SparteOption,
  ValidateForChatRequest,
  ValidateForChatResponse,
  ValidateRequest,
  ValidateResponse,
} from './prefill.types';
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -15`
Expected: All passing — 7 total (6 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.ts apps/api/src/prefill/prefill.service.spec.ts
git commit -m "feat(prefill): validateForChat happy path with required-field walk"
```

---

## Task 4: validateForChat — missing-required tests (top-level + nested)

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append inside `describe('PrefillService.validateForChat', ...)` block:

```ts
it('reports a missing top-level required field', async () => {
  const svc = await build();
  const json = JSON.stringify({ sparte: 'Kfz', fahrzeug: {} }); // einstieg missing
  const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
  expect(result.valid).toBe(false);
  expect(result.missingRequired).toEqual([{ path: 'einstieg' }]);
});

it('reports nested missing required fields when parent is present', async () => {
  const svc = await build();
  const json = JSON.stringify({
    sparte: 'Kfz',
    einstieg: { typ: 'A' }, // tarif missing
    fahrzeug: {},
  });
  const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
  expect(result.valid).toBe(false);
  expect(result.missingRequired).toEqual([{ path: 'einstieg.tarif' }]);
});

it('does not double-report nested when parent itself is missing', async () => {
  const svc = await build();
  const json = JSON.stringify({ sparte: 'Kfz', fahrzeug: {} }); // einstieg missing → only top-level miss
  const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
  const paths = result.missingRequired.map((m) => m.path);
  expect(paths).toContain('einstieg');
  expect(paths).not.toContain('einstieg.typ');
  expect(paths).not.toContain('einstieg.tarif');
});
```

- [ ] **Step 2: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -15`
Expected: 10 total passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.spec.ts
git commit -m "test(prefill): cover missing top-level + nested required"
```

---

## Task 5: validateForChat — sparte auto-detect + unresolved tests

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Add the tests**

Append inside the same describe block:

```ts
it('auto-detects sparte from data.sparte when not passed', async () => {
  const svc = await build();
  const json = JSON.stringify({
    sparte: 'Kfz',
    einstieg: { typ: 'A', tarif: 'B' },
    fahrzeug: {},
  });
  const result = await svc.validateForChat({ json, stage: 'live' });
  expect(result.sparte).toBe('Kfz');
});

it('auto-detects sparte from data.prefillData.sparte', async () => {
  const svc = await build();
  const json = JSON.stringify({
    sparte: 'Kfz',
    prefillData: {
      sparte: 'Kfz',
      einstieg: { typ: 'A', tarif: 'B' },
      fahrzeug: {},
    },
  });
  const result = await svc.validateForChat({ json, stage: 'live' });
  expect(result.sparte).toBe('Kfz');
});

it('throws BadRequestException when sparte cannot be resolved', async () => {
  const svc = await build();
  const json = JSON.stringify({ einstieg: {} });
  await expect(
    svc.validateForChat({ json, stage: 'live' }),
  ).rejects.toThrow(/Could not detect sparte/);
});
```

- [ ] **Step 2: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -15`
Expected: 13 total passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.spec.ts
git commit -m "test(prefill): cover sparte auto-detect and unresolved"
```

---

## Task 6: validateForChat — static-fallback test

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Add the test**

Append inside the same describe block:

```ts
it('returns empty missingRequired when falling back to static schema', async () => {
  jest
    .spyOn(swaggerLoader, 'loadSchema')
    .mockRejectedValue(new Error('network down'));
  const svc = await build();
  const json = JSON.stringify({ sparte: 'Kfz' });
  const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'qa' });
  expect(result.schemaSource).toBe('static');
  expect(result.missingRequired).toEqual([]);
  expect(result.stage).toBe('qa');
});

it('combines type errors and missing required (valid is false)', async () => {
  const svc = await build();
  const json = JSON.stringify({
    sparte: 'Kfz',
    einstieg: 'not-an-object', // type error
    // fahrzeug missing
  });
  const result = await svc.validateForChat({ json, sparte: 'Kfz', stage: 'live' });
  expect(result.valid).toBe(false);
  expect(result.typeErrors.length).toBeGreaterThan(0);
  expect(result.missingRequired.map((m) => m.path)).toContain('fahrzeug');
});
```

- [ ] **Step 2: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -15`
Expected: 15 total passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.spec.ts
git commit -m "test(prefill): cover static-fallback and combined errors"
```

---

## Task 7: extractStageDirective helper + tests

**Files:**
- Create: `apps/api/src/ai/copilot/stage-directive.ts`
- Create: `apps/api/src/ai/copilot/stage-directive.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/ai/copilot/stage-directive.spec.ts`:

```ts
import { extractStageDirective } from './stage-directive';

describe('extractStageDirective', () => {
  it('parses /stage qa as { stage: "qa", cleanedText: "" }', () => {
    expect(extractStageDirective('/stage qa')).toEqual({
      stage: 'qa',
      cleanedText: '',
    });
  });

  it('is case-insensitive', () => {
    expect(extractStageDirective('/Stage LIVE')).toEqual({
      stage: 'live',
      cleanedText: '',
    });
  });

  it('keeps trailing question text', () => {
    expect(extractStageDirective('/stage live what about Kfz?')).toEqual({
      stage: 'live',
      cleanedText: 'what about Kfz?',
    });
  });

  it('returns null when no directive', () => {
    expect(extractStageDirective('paste this prefill')).toEqual({
      stage: null,
      cleanedText: 'paste this prefill',
    });
  });

  it('does not match /stagger', () => {
    expect(extractStageDirective('/stagger qa')).toEqual({
      stage: null,
      cleanedText: '/stagger qa',
    });
  });

  it('rejects unknown stage values', () => {
    expect(extractStageDirective('/stage prod')).toEqual({
      stage: null,
      cleanedText: '/stage prod',
    });
  });

  it('only strips a leading directive', () => {
    expect(extractStageDirective('hello /stage qa')).toEqual({
      stage: null,
      cleanedText: 'hello /stage qa',
    });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="stage-directive" 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './stage-directive'".

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/ai/copilot/stage-directive.ts`:

```ts
const STAGE_DIRECTIVE = /^\s*\/stage\s+(live|qa|dev)\b\s*/i;

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

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="stage-directive" 2>&1 | tail -10`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/stage-directive.ts apps/api/src/ai/copilot/stage-directive.spec.ts
git commit -m "feat(copilot): /stage directive parser"
```

---

## Task 8: Add prefillStage to CopilotState

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot.types.ts`

- [ ] **Step 1: Extend `CopilotState`**

In `apps/api/src/ai/copilot/copilot.types.ts`, replace the `CopilotState` interface (lines 8–12) with:

```ts
export interface CopilotState {
  bugDraft?: CopilotBugDraft;
  lastBugReportId?: string;
  lastTranscriptId?: string;
  prefillStage?: 'live' | 'qa' | 'dev';
}
```

- [ ] **Step 2: Build to confirm**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot.types.ts
git commit -m "feat(copilot): prefillStage in CopilotState"
```

---

## Task 9: Wire stage parsing into copilot.controller.ts

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot.controller.ts`

- [ ] **Step 1: Add the import**

Add to the imports of `apps/api/src/ai/copilot/copilot.controller.ts`:

```ts
import { extractStageDirective } from './stage-directive';
import type { CopilotState } from './copilot.types';
```

- [ ] **Step 2: Pre-parse and short-circuit before `runStream`**

Replace the body of `message(...)` between the `flushHeaders()` call and the `try` block (around lines 104–119) with:

```ts
    const write = (event: CopilotStreamEvent): void => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const userText = body.text.trim();
    const { stage: directiveStage, cleanedText } = extractStageDirective(userText);

    if (directiveStage) {
      const currentState = (session.state as CopilotState | null) ?? {};
      await this.sessions.setState(id, { ...currentState, prefillStage: directiveStage });
    }

    if (directiveStage && cleanedText.length === 0) {
      const ackText = `Stage set to ${directiveStage.toUpperCase()}. Paste prefill JSON to validate.`;
      await this.sessions.appendMessage({
        sessionId: id,
        role: 'user',
        content: userText,
      });
      await this.sessions.appendMessage({
        sessionId: id,
        role: 'assistant',
        content: [{ type: 'text', text: ackText }],
      });
      write({ type: 'text_delta', text: ackText });
      write({ type: 'done', stopReason: 'stage_directive' });
      res.end();
      return;
    }

    try {
      for await (const event of this.agent.runStream({
        sessionId: id,
        userId: req.user.id,
        userEmail: req.user.email,
        userText: cleanedText.length > 0 ? cleanedText : userText,
      })) {
        write(event);
      }
    } catch (err) {
      this.logger.error(`runStream failed: ${(err as Error).message}`, (err as Error).stack);
      write({ type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
```

- [ ] **Step 3: Build and check for type errors**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -10`
Expected: Build succeeds. (`session.state` is `unknown`, the cast handles it.)

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot.controller.ts
git commit -m "feat(copilot): pre-parse /stage directive before agent invocation"
```

---

## Task 10: Wire PrefillModule into CopilotModule + inject service

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot.module.ts`
- Modify: `apps/api/src/ai/copilot/copilot-agent.service.ts`

- [ ] **Step 1: Add PrefillModule import**

Edit `apps/api/src/ai/copilot/copilot.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AiModule } from '../ai.module';
import { AuthModule } from '../../auth/auth.module';
import { IndexModule } from '../../index/index.module';
import { JiraModule } from '../../jira/jira.module';
import { PrefillModule } from '../../prefill/prefill.module';
import { CopilotAgentService } from './copilot-agent.service';
import { CopilotController } from './copilot.controller';
import { CopilotSessionService } from './copilot-session.service';

@Module({
  imports: [AuthModule, AiModule, IndexModule, JiraModule, PrefillModule],
  controllers: [CopilotController],
  providers: [CopilotAgentService, CopilotSessionService],
})
export class CopilotModule {}
```

- [ ] **Step 2: Inject PrefillService into the agent**

In `apps/api/src/ai/copilot/copilot-agent.service.ts`, add the import (top of file):

```ts
import { PrefillService } from '../../prefill/prefill.service';
```

Update the constructor (around lines 160–170) to add the new dependency at the end of the parameter list:

```ts
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly anthropic: AnthropicService,
    private readonly sessions: CopilotSessionService,
    private readonly dedup: DedupService,
    private readonly embedQueue: EmbedQueueService,
    private readonly triageQueue: TriageQueueService,
    private readonly voyage: VoyageService,
    private readonly prefill: PrefillService,
    @Optional() private readonly codeLocalizer?: CodeLocalizerService,
    @Optional() private readonly transcriptDecomposer?: TranscriptDecomposerService
  ) {}
```

- [ ] **Step 3: Build**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -10`
Expected: Build succeeds. (Nest will wire PrefillService via PrefillModule.)

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot.module.ts apps/api/src/ai/copilot/copilot-agent.service.ts
git commit -m "feat(copilot): inject PrefillService into the agent"
```

---

## Task 11: Add validate_prefill tool to COPILOT_TOOLS

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot-agent.service.ts`

- [ ] **Step 1: Append the tool to `COPILOT_TOOLS`**

Inside `apps/api/src/ai/copilot/copilot-agent.service.ts`, append a new entry to the `COPILOT_TOOLS: Anthropic.Tool[]` array (just before its closing `];`, currently around line 154):

```ts
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
```

- [ ] **Step 2: Build**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds. (No runtime change yet — the agent won't be told to use it until Task 12.)

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot-agent.service.ts
git commit -m "feat(copilot): declare validate_prefill tool"
```

---

## Task 12: Per-turn system-prompt addendum with active stage

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot-agent.service.ts`

- [ ] **Step 1: Add the addendum builder**

Insert near the top of `apps/api/src/ai/copilot/copilot-agent.service.ts`, right after the existing `SYSTEM_PROMPT` constant:

```ts
function prefillAddendum(stage: 'live' | 'qa' | 'dev'): string {
  return `\n\nPREFILL VALIDATION:
- When the user pastes JSON containing a \`sparte\` field or a \`prefillData\` wrapper, IMMEDIATELY call validate_prefill.
- Pass the pasted JSON verbatim as the \`json\` argument.
- Pass \`stage: "${stage}"\` (this is the active session stage).
- On result: write a conversational reply. Lead with missing required fields if any, then type errors. Cap the first reply at 5 issues; if there are more, end with "Want me to list the rest?".
- If the result has \`schemaSource: "static"\`, mention "(offline schema; required-field check skipped)".`;
}
```

- [ ] **Step 2: Pass it as a second `system` block per turn**

In `runStream`, locate the `messages.stream(...)` call (around line 213) and replace its `system:` field. Originally:

```ts
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
```

Change to:

```ts
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prefillAddendum(state.prefillStage ?? 'qa') },
        ],
```

This keeps the static prompt cacheable (the prefix block) while letting the dynamic addendum vary per turn.

- [ ] **Step 3: Build**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot-agent.service.ts
git commit -m "feat(copilot): inject prefill addendum with active stage per turn"
```

---

## Task 13: executeTool case for validate_prefill

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot-agent.service.ts`

- [ ] **Step 1: Append the case**

Inside the `executeTool` switch (around line 297), add a new case (before the `default:` if any, or anywhere — switch cases are unordered logically):

```ts
        case 'validate_prefill': {
          const json = String(input['json'] ?? '');
          const sparte =
            typeof input['sparte'] === 'string' ? (input['sparte'] as string) : undefined;
          const stage =
            typeof input['stage'] === 'string'
              ? (input['stage'] as 'live' | 'qa' | 'dev')
              : undefined;
          try {
            const result = await this.prefill.validateForChat({
              json,
              sparte,
              stage: stage ?? state.prefillStage ?? 'qa',
            });
            const issues = [
              ...result.missingRequired.map((m) => ({ kind: 'missing' as const, path: m.path })),
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
```

- [ ] **Step 2: Build**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot-agent.service.ts
git commit -m "feat(copilot): execute validate_prefill via PrefillService"
```

---

## Task 14a: Frontend tool-chip label

**Files:**
- Modify: `apps/web/src/app/pages/copilot/copilot.component.ts`

- [ ] **Step 1: Add `validate_prefill` to the labels map**

In `apps/web/src/app/pages/copilot/copilot.component.ts`, find the `toolLabel` method (around line 210) and add an entry to the labels object:

```ts
  protected toolLabel(name: string): string {
    const labels: Record<string, string> = {
      update_bug_draft: 'Updating bug draft…',
      submit_bug_report: 'Creating bug report…',
      check_duplicates: 'Checking for duplicates…',
      search_jira: 'Searching Jira…',
      find_affected_code: 'Locating affected code…',
      decompose_transcript: 'Decomposing transcript…',
      validate_prefill: 'Validating prefill…',
    };
    return labels[name] ?? `Running ${name}…`;
  }
```

- [ ] **Step 2: Build web**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build web 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/pages/copilot/copilot.component.ts
git commit -m "feat(copilot/web): friendly label for validate_prefill tool chip"
```

---

## Task 14: Backend lint + full tests

- [ ] **Step 1: Lint api**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx lint api 2>&1 | tail -10`
Expected: No new errors. Pre-existing warnings are acceptable.

- [ ] **Step 2: Full api test run**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api 2>&1 | tail -15`
Expected: All tests pass. (Existing 77 + ~9 new = ~86, exact count may vary.)

- [ ] **Step 3: Build api**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: No commit unless follow-up fixes were needed.**

---

## Task 15: Manual smoke test

- [ ] **Step 1: Start api + web (if not already running)**

Run (in separate terminals):
```bash
cd /Users/dp/Sources/comparit-copilot && pnpm start:api
cd /Users/dp/Sources/comparit-copilot && pnpm start:web
```

- [ ] **Step 2: Open http://localhost:4240/copilot in a browser, log in, start a new chat session**

- [ ] **Step 3: Auto-detect happy path**

Paste in chat: `{"sparte":"Kfz","einstieg":"oops"}`.
Expected: Tool chip "Validating prefill…" (or generic), then a conversational assistant reply that mentions:
- Missing required fields (some of `fahrzeug`, `versicherungsnehmer`, etc. depending on the QA Pool API)
- The `einstieg` should-be-object type error.
- A reference to the active stage ("on QA").

- [ ] **Step 4: /stage directive only**

Paste in chat: `/stage live`.
Expected: A short assistant reply "Stage set to LIVE. Paste prefill JSON to validate." — no tool chip, no Anthropic call (controller short-circuits).

- [ ] **Step 5: Repeat paste against LIVE**

Paste again: `{"sparte":"Kfz","einstieg":"oops"}`.
Expected: Reply now mentions LIVE schema state. The agent's reply should reflect a LIVE-tagged validation.

- [ ] **Step 6: Combined directive + question**

Paste: `/stage qa what's missing in {"sparte":"Kfz","einstieg":"oops"}`.
Expected: Stage flips back to QA, agent answers the question and validates the embedded JSON.

- [ ] **Step 7: Plain non-prefill JSON should NOT auto-validate**

Paste: `{"foo":"bar"}`.
Expected: Agent does NOT call validate_prefill (no `sparte` field, no `prefillData` wrapper) — replies normally.

- [ ] **Step 8: Plain text should not trigger anything**

Paste: `hi how are you?`.
Expected: Standard chat reply.

- [ ] **Step 9: No commit (smoke-test only).**

---

## Done

The Copilot chat now auto-validates pasted prefill JSON against the live Pool schema, reports missing required fields, and lets the user switch stage with `/stage <live|qa|dev>` (default `qa`). Prefill tab behavior is unchanged.
