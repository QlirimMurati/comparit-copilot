# Widget Active-Calculation Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the active Sparte's reactive-form values + visible validation errors on every chat message, ship them via the existing `capturedContext` channel, and have the intake agent treat them as authoritative context (so it stops saying *"Ich habe darauf keinen Zugriff"*).

**Architecture:** New `CopilotContextService` in `libs/copilot-widget` registered by each Sparte component; the widget's existing capture path reads a fresh snapshot on each chat send and packs it into `capturedContext.activeCalculation`; the api's `intake-agent.service.ts` system-prompt builder gains an `ACTIVE-CALCULATION CONTEXT` block when the field is present.

**Tech Stack:** Angular 19 reactive forms, NestJS + Anthropic SDK, Jest.

**Spec:** `docs/superpowers/specs/2026-04-29-widget-active-calculation-context-design.md`.

**Conventions verified in repo:**
- `prototype-frontend/libs/copilot-widget/src/lib/widget/widget-context.ts` exports `captureContext(input)`. Called once from `widget.component.ts:140` inside `toggle()`.
- `widget.types.ts:35` defines `CapturedContext`. Public barrel at `libs/copilot-widget/src/index.ts`.
- `comparit-copilot/apps/api/src/ai/intake-agent.service.ts:320` builds the `Captured page context` JSON block as a third `TextBlockParam` inside `buildSystemBlocks(...)`.
- The api uses Jest with `Test.createTestingModule` (see `prefill.service.spec.ts` for a recent example).

**Two repositories are touched.** All file paths below are absolute. Commits land in two repos with their own histories.

---

## Task 1: `CopilotContextService` — class + tests

**Repo:** `prototype-frontend`

**Files:**
- Create: `libs/copilot-widget/src/lib/widget/copilot-context.service.ts`
- Create: `libs/copilot-widget/src/lib/widget/copilot-context.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/lib/widget/copilot-context.service.spec.ts`:

```ts
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { CopilotContextService } from './copilot-context.service';

describe('CopilotContextService', () => {
  let svc: CopilotContextService;

  beforeEach(() => {
    svc = new CopilotContextService();
  });

  it('snapshot() returns empty when no form registered', () => {
    const snap = svc.snapshot();
    expect(snap.sparte).toBeNull();
    expect(snap.values).toEqual({});
    expect(snap.errors).toEqual([]);
    expect(typeof snap.capturedAt).toBe('string');
  });

  it('captures top-level values verbatim', () => {
    const form = new FormGroup({
      geburtsdatum: new FormControl('1990-05-12'),
      geschlecht: new FormControl('weiblich'),
    });
    svc.register(form, 'bu');
    const snap = svc.snapshot();
    expect(snap.sparte).toBe('bu');
    expect(snap.values).toEqual({
      geburtsdatum: '1990-05-12',
      geschlecht: 'weiblich',
    });
  });

  it('captures nested FormGroup values under dotted paths', () => {
    const form = new FormGroup({
      kunde: new FormGroup({
        geburtsdatum: new FormControl('1990-05-12'),
      }),
    });
    svc.register(form, 'bu');
    expect(svc.snapshot().values).toEqual({
      kunde: { geburtsdatum: '1990-05-12' },
    });
  });

  it('reports control-level validation errors with dotted controlPath', () => {
    const form = new FormGroup({
      kunde: new FormGroup({
        geburtsdatum: new FormControl('', Validators.required),
      }),
    });
    svc.register(form, 'bu');
    const snap = svc.snapshot();
    expect(snap.errors).toContainEqual({
      controlPath: 'kunde.geburtsdatum',
      errors: { required: true },
    });
  });

  it('recurses through FormArray with numeric keys', () => {
    const form = new FormGroup({
      personen: new FormArray([
        new FormGroup({ alter: new FormControl(30) }),
        new FormGroup({ alter: new FormControl('', Validators.required) }),
      ]),
    });
    svc.register(form, 'bu');
    const snap = svc.snapshot();
    expect(snap.values).toEqual({
      personen: [{ alter: 30 }, { alter: '' }],
    });
    expect(snap.errors).toContainEqual({
      controlPath: 'personen.1.alter',
      errors: { required: true },
    });
  });

  it('clear() drops registration', () => {
    const form = new FormGroup({ x: new FormControl('y') });
    svc.register(form, 'bu');
    svc.clear();
    const snap = svc.snapshot();
    expect(snap.sparte).toBeNull();
    expect(snap.values).toEqual({});
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx test copilot-widget --testPathPattern="copilot-context.service.spec" 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './copilot-context.service'".

- [ ] **Step 3: Implement the service**

Create `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/lib/widget/copilot-context.service.ts`:

```ts
import { Injectable } from '@angular/core';
import type {
  AbstractControl,
  FormGroup,
  ValidationErrors,
} from '@angular/forms';
import type { CopilotSparte } from '../sparte-detect';

