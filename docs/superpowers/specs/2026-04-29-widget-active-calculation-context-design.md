# Widget Active-Calculation Context — Design

**Date:** 2026-04-29
**Status:** Draft (pending user review)
**Spans:** `prototype-frontend` (libs/copilot-widget + each Sparte) and `comparit-copilot/apps/api` (intake agent prompt).

## Goal

Stop the in-app copilot widget from saying *"Ich habe darauf keinen Zugriff"* when a user inside a Sparte calculation asks about the active customer / form values. Capture the current Sparte's reactive-form state (and its visible validation errors) on every chat message, send it alongside the existing `capturedContext`, and have the api thread it into the intake agent's system prompt as authoritative context.

Concrete success criterion: while inside the BU sparte (`http://localhost:4201`) with a `Geburtsdatum` filled in, asking *"Wie alt ist mein Kunde laut den eingegebenen Daten?"* gets an answer based on the form value rather than the current "Ich habe keinen Zugriff" reply.

## Non-goals

- Per-message diffing — always send the full snapshot.
- Master copilot chat (`/copilot` page) enrichment — that surface doesn't have a per-Sparte form context.
- DOM scraping or console-error capture — the reactive-form values + `FormGroup.errors` are sufficient.
- PII redaction or a user-facing "context preview before send" UX (explicitly opted out — internal staff tool).
- New endpoint / DB schema change. Snapshot piggybacks on the existing `capturedContext` field.

## Decisions (locked from brainstorm)

| # | Decision |
|---|---|
| What to capture | **A** — active reactive-form values + per-control validation errors. |
| How each Sparte exposes its form | **A** — shared `CopilotContextService` in `libs/copilot-widget`. Each Sparte calls `register(formGroup, sparte)` once. |
| Privacy | **A** — full capture, no redaction (internal staff app). |
| When to capture | **A** — fresh snapshot on every chat message send. |
| How agent reads it | **A** — system-prompt addendum block (`ACTIVE-CALCULATION CONTEXT`). |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ prototype-frontend (per-Sparte component, e.g. apps/bu/.../bu)   │
│   ngOnInit() {                                                    │
│     this.copilotContext.register(this.grunddatenForm, 'bu');     │
│   }                                                               │
│   ngOnDestroy() { this.copilotContext.clear(); }                 │
│                              │                                    │
│                              ▼                                    │
│ libs/copilot-widget/                                              │
│   widget/copilot-context.service.ts        ← NEW                  │
│     register(formGroup, sparte)            ← stores latest        │
│     snapshot(): ContextSnapshot            ← reads form on demand │
│     clear()                                                       │
│   widget/widget-context.ts                                        │
│     existing baseCapture(...) extracted; new makeContextCapturer  │
│     factory injects CopilotContextService and adds                │
│     `activeCalculation` to CapturedContext                        │
│   widget/widget.types.ts                                          │
│     CapturedContext.activeCalculation?: ContextSnapshot \| null   │
│                              │                                    │
│                              ▼ POST /api/widget/chat/message      │
│                                { capturedContext:                 │
│                                  { ..., activeCalculation: {     │
│                                      sparte, values, errors,     │
│                                      capturedAt } } }            │
├──────────────────────────────────────────────────────────────────┤
│ comparit-copilot/apps/api/src/ai/intake-agent.service.ts          │
│   buildSystemPrompt(capturedContext) gains a second block when   │
│   activeCalculation is present:                                   │
│       ## ACTIVE-CALCULATION CONTEXT                               │
│       Sparte: <sparte>                                            │
│       Form values (JSON): { … }                                   │
│       Validation errors visible to the user:                      │
│         - <controlPath>: <error keys>                             │
│   No new endpoint, no DB change.                                  │
└──────────────────────────────────────────────────────────────────┘
```

Bug-report submissions (`POST /api/widget/reports`) get the same enrichment for free, since they share the same `capturedContext` capture path.

## Data shape

`libs/copilot-widget/src/lib/widget/copilot-context.service.ts` (new):

```ts
export interface FormErrorEntry {
  controlPath: string;        // 'kunde.geburtsdatum'
  errors: ValidationErrors;   // { required: true, minAge: { ... } }
}

