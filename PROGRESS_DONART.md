# Donart — Progress

> Live progress for Donart's workstreams. Update each working session.
> Plan: [IMPLEMENTATION_PLAN_DONART.md](./IMPLEMENTATION_PLAN_DONART.md) · Master: [PROGRESS.md](./PROGRESS.md)

---

## Current Focus

- **Active workstream:** _none yet — start with W1 (reporter email config) + W10 tests half per plan_
- **Last updated:** 2026-04-28

---

## Workstream Status (10)

| W# | Workstream | Status | Notes |
|---|---|---|---|
| W1 | Reporter email config (no Keycloak) | TODO | Provider-input, simple override |
| W2 | Console + unhandled rejection breadcrumbs | TODO | New `breadcrumb.service.ts` |
| W3 | Network error breadcrumbs (HttpInterceptor) | TODO | In comparer-ui wrapper |
| W4 | NgRx store snapshot capture | TODO | Needs W5 first |
| W5 | Configurable PII sanitizer | TODO | Must land before W4 |
| W6 | On-demand screenshot | TODO | Lazy-load `html2canvas` |
| W7 | Streaming chat render in widget | TODO | Depends on Clirim W1 |
| W8 | Bilingual widget UI strings | TODO | German default; sync with Lirim W10 |
| W9 | WebSocket consumer + dedup pre-check | TODO | Depends on Clirim W4 + W10 |
| W10 | Widget polish (config + Shadow DOM + tests) | TODO | Tests half early, polish later |

---

## In Progress

_none_

---

## Inherited (already done by previous sessions, mine to maintain)

- [x] `libs/widget/` Angular library — buildable, Shadow DOM, reactive form
- [x] `apps/widget/` Web Component shim — `<copilot-widget>` registered, runs on :4201
- [x] `libs/copilot-widget/` in comparer-ui — wrapper lib + `provideCopilotWidget()` + loader
- [x] Path alias `@comparit/copilot-widget` in `tsconfig.base.json`
- [x] Widget embedded in all 13 sparte apps' root components (uncommitted on `develop`)
- [x] `provideCopilotWidget()` registered in `libs/nf-remote/src/lib/helper/get-app-config.ts`
- [x] Initial chat-mode UI: bubbles, typing indicator, submit-report button on intake completion

---

## Done

_(append entries here as workstreams complete; format: `YYYY-MM-DD — Wn name — verification line`)_

---

## Decisions

_(record decisions specific to my workstreams; cross-team decisions go in master PROGRESS.md)_

---

## Blockers / Open Questions

- **Postgres/Redis port conflicts on macOS** — currently `55432` / `56379`; document in `infra/README.md` so new dev machines don't hit it.

---

## Notes for Next Session

- Comparer-ui current branch: `develop`, mid-Phase-14 refactor. Keep widget edits to additions; don't refactor surrounding code.
- Family services have been refactored to composition (memory: `VergleichBase` and `ComparerFamilyBase` deleted). NgRx snapshot (W4) should target the new structure, not the old god-class state shape.
- Clean-env wrapper still needed when running nx in `comparit-copilot` from a shell that recently ran nx in `comparer-ui` (see master PROGRESS.md "Caveats" section).
- Local-only project: no production hosting work; basic auth (HTTP Basic for widget→API) stays as-is.
