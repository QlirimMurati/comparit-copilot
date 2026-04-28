# Copilot — Internal Automation Platform

> Master implementation plan. Source of truth for architecture and scope decisions.
> Companion file: [PROGRESS.md](./PROGRESS.md) tracks live status, decisions, and open questions.

> **Scope:** local-only project (no production hosting, no deployment). Auth stays as the existing basic stub — email + JWT for web/admin, HTTP Basic for widget→API. No Keycloak, no OIDC.
>
> **Per-person execution plans** (10 workstreams each, split to avoid file conflicts):
> - [Clirim](./IMPLEMENTATION_PLAN_CLIRIM.md) — backend AI + Jira + indexing + WebSocket gateway · progress: [PROGRESS_CLIRIM.md](./PROGRESS_CLIRIM.md)
> - [Lirim](./IMPLEMENTATION_PLAN_LIRIM.md) — Copilot web app + admin UI + dashboards + CI · progress: [PROGRESS_LIRIM.md](./PROGRESS_LIRIM.md)
> - [Donart](./IMPLEMENTATION_PLAN_DONART.md) — embedded widget + comparer-ui integration + local infra · progress: [PROGRESS_DONART.md](./PROGRESS_DONART.md)

---

## 1. Vision

An internal team tool for the Comparit organization that combines:

1. **Bug reporting** — central inbox for issues raised by devs, QA, POs.
2. **AI-assisted ticket creation** — raw user text → polished Jira tickets.
3. **Embedded chatbot in `comparer-ui`** — captures rich runtime context (sparte, route, IDs, errors) automatically when bugs are reported.
4. **Jira integration via MCP** — search, filter, create tickets without leaving Copilot.
5. **Transcript → Tickets** — convert meeting transcripts into Epics + Stories + Subtasks.
6. **Codebase Q&A and code localization** — "where might this bug be in the code?"

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Copilot Backend (NestJS)                  │
│  ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌─────────┐ │
│  │ AuthN/AuthZ│ │ Bug/Ticket  │ │ AI Service │ │  MCP    │ │
│  │   (SSO)    │ │   Domain    │ │ (Claude)   │ │ Gateway │ │
│  └────────────┘ └─────────────┘ └────────────┘ └─────────┘ │
│         PostgreSQL + Redis + Vector store (pgvector)         │
└──────────▲──────────────────▲────────────────────▲──────────┘
           │ REST/WebSocket   │ REST/WebSocket     │ MCP
