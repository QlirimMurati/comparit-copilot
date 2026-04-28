# Frontend — `apps/web`, `apps/widget`, `libs/widget`

Angular 19 (standalone) + Tailwind 3. Two front-ends: the admin/web app and an embeddable Web Component widget.

## Location

- Repo root: `/Users/dp/Sources/comparit-copilot`
- Admin/web app: `apps/web` — http://localhost:4240
- Widget host (demo + build target for the custom element): `apps/widget` — http://localhost:4241
- Widget Angular library: `libs/widget` (component + context capture, exported as `<copilot-widget>`)

> Non-standard ports `:4240` / `:4241` leave `:4200`/`:4201` free for `comparer-ui`.

## Start

```bash
# from /Users/dp/Sources/comparit-copilot — assumes API running on :3000
pnpm start:web                  # admin app on http://localhost:4240
pnpm nx serve widget-host       # widget demo on http://localhost:4241
```

`apps/web` proxies `/api` → `http://localhost:3000` via `apps/web/proxy.conf.json`.

## Admin app — `apps/web/src/app/`

| Folder | Purpose |
|---|---|
| `app.routes.ts`, `app.config.ts` | Standalone routing + providers |
| `core/api/` | Typed HTTP clients (auth, bug-reports) |
| `core/auth/` | Auth state, token storage, route guards |
| `pages/login/` | Login form |
| `pages/home/` | Landing |
| `pages/reports/` | Bug-report list + `/reports/new` create form |

Login as `admin@comparit.de` / `admin`.

## Widget — `libs/widget` + `apps/widget`

- `libs/widget/src/lib/` — Angular component, context-capture util (URL, IDs, viewport, timezone, etc.), packaged via `ng-packagr`
- Registered as a Web Component (`<copilot-widget>`) using `@angular/elements`
- `apps/widget` is the host that builds/serves the custom element
- Submits to `POST /api/widget/reports` with HTTP Basic Auth (`widget:local` from `.env`)
- Chat mode (default) talks to `POST /api/widget/chat/{start,message,submit}`; falls back to a Form tab
- Consumed externally as `@comparit/copilot-widget` (embedded in all 12 sparte apps under `comparer-ui`)

## Test / Lint / Build

```bash
pnpm nx test web
pnpm nx test widget
pnpm nx lint web
pnpm nx build web
pnpm nx build widget            # produces the publishable lib
pnpm nx run-many -t build       # build everything
```

## Styling

- Tailwind 3 (`tailwindcss`, `postcss`, `autoprefixer`)
- Global styles: `apps/web/src/styles.scss`

## Gotcha

If `nx` fails with module-resolution errors, open a fresh terminal inside this repo (sibling Nx workspace env can pollute resolution).
