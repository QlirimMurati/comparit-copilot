# Backend — `apps/api`

NestJS 10 backend for the Comparit copilot platform. Drizzle + Postgres 16 (pgvector) + Redis 7 + Anthropic SDK.

## Location

- Repo root: `/Users/dp/Sources/comparit-copilot`
- App: `apps/api`
- E2E: `apps/api-e2e`

## Start

```bash
# from /Users/dp/Sources/comparit-copilot
docker compose -f infra/docker-compose.yml up -d   # Postgres :55432, Redis :56379
pnpm install                                       # once
cp .env.example .env                               # once; set ANTHROPIC_API_KEY for chat
pnpm start:api                                     # http://localhost:3000/api
```

Migrations auto-apply on boot. Bootstrap admin `cm@comparit.de` / `admin`.

## Health

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/db
```

## API documentation (Swagger)

- UI: http://localhost:3000/api/docs
- OpenAPI JSON: http://localhost:3000/api/docs-json
- Configured in `apps/api/src/main.ts`; tag/operation decorators live on each controller.
- Use the **Authorize** button: paste a JWT from `POST /api/auth/login` for `reports`/`auth/me`, or HTTP Basic `widget:local` for `widget`/`widget-chat`.

## Module map (`apps/api/src/`)

| Folder | Purpose |
|---|---|
| `app/` | Root Nest module wiring |
| `auth/` | JWT login (`auth.controller.ts`), `JwtGuard`, `@CurrentUser()` |
| `bug-reports/` | CRUD for bug reports (admin/web) |
| `widget/` | Public widget endpoints — Basic-Auth guard, `POST /api/widget/reports`, chat passthrough |
| `ai/` | Anthropic-driven bug intake — `intake-agent.service.ts` runs the manual tool loop, `intake-schema.ts` is the Zod contract, `chat-session.service.ts` persists transcripts |
| `users/` | `find-or-create-reporter.ts` helper |
| `db/` | Drizzle setup, migrations runner, `bootstrap-admin.ts`, `schema/` (`users`, `bug-reports`, `chat-sessions`, `chat-messages`) |
| `main.ts` | Nest bootstrap, global `/api` prefix |

## Key endpoints

- `POST /api/auth/login` — JWT
- `GET/POST /api/bug-reports` — admin (JWT)
- `POST /api/widget/reports` — Basic Auth (`widget:local`)
- `POST /api/widget/chat/start | message | submit` — AI intake

## Database

- ORM: Drizzle (`drizzle-orm` + `postgres-js`)
- Schema: `apps/api/src/db/schema/`
- Migrations: `apps/api/src/db/migrations/` (auto-applied)
- New migration after schema edit: `pnpm exec drizzle-kit generate`
- Studio: `pnpm exec drizzle-kit studio`
- Connection: `DATABASE_URL=postgres://postgres:postgres@localhost:55432/copilot`

## AI / Anthropic

- SDK: `@anthropic-ai/sdk`
- Model: Claude Opus 4.7 with adaptive thinking (`anthropic.service.ts`)
- Agent: `BugIntakeAgent` — tools `update_intake`, `complete_intake`; manual agentic loop
- Requires `ANTHROPIC_API_KEY` in `.env`; without it, chat returns a config error but the rest of the API works

## Test / Lint / Build

```bash
pnpm nx test api
pnpm nx lint api
pnpm nx build api
pnpm nx e2e api-e2e
```

## Gotcha

If `nx` errors with `Cannot find module '@nx/nest/package.json'`, open a fresh shell inside this repo — env from a sibling Nx workspace (e.g. `comparer-ui`) leaks resolution.
