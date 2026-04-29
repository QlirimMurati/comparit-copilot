# Prefill Tab Integration — Design

**Date:** 2026-04-28
**Status:** Draft (pending user review)

## Goal

Integrate the standalone `pool-prefill-checker` project into `comparit-copilot` as a top-level admin tab named **Prefill**, sitting next to Dashboards. The integrated tab must behave like the standalone tool: validate pasted JSON prefill data against the comparit Pool API schema, with LIVE / QA / DEV stage selection and live Swagger fetch. The standalone repo at `/Users/dp/Sources/pool-prefill-checker/` continues to exist independently and is not modified.

## Non-goals

- Sharing code between the standalone repo and copilot (no extracted lib).
- Embedding the standalone HTTP server (no iframe / sidecar process).
- Changing the validation rules.
- Reusing the standalone tool's dark theme.

## Decisions (locked from brainstorm)

| # | Decision |
|---|---|
| Schema source | **C — live fetch with bundled static `schema.ts` as offline fallback.** Stage toggle stays. |
| Tab placement | **A — top-level `Prefill` tab, visible to all authenticated users** (no role gate, like Reports / Dashboards). |
| Styling | **A — full Tailwind / light theme**, matching Reports and Dashboards. |
| UX features | **A — keep all:** auto-detect Sparte, Format JSON button, Cmd/Ctrl+Enter, replace textarea with cleaned JSON on validate, stage toggle with colored badges. |
| Backend strategy | **A — port the validator into a NestJS module** at `apps/api/src/prefill/`. No workspace lib. |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web (Angular 19, standalone, signals, OnPush)          │
│   pages/prefill/prefill.component.{ts,html}                  │
│     ├── stage toggle (LIVE / QA / DEV)                       │
│     ├── Sparte select + JSON textarea + Validate button      │
│     ├── auto-detect, format, Ctrl+Enter, clean-json swap     │
│     └── result panel (status banner + error table)           │
│                                                              │
│   core/api/prefill.service.ts  (HttpClient wrapper)          │
│   core/api/prefill.types.ts                                  │
│                            │                                 │
│                            ▼ POST /api/prefill/validate      │
│                            ▼ GET  /api/prefill/sparten       │
│ ─────────────────────────────────────────────────────────────│
│  apps/api (NestJS 10)                                        │
│   prefill/prefill.controller.ts   ← @UseGuards(JwtGuard)     │
│   prefill/prefill.service.ts      ← orchestrates             │
│   prefill/prefill.types.ts                                   │
│   prefill/lib/                                               │
│     ├── validator.ts        (copy from pool-prefill-checker) │
│     ├── parse-input.ts      (copy)                           │
│     ├── swagger-loader.ts   (copy + static fallback wired)   │
│     └── schema.ts           (copy — 1120-line static fallback)│
│                            │                                 │
│                            ▼ on first call / cache miss      │
│   pool.cpit.app / pool.qa.cpit.app / pool.cpit.dev           │
│      /swagger/v1/swagger.json                                │
│                            │                                 │
│   on fetch failure → static schema.ts; response carries      │
│   schemaSource: 'static' so the UI shows an offline chip.    │
└─────────────────────────────────────────────────────────────┘
```

## Backend (`apps/api/src/prefill/`)

### Files

```
prefill/
  prefill.module.ts        — @Module, imported by AppModule
  prefill.controller.ts    — @UseGuards(JwtGuard), Swagger tag 'prefill'
  prefill.service.ts       — orchestration; sparten label map
  prefill.types.ts         — request / response DTOs
  lib/
    validator.ts           — copy, drop .js import suffixes
    parse-input.ts         — copy, drop .js import suffixes
    swagger-loader.ts      — copy + add static fallback
    schema.ts              — copy (static fallback, ~1120 lines)
