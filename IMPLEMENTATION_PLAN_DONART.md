# Copilot — Donart's Implementation Plan

> **Owner:** Donart
> **Master plan:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — read first for vision, architecture, data model.
> **Live status:** [PROGRESS_DONART.md](./PROGRESS_DONART.md)
> **Teammates:** [Clirim](./IMPLEMENTATION_PLAN_CLIRIM.md) (backend AI + Jira), [Lirim](./IMPLEMENTATION_PLAN_LIRIM.md) (web app)

> **Scope reminders:** local-only project (no production hosting, no deployment). Auth stays as the existing basic stub — HTTP Basic between widget and API (`WIDGET_BASIC_USER` / `WIDGET_BASIC_PASS` env vars). No Keycloak, no OIDC.

---

## 1. Scope (what is mine)

The embedded chat widget end-to-end (Web Component build, runtime context capture, comparer-ui wrapper) and local infra. I make sure the widget runs anywhere a sparte app runs locally.

### Folders I own

```
apps/widget/                                          ← widget-host registration shim
libs/widget/                                          ← widget Angular library
infra/                                                ← local Docker compose (Postgres + Redis)
/Users/cm/Projects/comparer-ui/libs/copilot-widget/   ← thin Angular wrapper in comparer-ui
```

### Files I edit in comparer-ui (already started — uncommitted on `develop`)

```
tsconfig.base.json                                              (path alias)
libs/nf-remote/src/lib/helper/get-app-config.ts                 (provideCopilotWidget)
apps/<each-sparte>/src/app/(components/)?(<sparte>|app).component.{ts,html}   (embed widget)
```

### Folders I touch (coordinate)

- `apps/api/src/widget/` — widget endpoints exist; I propose changes (Clirim approves backend shape)
- `libs/shared-types/` — add widget-side types (CapturedContext, requests) in own files
- `apps/api/src/realtime/` — I'm a consumer of Clirim W10 WebSocket gateway, not author
- `package.json` — coordinate `@angular/elements` / `socket.io-client` upgrades on Slack first

---

## 2. Workstreams (10)

### W1 — Reporter email config (no Keycloak)
- Replace hardcoded `'admin@comparit.de'` with a configurable input on `provideCopilotWidget({ reporterEmail })`.
- Each sparte app passes whatever email makes sense for local dev (default to a single shared bootstrap user is fine).
- Document in `libs/copilot-widget/README.md`.
- **Done when:** any of the 13 sparte apps can override the email via the provider config without code changes elsewhere.

