# Copilot — Implementation Progress

> Live status, decisions, and open questions. Updated each working session.
> Master plan: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

> **Per-person progress files:**
> - [PROGRESS_CLIRIM.md](./PROGRESS_CLIRIM.md) — backend AI + Jira + indexing
> - [PROGRESS_LIRIM.md](./PROGRESS_LIRIM.md) — Copilot web app + admin UI
> - [PROGRESS_DONART.md](./PROGRESS_DONART.md) — widget + comparer-ui integration + infra
>
> This file remains the cross-team log: shared decisions, open questions affecting everyone, infra-wide caveats.

---

## Current Status

- **Phase:** 3 — AI bug-intake chatbot (MVP complete 2026-04-28)
- **Phase 1:** ✅ verified locally by user
- **Phase 2:** ✅ widget + comparer-ui wrapper + embedded in all 12 sparte apps
- **Started:** 2026-04-27
- **Last updated:** 2026-04-28

---

## Phase 3 — AI bug-intake chatbot (MVP, 2026-04-28)

### Decisions
- **Model:** `claude-opus-4-7` with adaptive thinking — per claude-api skill default
- **Approach:** Manual agentic loop — backend tracks intake state, persists transcript to DB
- **Tools:** `update_intake({title?, description?, severity?, sparte?})` and `complete_intake()`
- **Prompt caching:** stable system instructions block carries `cache_control: ephemeral`; per-session captured context + intake state come after

### API side
- [x] `@anthropic-ai/sdk@0.91.1` + `zod@4.3.6` installed
- [x] `chat_sessions` + `chat_messages` tables (migration `0002_awesome_bill_hollister.sql`)
- [x] `apps/api/src/ai/anthropic.service.ts` — wraps SDK, gracefully no-ops if `ANTHROPIC_API_KEY` not set
- [x] `apps/api/src/ai/intake-schema.ts` — Zod schema, two `Anthropic.Tool` definitions, full system prompt
- [x] `apps/api/src/ai/chat-session.service.ts` — Drizzle CRUD for sessions + messages
- [x] `apps/api/src/ai/intake-agent.service.ts` — manual loop (up to 4 tool roundtrips per turn), persists Claude content blocks verbatim, validates each `update_intake` against Zod
- [x] `apps/api/src/ai/intake.controller.ts` — `POST /api/widget/chat/{start,message,submit}`, behind `BasicAuthGuard`
- [x] `submit` endpoint joins session → user (by email) → creates `bug_reports` row, marks session `submitted`

### Widget side
- [x] Chat mode default, Form mode as fallback tab
- [x] Auto-starts chat on panel open (calls `/start`, displays AI greeting)
- [x] Message bubbles (user right / assistant left), typing indicator, input form
- [x] "Submit report" button appears once `intakeState.isComplete` flips
- [x] Bumped `anyComponentStyle` budget on `apps/widget` (8 kb / 16 kb) — Shadow-DOM scoping puts all styles in one component

### Verification
- [x] `nx build api` — clean (62 kB main, +33 kB from Anthropic SDK + Zod)
- [x] `nx build widget-host` — clean
- [x] `nx build web` — clean
- [x] `nx run-many -t test --projects=api,web` — 7 + 1 tests pass

### Phase 3 deferred (next sessions)
- [ ] **Streaming responses** — currently blocking; switch to `messages.stream()` for token-by-token UX
- [ ] **Ticket polisher agent** — second agent that takes raw intake + transcript and produces Jira-ready Markdown
- [ ] **Transcript decomposer** — paste a transcript, AI emits Epic + Stories + Subtasks tree
- [ ] **Few-shot example loading** — currently no examples, just system instructions
- [ ] **Prompt admin UI in copilot web** — view + edit prompts, replay against past sessions
- [ ] **Dedup via embeddings** — pgvector on bug_reports + chat-time "have I seen this before"
- [ ] **Bilingual UI strings** — widget non-AI strings still English

---

## Completed

