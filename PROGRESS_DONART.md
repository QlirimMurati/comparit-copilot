# Donart — Progress

> Live progress for Donart's workstreams. Update each working session.
> Plan: [IMPLEMENTATION_PLAN_DONART.md](./IMPLEMENTATION_PLAN_DONART.md) · Master: [PROGRESS.md](./PROGRESS.md)

---

## Current Focus

- **Active workstream:** W10 follow-on — apps/api test baseline (Clirim repo) still TODO
- **Last updated:** 2026-04-28

---

## Workstream Status (10)

| W# | Workstream | Status | Notes |
|---|---|---|---|
| W1 | Reporter email config (no Keycloak) | DONE | Added `reporterEmail` to `CopilotWidgetConfig`, three-level fallback (input → config → CurrentUserService) |
| W2 | Console + unhandled rejection breadcrumbs | DONE | `host/breadcrumb.service.ts`, ring buffer 50, auto-installed via `ENVIRONMENT_INITIALIZER` |
| W3 | Network error breadcrumbs (HttpInterceptor) | DONE | `host/copilot-http-interceptor.ts` (functional), allowlist + blocklist + 401 ignore |
| W4 | NgRx store snapshot capture | DONE | `storeAccessor` config field, applied in `enrichCaptured`, sanitizer covers it |
| W5 | Configurable PII sanitizer | DONE | `widget/sanitizer.ts`, default block keys + IBAN/tax-ID/card/email regex masking, 9 unit tests |
| W6 | On-demand screenshot | DONE | `screenshot.service.ts`, lazy `import('html2canvas')`, preview + remove |
| W7 | Streaming chat render in widget | DONE | SSE via fetch, AbortController stop button, falls back to blocking on error |
| W8 | Bilingual widget UI strings | DONE | `i18n.ts` with de/en dicts, auto-detect on chat input |
| W9 | WebSocket consumer + dedup pre-check | DONE | `widget-socket.service.ts` (socket.io-client w/ reconnect), `checkDuplicate` gate before submit, dedup overlay UI |
| W10 | Widget polish (config + Shadow DOM + tests) | PARTIAL | Sanitizer/breadcrumb config surfaced; ShadowDom encapsulation untouched; widget unit tests added (22 tests, 5 suites). **apps/api tests in Clirim repo NOT addressed.** |

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

- 2026-04-28 — W1 reporter email config — added to `CopilotWidgetConfig`, typecheck green, build green for `comparit`/`bu`/`kfz`
- 2026-04-28 — W2 console breadcrumbs — `CopilotBreadcrumbService` auto-installs via `ENVIRONMENT_INITIALIZER`, 5 unit tests pass
- 2026-04-28 — W3 network breadcrumbs — `copilotHttpInterceptor` functional interceptor + `CopilotNetworkBreadcrumbService` (3 unit tests pass)
- 2026-04-28 — W4 store snapshot — `storeAccessor` flows through `enrichCaptured`, sanitizer test verifies redaction on a composition-state shape
- 2026-04-28 — W5 PII sanitizer — `sanitize()` recursive, default block keys + IBAN/tax-ID/card/email regex (9 unit tests)
- 2026-04-28 — W6 screenshot — lazy `html2canvas`, preview + remove, base64 attached to `captured_context.screenshot`
- 2026-04-28 — W7 streaming chat — SSE via fetch + AbortController, stop button, fallback to blocking on stream error before any token received
- 2026-04-28 — W8 bilingual UI — de/en inline dictionaries, auto-detect on chat input, locale input on wrapper
- 2026-04-28 — W9 socket + dedup — `socket.io-client` reconnect, `checkDuplicate` gate before submit with confirm overlay
- 2026-04-28 — W10 polish + tests (host-side) — 22 unit tests across sanitizer/i18n/breadcrumb/network buffer/store snapshot all green; `nx build comparit/bu/kfz` green

---

## Decisions

_(record decisions specific to my workstreams; cross-team decisions go in master PROGRESS.md)_

---

## Blockers / Open Questions

- **Postgres/Redis port conflicts on macOS** — currently `55432` / `56379`; document in `infra/README.md` so new dev machines don't hit it.
- **Backend dependencies for full E2E**: W7 needs Clirim's SSE endpoint `POST /api/widget/chat/message/stream`; W9 needs `POST /api/reports/check-duplicate` and the WebSocket gateway. Client gracefully degrades if missing (stream falls back to blocking; dedup proceeds with submit on error). Verify against Clirim's branch when merged.
- **prototype-frontend dev server casing issue** (`pnpm start:cp:local` errors with `/users/dp/...` lowercase paths into `libs/comparer/...`) is **pre-existing, not caused by this work** — `nx build` for `comparit`/`bu`/`kfz` succeeds.
- **apps/api test baseline (W10 second half) not addressed** — that's in `comparit-copilot` and depends on Clirim's API surface.

---

## Notes for Next Session

- Comparer-ui current branch: `develop`, mid-Phase-14 refactor. Keep widget edits to additions; don't refactor surrounding code.
- Family services have been refactored to composition (memory: `VergleichBase` and `ComparerFamilyBase` deleted). NgRx snapshot (W4) should target the new structure, not the old god-class state shape.
- Clean-env wrapper still needed when running nx in `comparit-copilot` from a shell that recently ran nx in `comparer-ui` (see master PROGRESS.md "Caveats" section).
- Local-only project: no production hosting work; basic auth (HTTP Basic for widget→API) stays as-is.
