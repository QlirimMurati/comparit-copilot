# Prefill Tab Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the standalone `pool-prefill-checker` validator into `comparit-copilot` as a top-level Angular tab named **Prefill**, with a NestJS-backed validate endpoint that does live Swagger fetch + static-schema fallback.

**Architecture:** Port the four validator files into `apps/api/src/prefill/lib/` as a self-contained library, wrap them with a NestJS service + JWT-guarded controller (`/api/prefill/sparten`, `/api/prefill/validate`), and add an Angular standalone signal-based page at `apps/web/src/app/pages/prefill/` that hits those endpoints. No code shared with the standalone repo at `/Users/dp/Sources/pool-prefill-checker/`.

**Tech Stack:** NestJS 10, Angular 19 standalone components + signals, Tailwind 3, Jest + `@nestjs/testing`, `HttpTestingController` for Angular.

**Spec:** `docs/superpowers/specs/2026-04-28-prefill-tab-integration-design.md`.

**Conventions to follow (verified in repo):**
- JWT guard class is `JwtAuthGuard` (file `apps/api/src/auth/jwt.guard.ts`), exported from `AuthModule`. Decorators: `@ApiTags(...)`, `@ApiBearerAuth('jwt')`, `@UseGuards(JwtAuthGuard)`, `@Controller(...)`.
- Existing modules import `AuthModule` to use `JwtAuthGuard` (see `bug-reports.module.ts`).
- Frontend pages: standalone components, `ChangeDetectionStrategy.OnPush`, signals, `inject()` for DI, Tailwind classes (`rounded-xl border border-slate-200 bg-white`).
- Frontend service pattern: `@Injectable({ providedIn: 'root' })` + `HttpClient`, returns `Observable<T>` (see `bug-reports.service.ts`).
- Tests live next to source as `*.spec.ts`. Backend uses `Test.createTestingModule` + `jest.mock`. Frontend uses `TestBed` + `provideHttpClient` + `HttpTestingController`.

---

## Task 1: Copy `schema.ts` static fallback into `apps/api/src/prefill/lib/`

**Files:**
- Create: `apps/api/src/prefill/lib/schema.ts` (copy of `/Users/dp/Sources/pool-prefill-checker/src/schema.ts`, ~1120 lines)

- [ ] **Step 1: Copy the file verbatim**

```bash
mkdir -p /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib
cp /Users/dp/Sources/pool-prefill-checker/src/schema.ts /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/schema.ts
```

- [ ] **Step 2: Verify no `.js` import suffixes inside (schema.ts has no imports — should be clean)**

Run: `grep -n "from \"" /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/schema.ts | head`
Expected: No output (the file only declares constants and types, no imports).

- [ ] **Step 3: Type-check the new file in isolation**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm exec tsc --noEmit apps/api/src/prefill/lib/schema.ts 2>&1 | head -20`
Expected: No errors. (If errors appear that reference `tsconfig` resolution, that's fine — the file will be type-checked properly via `pnpm nx build api` later.)

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/lib/schema.ts
git commit -m "feat(prefill): add static schema fallback (copy from pool-prefill-checker)"
```

---

## Task 2: Copy `parse-input.ts` into `apps/api/src/prefill/lib/`

**Files:**
- Create: `apps/api/src/prefill/lib/parse-input.ts`

- [ ] **Step 1: Copy the file verbatim**

```bash
cp /Users/dp/Sources/pool-prefill-checker/src/parse-input.ts /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/parse-input.ts
```

- [ ] **Step 2: Confirm there are no `.js` import suffixes in this file**

Run: `grep -n "\.js\"" /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/parse-input.ts`
Expected: No output (this file only imports nothing or types).

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/lib/parse-input.ts
git commit -m "feat(prefill): add parse-input util (copy from pool-prefill-checker)"
```

---

## Task 3: Copy `validator.ts` into `apps/api/src/prefill/lib/` and drop `.js` suffixes

**Files:**
- Create: `apps/api/src/prefill/lib/validator.ts`

- [ ] **Step 1: Copy the file**

```bash
cp /Users/dp/Sources/pool-prefill-checker/src/validator.ts /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/validator.ts
```

- [ ] **Step 2: Drop the `.js` suffix from the schema import**

Edit `apps/api/src/prefill/lib/validator.ts` line 1:

Replace:
```ts
import { enums as defaultEnums, prefillSchemas as defaultPrefillSchemas, type FieldDef } from "./schema.js";
```

With:
```ts
import { enums as defaultEnums, prefillSchemas as defaultPrefillSchemas, type FieldDef } from './schema';
```

- [ ] **Step 3: Verify**

Run: `grep -n "from " /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/validator.ts`
Expected: One line — `import { enums as defaultEnums, prefillSchemas as defaultPrefillSchemas, type FieldDef } from './schema';`

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/lib/validator.ts
git commit -m "feat(prefill): add validator (copy from pool-prefill-checker)"
```

