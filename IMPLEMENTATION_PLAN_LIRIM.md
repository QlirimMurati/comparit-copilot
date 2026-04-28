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

### W1 — Bug report detail / edit page (Phase 1 leftover)
- Route `/reports/:id`.
- Show: header (title, status, severity, sparte), reporter, created, captured context (collapsible), AI proposal (when present), Jira link.
- Edit controls: status dropdown, severity dropdown, sparte select, jira_issue_key text input.
- Saves via existing `PATCH /api/reports/:id`.
- **Done when:** create-edit-list flow works end-to-end against the local API.

### W2 — Captured-context viewer (shared component)
- Reusable component `<copilot-context-viewer>` in `libs/ui-kit/`.
- Renders `captured_context` jsonb cleanly: route + IDs as a key-value table; breadcrumbs as a timeline; console errors with stack traces collapsed; store snapshot as a tree.
- Used in W1 detail page; also imported by Donart for widget review-before-submit.
- **Coordinate:** Donart imports from `libs/ui-kit/`.

### W3 — AI proposal panel on report detail
- Renders `bug_reports.ai_proposed_ticket` (Clirim W2 ticket polisher output).
- "Re-run polisher" button (calls `POST /api/reports/:id/polish`).
- "Push to Jira" button (calls `POST /api/reports/:id/push-to-jira` — Clirim W7).
- Shows duplicates above a confidence threshold (Clirim W4).
- **Coordinate:** depends on Clirim W2 + W4 + W7.

### W4 — Prompt admin UI (`/admin/prompts`)
- List active prompts per agent + per sparte.
- Edit form (textarea, sparte selector, activate/deactivate toggle).
- **Replay/test panel:** select past sessions, run candidate prompt, show side-by-side diff of model output.
- Permission gate: `qa-lead` and `admin` only (existing JWT role claim).
- **Coordinate:** depends on Clirim W6.

### W5 — Few-shot management UI (`/admin/few-shots`)
- List per agent + per sparte.
- Add new (paste a conversation, score 1–5).
- Activate/deactivate.
- **Coordinate:** depends on Clirim W5.

### W6 — NL Jira search (`/jira/search`)
- Input box → `POST /api/jira/search` → results table (Jira key, title, status, assignee, sparte).
- Show generated JQL (debug toggle).
- Click-through to ticket detail (read-only) + "find similar resolved" companion.
- **Coordinate:** depends on Clirim W7.

### W7 — Transcript decomposer UI (`/transcripts`)
- Paste textarea → `POST /api/transcripts`.
- Live tree view of Epic → Story → Subtask as decomposer fills it (consumes WebSocket channel `transcript:<id>` from Clirim W10).
- Inline edit on any node, then "Push all to Jira" (atomic create via Clirim W7).
- **Coordinate:** depends on Clirim W3 + W10 + W7.

### W8 — "Likely affected files" panel
- Renders Clirim W9 output on report detail: top-K files with confidence label, recent commit + author, click-through to file at line.
- "Find similar resolved tickets" companion (uses tickets_cache embeddings).
- **Coordinate:** depends on Clirim W8 + W9.

### W9 — Dashboards (`/dashboards`)
- Bugs per sparte (bar chart).
- Time-to-resolution (trend line).
- Deploy correlation (overlay deploys on bug-rate timeline — uses git SHA in captured context).
- Use a small chart lib (Chart.js or ng2-charts).
- **Coordinate:** read-only on existing tables; no backend dependency.

### W10 — Bilingual web UI + CI workflow
- **Bilingual:** `@ngx-translate/core` or Angular's built-in `$localize`. English default, German parallel; language toggle in header. Extract all hardcoded strings.
- **CI:** `.github/workflows/ci.yml` running `nx affected -t lint,test,build` for `api`, `web`, `widget-host`, `libs/widget`. Drizzle migration check (`pnpm drizzle-kit check`).
- **Done when:** every page renders in both languages; CI green on a sample PR.

---

## 3. Order of attack

1. **W1 detail page + W2 context viewer** — independent, unblocks demo
2. **W10 CI half** — set up before everyone's code piles up; bilingual half can come last
3. **W4 + W5 admin UIs** — once Clirim W5/W6 endpoints land
4. **W3 AI proposal panel** — once Clirim W2/W4 land
5. **W6 Jira search** — once Clirim W7 lands
6. **W7 transcript decomposer UI** — once Clirim W3 + W10 land
7. **W8 + W9 dashboards/code panel**

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
