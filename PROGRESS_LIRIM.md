# Lirim — Progress

> Live progress for Lirim's workstreams. Update each working session.
> Plan: [IMPLEMENTATION_PLAN_LIRIM.md](./IMPLEMENTATION_PLAN_LIRIM.md) · Master: [PROGRESS.md](./PROGRESS.md)

---

## Current Focus

- **Active workstream:** W9 (dashboards shell) next — W1 + W2 shipped 2026-04-28
- **Last updated:** 2026-04-28

---

## Workstream Status (10)

| W# | Workstream | Status | Notes |
|---|---|---|---|
| W1 | Bug report detail / edit page | Done | Shipped 2026-04-28 |
| W2 | Captured-context viewer | Done | Shipped 2026-04-28 (`@comparit-copilot/ui-kit`) |
| W3 | AI proposal panel | TODO | Depends on Clirim W2 + W4 + W7 |
| W4 | Prompt admin UI | TODO | Depends on Clirim W6 |
| W5 | Few-shot management UI | TODO | Depends on Clirim W5 |
| W6 | NL Jira search UI | TODO | Depends on Clirim W7 |
| W7 | Transcript decomposer UI | TODO | Depends on Clirim W3 + W10 |
| W8 | "Likely affected files" panel | TODO | Depends on Clirim W8 + W9 |
| W9 | Dashboards | TODO | |
| W10 | Bilingual web UI | TODO | CI half dropped per scope decision; bilingual pending i18n choice |

---

## In Progress

_none_

---

## Done

- 2026-04-28 — W1 Bug report detail/edit page — `nx build web` clean; route `/reports/:id` loads, edits status/severity/sparte/jiraIssueKey via existing `PATCH /api/reports/:id`.
- 2026-04-28 — W2 Captured-context viewer — new `libs/ui-kit/` lib (path alias `@comparit-copilot/ui-kit`) with `<lib-context-viewer>`; `nx build ui-kit` + `nx test ui-kit` green; consumed by W1 detail page.

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