---

## Task 4: Copy `swagger-loader.ts` and drop `.js` suffix

**Files:**
- Create: `apps/api/src/prefill/lib/swagger-loader.ts`

- [ ] **Step 1: Copy the file**

```bash
cp /Users/dp/Sources/pool-prefill-checker/src/swagger-loader.ts /Users/dp/Sources/comparit-copilot/apps/api/src/prefill/lib/swagger-loader.ts
```

- [ ] **Step 2: Drop `.js` suffix from the schema type import**

Edit `apps/api/src/prefill/lib/swagger-loader.ts` line 1:

Replace:
```ts
import type { FieldDef } from "./schema.js";
```

With:
```ts
import type { FieldDef } from './schema';
```

- [ ] **Step 3: Verify the `fetch` global is OK on the runtime**

The api runs on Node 18+ (verify in `apps/api/package.json` engines or rely on the existing fetch usage). Node 18+ has global `fetch`, so `swagger-loader.ts` can stay as-is.

Run: `grep -rn "fetch(" /Users/dp/Sources/comparit-copilot/apps/api/src/ | grep -v node_modules | head`
Expected: At least one existing `fetch(` call elsewhere in the api confirming the runtime supports it. If none found, add `import { fetch } from 'undici';` to the top of `swagger-loader.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/lib/swagger-loader.ts
git commit -m "feat(prefill): add swagger-loader (copy from pool-prefill-checker)"
```

---

## Task 5: Define backend types (`prefill.types.ts`)

**Files:**
- Create: `apps/api/src/prefill/prefill.types.ts`

- [ ] **Step 1: Write the types file**

Create `apps/api/src/prefill/prefill.types.ts`:

```ts
import type { ValidationError } from './lib/validator';

export type PrefillStage = 'live' | 'qa' | 'dev';

export interface ValidateRequest {
  sparte: string;
  json: string;
  stage?: PrefillStage;
}

export interface ValidateResponse {
  valid: boolean;
  errors: ValidationError[];
  fieldCount: number;
  cleanJson: string;
  stage: PrefillStage;
  schemaSource: 'live' | 'static';
}

export interface SparteOption {
  key: string;
  label: string;
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -20`
Expected: Build succeeds (the file compiles even though no controller uses it yet — service/controller arrive in next tasks).

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.types.ts
git commit -m "feat(prefill): add backend types (DTOs)"
```

---

## Task 6: PrefillService — happy path test (live schema)

**Files:**
- Create: `apps/api/src/prefill/prefill.service.ts`
- Create: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/prefill/prefill.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrefillService } from './prefill.service';
import * as swaggerLoader from './lib/swagger-loader';

describe('PrefillService.validate', () => {
  beforeEach(() => {
    jest.spyOn(swaggerLoader, 'loadSchema').mockResolvedValue({
      stage: 'live',
      loadedAt: Date.now(),
      enums: { KfzNutzungstypEnum: ['Privat', 'Gewerblich'] },
      prefillSchemas: {
        Kfz: {
          fields: {
            sparte: { type: 'string', nullable: false },
            nutzung: { type: 'enum', enumName: 'KfzNutzungstypEnum', nullable: false },
          },
        },
      },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  async function build() {
    const moduleRef = await Test.createTestingModule({
      providers: [PrefillService],
    }).compile();
    return moduleRef.get(PrefillService);
  }

  it('returns valid: true for a known-good Kfz payload', async () => {
    const svc = await build();
    const json = JSON.stringify({ sparte: 'Kfz', nutzung: 'Privat' });
    const result = await svc.validate({ sparte: 'Kfz', json, stage: 'live' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.schemaSource).toBe('live');
    expect(result.stage).toBe('live');
    expect(result.cleanJson).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -20`
Expected: FAIL — "Cannot find module './prefill.service'".

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/prefill/prefill.service.ts`:

```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parseAndUnwrap, extractFirstJson } from './lib/parse-input';
import { loadSchema } from './lib/swagger-loader';
import { validatePrefill } from './lib/validator';
import { enums as staticEnums, prefillSchemas as staticPrefillSchemas } from './lib/schema';
import type {
  PrefillStage,
  SparteOption,
  ValidateRequest,
  ValidateResponse,
} from './prefill.types';

