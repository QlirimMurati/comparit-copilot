# Validation Rules Table for Chat — Design

**Date:** 2026-04-28
**Status:** Draft (pending user review)
**Builds on:** `docs/superpowers/specs/2026-04-28-prefill-in-chat-design.md`

## Goal

Extract validation rules from `prototype-frontend` (every Sparte's Angular reactive-form services + custom validator helpers) into a queryable table, expose it to the Copilot chat agent via a `lookup_field_rule` tool, and let the table grow over time via chat-driven synonym additions and admin REST edits.

The chat must be able to answer questions like:
- *"What are the rules for Geburtsdatum in Kfz?"*
- *"What does Karenzzeit mean in BU?"*
- *"Remember that DOB means Geburtsdatum."*

…and it must understand at least the Sparte field synonyms seeded at extraction time, with the ability to learn new ones during conversation.

## Non-goals

- Vector embeddings for fuzzy synonyms (deferred — text-array LIKE plus the agent's own paraphrasing is enough for v1).
- Auto-extraction on every prototype-frontend commit (deferred — the seeder is run manually for now).
- A web admin UI for editing rules (REST endpoints exist; an Angular page can land later).
- Cross-validation of prototype-extracted rules against the live Pool API Swagger (deferred).
- Changing the existing Prefill tab or `validate_prefill` chat tool — they continue to operate against the Pool Swagger.

## Decisions (locked from brainstorm)

| # | Decision |
|---|---|
| Scope | One spec covering all four sub-features (extraction, storage, chat, learning). Each section thin and YAGNI. |
| Extraction | **A — AI extraction.** A one-shot Node script feeds each Sparte's form-service files (plus shared helper definitions) to Claude; output is structured JSON committed to git. |
| Storage | **A — Postgres via Drizzle.** New `validation_rules` table; seeder upserts JSON rows on api boot. |
| Chat integration | **A — new `lookup_field_rule` tool**, with a thin auto-trigger in the system prompt. |
| Synonyms | **A — hand-curated array per rule, seeded at extraction time.** Lookup matches case-insensitively against label, fieldPath, and synonyms. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Extraction (one-time, repeatable seeder)                          │
│   tools/extract-validation-rules.ts  (NEW — runs out of band)     │
│     ├─ scans /Users/dp/Sources/prototype-frontend/apps/<sparte>/  │
│     │  for *grunddaten*.service.ts, *form-manager*.ts, etc.       │
│     ├─ for each Sparte: feeds source + shared helper defs to      │
│     │  Claude (Anthropic SDK; uses prompt-cache on shared prefix) │
│     ├─ Claude returns structured rules JSON                       │
│     ├─ writes apps/api/src/validation-rules/seed/<Sparte>.json    │
│     │  (committed to git — reproducible source of truth)          │
│     └─ idempotent: re-running re-emits the JSON                   │
│                              │                                    │
│                              ▼  pnpm seed:validation-rules        │
│                              ▼  (or automatic on api boot)        │
├──────────────────────────────────────────────────────────────────┤
│ Backend (apps/api/src/validation-rules/)                          │
│   validation-rules.module.ts                                      │
│   validation-rules.controller.ts  (admin REST, JWT-guarded)       │
│   validation-rules.service.ts     (queries Drizzle)               │
│   validation-rules.types.ts                                       │
│   seeder.ts                       (boot-time JSON → DB upsert)    │
│                                                                   │
│ apps/api/src/db/schema/validation-rules.ts                        │
│   table: validation_rules                                         │
│     (id, sparte, fieldPath, label, type, validators jsonb,        │
│      enumValues text[], humanRule text, synonyms text[],          │
│      source 'seed'|'manual', createdAt, updatedAt)                │
├──────────────────────────────────────────────────────────────────┤
│ Chat (apps/api/src/ai/copilot/)                                   │
│   COPILOT_TOOLS gains: lookup_field_rule, add_field_synonym       │
│   System prompt addendum: "If user asks about a Sparte field,     │
│     call lookup_field_rule first."                                │
│   executeTool dispatches to ValidationRulesService                │
│ Frontend (apps/web)                                               │
│   Tool-chip labels: "Looking up field rule…", "Saving synonym…"   │
└──────────────────────────────────────────────────────────────────┘
```

The seeder is **two-step**:
1. AI extracts rules to JSON files (`seed/<Sparte>.json`), committed to git.
2. On api boot, `seeder.ts` upserts those JSON rows into `validation_rules` (only rows with `source='seed'` are touched — manual edits are never overwritten).

## Data model

### `apps/api/src/db/schema/validation-rules.ts`

```ts
import { pgTable, text, timestamp, jsonb, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  message?: string; // human-readable description of the rule
}

export const validationRules = pgTable(
  'validation_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
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
    source: text('source').notNull().default('seed'), // 'seed' | 'manual'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sparteFieldUq: uniqueIndex('validation_rules_sparte_field_uq').on(t.sparte, t.fieldPath),
  }),
);
```

### Seed JSON shape (one file per Sparte)

```json
[
  {
    "fieldPath": "versicherungsnehmer.geburtsdatum",
    "label": "Geburtsdatum",
    "type": "date",
    "validators": [
      { "kind": "required" },
      { "kind": "maxDate", "value": "today", "message": "must be in the past" },
      { "kind": "minAge", "value": 18, "message": "policyholder must be at least 18 at contract start" }
    ],
    "enumValues": null,
    "humanRule": "Date of birth. Required. Must be in the past. Policyholder must be at least 18 (and at most 90) at contract start.",
    "synonyms": ["Geburtstag", "DOB", "birthdate", "date of birth"]
  }
]
```

## Extraction script (`tools/extract-validation-rules.ts`)

- For each Sparte folder under `/Users/dp/Sources/prototype-frontend/apps/`, glob the form-defining files: `**/services/*grunddaten*.service.ts`, `**/services/*deckungsumfang*.service.ts`, `**/classes/*form-manager*.ts`, plus the per-app `services/ValidationHelper.ts` if present.
- Build one Anthropic message per Sparte with two blocks:
  1. **Cached prefix** (shared across Sparten): the validator helper definitions from `libs/comparer` and `@comparit/core` (read once at script start).
  2. **Variable suffix**: the Sparte's form files concatenated.
- Prompt asks Claude to emit JSON matching the seed shape above, **including 3–6 synonyms per field** (German + English aliases, common abbreviations).
- Output written to `apps/api/src/validation-rules/seed/<Sparte>.json`. Idempotent: re-running overwrites the same files.
- Sparte → file mapping (matches the existing prefill `sparteToSchemaName`):
  `Kfz`, `Bu`, `Rlv` (= `risikoleben`), `Pr` (= `private-rente`), `Br` (= `basis-rente`), `Gf` (= `gf`), `Hr` (= `hausrat`), `Wg` (= `wohngebaeude`), `Kvv` (= `kvv`), `Kvz` (= `kvz`), `Phv` (= `phv`).
- CLI flags:
  - `--sparte <name>` — extract only one Sparte (helpful for re-runs / spot checks).
  - `--dry-run` — print the JSON to stdout instead of writing to disk.
- The script reads `ANTHROPIC_API_KEY` from the same `.env` the api uses.
- Cost: roughly 11 × ~30k input tokens ≈ ~330k input tokens with prompt caching, one-shot per run. Acceptable for a manual reproducible step.

## Backend module (`apps/api/src/validation-rules/`)

### Files

```
validation-rules/
  validation-rules.module.ts
  validation-rules.controller.ts
  validation-rules.service.ts
  validation-rules.types.ts
  seeder.ts
  seed/
    Kfz.json   Bu.json   Rlv.json   Pr.json   Br.json
    Gf.json    Hr.json   Wg.json    Kvv.json  Kvz.json
    Phv.json
```

### `ValidationRulesService` methods

```ts
class ValidationRulesService {
  list(filter: { sparte?: string; query?: string }): Promise<ValidationRule[]>;
  getById(id: string): Promise<ValidationRule>;
  lookup(query: string, sparte?: string): Promise<ValidationRule[]>;
  // case-insensitive match against label, fieldPath, OR any element of synonyms
  upsert(input: UpsertRule, source: 'seed' | 'manual'): Promise<ValidationRule>;
  addSynonym(id: string, synonym: string): Promise<ValidationRule>;
  delete(id: string): Promise<void>;
}
```

`lookup(query, sparte)` SQL sketch:

```sql
SELECT * FROM validation_rules
WHERE (
  label ILIKE '%' || $1 || '%'
  OR field_path ILIKE '%' || $1 || '%'
  OR EXISTS (
    SELECT 1 FROM unnest(synonyms) s WHERE s ILIKE '%' || $1 || '%'
  )
)
AND ($2::text IS NULL OR sparte = $2)
ORDER BY sparte, field_path
LIMIT 25;
```

### REST endpoints

All JWT-guarded. Mutation endpoints additionally role-gated to `admin` / `qa_lead` (mirrors the existing admin module).

| Method | Path                                              | Auth        | Body / Returns                                                  |
|--------|---------------------------------------------------|-------------|-----------------------------------------------------------------|
| GET    | `/api/validation-rules?sparte=Kfz&q=geburtsdatum` | JWT         | `ValidationRule[]`                                              |
| GET    | `/api/validation-rules/:id`                       | JWT         | `ValidationRule`                                                |
| POST   | `/api/validation-rules`                           | JWT + admin | Upserts a `manual` row; returns `ValidationRule`                |
| PATCH  | `/api/validation-rules/:id`                       | JWT + admin | Updates `humanRule`, `validators`, `synonyms`, `enumValues`     |
| POST   | `/api/validation-rules/:id/synonyms`              | JWT         | `{ synonym }` → adds to the array; flips `source` to `'manual'` |
| DELETE | `/api/validation-rules/:id`                       | JWT + admin | 204                                                             |

### Boot-time seeder (`seeder.ts`)

- Implements `OnApplicationBootstrap`.
- Reads each `seed/*.json`. For every entry, calls `service.upsert(..., 'seed')` which:
  - On insert: creates with `source='seed'`.
  - On conflict (`sparte + fieldPath`): if existing row has `source='seed'`, replace fields (label, type, validators, enumValues, humanRule, synonyms). If existing row has `source='manual'`, do nothing.
- Logs `Seeded N rules; skipped M manual` on boot.
- Failures (malformed JSON, DB error) log a warning and do not block app start — same pattern as the existing `bootstrap-admin.ts`.

### Module wiring

`AppModule.imports` adds `ValidationRulesModule`. The module imports `AuthModule` (for the JWT guard).

## Chat agent integration

### `apps/api/src/ai/copilot/copilot-agent.service.ts`

**1. New tools in `COPILOT_TOOLS`:**

```ts
{
  name: 'lookup_field_rule',
  description:
    'Look up validation rules for a Sparte field. Use when the user asks "what are the rules for X?", "what is allowed for Y?", or asks about specific German field names like Geburtsdatum, Versicherungssumme, Beitragszahlung, etc. Matches by field name, dotted path, or synonym (case-insensitive).',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Field name or related term the user mentioned.' },
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
      ruleId: { type: 'string', description: 'The rule UUID returned by lookup_field_rule.' },
      synonym: { type: 'string', description: 'The new synonym to add.' },
    },
    required: ['ruleId', 'synonym'],
    additionalProperties: false,
  },
},
```

**2. System prompt addendum** (concatenated alongside the existing prefill addendum):

```
FIELD-RULE LOOKUP:
- When the user asks about a Sparte field (German labels like Geburtsdatum, Versicherungssumme, Karenzzeit, etc.), call lookup_field_rule first.
- If lookup returns 0 rows: say so and suggest 2–3 close alternatives based on the wording.
- If lookup returns multiple rows (same field across Sparten): summarize per Sparte.
- When the user says "remember/save/add 'X' as synonym for Y": call add_field_synonym after a fresh lookup_field_rule to get the rule id.
```

**3. `executeTool` cases** for `lookup_field_rule` and `add_field_synonym` — see Section 4 of the brainstorm transcript for code; in short, both delegate to `ValidationRulesService` and return `toolData` + a compact summary `message`.

### Module wiring

`CopilotModule.imports` adds `ValidationRulesModule`. The agent's constructor injects `ValidationRulesService`.

### Frontend tool-chip labels (`apps/web/src/app/pages/copilot/copilot.component.ts`)

```ts
lookup_field_rule: 'Looking up field rule…',
add_field_synonym: 'Saving synonym…',
```

## Learning loop

Three concrete write paths, all funneled through `validation_rules`:

| Path | Trigger | Effect | Permission |
|---|---|---|---|
| **Re-seed from JSON** | Engineer runs `pnpm extract:validation-rules` then `pnpm seed:validation-rules` (or just reboots the api) | Seed-sourced rows refresh; manual rows untouched | Local / CI |
| **Chat synonym add** | Any authenticated user via the `add_field_synonym` tool | Appends to `synonyms[]` (dedup, case-insensitive); flips `source` from `'seed'` to `'manual'` if it was seed so future re-seeds don't overwrite the user's addition | Logged-in user |
| **Admin REST edit** | Admin / qa_lead via `PATCH /api/validation-rules/:id` (or a future thin admin UI) | Updates `humanRule`, `validators`, `synonyms`, `enumValues`; sets `source='manual'` | Role-gated |

**Reproducibility / safety:**
- `source='manual'` rows are **never** overwritten by the seeder.
- Chat-added synonyms are persisted immediately and visible to the next `lookup_field_rule` call — no cache to invalidate.
- Seeder is idempotent. Seed JSON is committed to git so changes are reviewable in PRs.

## Error handling

| Case | Behavior |
|---|---|
| Same field appears in multiple Sparten with different rules | Each Sparte gets its own row; lookup with no `sparte` returns all matches; chat summarizes per Sparte. |
| User asks about a field that doesn't exist | `lookup_field_rule` returns `[]`; agent suggests close alternatives based on the original query. |
| Synonym collides with another field | Lookup returns multiple rules; agent disambiguates ("Did you mean Geburtsdatum (Kfz) or Geburtsdatum (Bu)?"). |
| Extraction misses a custom validator | Spot-checked manually after extraction; `humanRule` describes intent textually. Easy to fix via PATCH. |
| Seed JSON disagrees with DB after manual edits | Seeder ignores `source='manual'` rows; engineer can force-reset via DELETE + re-seed. |
| `add_field_synonym` ruleId not found | Service throws `NotFoundException`; tool returns `is_error: true`. |
| Anthropic API key missing during extraction | Script logs an error and exits non-zero. (api boot is unaffected — seeder reads JSON, not Anthropic.) |

## Testing

### Backend

- `validation-rules.service.spec.ts`:
  - `lookup` matches case-insensitively against `label`, `fieldPath`, `synonyms`.
  - `lookup` filters by `sparte` when provided.
  - `addSynonym` appends, dedups, and flips `source` to `'manual'`.
  - `upsert` idempotency: same input twice → one row, second `updatedAt` newer.
- `seeder.spec.ts`:
  - reading a fixture `seed/Test.json` upserts N rows;
  - second run with same JSON keeps `source='seed'` rows in sync;
  - rows with `source='manual'` are never modified.
- `validation-rules.controller.spec.ts`: light controller test mocking the service with `JwtAuthGuard.overrideGuard`. Mirrors `prefill.controller.spec.ts`.

### Extraction script

Not unit-tested (calls Anthropic). Manual checklist after running:
1. Each `seed/<Sparte>.json` file exists and parses as JSON.
2. Spot-check `Kfz.json` and `Bu.json`: at least 5 fields each, plausible synonyms.
3. `--dry-run` mode writes to stdout instead of disk (used to verify before committing).

### Manual smoke test (after seeding)

1. Boot api; check log for `Seeded N rules; skipped M manual`.
2. Open the Copilot chat. Ask: *"What are the rules for Geburtsdatum in Kfz?"* → expect `lookup_field_rule` tool chip, then a conversational reply citing the rule.
3. Ask: *"What does DOB mean?"* → expect `lookup_field_rule` to return 0 rows (synonym not seeded) → agent suggests "Geburtsdatum".
4. Ask: *"Remember that DOB means Geburtsdatum in Kfz."* → expect `lookup_field_rule` (resolves the rule), then `add_field_synonym` (adds DOB).
5. Ask: *"What are the rules for DOB in Kfz?"* → now resolves correctly via the new synonym; `source` shows `manual`.
6. Ask: *"What's the Karenzzeit in BU?"* → returns the Bu enum values + humanRule.

### Lint / build

```
pnpm nx test api && pnpm nx lint api && pnpm nx build api
pnpm nx build web   # frontend tool-chip label change
```

## Out of scope (deliberate)

- Vector embeddings for fuzzy synonyms.
- Auto-extraction on every prototype-frontend commit (CI hook).
- A web admin UI for editing rules.
- Cross-validation of prototype-extracted rules against the live Pool API Swagger.
- Role-aware restrictions on `add_field_synonym` (any logged-in user can add — controllable later via a setting if abuse appears).