```

### Endpoints

| Method | Path                       | Auth      | Returns |
|--------|----------------------------|-----------|---------|
| GET    | `/api/prefill/sparten`     | JwtGuard  | `[{ key, label }]` — drives the dropdown |
| POST   | `/api/prefill/validate`    | JwtGuard  | `{ valid, errors, fieldCount, cleanJson, stage, schemaSource }` |

`POST /api/prefill/validate` body: `{ sparte: string; json: string; stage: 'live' \| 'qa' \| 'dev' }`.

`schemaSource` is `'live'` when the Swagger fetch succeeded (or returned a still-warm cache entry) and `'static'` when the service fell back to the bundled `schema.ts`.

### Service flow (`PrefillService.validate`)

1. Try `loadSchema(stage)` from `lib/swagger-loader.ts` (5-minute TTL cache per stage).
2. On any thrown error, log a warning via Nest `Logger` and use the bundled `{ enums, prefillSchemas }` from `lib/schema.ts`. Mark `schemaSource = 'static'`.
3. `parseAndUnwrap(json)` — strips trailing junk, unwraps `prefillData`.
4. On JSON-parse failure, return HTTP 400 with `{ error: 'Invalid JSON …' }`.
5. If the resolved sparte is not in the schema, return HTTP 400 with the list of valid sparten.
6. Otherwise call `validatePrefill(sparte, data, source)` → return errors + the cleaned JSON string.

### Adaptation when copying the four `lib/` files

- Drop `.js` import suffixes (copilot api uses standard TS module resolution).
- Replace `console.error` with Nest `Logger`.
- The Sparte → German label map currently inlined in `pool-prefill-checker/src/server.ts` moves into `prefill.service.ts` and is exposed via `GET /api/prefill/sparten`.
- `swagger-loader.ts` keeps its in-process 5-minute cache (no Redis needed — the data is small and re-fetch on miss is cheap).

### Module wiring

`PrefillModule` is added to `AppModule.imports` next to `BugReportsModule`. It depends on `AuthModule` (re-exporting `JwtGuard`), same pattern as the existing modules.

## Frontend (`apps/web/src/app/pages/prefill/`)

### Files

```
apps/web/src/app/pages/prefill/
  prefill.component.ts       — standalone, OnPush, signals
  prefill.component.html     — Tailwind, light theme

apps/web/src/app/core/api/
  prefill.service.ts         — HttpClient wrapper (validate, listSparten)
  prefill.types.ts           — Sparte, Stage, ValidationError, ValidateResponse
```

### Component shape

Standalone Angular 19 component, signal-based, `ChangeDetectionStrategy.OnPush`, mirroring the conventions from `dashboards.component.ts`:

```ts
class PrefillComponent {
  private api = inject(PrefillService);

  protected sparten = signal<{ key: string; label: string }[]>([]);
  protected stage   = signal<'live' | 'qa' | 'dev'>('live');
  protected sparte  = signal<string>('');
  protected json    = signal<string>('');
  protected result  = signal<ValidateResponse | { error: string } | null>(null);
  protected loading = signal(false);
  protected autoDetected = signal<string | null>(null);

  // effect on json(): try extractFirstJson + JSON.parse; if data.sparte exists
  // and is in sparten(), set sparte() and autoDetected() — non-destructive.

  // template binds (keydown.control.enter) and (keydown.meta.enter) on
  // textarea to validate().

  // formatJson(): pretty-prints input via extractFirstJson + JSON.stringify(_, null, 2).