const SPARTE_LABELS: Record<string, string> = {
  Kfz: 'KFZ-Versicherung',
  Bu: 'Berufsunfähigkeitsversicherung',
  Rlv: 'Risikolebensversicherung',
  Pr: 'Private Rentenversicherung',
  Br: 'Basis-Rentenversicherung (Rürup)',
  Gf: 'Grundfähigkeitsversicherung',
  Hr: 'Hausratversicherung',
  Wg: 'Wohngebäudeversicherung',
  Kvv: 'Krankenversicherung (Voll)',
  Kvz: 'Krankenversicherung (Zusatz)',
  Phv: 'Privathaftpflichtversicherung',
};

@Injectable()
export class PrefillService {
  private readonly logger = new Logger(PrefillService.name);

  listSparten(): SparteOption[] {
    return Object.entries(SPARTE_LABELS).map(([key, label]) => ({ key, label }));
  }

  async validate(req: ValidateRequest): Promise<ValidateResponse> {
    const stage: PrefillStage = req.stage ?? 'live';

    let source: { enums: typeof staticEnums; prefillSchemas: typeof staticPrefillSchemas };
    let schemaSource: 'live' | 'static' = 'live';
    try {
      const loaded = await loadSchema(stage);
      source = { enums: loaded.enums, prefillSchemas: loaded.prefillSchemas };
    } catch (err) {
      this.logger.warn(
        `Live schema load failed for stage=${stage}; using static fallback. ${(err as Error).message}`,
      );
      source = { enums: staticEnums, prefillSchemas: staticPrefillSchemas };
      schemaSource = 'static';
    }

    if (!source.prefillSchemas[req.sparte]) {
      throw new BadRequestException(
        `Unknown sparte "${req.sparte}". Valid: ${Object.keys(source.prefillSchemas).join(', ')}`,
      );
    }

    let data: Record<string, unknown>;
    let cleanJson: string;
    try {
      cleanJson = extractFirstJson(req.json);
      data = parseAndUnwrap(req.json);
    } catch {
      throw new BadRequestException(
        'Invalid JSON — could not extract a valid JSON object from the input',
      );
    }

    const errors = validatePrefill(req.sparte, data, source);
    return {
      valid: errors.length === 0,
      errors,
      fieldCount: Object.keys(data).length,
      cleanJson,
      stage,
      schemaSource,
    };
  }
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -20`
Expected: PASS — 1 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.ts apps/api/src/prefill/prefill.service.spec.ts
git commit -m "feat(prefill): PrefillService.validate happy path"
```

---

## Task 7: PrefillService — fallback to static schema test

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Add the failing fallback test**

Append inside `describe('PrefillService.validate', ...)` in `apps/api/src/prefill/prefill.service.spec.ts`:

```ts
it('falls back to the static schema when loadSchema rejects', async () => {
  jest.spyOn(swaggerLoader, 'loadSchema').mockRejectedValue(new Error('network down'));
  const svc = await build();
  const json = JSON.stringify({ sparte: 'Kfz' });
  const result = await svc.validate({ sparte: 'Kfz', json, stage: 'qa' });
  expect(result.schemaSource).toBe('static');
  expect(result.stage).toBe('qa');
  // Static schema must contain Kfz — sanity check
  expect(result.errors).toEqual(expect.any(Array));
});
```

- [ ] **Step 2: Run test, expect pass (the implementation already handles this)**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -20`
Expected: PASS — 2 passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.spec.ts
git commit -m "test(prefill): cover static-schema fallback on swagger fetch failure"
```

---

## Task 8: PrefillService — invalid JSON & unknown sparte tests

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append inside the same `describe` block:

```ts
it('throws BadRequestException for invalid JSON', async () => {
  const svc = await build();
  await expect(
    svc.validate({ sparte: 'Kfz', json: 'not json at all', stage: 'live' }),
  ).rejects.toThrow(/Invalid JSON/);
});

it('throws BadRequestException for unknown sparte', async () => {
  const svc = await build();
  const json = JSON.stringify({ sparte: 'Xyz' });
  await expect(
    svc.validate({ sparte: 'Xyz', json, stage: 'live' }),
  ).rejects.toThrow(/Unknown sparte/);
});

it('reports validation errors for a bad enum value', async () => {
  const svc = await build();
  const json = JSON.stringify({ sparte: 'Kfz', nutzung: 'Bogus' });
  const result = await svc.validate({ sparte: 'Kfz', json, stage: 'live' });
  expect(result.valid).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].path).toBe('nutzung');
});
```

- [ ] **Step 2: Run test, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -20`
Expected: PASS — 5 passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.spec.ts
git commit -m "test(prefill): cover invalid JSON, unknown sparte, bad enum"
```

---

## Task 9: PrefillService — `listSparten` test

**Files:**
- Modify: `apps/api/src/prefill/prefill.service.spec.ts`

- [ ] **Step 1: Add a separate `describe` block for `listSparten`**

Append at the bottom of the file:

```ts
describe('PrefillService.listSparten', () => {
  it('returns all 11 sparten with German labels', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrefillService],
    }).compile();
    const svc = moduleRef.get(PrefillService);
    const result = svc.listSparten();
    expect(result).toEqual(
      expect.arrayContaining([
        { key: 'Kfz', label: 'KFZ-Versicherung' },
        { key: 'Phv', label: 'Privathaftpflichtversicherung' },
      ]),
    );
    expect(result).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.service.spec" 2>&1 | tail -20`
Expected: PASS — 6 passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.service.spec.ts
git commit -m "test(prefill): cover listSparten"
```

---

## Task 10: PrefillController + JWT guard

**Files:**
- Create: `apps/api/src/prefill/prefill.controller.ts`
- Create: `apps/api/src/prefill/prefill.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

Create `apps/api/src/prefill/prefill.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrefillController } from './prefill.controller';
import { PrefillService } from './prefill.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

describe('PrefillController', () => {
  const mockService = {
    listSparten: jest.fn().mockReturnValue([{ key: 'Kfz', label: 'KFZ-Versicherung' }]),
    validate: jest.fn().mockResolvedValue({
      valid: true,
      errors: [],
      fieldCount: 1,
      cleanJson: '{}',
      stage: 'live',
      schemaSource: 'live',
    }),
  };

  async function build() {
    const moduleRef = await Test.createTestingModule({
      controllers: [PrefillController],
      providers: [{ provide: PrefillService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(PrefillController);
  }

  beforeEach(() => jest.clearAllMocks());

  it('GET /sparten delegates to service', async () => {
    const ctrl = await build();
    expect(ctrl.listSparten()).toEqual([{ key: 'Kfz', label: 'KFZ-Versicherung' }]);
    expect(mockService.listSparten).toHaveBeenCalled();
  });

  it('POST /validate delegates to service', async () => {
    const ctrl = await build();
    const result = await ctrl.validate({ sparte: 'Kfz', json: '{}', stage: 'live' });
    expect(result.valid).toBe(true);
    expect(mockService.validate).toHaveBeenCalledWith({
      sparte: 'Kfz',
      json: '{}',
      stage: 'live',
    });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.controller.spec" 2>&1 | tail -20`
Expected: FAIL — "Cannot find module './prefill.controller'".

- [ ] **Step 3: Write the controller**

Create `apps/api/src/prefill/prefill.controller.ts`:

```ts
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrefillService } from './prefill.service';
import type { SparteOption, ValidateRequest, ValidateResponse } from './prefill.types';

@ApiTags('prefill')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('prefill')
export class PrefillController {
  constructor(private readonly svc: PrefillService) {}

  @ApiOperation({ summary: 'List sparten with German labels' })
  @Get('sparten')
  listSparten(): SparteOption[] {
    return this.svc.listSparten();
  }

  @ApiOperation({ summary: 'Validate a prefill JSON payload against a sparte schema' })
  @Post('validate')
  validate(@Body() body: ValidateRequest): Promise<ValidateResponse> {
    return this.svc.validate(body);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="prefill.controller.spec" 2>&1 | tail -20`
Expected: PASS — 2 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.controller.ts apps/api/src/prefill/prefill.controller.spec.ts
git commit -m "feat(prefill): JWT-guarded controller (sparten + validate)"
```

---

## Task 11: PrefillModule + register in AppModule

**Files:**
- Create: `apps/api/src/prefill/prefill.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

- [ ] **Step 1: Create the module**

Create `apps/api/src/prefill/prefill.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrefillController } from './prefill.controller';
import { PrefillService } from './prefill.service';

@Module({
  imports: [AuthModule],
  controllers: [PrefillController],
  providers: [PrefillService],
  exports: [PrefillService],
})
export class PrefillModule {}
```

- [ ] **Step 2: Register in `AppModule`**

Edit `apps/api/src/app/app.module.ts`. Add the import line near the top:

```ts
import { PrefillModule } from '../prefill/prefill.module';
```

Add `PrefillModule` to the `imports` array (alphabetical-ish, next to other feature modules):

```ts
@Module({
  imports: [
    DbModule,
    AuthModule,
    BugReportsModule,
    WidgetModule,
    AiModule,
    RealtimeModule,
    IndexModule,
    JiraModule,
    CopilotModule,
    PrefillModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Build the api**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 4: Boot smoke test**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm start:api &> /tmp/api-prefill.log & sleep 5 && curl -sS http://localhost:3000/api/health && echo && curl -sS http://localhost:3000/api/prefill/sparten ; jobs -p | xargs -r kill`
Expected: Health returns OK; `/api/prefill/sparten` returns `{"statusCode":401,"message":"Missing bearer token"}` (good — proves the route exists and JWT guard fires).

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/prefill/prefill.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(prefill): wire PrefillModule into AppModule"
```

---

## Task 12: Backend lint + full test pass

- [ ] **Step 1: Lint api**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx lint api 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 2: Full api test run**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api 2>&1 | tail -15`
Expected: All tests pass, including the 8 new prefill tests.

- [ ] **Step 3: No commit (lint/test gate only — nothing to add)**

If lint or tests fail, fix in place, then re-run from Step 1. Make a small follow-up commit only if changes were needed.

---

## Task 13: Frontend types

**Files:**
- Create: `apps/web/src/app/core/api/prefill.types.ts`

- [ ] **Step 1: Write the types**

Create `apps/web/src/app/core/api/prefill.types.ts`:

```ts
export type PrefillStage = 'live' | 'qa' | 'dev';

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
  expected?: string;
}

export interface ValidateRequest {
  sparte: string;
  json: string;
  stage: PrefillStage;
}

export interface ValidateResponse {
  valid: boolean;
  errors: ValidationError[];
  fieldCount: number;
  cleanJson: string;
  stage: PrefillStage;
  schemaSource: 'live' | 'static';
}

export interface SparteOption {
  key: string;
  label: string;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/core/api/prefill.types.ts
git commit -m "feat(prefill/web): frontend DTO types"
```

---

## Task 14: Frontend API service

**Files:**
- Create: `apps/web/src/app/core/api/prefill.service.ts`

- [ ] **Step 1: Write the service**

Create `apps/web/src/app/core/api/prefill.service.ts`:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  SparteOption,
  ValidateRequest,
  ValidateResponse,
} from './prefill.types';