### W2 — Console + unhandled rejection breadcrumbs
- New `libs/widget/src/lib/widget/breadcrumb.service.ts`:
  - Wrap `console.error`, `window.onerror`, `unhandledrejection` (chain, don't replace).
  - Ring buffer of last 50 events.
  - Push into `CapturedContext.consoleErrors`.
- Init in `provideCopilotWidget()` so it boots with the wrapper.

### W3 — Network error breadcrumbs (HttpInterceptor)
- Inside the comparer-ui wrapper (interceptors need DI in the host app), add an opt-in `HttpInterceptor` that records non-2xx responses.
- Buffer feeds into `captureContext()` at submit time.
- Configurable URL allowlist/blocklist (don't capture user PII routes).

### W4 — NgRx store snapshot capture
- New API on `provideCopilotWidget({ storeAccessor })` — host app passes a function that returns the current state tree.
- Sanitizer runs on the snapshot before attach (W5).
- **Coordinate:** comparer-ui's family services were just refactored to composition (Phase 13/14 — `VergleichBase` / `ComparerFamilyBase` deleted). Test against the new state shape.

### W5 — Configurable PII sanitizer
- New `libs/widget/src/lib/widget/sanitizer.ts`.
- Config: `{ blockKeys: string[], maskRegex: { name, regex, replacement }[] }`.
- Default blocklist: `versicherungsnummer`, `iban`, `geburtsdatum`, `steuerId`, `passwort`, `password`, `token`.
- Default mask regex: IBAN, German tax ID, credit card patterns.
- Recursively walks `CapturedContext` before send.
- **Done when:** unit tests cover blocklist + regex masking; manual test against an NgRx snapshot from BU app shows redaction works.

### W6 — On-demand screenshot
- "Attach screenshot" button in widget panel.
- Use `html2canvas` (heavy — load lazily).
- Show preview, allow remove before submit.
- Send as base64 in `captured_context.screenshot`.

### W7 — Streaming chat render in widget
- Consume Clirim W1's SSE endpoint (`POST /api/widget/chat/message/stream`).
- Token-by-token render in assistant bubble.
- "Stop" button cancels the stream (abort signal).
- Fall back to blocking endpoint if SSE fails (env flag).
- **Coordinate:** depends on Clirim W1.

### W8 — Bilingual widget UI strings
- German default per user preference.
- Auto-detect user input language per turn (Clirim handles AI; I handle UI strings).
- Match Lirim's i18n approach where compatible inside Shadow DOM, else simple inline dictionary.
- **Coordinate:** sync with Lirim W10.

### W9 — WebSocket consumer + pre-submit duplicate check
- **WebSocket consumer:** `socket.io-client` in widget; subscribe to `user:<id>` channel; toast on new message; reconnect with backoff. Depends on Clirim W10.
- **Dedup pre-check:** before final submit, call `POST /api/reports/check-duplicate` (Clirim W4); if matches above threshold, show "Looks similar to..." with link, ask confirm.

### W10 — Widget polish (config inputs + Shadow DOM + tests)
- **Config inputs:** surface PII sanitizer config + breadcrumb opt-ins as inputs on `provideCopilotWidget()`. Per-sparte overrides documented in `libs/copilot-widget/README.md`.
- **Shadow DOM polish:** verify icons/fonts load inside Shadow DOM (no leakage from host); reduce inline styles where possible; confirm widget doesn't pick up host CSS in any of the 13 sparte themes.
- **Tests:** cover `BasicAuthGuard`, `widget.service.ts`, `widget.controller.ts` (happy + 401), `auth.service.ts` (JWT sign/verify), `auth.controller.ts` (login + invalid). Get `apps/api` from ~7 tests up to a meaningful baseline.

---

## 3. Order of attack

1. **W1 reporter email config** — simple, immediate value
2. **W10 tests half** — backfill before adding more code
3. **W2 + W3 breadcrumbs** — context quality jump, fully my surface
4. **W5 PII sanitizer** — must land before W4 (snapshot can carry PII)
5. **W4 NgRx snapshot** — once sanitizer is solid
6. **W7 streaming render** — once Clirim W1 ships
7. **W9 dedup + WebSocket** — once Clirim W4 + W10 ship
8. **W6 screenshot + W10 polish + W8 bilingual** — non-blocking finishing touches

---

## 4. Conflict-avoidance rules

- **comparer-ui edits go in dedicated PRs** to that repo on `develop` — never bundled with copilot repo PRs.
- Per-sparte app embedding edits — keep each sparte change tiny (4–6 lines: import + render). Land them in a single sweep PR per session.
- `tsconfig.base.json` and `libs/nf-remote/src/lib/helper/get-app-config.ts` are merge hotspots in comparer-ui — rebase before pushing.
- `apps/api/src/widget/` changes go through Clirim for backend-shape sign-off.
- `package.json` — coordinate `@angular/elements`, `socket.io-client`, `html2canvas` upgrades on Slack first.
- Branch naming in copilot repo: `donart/<workstream>`. In comparer-ui: same prefix.

---

## 5. Definition of done per workstream

- Widget runs cleanly in dev mode with hot reload (`pnpm start:widget-host`).
- Widget loads in at least 3 sparte apps from comparer-ui without console errors.
- Shadow DOM isolation verified — no host CSS bleeds in or out.
- New context fields visible in submitted `bug_reports.captured_context` jsonb (verify via Postgres or Lirim's W2 viewer).
- `nx run-many -t build,test --projects=widget-host,widget,api` green.
- Status moved to "Done" in [PROGRESS_DONART.md](./PROGRESS_DONART.md) with date + verification line.
