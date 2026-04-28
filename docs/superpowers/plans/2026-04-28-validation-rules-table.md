# Validation Rules Table for Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Postgres-backed `validation_rules` table seeded by AI extraction from `prototype-frontend`, exposed to the Copilot chat agent via `lookup_field_rule` + `add_field_synonym` tools, with a learning loop driven by chat-side synonym additions and admin REST edits.

**Architecture:** New Drizzle schema + migration + Nest module (`apps/api/src/validation-rules/`); a one-shot extraction script under `tools/` produces JSON seed files committed in git; an `OnModuleInit` seeder upserts those JSON rows into the table on boot, leaving `source='manual'` rows untouched. Two new chat tools delegate to the service.

**Tech Stack:** NestJS 10, Drizzle (`postgres-js` + `pg-core`), Anthropic SDK (`@anthropic-ai/sdk`), Jest + `@nestjs/testing`, `tsx` for the extraction script.

**Spec:** `docs/superpowers/specs/2026-04-28-validation-rules-table-design.md`.

**Conventions verified in repo:**
- Schema files in `apps/api/src/db/schema/<name>.ts`, exported via `apps/api/src/db/schema/index.ts`.
- Migrations as hand-written SQL in `apps/api/src/db/migrations/NNNN_descriptive.sql`. Last numeric is `0011_add_copilot_tables.sql`.
- Auth guard for protected endpoints: `JwtAuthGuard` (file `apps/api/src/auth/jwt.guard.ts`).
- Role-gating: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin', 'qa_lead')` decorator.
- Modules import `AuthModule` to make `JwtAuthGuard` available.
- Boot-time hook: `OnModuleInit` (used by `JiraClient`, `EmbedQueueService`, `FewShotRegistryService`).
- Drizzle SQL migrations are auto-applied on boot by `apps/api/src/db/run-migrations.ts`.
- Existing `tools/` directory does not exist yet — will be created in Task 11.

---

## Task 1: Schema, migration, and index export

**Files:**
- Create: `apps/api/src/db/schema/validation-rules.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/src/db/migrations/0012_add_validation_rules.sql`

- [ ] **Step 1: Write the schema file**

Create `apps/api/src/db/schema/validation-rules.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export interface ValidatorRule {
  kind:
    | 'required'
    | 'min'
    | 'max'
    | 'minLength'
    | 'maxLength'
    | 'pattern'
    | 'minDate'
    | 'maxDate'
    | 'minAge'
    | 'maxAge'
    | 'custom';
  value?: string | number;
  message?: string;
}

export const validationRules = pgTable(
  'validation_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sparte: text('sparte').notNull(),
    fieldPath: text('field_path').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    validators: jsonb('validators').notNull().$type<ValidatorRule[]>(),
    enumValues: text('enum_values').array(),
    humanRule: text('human_rule').notNull(),
    synonyms: text('synonyms')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    source: text('source').notNull().default('seed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sparteFieldUq: uniqueIndex('validation_rules_sparte_field_uq').on(
      table.sparte,
      table.fieldPath,
    ),
  }),
);

export type ValidationRule = typeof validationRules.$inferSelect;
export type NewValidationRule = typeof validationRules.$inferInsert;
```

- [ ] **Step 2: Append to the schema index**

Add to `apps/api/src/db/schema/index.ts`:

```ts
export * from './validation-rules';
```

- [ ] **Step 3: Write the migration SQL**

Create `apps/api/src/db/migrations/0012_add_validation_rules.sql`:

```sql
CREATE TABLE IF NOT EXISTS "validation_rules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sparte" TEXT NOT NULL,
  "field_path" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "validators" JSONB NOT NULL,
  "enum_values" TEXT[],
  "human_rule" TEXT NOT NULL,
  "synonyms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source" TEXT NOT NULL DEFAULT 'seed',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "validation_rules_sparte_field_uq"
  ON "validation_rules" ("sparte", "field_path");
```

- [ ] **Step 4: Build and apply migration on boot**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm start:api > /tmp/api-boot.log 2>&1 & sleep 8; curl -sS http://localhost:3000/api/health; jobs -p | xargs -r kill`
Expected: `{"status":"ok",...}` and the boot log contains `Migration 0012_add_validation_rules.sql applied` (or similar — the exact wording is whatever the existing migration runner logs).

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/db/schema/validation-rules.ts apps/api/src/db/schema/index.ts apps/api/src/db/migrations/0012_add_validation_rules.sql
git commit -m "feat(validation-rules): db schema + migration"
```

---

## Task 2: Service skeleton + types

**Files:**
- Create: `apps/api/src/validation-rules/validation-rules.types.ts`
- Create: `apps/api/src/validation-rules/validation-rules.service.ts`

- [ ] **Step 1: Create the types file**

Create `apps/api/src/validation-rules/validation-rules.types.ts`:

```ts
import type {
  ValidationRule as ValidationRuleRow,
  ValidatorRule,
} from '../db/schema/validation-rules';

export type ValidationRule = ValidationRuleRow;
export type { ValidatorRule };

export interface UpsertValidationRule {
  sparte: string;
  fieldPath: string;
  label: string;
  type: string;
  validators: ValidatorRule[];
  enumValues?: string[] | null;
  humanRule: string;
  synonyms?: string[];
}
```

- [ ] **Step 2: Create the service skeleton (no methods yet — they arrive in Tasks 3–5)**

Create `apps/api/src/validation-rules/validation-rules.service.ts`:

```ts
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module';
import { validationRules } from '../db/schema/validation-rules';
import type {
  UpsertValidationRule,
  ValidationRule,
} from './validation-rules.types';

@Injectable()
export class ValidationRulesService {
  private readonly logger = new Logger(ValidationRulesService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}
}
```

- [ ] **Step 3: Build to confirm**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds (warnings about unused imports are fine — they're consumed by Tasks 3–5).

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.types.ts apps/api/src/validation-rules/validation-rules.service.ts
git commit -m "feat(validation-rules): service skeleton + types"
```