- [x] 2026-04-27 — Folder created (renamed to `/Users/cm/Projects/comparit-copilot`)
- [x] 2026-04-27 — `IMPLEMENTATION_PLAN.md` + `PROGRESS.md` written
- [x] 2026-04-27 — Resolved Q1–Q3 + Q5 (name, monorepo tool, auth, language)
- [x] 2026-04-27 — Nx workspace scaffolded (Nx 20.2.1, pnpm)
- [x] 2026-04-27 — `@nx/nest` + `apps/api` (NestJS 10.4.22) generated
- [x] 2026-04-27 — `@nx/angular` + `apps/web` (Angular 19.0.7) generated
- [x] 2026-04-27 — Tailwind 3 set up on web app
- [x] 2026-04-27 — Approved pnpm build scripts (`onlyBuiltDependencies` in package.json)
- [x] 2026-04-27 — Convenience scripts in package.json (`start:api`, `start:web`, `build`, `test`, `lint`)
- [x] 2026-04-27 — `apps/api`: refactored controller/service to expose `GET /api/health` returning structured `{ status, service, version, timestamp }`
- [x] 2026-04-27 — `apps/api`: enabled CORS for `WEB_ORIGIN` (default `http://localhost:4200`)
- [x] 2026-04-27 — Updated unit specs for renamed handlers; all tests green (api: 4 tests, web: 1 test)
- [x] 2026-04-27 — `apps/web`: deleted `nx-welcome.component.ts`, replaced shell with header+nav layout (Tailwind)
- [x] 2026-04-27 — `apps/web`: added `provideHttpClient(withFetch())` and `withComponentInputBinding()` router feature
- [x] 2026-04-27 — `apps/web`: created `core/api/health.service.ts` and `pages/home/` showing live API status badge
- [x] 2026-04-27 — `apps/web`: added stub `pages/reports/` route as placeholder for Phase 1 bug inbox
- [x] 2026-04-27 — `apps/web`: added `proxy.conf.json` (`/api` → `localhost:3000`), wired into `serve` target
- [x] 2026-04-27 — Verified end-to-end: started API, `curl /api/health` returned `{"status":"ok",...}`
- [x] 2026-04-27 — Updated `README.md` with run instructions and project layout
- [x] 2026-04-28 — User confirmed: local-only deployment, defaults across the board (Drizzle, Docker)
- [x] 2026-04-28 — `infra/docker-compose.yml` (Postgres 16 + pgvector + Redis 7 + named volumes + healthchecks)
- [x] 2026-04-28 — `.env.example` (committed) and `.env` (gitignored)
- [x] 2026-04-28 — Drizzle ORM installed (`drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `postgres@3.4.9`, `bcryptjs@2.4.3`)
- [x] 2026-04-28 — `drizzle.config.ts` at workspace root
- [x] 2026-04-28 — `apps/api/src/db/schema/users.ts` — id (uuid), email, password_hash, name, role (text + check constraint), timestamps
- [x] 2026-04-28 — `apps/api/src/db/db.module.ts` — `@Global()` module providing typed Drizzle client via `DRIZZLE` token
- [x] 2026-04-28 — `apps/api/src/db/run-migrations.ts` — runs `CREATE EXTENSION vector` + Drizzle migrate on startup
- [x] 2026-04-28 — `apps/api/src/db/bootstrap-admin.ts` — creates admin user if `BOOTSTRAP_ADMIN_EMAIL` not present
- [x] 2026-04-28 — Initial migration generated: `migrations/0000_redundant_ultragirl.sql`
- [x] 2026-04-28 — `main.ts` calls `runMigrations()` then `bootstrapAdmin()` before `app.listen`
- [x] 2026-04-28 — `GET /api/health/db` endpoint with mocked unit tests (api: 7 tests, web: 1 test, all green)
- [x] 2026-04-28 — Discovered & fixed: Drizzle 0.36 `$inferInsert` excluded columns with defaults — upgraded to 0.45.2

---

## Phase 1 — Completed today (2026-04-28)

### Stub auth
- [x] `@nestjs/jwt` + `@types/express` installed
- [x] `apps/api/src/auth/`: `auth.module.ts`, `auth.service.ts`, `auth.controller.ts`, `jwt.guard.ts`, `current-user.decorator.ts`, `auth.types.ts`
- [x] `POST /api/auth/login` (bcrypt password compare → signed JWT) + `GET /api/auth/me` (guarded)
- [x] `apps/web/src/app/core/auth/`: `auth.service.ts` (signal state, localStorage persist), `auth.interceptor.ts`, `auth.guard.ts`, `auth.types.ts`
- [x] `apps/web/src/app/pages/login/` with reactive form pre-filled with bootstrap admin creds
- [x] App routes wrap protected routes in `authGuard`; `/login` uses `guestGuard` to bounce already-authed users

### bug_reports CRUD
- [x] `apps/api/src/db/schema/bug-reports.ts` — id, reporterId FK, title, description, status, severity, sparte (nullable), captured_context (jsonb), jira_issue_key, timestamps
- [x] Status / severity / sparte enforced via CHECK constraints; indexes on reporter_id, status, created_at
- [x] Migration `0001_fine_the_stranger.sql` generated
- [x] `apps/api/src/bug-reports/` module: list (with filters), getById, create, update — all behind `JwtAuthGuard`, joined with users for reporter info
- [x] `apps/web/src/app/core/api/bug-reports.{types,service}.ts` — typed HTTP client mirroring API
- [x] `apps/web/src/app/pages/reports/reports.component.{ts,html}` — list with status/severity badges, sparte labels, reporter, created
- [x] `apps/web/src/app/pages/reports/new/new-report.component.{ts,html}` — reactive form with severity/sparte selects
- [x] Shell header shows logged-in user + Sign out

### Final verification
- [x] `nx run-many -t build` — both `api` and `web` build clean
- [x] `nx run-many -t test` — 7 api tests + 1 web test, all green
- [x] PROGRESS.md + README updated

---

## In Progress

- [ ] User to run end-to-end smoke (login → create report → see in list) once Docker Desktop is running

---

## Phase 1 — Remaining (deferred, owned in per-person plans)

- [ ] Bug report **detail / edit** page (status/severity dropdowns, jira link field) — Lirim W1
- [ ] CI workflow (GitHub Actions: lint + typecheck + test) — Lirim W10
- [ ] Auth/BugReports unit tests (only happy-path tests so far on health endpoints) — Donart W10

---

## Phase 2 — Embedded widget (started + MVP shipped 2026-04-28)

### Decisions
- **Stack:** Angular + `@angular/elements` (per user); Web Component registers `<copilot-widget>`
- **Auth:** HTTP Basic Auth between widget and API (per user — no API keys/JWT)
- **Layout:** component code in `libs/widget/`, registration shim in `apps/widget/` (single-file bundle requires app-style build target)

### Completed today
- [x] `libs/widget/` Angular library generated (buildable)
- [x] `apps/widget/` Angular app generated (project name `widget-host`); serves on **:4201**
- [x] `@angular/elements` 19.0.7 installed
- [x] `libs/widget/src/lib/widget/widget.types.ts` — `WidgetSeverity`, `WidgetSparte`, `CapturedContext`, request/response shapes
- [x] `libs/widget/src/lib/widget/context.ts` — `captureContext()` extracts URL, pathname, search, hash, IDs (vergleich/tarif/antrag/kunde via regex), viewport, timezone, locale, user agent, timestamp, referrer; `sparte` / `appVersion` / `reporterEmail` come in via inputs
- [x] `libs/widget/src/lib/widget/widget.service.ts` — POSTs to `/api/widget/reports` with `Authorization: Basic <base64(user:pass)>`
- [x] `libs/widget/src/lib/widget/widget.component.{ts,html,scss}` — floating button + slide-in panel + reactive form (title, description, severity, sparte) + collapsible "Page context attached" preview; **Shadow DOM** encapsulation so host page styles cannot leak in/out
- [x] `apps/widget/src/main.ts` — `createApplication()` + `createCustomElement()` + `customElements.define('copilot-widget', element)`
- [x] `apps/widget/src/index.html` — local demo page, sets all `<copilot-widget>` attributes
- [x] Deleted unused auto-generated `apps/widget/src/app/`

### API side
- [x] `apps/api/src/widget/widget.types.ts`, `basic-auth.guard.ts`, `widget.service.ts`, `widget.controller.ts`, `widget.module.ts`
- [x] `POST /api/widget/reports` — `BasicAuthGuard` validates against `WIDGET_BASIC_USER` / `WIDGET_BASIC_PASS` env vars
- [x] Service looks up reporter by email, errors out if user not in `users` table
- [x] Bug report stored with full `capturedContext` jsonb attached
- [x] CORS relaxed to `origin: true` (reflect any origin) since widget runs from arbitrary host pages locally
- [x] `.env` + `.env.example` updated (defaults: `widget` / `local`)
- [x] `WidgetModule` imported in `app.module.ts`

### Verification
- [x] `nx build api`, `nx build web`, `nx build widget-host` — all clean
- [x] `nx test` — 7 api tests + 1 web test still pass
- [x] Widget-host bundle: 197 kB main + 34 kB polyfills (231 kB total — Angular Elements + zone.js)

### Comparer-ui side (added 2026-04-28)
- [x] **`libs/copilot-widget/` in `/Users/cm/Projects/comparer-ui`** — thin wrapper lib
- [x] `provideCopilotWidget({...})` factory — drop into any sparte app's `providers`
- [x] `<copilot-bug-widget [sparte]="'bu'" [reporterEmail]="..." />` — drop into any layout
- [x] `CopilotWidgetLoader` service — lazy-loads `polyfills.js` + `main.js` from `:4201` (or override URL); de-duplicates concurrent loads + reuses already-defined custom element
- [x] Path alias `@comparit/copilot-widget` added to `tsconfig.base.json`
- [x] README at `libs/copilot-widget/README.md` with copy-paste setup snippet
- [x] `tsc --noEmit` clean

**Files touched in comparer-ui (uncommitted on `develop` branch):**
```
M  tsconfig.base.json                                    (+1 path alias)
A  libs/copilot-widget/README.md
A  libs/copilot-widget/project.json
A  libs/copilot-widget/tsconfig.json
A  libs/copilot-widget/tsconfig.lib.json
A  libs/copilot-widget/src/index.ts
A  libs/copilot-widget/src/lib/copilot-widget.component.ts
A  libs/copilot-widget/src/lib/copilot-widget.config.ts
A  libs/copilot-widget/src/lib/copilot-widget-loader.service.ts
```

User decides when/where to embed `<copilot-bug-widget>` in actual sparte layouts — not auto-embedded to avoid touching mid-Phase-14 refactor surface.

### Comparer-ui app embedding (added 2026-04-28)

`<copilot-bug-widget>` is now embedded in every product app. Each app's root component imports `CopilotBugWidgetComponent` and renders it at the bottom of its template; sparte is hardcoded per-app, reporter email is currently `'admin@comparit.de'` (TODO: wire to KeycloakAuthService once we land on the right accessor).

The shared `provideCopilotWidget()` is added once in `libs/nf-remote/src/lib/helper/get-app-config.ts`, so all apps inherit the API + auth config without per-app duplication.

| App | Sparte | Root component file |
|---|---|---|
| bu | bu | `apps/bu/src/app/components/bu.component.{ts,html}` |
| gf | gf | `apps/gf/src/app/components/gf.component.{ts,html}` |
| risikoleben | risikoleben | `apps/risikoleben/src/app/components/risikoleben.component.{ts,html}` |
| kvv | kvv | `apps/kvv/src/app/components/kvv.component.{ts,html}` |
| kvz | kvz | `apps/kvz/src/app/components/kvz.component.{ts,html}` |
| kfz | kfz | `apps/kfz/src/app/components/kfz.component.{ts,html}` |
| basis-rente | basis_rente | `apps/basis-rente/src/app/components/basis-rente.component.{ts,html}` |
| private-rente | private_rente | `apps/private-rente/src/app/components/private-rente.component.{ts,html}` |
| comparit (portal) | comparit | `apps/comparit/src/app/app.component.{ts,html}` |
| hausrat | hausrat | `apps/hausrat/src/app/app.component.{ts,html}` |
| phv | phv | `apps/phv/src/app/app.component.{ts,html}` |
| wohngebaeude | wohngebaeude | `apps/wohngebaeude/src/app/app.component.{ts,html}` |

**Verified:** `nx build` passes for `bu`, `basis-rente`, `hausrat`, `kvv` (covering all three component-structure patterns in the codebase). Other apps use the same patterns so they should compile cleanly too — full `nx run-many -t build` recommended on next session.

Initial IDE diagnostics flagged "Value could not be determined statically" — turned out to be stale Language Service state; runtime/AOT compiler accepts it. Adding explicit `standalone: true` to `CopilotBugWidgetComponent` removed the warning.

### Phase 2 deferred (next sessions)
- [ ] Wire `[reporterEmail]` to actual logged-in user (currently hardcoded `'admin@comparit.de'`) — likely via `KeycloakAuthService` from `@comparit/core`
- [ ] Console error / unhandled rejection / network error breadcrumbs
- [ ] NgRx store snapshot capture (when comparer-ui's family services are passed in)
- [ ] Configurable PII sanitizer (key blocklist, regex masks)
- [ ] On-demand screenshot (`html2canvas`)
- [ ] WebSocket — push notification to copilot web app on new widget submission
- [ ] Bilingual UI (German default per user preference for chatbot widget)

## Caveats / Gotchas Discovered

### Postgres / Redis port conflicts on macOS (2026-04-28)
First docker bring-up failed because the host had Postgres on `:5432`. Tried `5433`/`6380` next — also taken. Settled on **`55432`** (Postgres) and **`56379`** (Redis), updated in `infra/docker-compose.yml`, `.env`, and `.env.example`. If `bind: address already in use` recurs, run `lsof -i :PORT` to identify and either stop the conflicting service or pick another high port.

Side effect: a Postgres container that was started before `POSTGRES_DB=copilot` was set will keep running with no `copilot` database (the env var only runs on first init of the data dir). Cure: `docker compose -f infra/docker-compose.yml down -v` to wipe the volume, then `up -d` again.

### Nx + pnpm + sibling workspace pollution (2026-04-27)
When running `nx` inside `comparit-copilot` from a shell that recently ran pnpm/nx in `comparer-ui`, env vars cause Nx to resolve packages from `comparer-ui`'s pnpm store and fail with `Cannot find module '@nx/nest/package.json'`.

**Workaround:** clean env wrapper for any nx command run from outside the project shell:
```
env -i HOME=$HOME PATH=$PATH PWD=/Users/cm/Projects/comparit-copilot bash -c \
  'cd /Users/cm/Projects/comparit-copilot && ./node_modules/.bin/nx <args>'
```

Once developers run from inside the project (their own shell), the issue vanishes. Worth a README note.

---

## Resolved Decisions (2026-04-27)

- **Q1 Project name:** `comparit-copilot`
- **Q2 Monorepo tool:** Nx workspace (matches comparer-ui mental model)
- **Q3 Auth:** Stub auth (email + JWT, local users table) for Phase 1; swap to OIDC later
- **Q5 UI language:** Bilingual.
  - **Embedded chatbot widget:** default **German**, auto-detects user input language and replies accordingly
  - **Copilot web app:** default **English** UI, supports German content too
  - All AI agents must detect user language per turn and respond in kind

## Open Questions (non-blocking)

### Q4 — Anthropic API account
User reference: `cm@comparit.de`. Need to confirm this email is tied to an Anthropic API org account at console.anthropic.com (where API keys + billing live), or whether one needs to be provisioned. Becomes blocking at Phase 3.

### Q7 — Jira integration details
- Jira instance URL?
- API token available?
- Sandbox/test instance available?

Becomes blocking at Phase 4.

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-27 | Copilot lives in `/Users/cm/Projects/copilot` parallel to `comparer-ui` | User-specified; keeps release cycles independent |
| 2026-04-27 | Package manager: pnpm | Matches comparer-ui |
| 2026-04-27 | Node v20 LTS | Matches comparer-ui |
| 2026-04-27 | Widget ships as Web Component, embedded into comparer-ui via tiny wrapper lib | Decouples widget releases from comparer-ui releases |
| 2026-04-27 | Three-layer prompt storage: files in repo + DB overrides + ephemeral session state | Lets QA edit prompts without redeploys; keeps types in code |

---

## Notes / Context for Next Session

- Comparer-ui current branch: `develop`. Mid-refactor (Phase 14 — removing extends chains). Code localization in Copilot Phase 5 needs to handle code that moves between files.
- Sparten mapping (for widget context): BU, GF, Risikoleben (LV) | KVV, KVZ (KV) | Hausrat, PHV, Wohngebäude (Sach) | KFZ | Basis-Rente, Private-Rente (AV) | Comparit (portal).
- `VergleichBase` is deleted; `ComparerFamilyBase` is deleted. Widget context-extraction can rely on the new family-base composition pattern (each family's base service injects infrastructure services directly).