┌──────────┴────────┐ ┌───────┴────────┐ ┌─────────┴─────────┐
│ Copilot Web App   │ │ Embedded Bot   │ │ Jira / Confluence │
│ (Angular)         │ │ Widget (in     │ │ Slack / Sentry    │
│ devs/POs/QA       │ │  comparer-ui)  │ │ GitHub            │
└───────────────────┘ └────────────────┘ └───────────────────┘
```

**Why this split**

- The widget lives inside `comparer-ui` (Nx lib + Web Component). Has direct access to runtime context (route, sparte, IDs, NgRx state).
- The standalone web app is where the team manages reports, drafts tickets, searches Jira, browses dashboards.
- The backend is the single source of truth — it owns AI orchestration, Jira sync, persistence, and authorization.

---

## 3. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend (both apps) | Angular 19 + Tailwind | Matches comparer-ui shop |
| Backend | NestJS + Fastify | TypeScript, decorator-driven, fits team |
| DB | PostgreSQL 16 + pgvector | Tickets, reports, embeddings in one |
| Cache / queue | Redis + BullMQ | Async jobs (Jira sync, embedding, summaries) |
| AI | Claude Sonnet 4.6 (default) + Opus 4.7 (heavy lifts) | Use prompt caching; route by complexity |
| Realtime | WebSockets (Socket.io) | Notifications, live transcript |
| Auth | Basic stub (email + JWT for web; HTTP Basic for widget→API) | Local-only project; no Keycloak/OIDC |
| MCP | Atlassian MCP (Jira/Confluence), GitHub MCP | Avoid hand-rolling REST |
| Package manager | pnpm | Matches comparer-ui |
| Node | v20 LTS | Matches comparer-ui |
| Hosting | Local only (Docker compose for Postgres + Redis) | No production deployment planned |

---

## 4. Repository / Folder Structure

Top-level folder is `/Users/cm/Projects/copilot`, **parallel to `comparer-ui`** (not inside it).

Recommended monorepo layout (Nx workspace, not yet scaffolded):

```
copilot/
├── apps/
│   ├── api/                       # NestJS backend
│   └── web/                       # Angular standalone app (Copilot UI)
├── libs/
│   ├── widget/                    # Embedded chat widget (Web Component)
│   ├── shared-types/              # DTOs, schemas (Zod) shared FE/BE
│   ├── ai/                        # AI agent orchestration code
│   ├── prompts/                   # Versioned prompts + few-shots (files)
│   ├── jira-client/               # Wrapper around Atlassian MCP
│   └── ui-kit/                    # Shared Angular components
├── infra/
│   ├── docker-compose.yml         # Postgres, Redis, MinIO, etc.
│   └── migrations/                # Drizzle/Prisma SQL migrations
├── prompts/                       # Markdown system prompts (per-agent)
├── schemas/                       # Zod schemas (single source of truth)
├── few-shots/                     # JSON examples per agent
├── rubrics/                       # "What good looks like" docs
├── IMPLEMENTATION_PLAN.md         # this file
├── PROGRESS.md                    # live progress + decisions
└── README.md
```

**Embedding into comparer-ui:** the widget ships from Copilot as a Web Component (`<copilot-widget>`). A small Angular wrapper lib gets added to comparer-ui that loads the script and forwards context. Widget changes do not require redeploying comparer-ui.

---

## 5. Data Model (Postgres)

Core tables (sketches; final schema lives in migrations):

```sql
users(id, email, role, jira_account_id, created_at, ...)

bug_reports(
  id, reporter_id, status, severity, sparte,
  captured_context jsonb,        -- URL, IDs, store snapshot, errors
  transcript jsonb,              -- chat messages
  ai_summary text,
  ai_proposed_ticket jsonb,
  jira_issue_key text NULL,
  embedding vector(1536),        -- for dedup
  created_at, updated_at
)

chat_sessions(id, user_id, kind, schema_state jsonb, started_at, ended_at)
                                  -- kind: 'bug' | 'transcript' | 'qa'
chat_messages(session_id, role, content, tool_calls jsonb, ts)

tickets_cache(
  jira_key PK, title, status, assignee, fix_version,
  labels, sparte, last_synced_at, raw jsonb,
  embedding vector(1536)
)

ticket_drafts(
  id, source_report_id, title, description, type,
  parent_key, subtasks jsonb, epic_key, status, ...
)

notifications(id, user_id, kind, payload jsonb, read_at)

prompt_overrides(
  id, agent, sparte, override_text, active,
  created_by, created_at
)
few_shot_examples(
  id, agent, sparte, conversation jsonb, active, score,
  created_by, created_at
)