@Injectable({ providedIn: 'root' })
export class PrefillService {
  private readonly http = inject(HttpClient);

  listSparten(): Observable<SparteOption[]> {
    return this.http.get<SparteOption[]>('/api/prefill/sparten');
  }

  validate(req: ValidateRequest): Observable<ValidateResponse> {
    return this.http.post<ValidateResponse>('/api/prefill/validate', req);
  }
}
```

- [ ] **Step 2: Build the web app**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build web 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/core/api/prefill.service.ts
git commit -m "feat(prefill/web): HttpClient service"
```

---

## Task 15: PrefillComponent — class with signals + behaviors

**Files:**
- Create: `apps/web/src/app/pages/prefill/prefill.component.ts`

- [ ] **Step 1: Write the component class (template comes in next task)**

Create `apps/web/src/app/pages/prefill/prefill.component.ts`:

```ts
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { catchError, of } from 'rxjs';
import { PrefillService } from '../../core/api/prefill.service';
import type {
  PrefillStage,
  SparteOption,
  ValidateResponse,
  ValidationError,
} from '../../core/api/prefill.types';

interface ResultError {
  error: string;
}

function extractFirstJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
  }
  return trimmed;
}

@Component({
  selector: 'app-prefill',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prefill.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrefillComponent implements OnInit {
  private readonly api = inject(PrefillService);

  protected readonly sparten = signal<SparteOption[]>([]);
  protected readonly stage = signal<PrefillStage>('live');
  protected readonly sparte = signal<string>('');
  protected readonly json = signal<string>('');
  protected readonly result = signal<ValidateResponse | ResultError | null>(null);
  protected readonly loading = signal(false);
  protected readonly autoDetected = signal<string | null>(null);

  protected readonly resultErrors = computed<ValidationError[]>(() => {
    const r = this.result();
    return r && 'valid' in r ? r.errors : [];
  });

  protected readonly isOk = computed(() => {
    const r = this.result();
    return !!r && 'valid' in r && r.valid;
  });

  protected readonly isErr = computed(() => {
    const r = this.result();
    return !!r && (('error' in r) || ('valid' in r && !r.valid));
  });

  protected readonly resultStage = computed<PrefillStage | null>(() => {
    const r = this.result();
    return r && 'stage' in r ? r.stage : null;
  });

  protected readonly schemaIsStatic = computed(() => {
    const r = this.result();
    return !!r && 'schemaSource' in r && r.schemaSource === 'static';
  });

  constructor() {
    effect(() => {
      const raw = this.json();
      try {
        const obj = JSON.parse(extractFirstJson(raw)) as { sparte?: string; prefillData?: { sparte?: string } };
        const detected = obj.sparte ?? obj.prefillData?.sparte;
        if (detected && this.sparten().some((s) => s.key === detected)) {
          this.sparte.set(detected);
          this.autoDetected.set(detected);
          return;
        }
      } catch {
        // ignore
      }
      this.autoDetected.set(null);
    });
  }

  ngOnInit(): void {
    this.api
      .listSparten()
      .pipe(catchError(() => of<SparteOption[]>([])))
      .subscribe((list) => this.sparten.set(list));
  }

  protected setStage(s: PrefillStage): void {
    this.stage.set(s);
  }

  protected formatJson(): void {
    try {
      const parsed = JSON.parse(extractFirstJson(this.json()));
      this.json.set(JSON.stringify(parsed, null, 2));
    } catch {
      // leave as-is
    }
  }

  protected onTextareaKeydown(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      this.validate();
    }
  }

  protected validate(): void {
    const sparte = this.sparte();
    const json = this.json().trim();
    if (!sparte) {
      this.result.set({ error: 'Select a Sparte first' });
      return;
    }
    if (!json) {
      this.result.set({ error: 'Paste JSON data first' });
      return;
    }
    this.loading.set(true);
    this.result.set(null);
    this.api
      .validate({ sparte, json, stage: this.stage() })
      .pipe(
        catchError((err: { error?: { message?: string } }) =>
          of<ResultError>({ error: err.error?.message ?? 'Request failed' }),
        ),
      )
      .subscribe((res) => {
        this.loading.set(false);
        this.result.set(res);
        if ('cleanJson' in res && res.cleanJson) {
          try {
            this.json.set(JSON.stringify(JSON.parse(res.cleanJson), null, 2));
          } catch {
            // leave as-is
          }
        }
      });
  }

  protected stageBadgeTone(s: PrefillStage): string {
    switch (s) {
      case 'live': return 'bg-emerald-100 text-emerald-800';
      case 'qa':   return 'bg-amber-100 text-amber-800';
      case 'dev':  return 'bg-sky-100 text-sky-800';
    }
  }

  protected stageButtonTone(s: PrefillStage, active: boolean): string {
    if (!active) return 'bg-white text-slate-600 hover:bg-slate-50';
    switch (s) {
      case 'live': return 'bg-emerald-600 text-white';
      case 'qa':   return 'bg-amber-500 text-white';
      case 'dev':  return 'bg-sky-600 text-white';
    }
  }

  protected resultErrorMessage(): string | null {
    const r = this.result();
    if (r && 'error' in r) return r.error;
    return null;
  }
}
```