---

## Task 3: `lookup()` test + implementation

**Files:**
- Create: `apps/api/src/validation-rules/validation-rules.service.spec.ts`
- Modify: `apps/api/src/validation-rules/validation-rules.service.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/validation-rules/validation-rules.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../db/db.module';
import { ValidationRulesService } from './validation-rules.service';

interface FakeRow {
  id: string;
  sparte: string;
  field_path: string;
  label: string;
  type: string;
  validators: unknown[];
  enum_values: string[] | null;
  human_rule: string;
  synonyms: string[];
  source: string;
  created_at: Date;
  updated_at: Date;
}

function buildDb(rows: FakeRow[]): { db: unknown } {
  return {
    db: {
      execute: jest.fn().mockImplementation((_query: unknown) => {
        return Promise.resolve(rows);
      }),
    },
  };
}

const SAMPLE: FakeRow = {
  id: '11111111-1111-1111-1111-111111111111',
  sparte: 'Kfz',
  field_path: 'versicherungsnehmer.geburtsdatum',
  label: 'Geburtsdatum',
  type: 'date',
  validators: [{ kind: 'required' }],
  enum_values: null,
  human_rule: 'Date of birth. Required.',
  synonyms: ['DOB', 'Geburtstag'],
  source: 'seed',
  created_at: new Date(),
  updated_at: new Date(),
};

async function build(db: unknown): Promise<ValidationRulesService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ValidationRulesService,
      { provide: DRIZZLE, useValue: db },
    ],
  }).compile();
  return moduleRef.get(ValidationRulesService);
}

describe('ValidationRulesService.lookup', () => {
  it('matches case-insensitively by label, fieldPath, or synonym', async () => {
    const { db } = buildDb([SAMPLE]);
    const svc = await build(db);
    const result = await svc.lookup('GEBURTSDATUM');
    expect(result).toHaveLength(1);
    expect(result[0].sparte).toBe('Kfz');
    expect(result[0].synonyms).toContain('DOB');
  });

  it('forwards the sparte filter to the query', async () => {
    const { db } = buildDb([]);
    const svc = await build(db);
    await svc.lookup('geburtsdatum', 'Kfz');
    expect((db as { execute: jest.Mock }).execute).toHaveBeenCalledTimes(1);
    const calledWith = (db as { execute: jest.Mock }).execute.mock.calls[0][0];
    // The compiled SQL string should include both filters
    const sqlText = JSON.stringify(calledWith);
    expect(sqlText).toContain('Kfz');
    expect(sqlText.toLowerCase()).toContain('geburtsdatum');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.service.spec" 2>&1 | tail -15`
Expected: FAIL — "svc.lookup is not a function".

- [ ] **Step 3: Implement `lookup` using a raw SQL query (drizzle-orm `sql` template tag)**

Append to `apps/api/src/validation-rules/validation-rules.service.ts` inside the class:

