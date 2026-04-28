# Clirim — Progress

> Live progress for Clirim's workstreams. Update each working session.
> Plan: [IMPLEMENTATION_PLAN_CLIRIM.md](./IMPLEMENTATION_PLAN_CLIRIM.md) · Master: [PROGRESS.md](./PROGRESS.md)

---

## Current Focus

- **Active workstream:** W5/W6 admin endpoints next — W1, W2, W4 shipped
- **Last updated:** 2026-04-28

---

## Workstream Status (10 + 7 = 17)

### Main batch
| W# | Workstream | Status | Notes |
|---|---|---|---|
| W1 | Streaming responses | Done (2026-04-28) | SSE endpoint live; unblocks Donart W7 |
| W2 | Ticket polisher agent | Done (2026-04-28) | `POST /api/reports/:id/polish` writes to `bug_reports.ai_proposed_ticket`; unblocks Lirim W3 + my W12 |
| W3 | Transcript decomposer | TODO | New tables + tools |
| W4 | Dedup via embeddings | Done (2026-04-28) | `embedding vector(1024)` column + BullMQ embed worker + `POST /api/reports/check-duplicate`; unblocks Donart W9 + Lirim W3 + W11/W14/W17 |
| W5 | Few-shot loading + admin API | TODO | Unblocks Lirim W5 |
| W6 | Prompt overrides + replay | TODO | Unblocks Lirim W4 |
| W7 | Jira MCP integration | BLOCKED | Q7 Jira details — also unblocks W13/W16/W17 |
| W8 | Codebase indexing | TODO | Unblocks W9, W15 |
| W9 | Code-localizer agent | TODO | Depends on W8 |
| W10 | WebSocket gateway | TODO | Once 2+ consumers exist — also unblocks W14 |

### Phase 3 deepening (extras owned by me)
| W# | Workstream | Status | Notes |
|---|---|---|---|
| W11 | AI auto-triage on submit | TODO | Depends on W4 |
| W12 | Test-case generator | TODO | Depends on W2 |
| W13 | Daily digest worker | TODO | Reports-only fine pre-W7; richer once W7 lands |
| W14 | Bug pattern alerts (incidents) | TODO | Depends on W4 + W10 |
| W15 | Codebase Q&A bot | TODO | Depends on W8 |
| W16 | Confluence Q&A bot | TODO | Depends on W7 + Q7 |
| W17 | Cross-source dedup (reports ↔ tickets) | TODO | Tiny patch on W4 + W7 |

---

## In Progress

_none_

---

## Done

- 2026-04-28 — W1 streaming responses — `POST /api/widget/chat/message/stream` returns SSE (text_delta / state / done / error events); `IntakeAgentService.runTurnStream` wraps the tool loop around `messages.stream()`; final assistant turn persisted to `chat_messages` after stream end; existing blocking `/message` endpoint kept as fallback. Verified: `nx run api:build` green; `nx run api:test` 10/10 passing including 3 new tests for `runTurnStream`.
- 2026-04-28 — W2 ticket polisher agent — `POST /api/reports/:id/polish` (JWT-guarded) loads the bug report + linked chat transcript and runs Claude with `tool_choice` forcing a single `submit_polished_ticket` tool call. Output validated against `PolishedTicketSchema` (Zod), persisted to `bug_reports.ai_proposed_ticket`. New column added via migration `0003_add_ai_proposed_ticket.sql`. Schema lives at `apps/api/src/ai/ticket-polisher.schema.ts` (deviation from plan's `schemas/` path — kept inline beside the service, matching the existing `intake-schema.ts` pattern). Verified: build green; api test suite 17/17 passing including 7 new tests for the polisher service + Zod schema.
- 2026-04-28 — W4 dedup via embeddings — added `embedding vector(1024)` column on `bug_reports` (migration `0004_add_bug_report_embedding.sql`; using voyage-3 native dimension instead of plan's literal 1536). New `VoyageService` (fetch-based wrapper for `voyage-3` / `voyage-code-3` with configurable input type + output dimension), `EmbedQueueService` + `EmbedWorker` using bullmq (Redis from existing `infra/docker-compose.yml`), and `DedupService` doing pgvector cosine-distance lookup via `drizzle-orm`'s `cosineDistance`. Embed jobs enqueued from `WidgetService.submit`, `BugReportsService.create`, and `IntakeController.submit` after each report insert. New endpoint `POST /api/reports/check-duplicate` (JWT-guarded) returns top-K candidates filtered by configurable distance ceiling. Both Voyage and Redis are no-op-graceful when env vars are missing (warn + skip). Module wiring: removed unused `WidgetModule` import from `AiModule`, made `WidgetModule → AiModule` to access the queue. Deps added: `bullmq@5.76.2`, `ioredis@5.10.1`. Verified: build green; api test suite 28/28 passing including 11 new tests across `voyage.service.spec.ts`, `dedup.service.spec.ts`, `embed.worker.spec.ts`. Follow-up (deferred): HNSW vector index for hot-path latency once data volume grows.

---

## Decisions

_(record decisions specific to my workstreams; cross-team decisions go in master PROGRESS.md)_

---

## Blockers / Open Questions

- **Q4 (Anthropic API account)** — confirm `cm@comparit.de` org access at console.anthropic.com.
- **Q7 (Jira details)** — instance URL, API token, sandbox availability. Blocks W7.

---

## Notes for Next Session

- Streaming endpoint should preserve `cache_control: ephemeral` boundaries — system prompt must remain cacheable.
- New tables → new file in `apps/api/src/db/schema/`, then `pnpm drizzle-kit generate` — name migrations descriptively, rebase before merging if collisions.
- Local-only project: no production hosting work; basic auth stays as-is.