- [ ] **Step 2: Build (component will fail without template — acceptable for now, template added next task)**

Skip build until next task.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/pages/prefill/prefill.component.ts
git commit -m "feat(prefill/web): component class (signals, behaviors)"
```

---

## Task 16: PrefillComponent — template

**Files:**
- Create: `apps/web/src/app/pages/prefill/prefill.component.html`

- [ ] **Step 1: Write the template**

Create `apps/web/src/app/pages/prefill/prefill.component.html`:

```html
<section class="space-y-6">
  <header class="flex items-center justify-between gap-4">
    <div>
      <h2 class="text-2xl font-semibold tracking-tight">Prefill validator</h2>
      <p class="text-sm text-slate-600">
        Validate prefill JSON against the comparit Pool API schema.
      </p>
    </div>
    <div class="inline-flex overflow-hidden rounded-lg border border-slate-200">
      @for (s of ['live','qa','dev']; track s) {
        <button
          type="button"
          [class]="'px-4 py-1.5 text-xs font-semibold uppercase tracking-wide ' + stageButtonTone($any(s), stage() === s)"
          (click)="setStage($any(s))"
        >{{ s }}</button>
      }
    </div>
  </header>

  <div class="grid gap-4 md:grid-cols-2">
    <article class="rounded-xl border border-slate-200 bg-white">
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Input</h3>
        <button
          type="button"
          class="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          (click)="formatJson()"
        >Format JSON</button>
      </div>
      <div class="space-y-3 p-4">
        <div class="flex gap-2">
          <select
            class="flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm"
            [ngModel]="sparte()"
            (ngModelChange)="sparte.set($event)"
          >
            <option value="">Select Sparte…</option>
            @for (s of sparten(); track s.key) {
              <option [value]="s.key">{{ s.key }} — {{ s.label }}</option>
            }
          </select>
          <button
            type="button"
            class="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            [disabled]="loading()"
            (click)="validate()"
          >{{ loading() ? 'Validating…' : 'Validate' }}</button>
        </div>
        <textarea
          class="block h-[460px] w-full rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800"
          spellcheck="false"
          placeholder="Paste prefill JSON here… (Cmd/Ctrl+Enter to validate)"
          [ngModel]="json()"
          (ngModelChange)="json.set($event)"
          (keydown)="onTextareaKeydown($event)"
        ></textarea>
        @if (autoDetected(); as ad) {
          <p class="text-xs text-slate-500">
            Auto-detected: <span class="font-medium text-slate-700">{{ ad }}</span>
          </p>
        }
      </div>
    </article>

    <article class="rounded-xl border border-slate-200 bg-white">
      <div class="border-b border-slate-200 px-4 py-2">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Result</h3>
      </div>
      <div class="p-4">
        @if (loading()) {
          <div class="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">Validating…</div>
        } @else if (resultErrorMessage()) {
          <div class="rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{{ resultErrorMessage() }}</div>
        } @else if (isOk()) {
          <div class="flex items-center gap-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span>All prefill data is valid</span>
            @if (resultStage(); as s) {
              <span [class]="'rounded px-2 py-0.5 text-[10px] uppercase ' + stageBadgeTone(s)">{{ s }}</span>
            }
            @if (schemaIsStatic()) {
              <span class="rounded bg-amber-100 px-2 py-0.5 text-[10px] uppercase text-amber-800">offline schema (fallback)</span>
            }
          </div>
        } @else if (isErr()) {
          <div class="space-y-3">
            <div class="flex items-center gap-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <span>{{ resultErrors().length }} validation error{{ resultErrors().length === 1 ? '' : 's' }}</span>
              @if (resultStage(); as s) {
                <span [class]="'rounded px-2 py-0.5 text-[10px] uppercase ' + stageBadgeTone(s)">{{ s }}</span>
              }
              @if (schemaIsStatic()) {
                <span class="rounded bg-amber-100 px-2 py-0.5 text-[10px] uppercase text-amber-800">offline schema (fallback)</span>
              }
            </div>
            <div class="max-h-[420px] overflow-auto rounded border border-slate-200">
              <table class="w-full text-left text-xs">
                <thead class="sticky top-0 bg-slate-50">
                  <tr>
                    <th class="px-3 py-2 font-semibold text-slate-500">Field</th>
                    <th class="px-3 py-2 font-semibold text-slate-500">Error</th>
                    <th class="px-3 py-2 font-semibold text-slate-500">Value</th>
                    <th class="px-3 py-2 font-semibold text-slate-500">Expected</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of resultErrors(); track e.path + '|' + e.message) {
                    <tr class="border-t border-slate-200">
                      <td class="px-3 py-2 font-mono text-indigo-700">{{ e.path }}</td>
                      <td class="px-3 py-2 text-slate-600">{{ e.message }}</td>
                      <td class="px-3 py-2 font-mono text-rose-700">{{ e.value | json }}</td>
                      <td class="px-3 py-2 font-mono text-emerald-700">{{ e.expected || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        } @else {
          <div class="flex h-[420px] items-center justify-center text-sm text-slate-400">
            Paste JSON and click Validate
          </div>
        }
      </div>
    </article>
  </div>
</section>
```

- [ ] **Step 2: Build the web app**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build web 2>&1 | tail -15`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/pages/prefill/prefill.component.html
git commit -m "feat(prefill/web): component template (Tailwind, light theme)"
```

---

## Task 17: Wire route + nav link

**Files:**
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/app.component.html`

- [ ] **Step 1: Add the route**

Edit `apps/web/src/app/app.routes.ts`. Inside the children array (after the `dashboards` route, before `admin`), insert:

```ts
{
  path: 'prefill',
  loadComponent: () =>
    import('./pages/prefill/prefill.component').then(
      (m) => m.PrefillComponent
    ),
},
```

- [ ] **Step 2: Add the nav link**

Edit `apps/web/src/app/app.component.html`. After the `Dashboards` link `<a>` (line 22) and before the `@if (isAdmin())` block, add:

```html
<a
  routerLink="/prefill"
  routerLinkActive="text-slate-900 font-medium"
  class="text-slate-600 hover:text-slate-900"
>Prefill</a>
```

- [ ] **Step 3: Build the web app**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build web 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/app.routes.ts apps/web/src/app/app.component.html
git commit -m "feat(prefill/web): wire route + top-level nav link"
```

---

## Task 18: Frontend component test

**Files:**
- Create: `apps/web/src/app/pages/prefill/prefill.component.spec.ts`

- [ ] **Step 1: Write the test**

Create `apps/web/src/app/pages/prefill/prefill.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PrefillComponent } from './prefill.component';

describe('PrefillComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PrefillComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads sparten on init', () => {
    const fixture = TestBed.createComponent(PrefillComponent);
    fixture.detectChanges();
    const req = httpMock.expectOne('/api/prefill/sparten');
    expect(req.request.method).toBe('GET');
    req.flush([{ key: 'Kfz', label: 'KFZ-Versicherung' }]);
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).toContain('Kfz');
  });

  it('posts to /validate and shows the OK banner', () => {
    const fixture = TestBed.createComponent(PrefillComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/prefill/sparten').flush([
      { key: 'Kfz', label: 'KFZ-Versicherung' },
    ]);

    const cmp = fixture.componentInstance as unknown as {
      sparte: { set: (s: string) => void };
      json: { set: (s: string) => void };
      validate: () => void;
    };
    cmp.sparte.set('Kfz');
    cmp.json.set('{"sparte":"Kfz"}');
    cmp.validate();

    const req = httpMock.expectOne('/api/prefill/validate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sparte: 'Kfz', json: '{"sparte":"Kfz"}', stage: 'live' });
    req.flush({
      valid: true,
      errors: [],
      fieldCount: 1,
      cleanJson: '{"sparte":"Kfz"}',
      stage: 'live',
      schemaSource: 'live',
    });
    fixture.detectChanges();
    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).toContain('All prefill data is valid');
  });
});
```

- [ ] **Step 2: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test web --testPathPattern="prefill.component.spec" 2>&1 | tail -20`
Expected: PASS — 2 passing.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/web/src/app/pages/prefill/prefill.component.spec.ts
git commit -m "test(prefill/web): component init + validate flow"
```

---

## Task 19: Frontend lint + full test pass

- [ ] **Step 1: Lint web**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx lint web 2>&1 | tail -20`
Expected: No errors.