```ts
  async lookup(query: string, sparte?: string): Promise<ValidationRule[]> {
    const pattern = `%${query}%`;
    const rows = (await this.db.execute(sql`
      SELECT id, sparte, field_path AS "fieldPath", label, type, validators,
             enum_values AS "enumValues", human_rule AS "humanRule",
             synonyms, source,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM validation_rules
      WHERE (
        label ILIKE ${pattern}
        OR field_path ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM unnest(synonyms) s WHERE s ILIKE ${pattern}
        )
      )
      AND (${sparte ?? null}::text IS NULL OR sparte = ${sparte ?? null})
      ORDER BY sparte, field_path
      LIMIT 25
    `)) as unknown as ValidationRule[];
    return rows;
  }
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.service.spec" 2>&1 | tail -15`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.service.ts apps/api/src/validation-rules/validation-rules.service.spec.ts
git commit -m "feat(validation-rules): lookup() with case-insensitive label/path/synonym match"
```

---

## Task 4: `upsert()` test + implementation

**Files:**
- Modify: `apps/api/src/validation-rules/validation-rules.service.ts`
- Modify: `apps/api/src/validation-rules/validation-rules.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/validation-rules/validation-rules.service.spec.ts`:

```ts
describe('ValidationRulesService.upsert', () => {
  it('inserts a new row with source="seed" via ON CONFLICT DO UPDATE', async () => {
    const inserted = { ...SAMPLE };
    const db = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([inserted]),
          }),
        }),
      }),
    };
    const svc = await build(db);
    const result = await svc.upsert(
      {
        sparte: 'Kfz',
        fieldPath: 'versicherungsnehmer.geburtsdatum',
        label: 'Geburtsdatum',
        type: 'date',
        validators: [{ kind: 'required' }],
        humanRule: 'Date of birth.',
        synonyms: ['DOB'],
      },
      'seed',
    );
    expect(result.sparte).toBe('Kfz');
    expect(db.insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.service.spec" 2>&1 | tail -15`
Expected: FAIL — "svc.upsert is not a function".

- [ ] **Step 3: Implement `upsert`**

Append to `validation-rules.service.ts` inside the class:

```ts
  async upsert(
    input: UpsertValidationRule,
    source: 'seed' | 'manual',
  ): Promise<ValidationRule> {
    // For source='seed', overwrite an existing seed row but never a manual one
    // (that constraint is enforced by the seeder, not here — manual upserts
    // always succeed).
    const [row] = await this.db
      .insert(validationRules)
      .values({
        sparte: input.sparte,
        fieldPath: input.fieldPath,
        label: input.label,
        type: input.type,
        validators: input.validators,
        enumValues: input.enumValues ?? null,
        humanRule: input.humanRule,
        synonyms: input.synonyms ?? [],
        source,
      })
      .onConflictDoUpdate({
        target: [validationRules.sparte, validationRules.fieldPath],
        set: {
          label: input.label,
          type: input.type,
          validators: input.validators,
          enumValues: input.enumValues ?? null,
          humanRule: input.humanRule,
          synonyms: input.synonyms ?? [],
          source,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row as ValidationRule;
  }
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.service.spec" 2>&1 | tail -15`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.service.ts apps/api/src/validation-rules/validation-rules.service.spec.ts
git commit -m "feat(validation-rules): upsert() with ON CONFLICT DO UPDATE"
```

---

## Task 5: `addSynonym()` test + implementation (flips source to manual)

**Files:**
- Modify: `apps/api/src/validation-rules/validation-rules.service.ts`
- Modify: `apps/api/src/validation-rules/validation-rules.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
describe('ValidationRulesService.addSynonym', () => {
  function buildDbForUpdate(
    selectRow: FakeRow | undefined,
    updatedRow: FakeRow,
  ) {
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(selectRow ? [selectRow] : []),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedRow]),
          }),
        }),
      }),
    };
  }

  it('appends a new synonym, dedups, and flips source to manual', async () => {
    const updated = { ...SAMPLE, synonyms: ['DOB', 'Geburtstag', 'birthdate'], source: 'manual' };
    const db = buildDbForUpdate(SAMPLE, updated);
    const svc = await build(db);
    const result = await svc.addSynonym(SAMPLE.id, 'birthdate');
    expect(result.synonyms).toContain('birthdate');
    expect(result.source).toBe('manual');
    expect(db.update).toHaveBeenCalled();
  });

  it('does not duplicate an existing synonym (case-insensitive)', async () => {
    const updated = { ...SAMPLE, source: 'manual' };
    const db = buildDbForUpdate(SAMPLE, updated);
    const svc = await build(db);
    await svc.addSynonym(SAMPLE.id, 'dob'); // already exists as "DOB"
    const setCall = db.update.mock.results[0].value.set.mock.calls[0][0];
    expect(setCall.synonyms).toEqual(['DOB', 'Geburtstag']);
  });

  it('throws NotFoundException when the rule does not exist', async () => {
    const db = buildDbForUpdate(undefined, SAMPLE);
    const svc = await build(db);
    await expect(svc.addSynonym('00000000-0000-0000-0000-000000000000', 'X')).rejects.toThrow(
      /not found/i,
    );
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.service.spec" 2>&1 | tail -15`
Expected: FAIL — "svc.addSynonym is not a function".

- [ ] **Step 3: Implement `addSynonym`**

Append to `validation-rules.service.ts` inside the class:

```ts
  async addSynonym(id: string, synonym: string): Promise<ValidationRule> {
    const trimmed = synonym.trim();
    if (!trimmed) {
      throw new Error('synonym cannot be empty');
    }

    const existing = await this.db
      .select()
      .from(validationRules)
      .where(eq(validationRules.id, id))
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundException(`Validation rule ${id} not found`);
    }
    const current = existing[0] as ValidationRule;
    const lower = trimmed.toLowerCase();
    const already = current.synonyms.some((s) => s.toLowerCase() === lower);
    const nextSynonyms = already
      ? current.synonyms
      : [...current.synonyms, trimmed];

    const [row] = await this.db
      .update(validationRules)
      .set({
        synonyms: nextSynonyms,
        source: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(validationRules.id, id))
      .returning();
    return row as ValidationRule;
  }
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.service.spec" 2>&1 | tail -15`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.service.ts apps/api/src/validation-rules/validation-rules.service.spec.ts
git commit -m "feat(validation-rules): addSynonym() with dedup + source flip"
```

---

## Task 6: `list`, `getById`, `delete` (basic CRUD)

**Files:**
- Modify: `apps/api/src/validation-rules/validation-rules.service.ts`

- [ ] **Step 1: Append the methods to the class**

```ts
  async list(filter: { sparte?: string; query?: string } = {}): Promise<ValidationRule[]> {
    if (filter.query !== undefined && filter.query.length > 0) {
      return this.lookup(filter.query, filter.sparte);
    }
    if (filter.sparte) {
      const rows = await this.db
        .select()
        .from(validationRules)
        .where(eq(validationRules.sparte, filter.sparte));
      return rows as ValidationRule[];
    }
    const rows = await this.db.select().from(validationRules);
    return rows as ValidationRule[];
  }

  async getById(id: string): Promise<ValidationRule> {
    const rows = await this.db
      .select()
      .from(validationRules)
      .where(eq(validationRules.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`Validation rule ${id} not found`);
    }
    return rows[0] as ValidationRule;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(validationRules).where(eq(validationRules.id, id));
  }
```

- [ ] **Step 2: Build to confirm**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.service.ts
git commit -m "feat(validation-rules): list, getById, delete"
```

---

## Task 7: REST controller (JWT-guarded; mutations role-gated)

**Files:**
- Create: `apps/api/src/validation-rules/validation-rules.controller.ts`
- Create: `apps/api/src/validation-rules/validation-rules.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/validation-rules/validation-rules.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ValidationRulesController } from './validation-rules.controller';
import { ValidationRulesService } from './validation-rules.service';

describe('ValidationRulesController', () => {
  const mockService = {
    list: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue({ id: 'r1', sparte: 'Kfz' }),
    upsert: jest.fn().mockResolvedValue({ id: 'r2', sparte: 'Kfz' }),
    addSynonym: jest.fn().mockResolvedValue({ id: 'r1', synonyms: ['x'] }),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  async function build(): Promise<ValidationRulesController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationRulesController],
      providers: [{ provide: ValidationRulesService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    return moduleRef.get(ValidationRulesController);
  }

  beforeEach(() => jest.clearAllMocks());

  it('GET / forwards the filter to service.list', async () => {
    const ctrl = await build();
    await ctrl.list('Kfz', 'geburtsdatum');
    expect(mockService.list).toHaveBeenCalledWith({ sparte: 'Kfz', query: 'geburtsdatum' });
  });

  it('GET /:id forwards to getById', async () => {
    const ctrl = await build();
    const res = await ctrl.getById('r1');
    expect(res.id).toBe('r1');
  });

  it('POST /:id/synonyms forwards to addSynonym', async () => {
    const ctrl = await build();
    await ctrl.addSynonym('r1', { synonym: 'birthdate' });
    expect(mockService.addSynonym).toHaveBeenCalledWith('r1', 'birthdate');
  });

  it('POST / upserts a manual rule', async () => {
    const ctrl = await build();
    await ctrl.create({
      sparte: 'Kfz',
      fieldPath: 'foo',
      label: 'Foo',
      type: 'string',
      validators: [],
      humanRule: 'x',
    });
    expect(mockService.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sparte: 'Kfz', fieldPath: 'foo' }),
      'manual',
    );
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.controller.spec" 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './validation-rules.controller'".

- [ ] **Step 3: Implement the controller**

Create `apps/api/src/validation-rules/validation-rules.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type {
  UpsertValidationRule,
  ValidationRule,
} from './validation-rules.types';
import { ValidationRulesService } from './validation-rules.service';

@ApiTags('validation-rules')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('validation-rules')
export class ValidationRulesController {
  constructor(private readonly svc: ValidationRulesService) {}

  @ApiOperation({ summary: 'List validation rules (optionally filtered)' })
  @Get()
  list(
    @Query('sparte') sparte?: string,
    @Query('q') query?: string,
  ): Promise<ValidationRule[]> {
    return this.svc.list({ sparte, query });
  }

  @ApiOperation({ summary: 'Get a single validation rule by id' })
  @Get(':id')
  getById(@Param('id') id: string): Promise<ValidationRule> {
    return this.svc.getById(id);
  }

  @ApiOperation({ summary: 'Upsert a manual validation rule' })
  @Roles('admin', 'qa_lead')
  @Post()
  create(@Body() body: UpsertValidationRule): Promise<ValidationRule> {
    return this.svc.upsert(body, 'manual');
  }

  @ApiOperation({ summary: 'Patch an existing validation rule (becomes manual)' })
  @Roles('admin', 'qa_lead')
  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: Partial<UpsertValidationRule>,
  ): Promise<ValidationRule> {
    const existing = await this.svc.getById(id);
    return this.svc.upsert(
      {
        sparte: body.sparte ?? existing.sparte,
        fieldPath: body.fieldPath ?? existing.fieldPath,
        label: body.label ?? existing.label,
        type: body.type ?? existing.type,
        validators: body.validators ?? (existing.validators as unknown as UpsertValidationRule['validators']),
        enumValues: body.enumValues ?? existing.enumValues ?? null,
        humanRule: body.humanRule ?? existing.humanRule,
        synonyms: body.synonyms ?? existing.synonyms,
      },
      'manual',
    );
  }

  @ApiOperation({ summary: 'Add a synonym to an existing rule' })
  @Post(':id/synonyms')
  addSynonym(
    @Param('id') id: string,
    @Body() body: { synonym: string },
  ): Promise<ValidationRule> {
    return this.svc.addSynonym(id, body.synonym);
  }

  @ApiOperation({ summary: 'Delete a validation rule' })
  @Roles('admin', 'qa_lead')
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.svc.delete(id);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="validation-rules.controller.spec" 2>&1 | tail -10`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.controller.ts apps/api/src/validation-rules/validation-rules.controller.spec.ts
git commit -m "feat(validation-rules): JWT-guarded REST controller (admin-gated mutations)"
```

---

## Task 8: Module wiring + AppModule registration

**Files:**
- Create: `apps/api/src/validation-rules/validation-rules.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

- [ ] **Step 1: Create the module**

Create `apps/api/src/validation-rules/validation-rules.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ValidationRulesController } from './validation-rules.controller';
import { ValidationRulesService } from './validation-rules.service';

@Module({
  imports: [AuthModule],
  controllers: [ValidationRulesController],
  providers: [ValidationRulesService],
  exports: [ValidationRulesService],
})
export class ValidationRulesModule {}
```

- [ ] **Step 2: Register in `AppModule`**

In `apps/api/src/app/app.module.ts`, add the import:

```ts
import { ValidationRulesModule } from '../validation-rules/validation-rules.module';
```

Add `ValidationRulesModule` at the end of the `imports` array:

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
    ValidationRulesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Boot smoke test**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm start:api > /tmp/api-vr.log 2>&1 & sleep 8 && curl -sS -o /dev/null -w "GET /api/validation-rules -> %{http_code}\n" http://localhost:3000/api/validation-rules; jobs -p | xargs -r kill`
Expected: `401` (no token sent — proves the route is registered and the guard fires).

- [ ] **Step 4: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/validation-rules.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(validation-rules): module wired into AppModule"
```

---

## Task 9: Boot-time seeder + fixture test

**Files:**
- Create: `apps/api/src/validation-rules/seeder.ts`
- Create: `apps/api/src/validation-rules/seeder.spec.ts`
- Create: `apps/api/src/validation-rules/seed/.gitkeep`
- Modify: `apps/api/src/validation-rules/validation-rules.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/validation-rules/seeder.spec.ts`:

```ts
import { ValidationRulesSeeder } from './seeder';
import type { ValidationRulesService } from './validation-rules.service';

describe('ValidationRulesSeeder', () => {
  const fakeService = {
    upsert: jest.fn().mockResolvedValue({}),
    getById: jest.fn(),
    list: jest.fn(),
    addSynonym: jest.fn(),
    delete: jest.fn(),
    lookup: jest.fn(),
  } as unknown as ValidationRulesService & { upsert: jest.Mock };

  beforeEach(() => jest.clearAllMocks());

  it('upserts every entry from each Sparte file with source="seed"', async () => {
    const seedFiles = {
      'Kfz.json': [
        {
          fieldPath: 'einstieg.tarif',
          label: 'Tarif',
          type: 'enum',
          validators: [{ kind: 'required' }],
          enumValues: ['A', 'B'],
          humanRule: 'Tarif key.',
          synonyms: ['tarifart'],
        },
      ],
      'Bu.json': [
        {
          fieldPath: 'beruf',
          label: 'Beruf',
          type: 'string',
          validators: [{ kind: 'required' }],
          humanRule: 'Beruf des VN.',
          synonyms: ['profession', 'job'],
        },
      ],
    };
    const seeder = new ValidationRulesSeeder(fakeService);
    await seeder.runWithFiles(seedFiles);
    expect(fakeService.upsert).toHaveBeenCalledTimes(2);
    expect((fakeService.upsert as jest.Mock).mock.calls[0]).toEqual([
      expect.objectContaining({ sparte: 'Kfz', fieldPath: 'einstieg.tarif' }),
      'seed',
    ]);
    expect((fakeService.upsert as jest.Mock).mock.calls[1]).toEqual([
      expect.objectContaining({ sparte: 'Bu', fieldPath: 'beruf' }),
      'seed',
    ]);
  });

  it('does nothing when seedFiles is empty', async () => {
    const seeder = new ValidationRulesSeeder(fakeService);
    await seeder.runWithFiles({});
    expect(fakeService.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="seeder.spec" 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './seeder'".

- [ ] **Step 3: Implement the seeder**

Create `apps/api/src/validation-rules/seeder.ts`:

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { UpsertValidationRule } from './validation-rules.types';
import { ValidationRulesService } from './validation-rules.service';

interface SeedEntry {
  fieldPath: string;
  label: string;
  type: string;
  validators: UpsertValidationRule['validators'];
  enumValues?: string[] | null;
  humanRule: string;
  synonyms?: string[];
}

@Injectable()
export class ValidationRulesSeeder implements OnModuleInit {
  private readonly logger = new Logger(ValidationRulesSeeder.name);

  constructor(private readonly svc: ValidationRulesService) {}

  async onModuleInit(): Promise<void> {
    const files = this.readSeedDir();
    await this.runWithFiles(files);
  }

  async runWithFiles(files: Record<string, SeedEntry[]>): Promise<void> {
    let total = 0;
    for (const [filename, entries] of Object.entries(files)) {
      const sparte = filename.replace(/\.json$/, '');
      for (const e of entries) {
        try {
          await this.svc.upsert(
            {
              sparte,
              fieldPath: e.fieldPath,
              label: e.label,
              type: e.type,
              validators: e.validators,
              enumValues: e.enumValues ?? null,
              humanRule: e.humanRule,
              synonyms: e.synonyms ?? [],
            },
            'seed',
          );
          total++;
        } catch (err) {
          this.logger.warn(
            `Skipped ${sparte}.${e.fieldPath}: ${(err as Error).message}`,
          );
        }
      }
    }
    if (total > 0) {
      this.logger.log(`Seeded ${total} validation rules from JSON`);
    }
  }

  private readSeedDir(): Record<string, SeedEntry[]> {
    const dir = join(__dirname, 'seed');
    let entries: string[];
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return {};
    }
    const out: Record<string, SeedEntry[]> = {};
    for (const f of entries) {
      try {
        const raw = readFileSync(join(dir, f), 'utf8');
        out[f] = JSON.parse(raw) as SeedEntry[];
      } catch (err) {
        this.logger.warn(`Failed to read ${f}: ${(err as Error).message}`);
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Add the empty seed directory marker**

```bash
mkdir -p /Users/dp/Sources/comparit-copilot/apps/api/src/validation-rules/seed
touch /Users/dp/Sources/comparit-copilot/apps/api/src/validation-rules/seed/.gitkeep
```

- [ ] **Step 5: Wire seeder as a provider**

In `apps/api/src/validation-rules/validation-rules.module.ts`, add:

```ts
import { ValidationRulesSeeder } from './seeder';
```

And update the providers array:

```ts
@Module({
  imports: [AuthModule],
  controllers: [ValidationRulesController],
  providers: [ValidationRulesService, ValidationRulesSeeder],
  exports: [ValidationRulesService],
})
export class ValidationRulesModule {}
```

- [ ] **Step 6: Run, expect pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api --testPathPattern="seeder.spec" 2>&1 | tail -10`
Expected: 2 passing.

- [ ] **Step 7: Verify webpack bundles the JSON dir at build**

The api uses webpack which by default does not copy non-imported files. Verify by running the build:

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -10`
Expected: Build succeeds. After Task 11 commits seed JSON files, the seeder reads them at runtime via `__dirname` resolution from the source tree (`pnpm start:api` runs via `tsx`/`webpack-dev`, which keeps source paths). For production builds, the JSON files would need to be copied via webpack `assets` config — but production deployment is out of scope for this task.

- [ ] **Step 8: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/seeder.ts apps/api/src/validation-rules/seeder.spec.ts apps/api/src/validation-rules/seed/.gitkeep apps/api/src/validation-rules/validation-rules.module.ts
git commit -m "feat(validation-rules): boot-time seeder reads seed/<Sparte>.json"
```

---

## Task 10: Sparte → folder map + extraction CLI helper

**Files:**
- Create: `tools/extract-validation-rules.ts`
- Create: `tools/.gitignore` (ignore generated `.tmp` files)
- Modify: `package.json` (add a script)

- [ ] **Step 1: Add the script entry**

In `/Users/dp/Sources/comparit-copilot/package.json`, locate the `"scripts"` block and add:

```json
"extract:validation-rules": "tsx tools/extract-validation-rules.ts"
```

- [ ] **Step 2: Implement the extraction script**

Create `/Users/dp/Sources/comparit-copilot/tools/extract-validation-rules.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';

const PROTOTYPE_ROOT = '/Users/dp/Sources/prototype-frontend';
const SEED_OUT = '/Users/dp/Sources/comparit-copilot/apps/api/src/validation-rules/seed';
const SHARED_HELPER_GLOBS = [
  `${PROTOTYPE_ROOT}/libs/comparer/**/*validators*.ts`,
  `${PROTOTYPE_ROOT}/libs/**/src/lib/**/validators/**/*.ts`,
];

const SPARTE_TO_APP: Record<string, string> = {
  Kfz: 'kfz',
  Bu: 'bu',
  Rlv: 'risikoleben',
  Pr: 'private-rente',
  Br: 'basis-rente',
  Gf: 'gf',
  Hr: 'hausrat',
  Wg: 'wohngebaeude',
  Kvv: 'kvv',
  Kvz: 'kvz',
  Phv: 'phv',
};

const FORM_FILE_GLOBS = (app: string): string[] => [
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*grunddaten*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*deckungsumfang*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/*leistungsumfang*.service.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/classes/*form-manager*.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/classes/*idd-form*.ts`,
  `${PROTOTYPE_ROOT}/apps/${app}/src/app/services/ValidationHelper.ts`,
];

const PROMPT = `You are extracting validation rules from Angular reactive-form code.
For every visible form field, emit one JSON object with: fieldPath, label, type
('string'|'integer'|'number'|'boolean'|'date'|'enum'), validators (array of
{kind, value?, message?}), enumValues (only for type='enum'; null otherwise),
humanRule (one-sentence German + English description of all constraints), and
synonyms (3–6 alternate names: German labels, English aliases, common
abbreviations like 'DOB' for 'Geburtstag', 'KZH' for 'Karenzzeit').

Validator kinds you may use: required, min, max, minLength, maxLength, pattern,
minDate, maxDate, minAge, maxAge, custom. Use 'custom' for helpers whose
intent does not fit the others; put the helper name in 'message'.

Output a single JSON array. No prose, no markdown fences. Just the array.`;

interface SeedEntry {
  fieldPath: string;
  label: string;
  type: string;
  validators: { kind: string; value?: string | number; message?: string }[];
  enumValues?: string[] | null;
  humanRule: string;
  synonyms: string[];
}

async function loadSharedHelpers(): Promise<string> {
  const files = (
    await Promise.all(SHARED_HELPER_GLOBS.map((g) => glob(g)))
  ).flat();
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const f of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    parts.push(`// ===== ${basename(f)} =====`);
    try {
      parts.push(readFileSync(f, 'utf8'));
    } catch {
      // skip unreadable
    }
  }
  return parts.join('\n\n');
}

async function loadSparteFiles(app: string): Promise<string> {
  const files = (
    await Promise.all(FORM_FILE_GLOBS(app).map((g) => glob(g)))
  ).flat();
  const parts: string[] = [];
  for (const f of files) {
    parts.push(`// ===== ${f.replace(PROTOTYPE_ROOT + '/', '')} =====`);
    parts.push(readFileSync(f, 'utf8'));
  }
  return parts.join('\n\n');
}

async function extractOne(
  client: Anthropic,
  helpers: string,
  sparte: string,
  app: string,
): Promise<SeedEntry[]> {
  const sparteSrc = await loadSparteFiles(app);
  if (!sparteSrc.trim()) {
    console.warn(`[${sparte}] no form files found under apps/${app}; skipping`);
    return [];
  }
  const resp = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    system: [
      { type: 'text', text: PROMPT },
      { type: 'text', text: helpers, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Sparte: ${sparte}\n\nForm source:\n${sparteSrc}`,
      },
    ],
  });
  const text = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  // Strip optional code-fence wrapping just in case
  const jsonText = text
    .replace(/^\s*```(?:json)?/, '')
    .replace(/```\s*$/, '')
    .trim();
  return JSON.parse(jsonText) as SeedEntry[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlySparte = args
    .find((a) => a.startsWith('--sparte='))
    ?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY required');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  const helpers = await loadSharedHelpers();
  console.log(`Loaded ${helpers.length} chars of shared helpers`);

  if (!dryRun) mkdirSync(SEED_OUT, { recursive: true });

  const targets = onlySparte
    ? Object.entries(SPARTE_TO_APP).filter(([s]) => s === onlySparte)
    : Object.entries(SPARTE_TO_APP);

  for (const [sparte, app] of targets) {
    console.log(`\n[${sparte}] extracting (apps/${app})…`);
    try {
      const entries = await extractOne(client, helpers, sparte, app);
      if (dryRun) {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        const out = join(SEED_OUT, `${sparte}.json`);
        writeFileSync(out, JSON.stringify(entries, null, 2) + '\n');
        console.log(`[${sparte}] wrote ${entries.length} rules → ${out}`);
      }
    } catch (err) {
      console.error(`[${sparte}] failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Confirm `glob` is available; add if not**

Run: `cd /Users/dp/Sources/comparit-copilot && node -e "require('glob')" 2>&1 | head`
Expected: Either no output (already a transitive dep) or an error.

If error, install: `pnpm add -D glob`

- [ ] **Step 4: Verify the script type-checks**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm exec tsx --check tools/extract-validation-rules.ts 2>&1 | tail -10`
Expected: No type errors. (`--check` may not be a tsx flag; alternative: `pnpm exec tsc --noEmit tools/extract-validation-rules.ts`.)

If `--check` is unsupported, use: `pnpm exec tsc --noEmit --moduleResolution bundler --module esnext --target es2022 tools/extract-validation-rules.ts`

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add tools/extract-validation-rules.ts package.json
git commit -m "tools: AI extraction script for validation rules"
```

---

## Task 11: Run extraction for all 11 Sparten and commit seed JSON

**Files:**
- Create: `apps/api/src/validation-rules/seed/Kfz.json` … `Phv.json` (11 files total)

- [ ] **Step 1: Run a dry run for Kfz to spot-check**

Run: `cd /Users/dp/Sources/comparit-copilot && ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2) pnpm extract:validation-rules -- --sparte=Kfz --dry-run 2>&1 | head -100`

Expected: A JSON array printed to stdout. Skim 3–5 entries and confirm:
- Each has `fieldPath`, `label`, `type`, `validators[]`, `humanRule`, `synonyms[]`.
- Synonyms include German + English variants.
- At least one entry references a custom validator (e.g., `kennzeichenTeil1Validator`) with a sensible `humanRule`.

- [ ] **Step 2: Run the full extraction**

Run: `cd /Users/dp/Sources/comparit-copilot && ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2) pnpm extract:validation-rules 2>&1 | tail -30`

Expected: For each Sparte, log "wrote N rules → …/Kfz.json". Some Sparten may emit 0 rules if their app folder lacks form services (e.g. `kvz` if it has no grunddaten file) — that's acceptable.

- [ ] **Step 3: Spot-check two more Sparten**

Run: `cd /Users/dp/Sources/comparit-copilot && jq -r '.[].fieldPath' apps/api/src/validation-rules/seed/Bu.json | head -20 && echo --- && jq -r '.[].fieldPath' apps/api/src/validation-rules/seed/Phv.json | head -20`
Expected: Plausible `fieldPath`s. Manual review confirms they reference real form fields.

- [ ] **Step 4: Verify all 11 files exist and parse as JSON**

Run: `cd /Users/dp/Sources/comparit-copilot && for f in Kfz Bu Rlv Pr Br Gf Hr Wg Kvv Kvz Phv; do test -f apps/api/src/validation-rules/seed/$f.json && jq empty apps/api/src/validation-rules/seed/$f.json && echo "$f OK" || echo "$f MISSING/INVALID"; done`
Expected: 11 lines all ending in `OK`.

- [ ] **Step 5: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/validation-rules/seed/*.json
git commit -m "feat(validation-rules): seed JSON for all 11 Sparten (AI-extracted)"
```

---

## Task 12: Boot smoke test — seeder populates the table

- [ ] **Step 1: Reset the table for a clean smoke**

Run: `cd /Users/dp/Sources/comparit-copilot && docker compose -f infra/docker-compose.yml exec -T postgres psql -U postgres -d copilot -c "TRUNCATE validation_rules;" 2>&1 | tail -5`
Expected: `TRUNCATE TABLE` (or table doesn't exist yet — fine after Task 1's migration is applied on next boot).

- [ ] **Step 2: Boot api**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm start:api > /tmp/api-vr-seed.log 2>&1 & sleep 12; grep -E "Seeded|validation_rules" /tmp/api-vr-seed.log | tail`
Expected: `Seeded N validation rules from JSON` where N is the total entries across all `seed/*.json`.

- [ ] **Step 3: Verify via REST**

Run: `cd /Users/dp/Sources/comparit-copilot && TOKEN=$(curl -sS -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@comparit.de","password":"admin"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])"); curl -sS -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/validation-rules?sparte=Kfz" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Got {len(d)} Kfz rules; first label: {d[0][\"label\"] if d else \"NONE\"}')"`
Expected: At least 5 Kfz rules; first label is a plausible German field name.

- [ ] **Step 4: Stop api**

Run: `lsof -ti:3000 | xargs kill -9 2>/dev/null; echo done`

- [ ] **Step 5: No commit (smoke test only).**

---

## Task 13: Chat tools — `lookup_field_rule` + `add_field_synonym` declarations

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot-agent.service.ts`

- [ ] **Step 1: Append the tool declarations**

In `apps/api/src/ai/copilot/copilot-agent.service.ts`, find the closing `];` of `COPILOT_TOOLS` (after the `validate_prefill` declaration added earlier) and insert these two entries before the `];`:

```ts
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
```

- [ ] **Step 2: Build**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot-agent.service.ts
git commit -m "feat(copilot): declare lookup_field_rule + add_field_synonym tools"
```

---

## Task 14: System-prompt addendum + module wiring + `executeTool` cases

**Files:**
- Modify: `apps/api/src/ai/copilot/copilot.module.ts`
- Modify: `apps/api/src/ai/copilot/copilot-agent.service.ts`

- [ ] **Step 1: Wire `ValidationRulesModule` into `CopilotModule`**

In `apps/api/src/ai/copilot/copilot.module.ts`, add the import:

```ts
import { ValidationRulesModule } from '../../validation-rules/validation-rules.module';
```

Update the `imports` array:

```ts
@Module({
  imports: [AuthModule, AiModule, IndexModule, JiraModule, PrefillModule, ValidationRulesModule],
  controllers: [CopilotController],
  providers: [CopilotAgentService, CopilotSessionService],
})
export class CopilotModule {}
```

- [ ] **Step 2: Inject `ValidationRulesService` into the agent**

In `apps/api/src/ai/copilot/copilot-agent.service.ts`, add the import:

```ts
import { ValidationRulesService } from '../../validation-rules/validation-rules.service';
```

Update the constructor (add the new dependency right after `prefill`):

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
    private readonly validationRules: ValidationRulesService,
    @Optional() private readonly codeLocalizer?: CodeLocalizerService,
    @Optional() private readonly transcriptDecomposer?: TranscriptDecomposerService
  ) {}
```

- [ ] **Step 3: Extend the prefill-addendum function with field-rule guidance**

Locate the `prefillAddendum` function and replace it with:

```ts
function prefillAddendum(stage: 'live' | 'qa' | 'dev'): string {
  return `\n\nPREFILL VALIDATION:
- When the user pastes JSON containing a \`sparte\` field or a \`prefillData\` wrapper, IMMEDIATELY call validate_prefill.
- Pass the pasted JSON verbatim as the \`json\` argument.
- Pass \`stage: "${stage}"\` (this is the active session stage).
- On result: write a conversational reply. Lead with missing required fields if any, then type errors. Cap the first reply at 5 issues; if there are more, end with "Want me to list the rest?".
- If the result has \`schemaSource: "static"\`, mention "(offline schema; required-field check skipped)".

FIELD-RULE LOOKUP:
- When the user asks about a Sparte field (German labels like Geburtsdatum, Versicherungssumme, Karenzzeit, etc.), call lookup_field_rule first.
- If lookup returns 0 rows: say so and suggest 2–3 close alternatives based on the wording.
- If lookup returns multiple rows (same field across Sparten): summarize per Sparte.
- When the user says "remember/save/add 'X' as synonym for Y": call add_field_synonym after a fresh lookup_field_rule to get the rule id.`;
}
```

- [ ] **Step 4: Add the `executeTool` cases**

Find the `executeTool` switch and append two cases before the `default:`:

```ts
        case 'lookup_field_rule': {
          const query = String(input['query'] ?? '');
          const sparteFilter =
            typeof input['sparte'] === 'string' ? (input['sparte'] as string) : undefined;
          const rules = await this.validationRules.lookup(query, sparteFilter);
          return {
            nextState: state,
            toolData: rules,
            message: JSON.stringify({
              count: rules.length,
              rules: rules.slice(0, 10).map((r) => ({
                id: r.id,
                sparte: r.sparte,
                fieldPath: r.fieldPath,
                label: r.label,
                type: r.type,
                humanRule: r.humanRule,
                enumValues: r.enumValues,
                synonyms: r.synonyms,
              })),
            }),
            isError: false,
          };
        }

        case 'add_field_synonym': {
          const ruleId = String(input['ruleId'] ?? '');
          const synonym = String(input['synonym'] ?? '');
          try {
            const updated = await this.validationRules.addSynonym(ruleId, synonym);
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
```

- [ ] **Step 5: Build**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/dp/Sources/comparit-copilot
git add apps/api/src/ai/copilot/copilot.module.ts apps/api/src/ai/copilot/copilot-agent.service.ts
git commit -m "feat(copilot): wire validation-rules into agent (lookup + add_synonym)"
```

---

## Task 15: Frontend tool-chip labels

**Files:**
- Modify: `apps/web/src/app/pages/copilot/copilot.component.ts`

- [ ] **Step 1: Add the new entries to the labels map**

Locate the `toolLabel` method's `labels` object and add:

```ts
      lookup_field_rule: 'Looking up field rule…',
      add_field_synonym: 'Saving synonym…',
```

So the full method becomes:

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
      lookup_field_rule: 'Looking up field rule…',
      add_field_synonym: 'Saving synonym…',
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
git commit -m "feat(copilot/web): friendly tool-chip labels for validation-rules tools"
```

---

## Task 16: Lint + full tests + manual chat smoke

- [ ] **Step 1: Lint api (only fail on errors from the new code)**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx lint api 2>&1 | tail -10`
Expected: Pre-existing warnings acceptable. No new errors in `apps/api/src/validation-rules/` or `apps/api/src/ai/copilot/`.

- [ ] **Step 2: Full api test pass**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx test api 2>&1 | tail -10`
Expected: All passing (existing 93 + 12 new ≈ 105).

- [ ] **Step 3: Build api + web**

Run: `cd /Users/dp/Sources/comparit-copilot && pnpm nx build api && pnpm nx build web 2>&1 | tail -8`
Expected: Both succeed.

- [ ] **Step 4: Restart api + web for smoke**

Run: `cd /Users/dp/Sources/comparit-copilot && pkill -f "nx serve api" 2>/dev/null; pkill -f "nx serve web" 2>/dev/null; lsof -ti:3000 | xargs kill -9 2>/dev/null; lsof -ti:4240 | xargs kill -9 2>/dev/null; sleep 2; pnpm start:api > /tmp/api-vr-final.log 2>&1 & pnpm start:web > /tmp/web-vr-final.log 2>&1 &
echo "started"`

Wait for both to be up:
Run: `until curl -sf http://localhost:3000/api/health > /dev/null && curl -sf http://localhost:4240 > /dev/null; do sleep 2; done; echo "both up"`

- [ ] **Step 5: Manual smoke (browser)**

Open http://localhost:4240/copilot, log in as `admin@comparit.de` / `admin`, start a new session. Test each:

1. Ask: *"What are the rules for Geburtsdatum in Kfz?"* → expect `Looking up field rule…` chip and a conversational reply naming validators (e.g. "must be in the past", min age).
2. Ask: *"What does DOB mean?"* → expect `Looking up field rule…` to return 0; agent suggests "Geburtsdatum".
3. Ask: *"Remember that DOB means Geburtsdatum in Kfz."* → expect `Looking up field rule…` then `Saving synonym…`; ack reply.
4. Ask: *"What are the rules for DOB in Kfz?"* → resolves now via the new synonym.
5. Ask: *"What's the Karenzzeit in BU?"* → returns enum values (e.g. 3, 6, 12 months) + humanRule.

- [ ] **Step 6: Push**

Run: `cd /Users/dp/Sources/comparit-copilot && git push origin main 2>&1 | tail -5`
Expected: Branch up to date or new commits pushed.

---

## Done

The `validation_rules` table is seeded from AI-extracted JSON, exposed as JWT-guarded REST + two chat tools. Manual edits via the chat (`add_field_synonym`) flip rows to `source='manual'` so the seeder never overwrites user additions. Re-running the extraction script + rebooting refreshes the seed-source rows in place.