export interface FormErrorEntry {
  controlPath: string;
  errors: ValidationErrors;
}

export interface ContextSnapshot {
  sparte: CopilotSparte | null;
  values: Record<string, unknown>;
  errors: FormErrorEntry[];
  capturedAt: string;
}

@Injectable({ providedIn: 'root' })
export class CopilotContextService {
  private form: FormGroup | null = null;
  private sparte: CopilotSparte | null = null;

  register(form: FormGroup, sparte: CopilotSparte): void {
    this.form = form;
    this.sparte = sparte;
  }

  clear(): void {
    this.form = null;
    this.sparte = null;
  }

  snapshot(): ContextSnapshot {
    const values =
      this.form && typeof this.form.getRawValue === 'function'
        ? (this.form.getRawValue() as Record<string, unknown>)
        : {};
    const errors: FormErrorEntry[] = [];
    if (this.form) {
      collectErrors(this.form, '', errors);
    }
    return {
      sparte: this.sparte,
      values,
      errors,
      capturedAt: new Date().toISOString(),
    };
  }
}

function collectErrors(
  control: AbstractControl,
  path: string,
  out: FormErrorEntry[],
): void {
  if (control.errors) {
    out.push({ controlPath: path || '(root)', errors: control.errors });
  }
  const c = control as unknown as {
    controls?: Record<string, AbstractControl> | AbstractControl[];
  };
  const ctrls = c.controls;
  if (!ctrls) return;
  if (Array.isArray(ctrls)) {
    ctrls.forEach((child, i) => {
      const next = path ? `${path}.${i}` : String(i);
      collectErrors(child, next, out);
    });
  } else {
    for (const [key, child] of Object.entries(ctrls)) {
      const next = path ? `${path}.${key}` : key;
      collectErrors(child, next, out);
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx test copilot-widget --testPathPattern="copilot-context.service.spec" 2>&1 | tail -10`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/prototype-frontend
git add libs/copilot-widget/src/lib/widget/copilot-context.service.ts libs/copilot-widget/src/lib/widget/copilot-context.service.spec.ts
git commit -m "feat(copilot-widget): CopilotContextService with form-state + errors snapshot"
```

---

## Task 2: Export the service + extend `CapturedContext`

**Repo:** `prototype-frontend`

**Files:**
- Modify: `libs/copilot-widget/src/index.ts`
- Modify: `libs/copilot-widget/src/lib/widget/widget.types.ts`

- [ ] **Step 1: Add the public export**

Append to `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/index.ts`:

```ts
export * from './lib/widget/copilot-context.service';
```

- [ ] **Step 2: Extend `CapturedContext` to carry the snapshot**

Edit `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/lib/widget/widget.types.ts`. Add the import at the top of the file (next to other imports — adjust if there's already an existing import block):

```ts
import type { ContextSnapshot } from './copilot-context.service';
```

Find the `CapturedContext` interface (line 35). Append the new field before the closing brace:

Replace this block:

```ts
  consoleErrors?: ConsoleError[];
  networkErrors?: NetworkError[];
  storeSnapshot?: unknown;
  screenshot?: string;
}
```

With:

```ts
  consoleErrors?: ConsoleError[];
  networkErrors?: NetworkError[];
  storeSnapshot?: unknown;
  screenshot?: string;
  activeCalculation?: ContextSnapshot | null;
}
```

- [ ] **Step 3: Build the lib to confirm**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx build copilot-widget 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/prototype-frontend
git add libs/copilot-widget/src/index.ts libs/copilot-widget/src/lib/widget/widget.types.ts
git commit -m "feat(copilot-widget): export CopilotContextService + add CapturedContext.activeCalculation"
```

---

## Task 3: Wire snapshot into `widget-context.ts`

**Repo:** `prototype-frontend`

**Files:**
- Modify: `libs/copilot-widget/src/lib/widget/widget-context.ts`
- Modify: `libs/copilot-widget/src/lib/widget/widget-context.spec.ts`

- [ ] **Step 1: Refactor `captureContext` to accept an optional snapshot — add the failing test first**

Append to `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/lib/widget/widget-context.spec.ts` (file already exists):

```ts
describe('captureContext with activeCalculation', () => {
  it('passes activeCalculation through when snapshot has values', () => {
    const ctx = captureContext({
      sparte: 'bu',
      activeCalculation: {
        sparte: 'bu',
        values: { geburtsdatum: '1990-05-12' },
        errors: [],
        capturedAt: '2026-04-29T00:00:00.000Z',
      },
    });
    expect(ctx.activeCalculation).toEqual({
      sparte: 'bu',
      values: { geburtsdatum: '1990-05-12' },
      errors: [],
      capturedAt: '2026-04-29T00:00:00.000Z',
    });
  });

  it('omits activeCalculation when snapshot is null', () => {
    const ctx = captureContext({ sparte: 'bu', activeCalculation: null });
    expect(ctx.activeCalculation).toBeNull();
  });

  it('omits activeCalculation when snapshot is empty (no sparte, no values)', () => {
    const ctx = captureContext({
      sparte: null,
      activeCalculation: {
        sparte: null,
        values: {},
        errors: [],
        capturedAt: '2026-04-29T00:00:00.000Z',
      },
    });
    expect(ctx.activeCalculation).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx test copilot-widget --testPathPattern="widget-context.spec" 2>&1 | tail -10`
Expected: FAIL — "Argument of type ... is not assignable" or similar (the new field doesn't exist on `CaptureInputs` yet).

- [ ] **Step 3: Extend `CaptureInputs` and pass through**

Edit `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/lib/widget/widget-context.ts`. Replace the entire file with:

```ts
import type { ContextSnapshot } from './copilot-context.service';
import type { CapturedContext, WidgetSparte } from './widget.types';

export interface CaptureInputs {
  sparte?: WidgetSparte | null;
  appVersion?: string | null;
  reporterEmail?: string | null;
  activeCalculation?: ContextSnapshot | null;
}

const ID_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'vergleichId',
    re: /\/vergleich\/([^/?#]+)|vergleich(?:_id|Id)=([^&]+)/i,
  },
  { name: 'tarifId', re: /\/tarif\/([^/?#]+)|tarif(?:_id|Id)=([^&]+)/i },
  { name: 'antragId', re: /\/antrag\/([^/?#]+)|antrag(?:_id|Id)=([^&]+)/i },
  { name: 'kundeId', re: /\/kunde\/([^/?#]+)|kunde(?:_id|Id)=([^&]+)/i },
];

export function captureContext(input: CaptureInputs = {}): CapturedContext {
  const url = window.location.href;
  const ids: Record<string, string> = {};
  for (const p of ID_PATTERNS) {
    const m = url.match(p.re);
    const value = m ? (m[1] ?? m[2]) : null;
    if (value) ids[p.name] = decodeURIComponent(value);
  }

  const calc = input.activeCalculation ?? null;
  const calcIsEmpty =
    !calc ||
    (!calc.sparte &&
      Object.keys(calc.values ?? {}).length === 0 &&
      (calc.errors ?? []).length === 0);

  return {
    url,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    ids,
    sparte: input.sparte ?? null,
    appVersion: input.appVersion ?? null,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    timestamp: new Date().toISOString(),
    referrer: document.referrer,
    reporterEmail: input.reporterEmail ?? null,
    activeCalculation: calcIsEmpty ? null : calc,
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx test copilot-widget --testPathPattern="widget-context.spec" 2>&1 | tail -10`
Expected: All passing (existing tests + 3 new = 4+).

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/prototype-frontend
git add libs/copilot-widget/src/lib/widget/widget-context.ts libs/copilot-widget/src/lib/widget/widget-context.spec.ts
git commit -m "feat(copilot-widget): captureContext accepts activeCalculation snapshot"
```

---

## Task 4: Inject `CopilotContextService` in widget component, snapshot on every send

**Repo:** `prototype-frontend`

**Files:**
- Modify: `libs/copilot-widget/src/lib/widget/widget.component.ts`

- [ ] **Step 1: Add the import + injection**

Edit `/Users/dp/Sources/prototype-frontend/libs/copilot-widget/src/lib/widget/widget.component.ts`. Find the existing import line for `widget-context` (line 12) and add a sibling import:

```ts
import { CopilotContextService } from './copilot-context.service';
```

Find the component class. Add an injected field near the other `inject(...)` calls in the class (place it next to existing private DI fields):

```ts
  private readonly copilotContext = inject(CopilotContextService);
```

If the file doesn't already have `inject` imported from `@angular/core`, add it to the existing `@angular/core` import.

- [ ] **Step 2: Update the existing `captureContext({...})` call sites to include `activeCalculation`**

Find every call to `captureContext({` in this file. There is currently one (around line 140) inside `toggle()`. Update it to:

```ts
      this.capturedContext.set(
        captureContext({
          sparte: this.sparte,
          appVersion: this.appVersion,
          reporterEmail: this.reporterEmail,
          activeCalculation: this.copilotContext.snapshot(),
        })
      );
```

- [ ] **Step 3: Refresh on every chat send**

The widget already re-runs `captureContext` indirectly via `enrichCaptured(this.capturedContext())` — but that doesn't refresh the form snapshot. Patch the chat-send path:

Find the method that sends a chat message (look for `chatMessage(` or where `chatMessageStream` is invoked — typically inside an `onSubmit`/`send` method. Identify the line that reads `this.capturedContext()`).

Just before sending, refresh the captured context:

Locate the line `const enriched = this.enrichCaptured(this.capturedContext());` (around line 251). Replace with:

```ts
    // Refresh form snapshot so each chat message carries the latest state.
    this.capturedContext.set(
      captureContext({
        sparte: this.sparte,
        appVersion: this.appVersion,
        reporterEmail: this.reporterEmail,
        activeCalculation: this.copilotContext.snapshot(),
      })
    );
    const enriched = this.enrichCaptured(this.capturedContext());
```

- [ ] **Step 4: Build to confirm**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx build copilot-widget 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/prototype-frontend
git add libs/copilot-widget/src/lib/widget/widget.component.ts
git commit -m "feat(copilot-widget): refresh form snapshot on every chat send"
```

---

## Task 5: Register form in BU sparte (integration anchor)

**Repo:** `prototype-frontend`

**Files:**
- Modify: `apps/bu/src/app/components/bu.component.ts`

- [ ] **Step 1: Locate the root form**

Run: `grep -nE "FormGroup|form\s*=|grunddatenForm|grunddaten\.form" /Users/dp/Sources/prototype-frontend/apps/bu/src/app/components/bu.component.ts | head`
Expected: at least one line referencing the BU root form (e.g. `this.grunddatenForm`, or `this.buGrunddatenService.form`). Note the field name.

- [ ] **Step 2: Add the import + registration**

Edit `/Users/dp/Sources/prototype-frontend/apps/bu/src/app/components/bu.component.ts`. Add the import near the existing `@comparit/copilot-widget` import (already present per `grep` results from earlier):

```ts
import {
  CopilotBugWidgetComponent,
  CopilotContextService,
} from '@comparit/copilot-widget';
```

Add the inject in the class (alongside other `private readonly ... = inject(...)` lines):

```ts
  private readonly copilotContext = inject(CopilotContextService);
```

In `ngOnInit` (or constructor if there's no `ngOnInit`), register the form. Use the field name discovered in Step 1. If the form lives on a service (e.g. `this.buGrunddatenService.form`), use that. Example for the common shape:

```ts
  ngOnInit(): void {
    // … existing init body
    this.copilotContext.register(this.grunddatenForm, 'bu');
  }
```

Add the cleanup hook. If the class doesn't already implement `OnDestroy`, add it to the class signature and the `@angular/core` import:

```ts
import { Component, OnDestroy, OnInit, inject } from '@angular/core';

export class BuComponent implements OnInit, OnDestroy {
  // …
  ngOnDestroy(): void {
    this.copilotContext.clear();
  }
}
```

- [ ] **Step 3: Build the BU app to verify**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx build bu 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/prototype-frontend
git add apps/bu/src/app/components/bu.component.ts
git commit -m "feat(bu): register grunddaten form with CopilotContextService"
```

---

## Task 6: Backend — extend intake-agent system prompt builder

**Repo:** `comparit-copilot`

**Files:**
- Modify: `apps/api/src/ai/intake-agent.service.ts`

- [ ] **Step 1: Add the active-calculation block helpers**

Edit `/Users/dp/Sources/comparit-copilot/apps/api/src/ai/intake-agent.service.ts`. Add this helper near the top of the file, after the existing `import` block and before the `@Injectable()` decorator:

```ts
interface ActiveCalc {
  sparte: string | null;
  values: Record<string, unknown>;
  errors: { controlPath: string; errors: Record<string, unknown> }[];
  capturedAt: string;
}

function buildActiveCalcBlock(active: ActiveCalc): string {
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
```

- [ ] **Step 2: Insert the new prompt block in `buildSystemBlocks`**

Find `buildSystemBlocks(...)` (around line 320). Replace the final `blocks.push({...captured page context...})` call with:

```ts
    blocks.push({
      type: 'text',
      text:
        `## Captured page context\n\`\`\`json\n${JSON.stringify(capturedContext, null, 2)}\n\`\`\`\n\n` +
        `## Current intake state\n\`\`\`json\n${JSON.stringify(intakeState, null, 2)}\n\`\`\``,
    });

    const active = (capturedContext as { activeCalculation?: ActiveCalc | null } | null)
      ?.activeCalculation;
    if (
      active &&
      (active.sparte || Object.keys(active.values ?? {}).length > 0 || (active.errors ?? []).length > 0)
    ) {
      blocks.push({
        type: 'text',
        text: buildActiveCalcBlock(active),
      });
    }

    return blocks;
```

- [ ] **Step 3: Build the api**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/intake-agent.service.ts
git commit -m "feat(intake-agent): inject ACTIVE-CALCULATION CONTEXT prompt block when capturedContext.activeCalculation is set"
```

---

## Task 7: Backend — test the prompt builder

**Repo:** `comparit-copilot`

**Files:**
- Modify: `apps/api/src/ai/intake-agent.service.spec.ts` (extend existing) **OR** Create: `apps/api/src/ai/intake-agent-prompt.spec.ts`

- [ ] **Step 1: Check whether a spec exists**

Run: `ls /Users/dp/Sources/comparit-copilot/apps/api/src/ai/intake-agent.service.spec.ts 2>&1`
- If it exists → extend it.
- If it does not exist → create a focused new spec for the prompt builder.

- [ ] **Step 2: Make `buildSystemBlocks` and `buildActiveCalcBlock` testable**

If `buildActiveCalcBlock` is already top-level (per Task 6 step 1), it's directly importable. Add a one-line export to the file:

In `apps/api/src/ai/intake-agent.service.ts`, change

```ts
function buildActiveCalcBlock(active: ActiveCalc): string {
```

to

```ts
export function buildActiveCalcBlock(active: ActiveCalc): string {
```

and add `export type { ActiveCalc };` after the interface declaration (so the spec can type test fixtures).

- [ ] **Step 3: Write the test**

Create `/Users/dp/Sources/comparit-copilot/apps/api/src/ai/intake-agent-prompt.spec.ts` (skip if extending `intake-agent.service.spec.ts` — adapt the imports accordingly):

```ts
import { buildActiveCalcBlock } from './intake-agent.service';

describe('buildActiveCalcBlock', () => {
  it('renders sparte, values, and errors', () => {
    const text = buildActiveCalcBlock({
      sparte: 'bu',
      values: { geburtsdatum: '1990-05-12' },
      errors: [
        { controlPath: 'beruf', errors: { required: true } },
      ],
      capturedAt: '2026-04-29T00:00:00.000Z',
    });
    expect(text).toContain('## ACTIVE-CALCULATION CONTEXT');
    expect(text).toContain('AUTHORITATIVE');
    expect(text).toContain('Do NOT say "ich habe darauf keinen Zugriff"');
    expect(text).toContain('Sparte: bu');
    expect(text).toContain('"geburtsdatum": "1990-05-12"');
    expect(text).toContain('- beruf: required');
  });

  it('shows "(none)" when no errors are present', () => {
    const text = buildActiveCalcBlock({
      sparte: 'bu',
      values: {},
      errors: [],
      capturedAt: '2026-04-29T00:00:00.000Z',
    });
    expect(text).toContain('Validation errors visible to the user:\n  (none)');
  });
});
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="intake-agent-prompt" 2>&1 | tail -10`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/intake-agent.service.ts apps/api/src/ai/intake-agent-prompt.spec.ts
git commit -m "test(intake-agent): cover ACTIVE-CALCULATION CONTEXT block formatting"
```

---

## Task 8: End-to-end smoke (BU only)

**Repos:** both

- [ ] **Step 1: Restart the api with the new prompt builder**

Run:
```bash
cd /Users/dp/Sources/comparit-copilot
pkill -9 -f "nx serve api" 2>/dev/null; lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 2
pnpm start:api > /tmp/api-active-calc.log 2>&1 &
until curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do sleep 2; done
echo "api up"
```
Expected: api on port 3000 ready.

- [ ] **Step 2: Restart the BU sparte**

Run:
```bash
cd /Users/dp/Sources/prototype-frontend
pkill -9 -f "nx run bu:serve" 2>/dev/null; lsof -ti:4201 | xargs kill -9 2>/dev/null
sleep 2
pnpm start:bu > /tmp/bu-active-calc.log 2>&1 &
until curl -sf http://localhost:4201 > /dev/null 2>&1; do sleep 3; done
echo "bu up"
```
Expected: BU on port 4201 ready.

- [ ] **Step 3: Manual chat smoke**

In a browser:
1. Open `http://localhost:4201`.
2. Navigate into the BU calculator. Fill `Geburtsdatum`, `Geschlecht`, and a few other fields.
3. Open the embedded copilot widget chat (icon at bottom-right of the page).
4. Ask: *"Wie alt ist mein Kunde laut den eingegebenen Daten?"*
   Expected: assistant reads `geburtsdatum` and answers with the age (no "ich habe darauf keinen Zugriff").
5. Clear a required field (e.g. delete `Geburtsdatum`). Ask: *"Was fehlt mir noch?"*
   Expected: assistant lists the visible validation errors (`geburtsdatum: required`, etc.).
6. Navigate to a non-Sparte route (e.g. dashboard). Open the chat there. Ask the same question.
   Expected: assistant returns to a context-less reply, confirming `clear()` works.

- [ ] **Step 4: No commit (smoke only).**

---

## Task 9: Roll out to the other 10 Sparten

**Repo:** `prototype-frontend`

**Files:** one component per Sparte. The exact name and the exact root-form field vary; the change pattern is the same.

| Sparte | Component file | Sparte literal |
|---|---|---|
| Kfz | `apps/kfz/src/app/components/kfz.component.ts` | `'kfz'` |
| Risikoleben | `apps/risikoleben/src/app/components/rlv.component.ts` (or similar — verify with `ls`) | `'risikoleben'` |
| Private Rente | `apps/private-rente/src/app/components/private-rente.component.ts` | `'private_rente'` |
| Basis Rente | `apps/basis-rente/src/app/components/basis-rente.component.ts` | `'basis_rente'` |
| Grundfähigkeit | `apps/gf/src/app/components/gf.component.ts` | `'gf'` |
| Hausrat | `apps/hausrat/src/app/components/hausrat.component.ts` | `'hausrat'` |
| Wohngebäude | `apps/wohngebaeude/src/app/components/wohngebaeude.component.ts` | `'wohngebaeude'` |
| KVV | `apps/kvv/src/app/components/kvv.component.ts` | `'kvv'` |
| KVZ | `apps/kvz/src/app/components/kvz.component.ts` | `'kvz'` |
| PHV | `apps/phv/src/app/components/phv.component.ts` | `'phv'` |

For each row above:

- [ ] **Step 1: Locate the component file and the root form**

Run:
```bash
ls /Users/dp/Sources/prototype-frontend/apps/<dir>/src/app/components/
grep -nE "FormGroup|form\s*=|grunddatenForm|grunddaten\.form" /Users/dp/Sources/prototype-frontend/apps/<dir>/src/app/components/<name>.component.ts | head
```
Expected: a single `*.component.ts` and a clear root-form reference.

- [ ] **Step 2: Apply the same edit as Task 5 step 2**

Add the import:
```ts
import { CopilotContextService } from '@comparit/copilot-widget';
```

(Or extend the existing `@comparit/copilot-widget` import to include `CopilotContextService`.)

Inject:
```ts
private readonly copilotContext = inject(CopilotContextService);
```

In `ngOnInit`:
```ts
this.copilotContext.register(<form-reference>, '<sparte literal>');
```

In `ngOnDestroy` (add `OnDestroy` to the class signature if missing):
```ts
this.copilotContext.clear();
```

- [ ] **Step 3: Build the touched app**

Run: `cd /Users/dp/Sources/prototype-frontend && pnpm nx build <sparte-app> 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit (single commit per sparte for easy revert)**

```bash
cd /Users/dp/Sources/prototype-frontend
git add apps/<dir>/src/app/components/<name>.component.ts
git commit -m "feat(<sparte>): register form with CopilotContextService"
```

Repeat steps 1–4 for each of the 10 rows.

---

## Task 10: Push + final verification

**Repos:** both

- [ ] **Step 1: Push prototype-frontend**

```bash
cd /Users/dp/Sources/prototype-frontend
git push
```
Expected: branch updated.

- [ ] **Step 2: Push comparit-copilot**

```bash
cd /Users/dp/Sources/comparit-copilot
git push origin main
```
Expected: branch updated.

- [ ] **Step 3: Spot-check two more Sparten**

Restart at least one extra Sparte (e.g. `pnpm start:kfz` on port 4202) and repeat Task 8 step 3 with KFZ-specific fields (e.g. `Fahrzeugidentnummer`). Ask: *"Welche FIN habe ich eingegeben?"* — expect the assistant to read it from `activeCalculation.values`.

- [ ] **Step 4: Done — leave servers running.**

---

## Done

The intake widget chat now answers questions about the active customer / calculation by reading `activeCalculation` from `capturedContext`, sourced live from each Sparte's reactive form.
