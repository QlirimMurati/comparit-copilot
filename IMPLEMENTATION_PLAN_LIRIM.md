# Copilot — Lirim's Implementation Plan

> **Owner:** Lirim
> **Master plan:** [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — read first for vision, architecture, data model.
> **Live status:** [PROGRESS_LIRIM.md](./PROGRESS_LIRIM.md)
> **Teammates:** [Clirim](./IMPLEMENTATION_PLAN_CLIRIM.md) (backend AI + Jira), [Donart](./IMPLEMENTATION_PLAN_DONART.md) (widget + integration)

> **Scope reminders:** local-only project (no production hosting, no deployment). Auth stays as the existing basic stub (email + JWT). No Keycloak, no OIDC.

---

## 1. Scope (what is mine)

The Copilot web app for devs/QA/POs. Everything in `apps/web/`, the shared `libs/ui-kit/`, dashboards, and the admin UI for prompts and few-shots. I render what Clirim's API exposes.

### Folders I own

```
apps/web/                        ← all of it
libs/ui-kit/                     ← shared Angular components
apps/web/src/app/pages/admin/    ← prompt + few-shot management
apps/web/src/app/pages/jira/     ← NL search UI
apps/web/src/app/pages/transcripts/  ← paste + refine UI
apps/web/src/app/pages/dashboards/   ← stats
.github/workflows/               ← CI for the whole repo (see W10)
```

### Folders I touch (coordinate)

- `libs/shared-types/` — add my view-model types in own files
- `apps/web/src/app/core/api/` — one service file per backend domain (don't merge into one mega-service)
- `package.json` — coordinate Angular / Tailwind / NgRx upgrades on Slack first

---

## 2. Workstreams (10)

### W1 — Bug report detail / edit page (Phase 1 leftover) — ✅ DONE 2026-04-28
- Route `/reports/:id`.
- Show: header (title, status, severity, sparte), reporter, created, captured context (collapsible), AI proposal (when present), Jira link.
- Edit controls: status dropdown, severity dropdown, sparte select, jira_issue_key text input.
- Saves via existing `PATCH /api/reports/:id`.
- **Shipped:** [detail.component.ts](apps/web/src/app/pages/reports/detail/detail.component.ts) + view link from list.

### W2 — Captured-context viewer (shared component) — ✅ DONE 2026-04-28
- Reusable component `<lib-context-viewer>` in `libs/ui-kit/` (path alias `@comparit-copilot/ui-kit`).
- Renders `captured_context` jsonb cleanly: route + IDs as a key-value table; meta (browser/locale/app) as a key-value table; collapsible "Other fields" raw JSON for unknown shapes.
- Used in W1 detail page; available for Donart's widget review-before-submit.
- **Shipped:** [context-viewer.component.ts](libs/ui-kit/src/lib/context-viewer/context-viewer.component.ts).
- **Follow-up:** breadcrumbs timeline + store-snapshot tree once Donart's W2/W4 produce those fields.

### W3 — AI proposal panel on report detail — ✅ MOSTLY DONE 2026-04-28
- Renders `bug_reports.ai_proposed_ticket` (Clirim W2 ticket polisher output) — title, type, labels, repro steps, expected/actual.
- "Run / Re-run polisher" button (`POST /api/reports/:id/polish`).
- "Generate test stub" button (`POST /api/reports/:id/generate-test-stub`) — shows Cypress/Playwright source.
- "Check duplicates" button (`POST /api/reports/check-duplicate`) — lists similar reports with cosine distance.
- "Push to Jira" button — **stubbed/disabled** with tooltip "pending Q7" until Clirim W7 lands.
- **Shipped:** detail.component.html `AI proposal` / `Possible duplicates` / `Test stub` sections.

### W4 — Prompt admin UI (`/admin/prompts`) — ✅ DONE 2026-04-28
- List of DB overrides per agent (intake / ticket_polisher / transcript_decomposer / triage / qa_bot / code_localizer).
- "Currently active prompt" panel showing whether DB override or repo default is active.
- Create / edit form (textarea + note + active toggle).
- Toggle active inline from row.
- **Replay panel:** runs candidate prompt against last 5 intake sessions; side-by-side diff of original vs candidate assistant output.
- Permission gate: `qa_lead` / `admin` via [roleGuard](apps/web/src/app/core/auth/role.guard.ts).
- **Shipped:** [prompts.component.ts](apps/web/src/app/pages/admin/prompts/prompts.component.ts).

### W5 — Few-shot management UI (`/admin/few-shots`) — ✅ DONE 2026-04-28
- List per agent (label, turn count, active badge, updated date).
- Create form: label + structured turn editor (add/remove user/assistant turns, role toggle, text per turn) + active toggle.
- Edit existing entry — same form pre-filled.
- Toggle active inline from row.
- Permission gate via [roleGuard](apps/web/src/app/core/auth/role.guard.ts).
- **Shipped:** [few-shots.component.ts](apps/web/src/app/pages/admin/few-shots/few-shots.component.ts).
- **Note:** scoring (1–5) deferred — backend doesn't carry a score field yet.

### W6 — NL Jira search (`/jira/search`) — 🚫 BLOCKED on Clirim W7 (Q7)
- Input box → `POST /api/jira/search` → results table (Jira key, title, status, assignee, sparte).
- Show generated JQL (debug toggle).
- Click-through to ticket detail (read-only) + "find similar resolved" companion.
- **Coordinate:** depends on Clirim W7. Q7 (Jira instance URL + API token) still unanswered.

### W7 — Transcript decomposer UI (`/transcripts`) — ✅ MOSTLY DONE 2026-04-28
- Paste textarea + optional title → `POST /api/transcripts` returns full Epic/Story/Subtask tree.
- Tree view: nested cards by depth (epic → story → subtask), labels, hour estimate badges, assistant explanation.
- Refine input: free-form instruction → `POST /api/transcripts/:id/refine` → re-rendered tree.
- "Start over" resets state.
- **Shipped:** [transcripts.component.ts](apps/web/src/app/pages/transcripts/transcripts.component.ts).
- **Follow-up:** live tree-fill via Clirim W10 WebSocket channel `transcript:<id>` (currently REST-only — `socket.io-client` dep needs to be added). "Push all to Jira" deferred until Clirim W7 ships.

### W8 — "Likely affected files" panel — 🚫 BLOCKED on Clirim W8 + W9
- Renders Clirim W9 output on report detail: top-K files with confidence label, recent commit + author, click-through to file at line.
- "Find similar resolved tickets" companion (uses tickets_cache embeddings).
- **Coordinate:** depends on Clirim W8 (codebase indexing) + W9 (code-localizer agent). Neither shipped yet.

### W9 — Dashboards (`/dashboards`) — 🟡 PARTIAL 2026-04-28
- ✅ Total / Open / Resolved KPI cards.
- ✅ Bugs-per-sparte horizontal bar chart (CSS bars off the existing `GET /api/reports` data — no chart lib needed yet).
- ✅ Status breakdown chips.
- ❌ Time-to-resolution trend line — needs aggregation endpoint (TODO: small read-only addition to `apps/api/src/bug-reports/`, coordinate with Clirim).
- ❌ Deploy correlation overlay — needs git SHA aggregation from `captured_context`.
- **Shipped:** [dashboards.component.ts](apps/web/src/app/pages/dashboards/dashboards.component.ts). Chart lib decision deferred until trend lines are needed.

### W10 — Bilingual web UI — ⏳ TODO (CI half dropped)
- **Bilingual:** `@ngx-translate/core` or Angular's built-in `$localize`. English default, German parallel; language toggle in header. Extract all hardcoded strings.
- **Coordinate i18n choice with Donart's W8** (widget bilingual) before starting — both must use the same library.
- **Note:** CI workflow scope dropped (local-only project — no `.github/workflows/`). Verification via local `nx run-many -t lint,test,build`.
- **Done when:** every page renders in both languages.

---

## 3. Order of attack

1. ✅ **W1 detail page + W2 context viewer** — shipped 2026-04-28
2. ✅ **W4 + W5 admin UIs** — shipped 2026-04-28
3. ✅ **W3 AI proposal panel** — shipped 2026-04-28 (Jira-push button stubbed)
4. ✅ **W7 transcript decomposer UI** — shipped 2026-04-28 (REST-only; live tree-fill TODO)
5. ✅ **W9 dashboards** — first tile shipped 2026-04-28; trend tiles need aggregation endpoint
6. ⏳ **W10 bilingual** — pending i18n choice with Donart
7. 🚫 **W6 Jira search** — blocked on Clirim W7 (Q7)
8. 🚫 **W8 affected-files panel** — blocked on Clirim W8 + W9

---

## 4. Conflict-avoidance rules

- One service file per API domain in `apps/web/src/app/core/api/` — never one mega `api.service.ts`.
- New routes → append to `app.routes.ts` (avoid reordering).
- `libs/ui-kit/` — components are append-only too; if I rename, do it in a dedicated PR.
- `package.json` — coordinate Angular / Tailwind / NgRx / chart-lib upgrades on Slack first.
- Branch naming: `lirim/<workstream>` (e.g. `lirim/w4-prompt-admin`).

---

## 5. Definition of done per workstream

- Page renders cleanly in both English and German (W10 onward).
- Loading + error states handled (no raw `Error: ...` to user).
- Mobile breakpoint at least passable (sm: 640px).
- Basic Cypress or Playwright smoke covering happy path.
- `nx run-many -t build,test --projects=web` green.
- Status moved to "Done" in [PROGRESS_LIRIM.md](./PROGRESS_LIRIM.md) with date + verification line.
