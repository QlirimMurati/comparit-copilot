# comparit-copilot

Internal automation platform for the Comparit team. See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the master plan and [PROGRESS.md](./PROGRESS.md) for live status.

> **Stack:** Nx 20 (pnpm) · NestJS 10 (`apps/api`) · Angular 19 (`apps/web`) · Tailwind 3 · Postgres 16 + pgvector · Redis 7 · Claude API

## Apps

| Path | What | Dev URL |
|---|---|---|
| `apps/api` | NestJS backend | http://localhost:3000/api |
| `apps/web` | Angular admin/web app | http://localhost:4240 |
| `apps/widget` | Widget-host shim — registers `<copilot-widget>` custom element | http://localhost:4241 |

> Note: copilot uses uncommon ports `:4240`/`:4241` to leave the standard `:4200`/`:4201` free for `comparer-ui` and other Angular projects.
| `apps/api-e2e` | API e2e tests (jest+supertest) | — |
| `libs/widget` | Angular component + context capture for the embedded widget | — |

`apps/web` proxies `/api` → `http://localhost:3000` in dev (`apps/web/proxy.conf.json`).

## Prerequisites

- Node 20+
- pnpm 10+
- Docker Desktop (or OrbStack) running

## Run locally

```bash
pnpm install                                      # once
docker compose -f infra/docker-compose.yml up -d  # Postgres + Redis
pnpm start:api                                    # runs migrations on boot
pnpm start:web                                    # http://localhost:4240
```

The API auto-applies migrations and bootstraps an admin user (`cm@comparit.de` / `admin` from `.env`) on startup.

Stop infra:
```bash
docker compose -f infra/docker-compose.yml down
# add -v to also wipe Postgres data volume
```

## Test / Build / Lint

```bash
pnpm nx test api
pnpm nx test web
pnpm nx run-many -t build    # build all
pnpm nx run-many -t lint     # lint all
```

## Health checks

```bash
curl http://localhost:3000/api/health
# {"status":"ok","service":"comparit-copilot-api","version":"0.0.0","timestamp":"..."}

curl http://localhost:3000/api/health/db
# {"status":"ok"}
```

## Database

- ORM: Drizzle (`drizzle-orm` + `postgres-js`)
- Schema: `apps/api/src/db/schema/`
- Migrations: `apps/api/src/db/migrations/` (auto-applied on api startup)
- Generate a new migration after schema changes: `pnpm exec drizzle-kit generate`
- Inspect with Drizzle Studio: `pnpm exec drizzle-kit studio`

## Known gotcha

If `nx` commands fail with `Cannot find module '@nx/nest/package.json'` (or similar) when run from a shell that recently invoked nx/pnpm in another sibling Nx workspace (e.g. `comparer-ui`), open a fresh terminal session inside this directory. Env vars from the previous shell can pollute Nx's package resolution.

## Project layout

```
apps/
  api/                       # NestJS
  web/                       # Angular standalone
  api-e2e/
libs/                        # (added in later phases)
infra/                       # docker-compose, migrations (added next)
prompts/                     # AI agent system prompts (Phase 3)
schemas/                     # Zod schemas (Phase 3)
few-shots/                   # AI example conversations (Phase 3)
```

## Phase progress

**Phase 1 — Foundation** ✅
- Workspace, NestJS api, Angular web, Postgres+pgvector+Redis, Drizzle, stub auth, bug-report CRUD + UI

**Phase 2 — Embedded widget** ✅
- Web Component widget at `libs/widget` + `apps/widget` (build target)
- `POST /api/widget/reports` with HTTP Basic Auth
- Wrapper lib `@comparit/copilot-widget` in comparer-ui, embedded in all 12 sparte apps

**Phase 3 — AI bug-intake chatbot (MVP)** ✅
- `chat_sessions` + `chat_messages` tables; Anthropic SDK; Claude Opus 4.7 with adaptive thinking
- `BugIntakeAgent` with two tools (`update_intake`, `complete_intake`) and manual agentic loop
- `POST /api/widget/chat/{start,message,submit}` endpoints
- Widget chat mode (default) with message bubbles + typing indicator, falls back to Form tab
- Requires `ANTHROPIC_API_KEY` set in `.env` (otherwise widget returns a config-error message but everything else still works)

## Try it locally

1. **Start Docker Desktop** (or OrbStack)
2. `docker compose -f infra/docker-compose.yml up -d` — Postgres + Redis
3. `pnpm install` (once)
4. `pnpm start:api` — applies migrations, bootstraps admin user, listens on :3000
5. `pnpm start:web` — http://localhost:4240
6. Sign in with `cm@comparit.de` / `admin`
7. Create a bug report at `/reports/new`

### Try the embedded widget

```bash
pnpm nx serve widget-host    # http://localhost:4241
```

Visit http://localhost:4241 — you'll see the demo page with `<copilot-widget>` floating bottom-right. Click 🐞, fill the form, submit. The report shows up in the Copilot web app's `/reports` list (refresh the page).

The widget submits via HTTP Basic Auth (`widget:local` from `.env`) and includes auto-captured context (URL, IDs, viewport, timezone, etc.) in the `capturedContext` jsonb column.