export interface ContextSnapshot {
  sparte: CopilotSparte | null;
  values: Record<string, unknown>;     // FormGroup.getRawValue() — full nested tree
  errors: FormErrorEntry[];            // every invalid control, dotted path
  capturedAt: string;                   // ISO timestamp
}

@Injectable({ providedIn: 'root' })
export class CopilotContextService {
  private form: FormGroup | null = null;
  private sparte: CopilotSparte | null = null;
  register(form: FormGroup, sparte: CopilotSparte): void;
  snapshot(): ContextSnapshot;
  clear(): void;
}
```

`libs/copilot-widget/src/lib/widget/widget.types.ts` extension:

```ts
export interface CapturedContext {
  // … existing fields (url, pathname, ids, sparte, viewport, …)
  activeCalculation?: ContextSnapshot | null;
}
```

`apps/api/src/ai/intake-agent.service.ts` reads only:

```ts
interface ActiveCalc {
  sparte: string | null;
  values: Record<string, unknown>;
  errors: { controlPath: string; errors: Record<string, unknown> }[];
  capturedAt: string;
}
```

(structurally compatible with the frontend `ContextSnapshot`).

## Frontend changes (`prototype-frontend`)

### libs/copilot-widget

- **New** `widget/copilot-context.service.ts`:
  - `register(form, sparte)` — stores the latest registration.
  - `snapshot()` — calls `form.getRawValue()` plus a recursive walk that pushes invalid controls into `errors[]` with dotted-path keys. Recursion handles `FormGroup` (string-keyed) and `FormArray` (number-keyed) via the shared `.controls` shape.
  - `clear()` — drops the registration.
- **Modify** `widget/widget-context.ts` to:
  - Keep the existing `captureContext()` body as a private `baseCapture()`.
  - Add `makeContextCapturer()` factory that calls `inject(CopilotContextService)` (must be invoked from an injection context) and returns a closure that combines `baseCapture()` + `ctx.snapshot()` into the final `CapturedContext`.
  - `activeCalculation` is `null` when neither sparte nor any form values are present (so dashboard/index pages don't get noise).
- **Modify** `widget/widget.types.ts` to add `activeCalculation?: ContextSnapshot | null` to `CapturedContext`. Re-export `ContextSnapshot` and `FormErrorEntry` from the public barrel (`libs/copilot-widget/src/index.ts`).
- **Modify** `widget/widget.component.ts` to construct the capturer once in its constructor (where `inject()` is valid) and call the captured function on every `chatMessage`/`submit` send, replacing the static `captureContext()` import.
- **Public export** in `libs/copilot-widget/src/index.ts`:
  ```ts
  export * from './lib/widget/copilot-context.service';
  ```

### Per-Sparte registration

Each Sparte component injects the service and registers its root `FormGroup` once in `ngOnInit`, plus `clear()` in `ngOnDestroy`. The form already exists (used by the `*-grunddaten.service.ts`).

Affected files (one-line changes each):

```
apps/bu/src/app/components/bu.component.ts
apps/kfz/src/app/components/kfz.component.ts
apps/risikoleben/src/app/components/...
apps/private-rente/src/app/components/...
apps/basis-rente/src/app/components/...
apps/gf/src/app/components/...
apps/hausrat/src/app/components/...
apps/wohngebaeude/src/app/components/...
apps/kvv/src/app/components/...
apps/kvz/src/app/components/...
apps/phv/src/app/components/...
```

The plan ships **BU first** as the integration test, then duplicates the one-line registration in the other 10 sparten in a single follow-up commit.

## Backend changes (`comparit-copilot/apps/api`)

### `apps/api/src/ai/intake-agent.service.ts`

Extend `buildSystemPrompt(capturedContext)` (currently emits only the JSON dump under `## Captured page context`) to also append an `ACTIVE-CALCULATION CONTEXT` block when `capturedContext.activeCalculation` is present and non-empty.

