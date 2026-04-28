# Copilot — Clirim's Implementation Plan

> **Owner:** Clirim
> **Master plan:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — read first for vision, architecture, data model.
> **Live status:** [PROGRESS_CLIRIM.md](./PROGRESS_CLIRIM.md)
> **Teammates:** [Lirim](./IMPLEMENTATION_PLAN_LIRIM.md) (web app), [Donart](./IMPLEMENTATION_PLAN_DONART.md) (widget + integration)

> **Scope reminders:** local-only project (no production hosting, no deployment). Auth stays as the existing basic stub (email + JWT for web/admin; HTTP Basic for widget→API). No Keycloak, no OIDC.

---

## 1. Scope (what is mine)

Backend AI orchestration, Jira/MCP integration, codebase indexing, WebSocket gateway. Anything that hits Anthropic, pgvector, Jira, or the realtime layer is mine.

### Folders I own

```
apps/api/src/ai/                 ← all agents and orchestration
apps/api/src/jira/               ← Jira MCP wrapper, tickets_cache, sync workers
apps/api/src/index/              ← codebase indexing pipeline
apps/api/src/realtime/           ← WebSocket gateway
prompts/                         ← system prompts
schemas/                         ← Zod schemas (single source of truth)
few-shots/                       ← few-shot conversations
rubrics/                         ← "what good looks like" docs
libs/ai/                         ← shared agent code if extracted
libs/jira-client/                ← MCP wrapper if extracted
```

### Folders I touch (coordinate)

- `apps/api/src/db/schema/` — add new tables in **new files** (no edits to existing)
- `libs/shared-types/` — add my DTOs in own files
- `package.json` — coordinate Anthropic/MCP/Voyage SDK upgrades on Slack first
- `infra/docker-compose.yml` — request changes via Donart (only for adding local services)

---

## 2. Workstreams (10 + 7 deepening = 17)

### W1 — Streaming responses (Phase 3 polish)
- Switch `intake-agent.service.ts` from `messages.create` → `messages.stream`.
- New endpoint `POST /api/widget/chat/message/stream` that returns SSE.
- Persist final assembled assistant turn to `chat_messages` after stream end.
- Keep blocking endpoint as fallback.
- **Coordinate:** Donart W7 consumes the SSE stream.

### W2 — Ticket polisher agent
- New file `apps/api/src/ai/ticket-polisher.service.ts`.
- Input: full transcript + `bug_reports.captured_context` + intake fields.
- Output: `{ title, description (Markdown), proposedType, proposedLabels, repro_steps, expected, actual }` validated by Zod schema in `schemas/ticket-polisher.schema.ts`.
- Endpoint: `POST /api/reports/:id/polish` → writes to `bug_reports.ai_proposed_ticket` jsonb.
- **Coordinate:** Lirim W3 renders the proposal.

### W3 — Transcript decomposer (agent + tools + endpoints + schema)
- New folder `apps/api/src/ai/transcript-decomposer/`.
- Tools the agent can call: `add_epic`, `add_story(epic_id)`, `add_subtask(story_id)`, `update_node`, `complete_decomposition`.
- Endpoints: `POST /api/transcripts` (start), `POST /api/transcripts/:id/refine` (chat), `GET /api/transcripts/:id` (current tree).
- New tables `transcript_sessions` + `transcript_nodes` (own migration file).
- **Coordinate:** Lirim W7 builds the paste-and-refine UI.

### W4 — Dedup via embeddings
- Add `embedding vector(1536)` column to `bug_reports` (migration).
- Compute embedding on report submit (BullMQ job, new `apps/api/src/ai/embed.worker.ts`).
- Endpoint `POST /api/reports/check-duplicate` → top 5 nearest above threshold.
- Use `voyage-3` for general text embeddings.
- **Coordinate:** Donart W9 calls pre-submit; Lirim W3 shows in detail.

### W5 — Few-shot loading + admin API endpoints
- Read few-shots from `few-shots/<agent>/*.json` at boot.
- Layer DB overrides from `few_shot_examples` table (new schema file).
- Inject into agent system prompt with `cache_control: ephemeral` boundary.
- Endpoints: `GET /api/admin/few-shots`, `POST /api/admin/few-shots`, `PATCH /api/admin/few-shots/:id` (admin/qa-lead only via existing JWT guard + role check).
- **Coordinate:** Lirim W5 builds the admin UI.

### W6 — Prompt overrides + replay endpoints
- New table `prompt_overrides` (migration).
- Endpoints `GET/POST/PATCH /api/admin/prompts`, plus `POST /api/admin/prompts/replay` that runs a candidate prompt against past sessions and returns a behavior diff.
- Activation flag controls runtime injection.
- **Coordinate:** Lirim W4 builds the admin/replay UI.