audit_log(...)                   -- every write, who did it
```

---

## 6. Phased Roadmap

Each phase is independently shippable.

### Phase 1 — Foundation (2–3 weeks)
- Repo scaffold (Nx workspace, NestJS app, Angular app)
- Auth (OIDC), users, roles
- Postgres schema for reports + chat sessions
- Bare web app: list + detail views, no AI yet
- Manual bug report form (no chatbot)
- **Ship to internal users — they can already file bugs centrally**

### Phase 2 — Embedded widget + context capture (2–3 weeks)
- Widget as Web Component, embedded in comparer-ui via tiny wrapper lib
- Breadcrumb service, error capture, route/sparte/ID extraction
- Sanitizer with config (PII stripping)
- Submit-report flow with auto-attached context (still no AI conversation)
- WebSocket notifications to Copilot app

### Phase 3 — AI intake + ticket polish (2 weeks)
- `bug-intake` agent: chatbot conversation
- `ticket-polisher`: raw → Jira-ready Markdown
- Jira MCP integration: create issue from draft
- Dedup via embeddings (warn on submit)

### Phase 4 — Jira search + transcript decomposition (2 weeks)
- `tickets_cache` + sync worker + webhook
- NL search UI (NL → JQL with allowlist validation)
- `transcript-decomposer`: Epic/Story/Subtask tree creator
- Atomic multi-issue creation in Jira

### Phase 5 — Code localization + dashboards (2–3 weeks)
- Codebase indexing (chunk-by-symbol, embeddings, pgvector)
- Code-search agent tools (semantic search, grep, read, git)
- "Likely affected code" panel on tickets/reports
- Dashboard: bugs per sparte, time-to-resolution, deploy correlation

**Total target: 10–13 weeks for a small team (2 devs + 1 designer).**

---

## 7. AI Orchestration

### 7.1 Agents

| Agent | Job | Model |
|---|---|---|
| `bug-intake` | Conversational; collects repro steps; knows captured context | Sonnet 4.6 |
| `ticket-polisher` | Rewrites raw report into Jira-shaped Markdown | Sonnet 4.6 |
| `transcript-decomposer` | Transcript → Epic/Story/Subtask tree | Opus 4.7 |
| `jira-search` | NL query → JQL, executes via MCP | Sonnet 4.6 |
| `dedup-classifier` | Find similar reports/tickets via embeddings + LLM tiebreak | Embeddings + Sonnet |
| `qa-bot` | Codebase Q&A (RAG over comparer-ui) | Sonnet 4.6 |
| `code-localizer` | Ticket → "likely affected files" via tools | Sonnet 4.6 |

### 7.2 Schema-driven question loop

Each agent has a **target schema** (Zod). The model fills it across turns. The next question is whatever required field is unfilled. The captured context pre-fills as much as possible.

### 7.3 Prompt / schema / few-shot storage (3-layer model)

**Layer 1 — In the repo (slow-changing, code-reviewed)**
- `prompts/<agent>.system.md` — system prompts
- `schemas/<agent>.schema.ts` — Zod schemas with `.describe()` strings the model uses for guidance
- `few-shots/<agent>/*.json` — example conversations
- `rubrics/*.md` — "what good looks like" docs

**Layer 2 — In the database (fast-changing, team-editable)**
- `prompt_overrides` — per-sparte additions/overrides without redeploy
- `few_shot_examples` — added/scored from the admin UI
- `field_taxonomies` — editable enum values (e.g. severity descriptions)

**Layer 3 — Per-conversation runtime state (ephemeral)**
- `chat_sessions.schema_state` — what's been filled so far
- `chat_messages` — the transcript

**Admin UI (in Copilot web app, `/admin/prompts`)**
- View/edit prompts and few-shots
- **Test panel** — replay a proposed prompt against past sessions; show behavior diff
- Activate/deactivate; full audit log
- Permissions: only `qa-lead` and `admin` can edit

---

## 8. Embedded Widget — Context Capture

### 8.1 Auto-captured context

```ts
type CapturedContext = {
  url: string;
  route: { path: string; params: Record<string,string>; queryParams: ... };
  sparte: 'bu' | 'gf' | 'risikoleben' | 'kvv' | 'kvz' | 'hausrat' | ...;
  ids: { tarifId?, vergleichId?, antragId?, kundeId? };
  user: { id, email, role };
  app: { version, gitSha, buildTime, environment };
  browser: { ua, viewport, locale, timezone };
  timing: { now, sessionStart, lastInteraction };
  recentActions: BreadcrumbEvent[];     // last 50 events
  consoleErrors: { level, message, stack, ts }[];
  networkErrors: { url, status, method, ts }[];
  storeSnapshot: SanitizedNgRxState;    // PII-stripped
  featureFlags: Record<string, boolean>;
  screenshot?: string;                  // on demand only
  rrwebSession?: string;                // optional, opt-in
};
```

### 8.2 Wiring per field

| Field | Source |
|---|---|
| `route`, `ids`, `sparte` | `Router` + route params; sparte derived from active app shell |
| `recentActions` | Breadcrumb service: `Router.events`, click events, `HttpInterceptor` |
| `consoleErrors` | Wrap `console.error`, `window.onerror`, `unhandledrejection` |
| `networkErrors` | `HttpInterceptor` recording non-2xx |
| `storeSnapshot` | Tap NgRx store, run sanitizer (PII-by-key list) |
| `screenshot` | `html2canvas`, only on user request |
| `rrwebSession` | Opt-in only |

### 8.3 Privacy

- Sanitizer stripping mandatory before send (Versicherungsnummer, IBAN, birth dates, tax IDs).
- Show user the attached context block with edit/redact controls before submit.
- Audit-logged.

---

## 9. Code Localization Strategy

Used during ticket creation and on demand.

### 9.1 Index pipeline
- Chunk by symbol (function/class/component) using `ts-morph` or tree-sitter — beats sliding-window for code.
- Each chunk: `path`, `sparte` (derived from path), `symbol`, `kind`, `lastModified`, `gitSha`.
- Embed with code-aware model (e.g. Voyage `voyage-code-3`).
- Re-index on `main` push via CI; incremental on changed files.

### 9.2 Search modes (used in combination)
- **Semantic search** — pgvector hybrid (embedding + BM25), filtered by sparte.
- **Agentic exploration** — Claude with tools (`semantic_search`, `grep`, `read_file`, `find_symbol`, `git_log`, `git_blame`).
- **Structural shortcuts** — stack trace path extraction, route → component map, error-string grep, sparte-from-ticket-label routing.

### 9.3 Output panel on tickets/reports
- Top-K candidate files with line ranges
- Confidence label (HIGH/MEDIUM/LOW)
- Recent commit/author info
- Reasoning summary
- Click-through to file at line
- "Find similar resolved tickets" companion (uses `tickets_cache` embeddings)

### 9.4 Honest limits
- Vague tickets → wide net (intentional pressure on intake quality).
- Cross-cutting bugs are hard.
- Newly-merged code may be missing until reindex.
- Target 60–70% "first suggestion is correct file". Human always confirms.

---

## 10. Jira Integration

- Use Atlassian MCP server, not hand-rolled REST.
- `tickets_cache` synced via:
  - Webhook receiver for near-realtime updates on tickets we created.
  - Hourly delta sync (BullMQ worker).
  - Nightly full sync (failsafe).
- JQL builder: AI generates JQL → server validates against allowlist before executing.
- Auth: OAuth on-behalf-of user (cleaner audit) — confirm during Phase 4.

---

## 11. Privacy & Security

- Local-only project — no public hosting, runs on developer machines.
- PII sanitization on widget context before leaving browser (still relevant for shared dev DBs).
- Per-sparte PII whitelist/blocklist config.
- Audit log on every write (kept for traceability across local sessions).
- Role-based access (existing JWT role claim):
  - `dev` — view/create reports and drafts, push to Jira
  - `qa` — same + edit prompt overrides for owned sparten
  - `po` — same + dashboard access
  - `qa-lead` — edit all prompts, manage few-shots
  - `admin` — full control + user management

---

## 12. Open Decisions

Tracked live in [PROGRESS.md](./PROGRESS.md) under "Open Questions". Remaining items:

- Anthropic API account access (Q4 — confirm `cm@comparit.de` org access)
- Jira details (Q7 — instance URL, API token, sandbox availability)

---

## 13. Extra Ideas (post-Phase 5, low effort, high value)

In rough priority order:

1. **Dedup via embeddings** (already in Phase 3)
2. **Deploy correlation** — git SHA in context → "spike of bugs after release X"
3. **AI auto-triage** — proposed severity/sparte/assignee on submit (human confirms)
4. **Daily digest** — AI summary posted to Slack/Teams
5. **Reproducer extraction** — already in `ticket-polisher`
6. **rrweb session replay** — opt-in
7. **PR linker** — match Jira keys in commits, link on tickets
8. **Find similar resolved tickets** (companion to code localization)
9. **Voice input** (Whisper or Web Speech API)
10. **Release notes generator** — by fix-version, grouped by sparte
11. **Standup helper** — `/standup` summarizes assigned tickets
12. **Confluence answer bot**
13. **Bug pattern alerts** — 3+ similar reports in 1 hr → incident escalation
14. **Test-case generator** — Cypress/Playwright stub from bug report
15. **Feature-flag awareness** — capture flag state, surface "only when flag X on" patterns

Skipped intentionally for v1: fine-tuning, self-hosted LLMs, native mobile, real-time collab editing.