- [ ] **Step 2: Full web test run**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test web 2>&1 | tail -15`
Expected: All tests pass, including the 2 new prefill component tests.

- [ ] **Step 3: No commit (lint/test gate). Fix in place if anything fails.**

---

## Task 20: Manual smoke test

- [ ] **Step 1: Start the api**

Run (from a terminal): `cd /Users/dp/Sources/comparit-copilot && pnpm start:api`
Wait until log shows `Application is running on: http://[::1]:3000/api`.

- [ ] **Step 2: Start the web app**

Run (from another terminal): `cd /Users/dp/Sources/comparit-copilot && pnpm start:web`
Wait until log shows `Application bundle generation complete.`.

- [ ] **Step 3: Open http://localhost:4240 in a browser, log in as `admin@comparit.de` / `admin`**

Expected: After login, the top nav shows: Copilot · Reports · Dashboards · **Prefill** · (Admin if admin).

- [ ] **Step 4: Click **Prefill** → paste a known Kfz prefill, validate against LIVE**

Expected: "All prefill data is valid" banner with a green LIVE badge OR a red banner with errors and the LIVE badge — depending on payload correctness.

- [ ] **Step 5: Toggle to DEV, validate again**

Expected: Same payload, now badged DEV. Stage badge color changes to sky.