### W7 — Jira MCP integration
- `apps/api/src/jira/mcp.client.ts` — wraps Atlassian MCP server.
- `apps/api/src/jira/tickets-cache.service.ts` + new `tickets_cache` table.
- Sync workers (BullMQ): webhook receiver, hourly delta sync, nightly full sync — all running locally.
- `apps/api/src/jira/jql-builder.service.ts` — agent generates JQL → server validates against allowlist.
- Endpoints: `POST /api/jira/search`, `POST /api/reports/:id/push-to-jira`.
- **Blocking:** Q7 (Jira instance URL, API token). Park until resolved.

### W8 — Codebase indexing pipeline
- `apps/api/src/index/chunk.service.ts` — `ts-morph`-based chunker (chunk by symbol).
- `apps/api/src/index/embed.service.ts` — `voyage-code-3` embeddings into pgvector.
- New table `code_chunks` (path, sparte, symbol, kind, lastModified, gitSha, embedding).
- CLI command `pnpm index:repo --path <path>` for first run + on-demand reindex.
- Endpoint `POST /api/code/search` (semantic + BM25 hybrid, sparte filter).

### W9 — Code-localizer agent
- `apps/api/src/ai/code-localizer.service.ts` — Claude with tools: `semantic_search`, `grep`, `read_file`, `find_symbol`, `git_log`, `git_blame`.
- Endpoint `POST /api/reports/:id/localize` → top-K candidate files with confidence labels.
- Cache results on the report row.
- **Coordinate:** Lirim W8 renders the panel.

### W10 — WebSocket gateway
- `apps/api/src/realtime/realtime.gateway.ts` (Socket.io).
- Channels: `user:<id>` (notifications), `report:<id>` (live updates), `transcript:<id>` (decomposer streaming).
- Authorize on connect using existing JWT (web) or basic auth header (widget).
- Emit on: new bug report, AI proposal ready, Jira sync update, transcript node added.
- **Coordinate:** Donart W9 consumes in widget; Lirim consumes in web app.

---

## 2b. Phase 3 deepening (extras not covered in Lirim's / Donart's plans)

Things from `IMPLEMENTATION_PLAN.md` §13 (extra ideas) that fall in my lane and aren't picked up elsewhere. All AI / backend / data work — fits the intake & analysis story Phase 3 is about. Order them after W1–W10 unless a stakeholder pulls one forward.

