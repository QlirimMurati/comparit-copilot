# Lirim — Progress

> Live progress for Lirim's workstreams. Update each working session.
> Plan: [IMPLEMENTATION_PLAN_LIRIM.md](./IMPLEMENTATION_PLAN_LIRIM.md) · Master: [PROGRESS.md](./PROGRESS.md)

---

## Current Focus

- **Active workstream:** W10 bilingual (after i18n decision); rest of W9 (trend tiles) needs aggregation endpoint
- **Last updated:** 2026-04-28

---

## Workstream Status (10)

| W# | Workstream | Status | Notes |
|---|---|---|---|
| W1 | Bug report detail / edit page | Done | Shipped 2026-04-28 |
| W2 | Captured-context viewer | Done | Shipped 2026-04-28 (`@comparit-copilot/ui-kit`) |
| W3 | AI proposal panel | Mostly done | Polish + dedup + test-stub wired; Jira-push stubbed (Q7) |
| W4 | Prompt admin UI | Done | Shipped 2026-04-28 with replay panel |
| W5 | Few-shot management UI | Done | Shipped 2026-04-28 |
| W6 | NL Jira search UI | Blocked | Clirim W7 (Q7 unresolved) |
| W7 | Transcript decomposer UI | Mostly done | REST-only; live WebSocket tree-fill TODO |
| W8 | "Likely affected files" panel | Blocked | Clirim W8 + W9 not shipped |
| W9 | Dashboards | Partial | First tile shipped; trend tiles need aggregation endpoint |
| W10 | Bilingual web UI | TODO | Pending i18n choice with Donart |

---

## In Progress

_none_

---

## Done

- 2026-04-28 — W1 Bug report detail/edit page — `nx build web` clean; route `/reports/:id` loads, edits status/severity/sparte/jiraIssueKey via existing `PATCH /api/reports/:id`.
- 2026-04-28 — W2 Captured-context viewer — new `libs/ui-kit/` lib (path alias `@comparit-copilot/ui-kit`) with `<lib-context-viewer>`; `nx build ui-kit` + `nx test ui-kit` green; consumed by W1 detail page.
- 2026-04-28 — W4 Prompt admin UI — `/admin/prompts` with create/edit/toggle + replay panel (last 5 intake sessions side-by-side diff); `roleGuard(['admin','qa_lead'])`. `nx build web` clean.
- 2026-04-28 — W5 Few-shots admin UI — `/admin/few-shots` with structured turn editor (user/assistant), label, active toggle. Same role guard. `nx build web` clean.
- 2026-04-28 — W3 AI proposal panel — detail page renders `aiProposedTicket` (title, type, labels, repro steps, expected/actual). "Run polisher" + "Generate test stub" + "Check duplicates" buttons live. "Push to Jira" stubbed/disabled (Q7).
- 2026-04-28 — W7 Transcript decomposer UI — `/transcripts` paste-and-tree-render, refine input, status badges. REST-only (live WebSocket layer pending `socket.io-client` dep).
- 2026-04-28 — W9 Dashboards (first tile) — `/dashboards` with KPI cards, bugs-per-sparte CSS bar chart, status breakdown chips. No chart lib needed yet.

---

## Decisions

_(record decisions specific to my workstreams; cross-team decisions go in master PROGRESS.md)_

---

## Blockers / Open Questions

- **i18n library choice** — `@ngx-translate/core` vs Angular built-in `$localize`. Affects Donart W8 (widget) compatibility — discuss before W10 bilingual half.
- **Chart library for dashboards** — Chart.js vs ng2-charts vs Recharts. Pick before W9.

---

## Notes for Next Session

- Use one service file per backend domain in `apps/web/src/app/core/api/` (don't merge into a mega-service).
- Append-only edits to `app.routes.ts` to avoid merge conflicts.
- Mobile breakpoint baseline: at least passable at sm: 640px.
- Local-only project: no production hosting work; basic auth (email + JWT) stays as-is.