- [ ] **Step 6: Block `pool.cpit.app` in `/etc/hosts` and validate again**

Add line `127.0.0.1 pool.cpit.app pool.qa.cpit.app pool.cpit.dev` to `/etc/hosts`, restart api, validate.
Expected: Result still appears, with an amber **offline schema (fallback)** chip next to the stage badge.

Remove the `/etc/hosts` line after the test.

- [ ] **Step 7: Cmd/Ctrl+Enter shortcut works inside the textarea**

Expected: The Validate button fires.

- [ ] **Step 8: "Format JSON" button works**

Expected: Pasted compact JSON becomes pretty-printed.

- [ ] **Step 9: Auto-detect picks up `sparte` from pasted JSON containing `{"sparte":"Bu",…}`**

Expected: Sparte dropdown switches to `Bu`, "Auto-detected: Bu" caption appears.

- [ ] **Step 10: After a successful validate, the textarea is replaced with the cleaned JSON**

Paste `{"sparte":"Kfz"}{"trailing":"junk"}`, validate.
Expected: Textarea now shows formatted `{"sparte":"Kfz"}` only.

---

## Task 21: Final verification + plan checkbox sweep

- [ ] **Step 1: One last full lint + test pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx lint api && pnpm nx lint web && pnpm nx test api && pnpm nx test web 2>&1 | tail -25`
Expected: All green.

- [ ] **Step 2: Confirm git log**

Run: `cd /Users/dp/Sources/comparit-copilot && git log --oneline -25`
Expected: ~15 small commits documenting the integration.

- [ ] **Step 3: No new commit unless follow-up fixes were needed.**

---

## Done

The Prefill tab is live at `http://localhost:4240/prefill`, gated by the standard auth guard (any logged-in user), backed by `/api/prefill/{sparten,validate}` with live Swagger fetch + static fallback.
