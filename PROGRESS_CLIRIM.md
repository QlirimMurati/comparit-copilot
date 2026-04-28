# Clirim — Progress

> Live progress for Clirim's workstreams. Update each working session.
> Plan: [IMPLEMENTATION_PLAN_CLIRIM.md](./IMPLEMENTATION_PLAN_CLIRIM.md) · Master: [PROGRESS.md](./PROGRESS.md)

---

## Current Focus

- **Active workstream:** _none yet — start with W1 (streaming) per plan_
- **Last updated:** 2026-04-28

---

## Workstream Status (10)

| W# | Workstream | Status | Notes |
|---|---|---|---|
| W1 | Streaming responses | TODO | Unblocks Donart W7 |
| W2 | Ticket polisher agent | TODO | Unblocks Lirim W3 |
| W3 | Transcript decomposer | TODO | New tables + tools |
| W4 | Dedup via embeddings | TODO | Unblocks Donart W9 + Lirim W3 |
| W5 | Few-shot loading + admin API | TODO | Unblocks Lirim W5 |
| W6 | Prompt overrides + replay | TODO | Unblocks Lirim W4 |
| W7 | Jira MCP integration | BLOCKED | Q7 Jira details |
| W8 | Codebase indexing | TODO | |
| W9 | Code-localizer agent | TODO | Depends on W8 |
| W10 | WebSocket gateway | TODO | Once 2+ consumers exist |

---

## In Progress

_none_

---

## Done

_(append entries here as workstreams complete; format: `YYYY-MM-DD — Wn name — verification line`)_

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