```ts
function buildSystemPrompt(capturedContext: unknown): string {
  const blocks: string[] = [BASE_PROMPT];

  if (capturedContext) {
    blocks.push(
      `## Captured page context\n\`\`\`json\n${JSON.stringify(
        capturedContext,
        null,
        2,
      )}\n\`\`\``,
    );

    const active = (capturedContext as { activeCalculation?: ActiveCalc | null })
      .activeCalculation;
    if (
      active &&
      (active.sparte || Object.keys(active.values ?? {}).length > 0)
    ) {
      blocks.push(buildActiveCalcBlock(active));
    }
  }

  return blocks.join('\n\n');
}

function buildActiveCalcBlock(active: ActiveCalc): string {
  const errorLines = active.errors.length
    ? active.errors
        .map(
          (e) =>
            `  - ${e.controlPath}: ${Object.keys(e.errors).join(', ')}`,
        )
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
```

The explicit *"Do NOT say 'ich habe darauf keinen Zugriff'"* line is the cheapest reliable fix for the current failure mode.

### Scope: which agent?

This iteration touches **only the widget intake agent** (`intake-agent.service.ts`), reachable via `/api/widget/chat/...`. The master copilot chat (`copilot-agent.service.ts` at `/api/copilot/sessions/:id/message`, surfaced in the copilot web UI) does **not** receive form context today — different surface, no widget host. Leaving it untouched here.

## Edge cases

| Case | Behavior |
|---|---|
| User on `/dashboard` — no form registered | `activeCalculation: null`. Existing context-only behavior. |
| Sparte component destroyed mid-chat | Per-component `ngOnDestroy → clear()` resets the registration so the next `snapshot()` returns empty values, not stale data. |
| Nested `FormArray` (multiple insured persons) | `getRawValue()` returns nested arrays; `collectErrors()` recurses via `.controls`. |
| Form is initially invalid (required fields untouched) | Errors are reported honestly — agent can name the missing fields. |
| Two Sparten registered defensively | Last `register()` wins. Single-Sparte-at-a-time UX makes this a no-op in practice. |
| Date instances in form values | `JSON.stringify` calls `Date.prototype.toJSON()` → ISO string. |
| Snapshot size | A typical Sparte form is <2 KB serialized. Far below any token budget. |

## Testing

### Frontend (`libs/copilot-widget`)

- `widget/copilot-context.service.spec.ts` (new):
  - register + snapshot returns top-level values verbatim.
  - Nested `FormGroup` values appear under their dotted path; `errors[].controlPath` matches.
  - `FormArray` items recurse correctly with numeric keys.
  - `clear()` empties values + errors.
- `widget/widget-context.spec.ts` (extend existing): asserts `activeCalculation` is present when a form is registered, `null` otherwise.
- `apps/bu/src/app/components/bu.component.spec.ts` (light extension): instantiate the component, assert `CopilotContextService.register` is called with the grunddaten form.

### Backend (`comparit-copilot/apps/api`)

- `apps/api/src/ai/intake-agent.service.spec.ts` (extend): assert `buildSystemPrompt` includes the `ACTIVE-CALCULATION CONTEXT` heading when `capturedContext.activeCalculation` is non-empty, and omits it when null/empty.

### Manual smoke

1. Start prototype `apps/bu` (`http://localhost:4201`) + comparit-copilot api (`http://localhost:3000`).
2. Fill in `Geburtsdatum`, `Geschlecht`, etc. in the BU form.
3. Open the copilot widget chat.
4. Ask: *"Wie alt ist mein Kunde laut den eingegebenen Daten?"* — expect the agent to compute the age from `activeCalculation.values.geburtsdatum`.
5. Clear a required field. Ask: *"Was fehlt mir noch?"* — expect the agent to name the controls in `activeCalculation.errors`.
6. Navigate away from `/bu` (e.g. `/dashboard`). Open chat. Ask the same question — expect the previous "no access" answer (since `activeCalculation` is null), confirming `clear()` worked.

## Out of scope (deliberate)

- Master copilot chat enrichment.
- Per-message diffing.
- Network / console / breadcrumb capture (the existing `network-breadcrumb.service.ts` covers some of this; not coupled to this feature).
- PII redaction.
- "Preview before send" UX.
- A new persistence layer for snapshots (they live only in the agent's prompt context).