  // validate(): posts to /api/prefill/validate; on success, swaps json() with
  // response.cleanJson (formatted).
}
```

`extractFirstJson` and `parseAndUnwrap` are duplicated client-side as small helpers in the component file (auto-detect needs to run on every keystroke; calling the backend would be wasteful). The canonical implementations stay on the server — the client copies are best-effort heuristics for live UX only.

### Layout (Tailwind, light)

```
┌──────────────────────────────────────────────────────────────────┐
│ Page header: "Prefill validator"   [LIVE] [QA] [DEV] toggle pill │
├─────────────────────────────────┬────────────────────────────────┤
│ INPUT panel (rounded-lg border) │ RESULT panel                   │
│  ─ Sparte select   [Validate]   │  status banner                 │
│  ─ <textarea>  monospace,       │   (green ok / red err /        │
│      h-[480px], font-mono       │    amber warn / slate idle)    │
│      bg-slate-50 inside the     │  + stage badge                 │
│      light card                 │  + field count                 │
│  ─ "Auto-detected: <Sparte>"    │  errors table:                 │
│  ─ "Format JSON" link button    │   Field | Error | Value | Exp. │
└─────────────────────────────────┴────────────────────────────────┘
```

- Two-column grid at `md:` breakpoint, single column on mobile.
- Status banner colors via Tailwind: `bg-emerald-50 text-emerald-800` (ok), `bg-rose-50 text-rose-800` (err), `bg-amber-50 text-amber-800` (warn), `bg-slate-100 text-slate-600` (idle).
- Stage toggle is a 3-button segmented control. Active state colored per stage: emerald (LIVE), amber (QA), sky (DEV).
- Code-like fields (`path`, `value`, `expected`) use `font-mono text-xs` on the light card surface.
- When `schemaSource === 'static'`, a small amber chip "offline schema (fallback)" appears next to the stage badge in the result panel.
- Empty state: centered "← Paste JSON and click Validate".
- Validate button shows a spinner and is disabled while in flight.

### Behavior parity with the standalone tool

- Auto-detect Sparte from pasted JSON (`data.sparte` or `data.prefillData.sparte`).
- "Format JSON" button — pretty-prints input.
- Cmd/Ctrl+Enter inside textarea → `validate()`.
- After successful validate, replace textarea content with `cleanJson` from the response.
- Stage toggle persists across validations within the session (signal lives on the component).

## Routing & nav

### `app.routes.ts`

Add a new route alongside `reports` / `dashboards`:

```ts
{
  path: 'prefill',
  loadComponent: () =>
    import('./pages/prefill/prefill.component').then(
      (m) => m.PrefillComponent,
    ),
},
```

It inherits `authGuard` from the parent route — no extra guard.

### `app.component.html`

Add a fourth tab between Dashboards and the admin-only Admin tab:

```html
<a
  routerLink="/prefill"
  routerLinkActive="text-slate-900 font-medium"
  class="text-slate-600 hover:text-slate-900"
>Prefill</a>
```

`isFullscreen` is unchanged — only `/copilot` is fullscreen.

## Error handling

| Case | Behavior |
|---|---|
| Backend fetch of Swagger fails | Logger.warn, fall back to static schema, response includes `schemaSource: 'static'`, UI shows amber chip. |
| Input is not valid JSON | HTTP 400 `{ error: 'Invalid JSON — …' }`; UI shows red status banner with the message. |
| Sparte not present in resolved schema | HTTP 400 with the list of valid sparten on that stage. |
| `ANTHROPIC_API_KEY` missing | Not relevant — prefill module does not call Anthropic. |
| Network timeout to pool.cpit.app | Same as fetch failure: fall back to static schema. |

## Testing

### Backend (`apps/api`)

- `prefill.service.spec.ts`:
  - `validate()` returns `valid: true` for a known-good Kfz fixture.
  - `validate()` reports the expected errors for a payload with a bad enum and a missing required object.
  - `validate()` falls back to the static schema when `loadSchema` rejects (mocked); response carries `schemaSource: 'static'`.
  - Trailing-junk JSON is parsed via `parseAndUnwrap`; `prefillData` wrapper is unwrapped.
- `prefill.controller.spec.ts`: light controller test mocking the service; asserts JWT guard is applied (mirror `bug-reports` pattern).

### Frontend (`apps/web`)

- `prefill.component.spec.ts` with `HttpTestingController`:
  - `GET /api/prefill/sparten` is called on init and renders options.
  - `validate()` posts to `/api/prefill/validate` and renders the error table.
  - Auto-detect picks up `sparte` from pasted JSON.
  - On success with `cleanJson`, the textarea is replaced.

### Lint / build

```bash
pnpm nx lint api && pnpm nx lint web
pnpm nx build api && pnpm nx build web
```

### Manual smoke test

1. `pnpm start:api` + `pnpm start:web`. Log in as `cm@comparit.de` / `admin`.
2. Click **Prefill**. Paste a known Kfz prefill, validate against LIVE → expect "All prefill data is valid" with the LIVE badge.
3. Toggle to DEV, validate the same payload → expect a DEV-tagged result.
4. Block `pool.cpit.app` (e.g. via `/etc/hosts`), validate again → expect the amber "offline schema (fallback)" chip and a result driven by the static schema.

## Out of scope

- Sharing code with the standalone `pool-prefill-checker` repo.
- Persisting validation history.
- Comparing results across stages.
- Allowing custom Swagger URLs.
- Importing prefill JSON from a URL or file upload (paste only, like the standalone tool).