### W11 — AI auto-triage on submit
- New agent `apps/api/src/ai/triage-agent.service.ts`.
- Runs on report create (BullMQ job, async — don't block the submit response).
- Inputs: title, description, captured_context (URL/IDs/sparte), recent similar reports (W4).
- Outputs (written to `bug_reports.ai_proposed_*` jsonb fields): proposed severity, sparte (correction/refinement), suggested assignee (from `users` who fixed similar reports — uses `bug_reports.reporterId` + `jira_issue_key` history).
- Confidence score on each proposal; surfaces only if confidence > threshold.
- Lirim consumes the proposals on the report-detail page (his W3 already renders `ai_proposed_ticket`; same panel can show triage suggestions).
- **Coordinate:** depends on W2 (polisher schema patterns) + W4 (similarity to compute "who fixed similar before").

### W12 — Test-case generator (extends ticket polisher)
- New agent or extension of W2: given a polished bug report (steps to reproduce, expected vs actual), generate a Cypress or Playwright test stub.
- Output: text block stored in `bug_reports.ai_proposed_ticket.testStub`.
- Endpoint: `POST /api/reports/:id/generate-test-stub`.
- The framework choice (Cypress vs Playwright) is configurable per sparte (env or config table) — comparer-ui uses Cypress today.
- Lirim's W3 panel can show + copy the snippet.
- **Coordinate:** depends on W2 polisher producing structured steps.

### W13 — Daily digest worker
- BullMQ scheduled job (cron-style, default 09:00 local).
- Pulls yesterday's reports + Jira movement (uses W7 `tickets_cache`).
- AI summarization agent (Sonnet 4.6 — cost-conscious; this is high-volume): groups by sparte, severity, status; highlights spikes, new blockers, freshly-resolved tickets.
- Output: Markdown digest + post target. Local-only project, so the "post target" is a file written to `dist/digests/YYYY-MM-DD.md` and an endpoint `GET /api/admin/digests/:date` that returns it. (Slack/Teams/email integration is deferred — out of scope for local-only.)
- **Coordinate:** depends on W7 ticket cache for Jira movement; useful pre-W7 with reports-only summary.

### W14 — Bug pattern alerts (incident detection)
- Extension of W4 dedup pipeline: when N (configurable, default 3) reports cluster within a rolling window (default 1 hr) above similarity threshold, emit a `pattern.detected` event on W10's WebSocket gateway.
- Updates `bug_reports.cluster_id` (new column, migration) so all reports in the cluster link to one incident view.
- New table `incidents` (id, cluster_key, opened_at, summary jsonb) — light schema, basically a denormalized rollup.
- Lirim renders the cluster on the inbox; Donart's W9 widget surfaces "we're seeing several similar reports right now" before submit.
- **Coordinate:** depends on W4 embeddings + W10 WebSocket; new pgvector ANN index for hot-path performance.

### W15 — Codebase Q&A bot
- New agent `apps/api/src/ai/qa-bot.service.ts`.
- RAG over the W8 codebase index — semantic search (top-K) + read-file + grep tools.
- Different from W9 (code-localizer) which is "where is the bug" — this is general "how does X work in this codebase".
- Endpoint: `POST /api/qa/ask` — chat-style, supports multi-turn via `chat_sessions.kind = 'qa'` (already in schema).
- Useful for onboarding / triage. Could later be reused inside Lirim's web app or Donart's widget as an opt-in chat mode.
- **Coordinate:** depends on W8 index; lives in Phase 5 territory but cheap to build once W8 ships.

### W16 — Confluence answer bot
- Mirror structure to W15 but RAG source is Confluence (the team's actual product/policy docs, not code).
- Atlassian MCP server already exposes `confluence.search` + `confluence.read` — reuse the W7 client.
- Endpoint: `POST /api/qa/confluence/ask`. Multi-turn via `chat_sessions.kind = 'qa-confluence'`.
- **Coordinate:** depends on W7 (MCP client); blocked until Q7 (Jira/Confluence access) is resolved.

### W17 — Cross-source dedup (reports ↔ Jira tickets)
- Extension of W4: at submit time, also check `tickets_cache` for similar resolved/in-progress tickets, not only past `bug_reports`.
- Same embedding model (Voyage) so vectors are comparable; needs `embedding` column on `tickets_cache` (small migration on top of W7).
- Endpoint enhancement: `POST /api/reports/check-duplicate` returns `{ similarReports: [...], similarTickets: [...] }`.
- Donart's W9 surfaces "we already fixed this in v3.2.1" guidance.
- **Coordinate:** depends on W4 + W7; tiny on top of either.

---

## 3. Order of attack

### Main batch (W1–W10)
1. **W1 streaming** — small, unblocks UX, low conflict surface
2. **W2 ticket polisher** — natural extension of intake agent
3. **W4 dedup embeddings** — foundational for later (W7, W8, W11, W14, W17)
4. **W5 + W6 admin API** — unblocks Lirim's admin UI
5. **W3 transcript decomposer** — bigger lift, needs new schema
6. **W10 WebSocket gateway** — once 2+ consumers exist
7. **W7 Jira** — once Q7 is resolved
8. **W8 + W9 code indexing/localizer**

### Phase 3 deepening (W11–W17)
Tackle these once the main batch lands. Most layer on top of earlier workstreams (W4 / W7 / W8 / W10), so doing them out of order pays a re-work tax.

9. **W11 auto-triage** — once W4 lands (needs similarity to suggest assignee)
10. **W17 cross-source dedup** — tiny patch on top of W4 + W7
11. **W14 incident detection** — once W4 + W10 land
12. **W12 test-case generator** — once W2 polisher schema is stable
13. **W13 daily digest** — once W7 ticket cache exists (or earlier with reports-only)
14. **W15 codebase Q&A** — once W8 index lands
15. **W16 Confluence Q&A** — once W7 MCP client is wired

---

## 4. Conflict-avoidance rules

- New tables → new schema file (`apps/api/src/db/schema/<feature>.ts`), never edit existing schema files.
- New migrations → run `pnpm drizzle-kit generate` in a fresh git pull and rebase before merging if names collide.
- New DTOs → new file in `libs/shared-types/`.
- Touching `apps/api/src/app.module.ts` → coordinate (frequent merge target). Add-imports only.
- Anthropic SDK or Voyage upgrade → Slack the team first.
- Branch naming: `clirim/<workstream>` (e.g. `clirim/w2-ticket-polisher`).

---

## 5. Definition of done per workstream

- All endpoints have happy-path unit tests (Jest).
- Migrations checked in, idempotent locally (`pnpm db:reset && pnpm db:migrate`).
- Schemas + prompts in repo files, even if DB overrides exist.
- `nx run-many -t build,test --projects=api` green.
- Status moved to "Done" in [PROGRESS_CLIRIM.md](./PROGRESS_CLIRIM.md) with date and verification line.
