# Step 13: Dashboard with real Parsim pages

## Goal

Replace the starter's demo pages with real Parsim pages (overview, agent sessions, session detail, API keys, settings, setup), served by new read-only backend endpoints scoped to the user's projects, with a development auto-login until sign-in pages arrive in step 18.

## What was built

### Backend

- **Dashboard endpoints** (`/api/v1/projects/:projectId/...`, JWT, owner only, 404 for anyone else):
  - `dashboard/summary`: requests, tokens, cost, upstream calls, GC runs and reduction, savings applied (on mode) and estimated (shadow mode) in tokens and dollars, recalls, and decisions by reason.
  - `dashboard/daily`: one entry per UTC day.
  - `sessions`: paged, sortable by last seen, first seen, requests or tokens saved, searchable with literal wildcards.
  - `sessions/:id`: requests with their GC run, decisions with reasons, and recalls.
  - `settings`: each threshold with the project's value and the server default, side-effect tools, recall limit.
  - API keys and settings changes use the existing endpoints.
- **Content rule.** Only the session detail returns content, and only when the project stores content. Other endpoints never return it, which the tests check.
- **Per-project GC settings** (your choice): projects can override the five thresholds and add side-effect tools. Null uses the `.env` default. Project tools are added to the server list, never replace it. The GC uses the project's values on its traffic.
- **Demo seed** (`npm run seed:demo`): two projects for the seeded admin with 30 days of fake traffic and no prompt content.
  - "Demo research agent": Gemini, GC on, with recalls.
  - "Demo support agent": OpenAI, shadow mode.
  - Running it again replaces them; it refuses to run in production.

### Frontend

- **Demo pages removed** (your choice): product, users, kanban, chat, AI chat, forms, icons, notifications, React Query demo and the starter overview.
  - Also removed: their feature folders, mock APIs and mock data, and the packages only they used (AI SDK, dnd-kit, faker, match-sorter, sort-by, uuid, zustand).
  - The shadcn components, layout, data table and charts stay.
- **Development auto-login.** With `DEV_AUTO_LOGIN=true`, `src/proxy.ts` signs in as the seeded admin and keeps the JWT in an httpOnly cookie until shortly before it expires.
  - It refuses to run when `NODE_ENV=production`.
  - The token never reaches browser JavaScript: server components call the backend directly, and the browser goes through `/api/parsim/...`, which only forwards `/projects` paths.
  - Without a token the dashboard says "Not signed in" and explains how to enable it.
- **Project switcher** at the bottom of the sidebar, and Parsim navigation: Overview, Agent sessions, API keys, Settings, Setup.
- **Pages:**
  - **Overview:** tokens and dollars saved, context reduction, requests and recalls for 7, 30 or 90 days, a daily savings chart, and decisions by type in the `--gc-*` colors (drops red, archives blue). Shadow projects show "Shadow mode: estimated savings".
  - **Agent sessions:** data table with server-side search, sort and paging through the URL.
  - **Session detail:**
    - KPIs;
    - a request timeline with context before and after GC, GC badges, cache, cost and status;
    - decisions with reasons and stubs;
    - recalls;
    - the original tool result only when allowed.
  - **API keys:** create (the key is shown once, with a copy button), list, revoke with confirmation.
  - **Settings:**
    - GC mode, with a warning when On is selected and a confirmation dialog before saving;
    - thresholds, where empty uses the default shown;
    - side-effect tools;
    - content storage.
  - **Setup:** one-line snippets for the OpenAI SDK, Gemini through the OpenAI SDK, the Google GenAI SDK, the Anthropic SDK and Claude Code, with the Parsim endpoint filled in and the project's own provider first.
- **Fixes found while testing:**
  - The starter's table hook split text searches at hyphens and spaces.
  - Relative times caused hydration mismatches.
  - URL parsers imported from a `'use client'` module were not usable by server pages.
  - The help panel showed the starter's placeholder text.
  - The Next.js dev indicator covered the project switcher.
  - Breadcrumbs showed raw segments.

## Files changed

### Backend

- `src/dashboard/` (new): controller, service, query DTOs and helpers, types; plus `dashboard-query.spec.ts`.
- `src/projects/**`: per-project GC fields in the domain, entity, mapper, DTOs and service.
- `src/projects/project-gc-config.ts` (+ spec).
- `src/proxy/proxy-gc.service.ts`: uses the project's GC config.
- `src/database/migrations/1791725005289-AddProjectGcSettings.ts`.
- `src/database/seeds/demo/` (new): `demo-data.ts` (+ spec), `run-demo-seed.ts`; `package.json` gets `seed:demo`.
- `src/app.module.ts`.
- `test/dashboard/dashboard.e2e-spec.ts` (new).
- `docs/dashboard.md` (new), `docs/gc.md`, `docs/recall.md`, `docs/readme.md`.

### Frontend

- Removed: the demo pages and features listed above, `src/constants/mock-api*.ts`, `src/lib/api-client.ts`, `components/ui/kanban.tsx`, `components/forms/demo-form.tsx`, `layout/cta-github.tsx`.
- `src/lib/parsim/`: `config`, `dev-auth`, `server-api`, `client-api`, `types`, `format` (+ tests).
- `src/proxy.ts`, `src/app/api/parsim/[...path]/route.ts`.
- `src/app/dashboard/`: `layout.tsx`, `actions.ts`, and the `overview`, `sessions`, `sessions/[sessionId]`, `api-keys`, `settings` and `setup` pages.
- `src/features/`: `overview`, `sessions`, `api-keys`, `settings`, `setup` (each with its `api/` layer), `parsim.test.ts`.
- Components: `layout/project-switcher.tsx`, `layout/not-signed-in.tsx`, `copy-button.tsx`, `time.tsx`; `app-sidebar`, `header`, `info-sidebar`, `icons` updated.
- Config and hooks: `config/nav-config.ts`, `hooks/use-breadcrumbs.tsx`, `hooks/use-data-table.ts`.
- `vitest.config.mts`, `package.json` (test script, Vitest, removed packages), `next.config.ts`, `env.example.txt`, `docs/parsim-dashboard.md`, `CLAUDE.md`.

### Other

- `docs/progress/step-13-dashboard.md`, `docs/progress/README.md`.
- `docs/progress/screenshots/step-13-*.jpg`: 15 screenshots, every page in dark and light, plus the shadow-mode overview and the "turn on" confirmation.

## Tests

- **Backend unit:** date range parsing and UTC day buckets, LIKE escaping, effective project GC config, demo data (seeded randomness, pricing, decisions only in passes, shadow sends no smaller requests).
- **Backend e2e** (`dashboard.e2e-spec.ts`, 23 tests, with data generated through the real proxy and the fake upstream):
  - summary in on mode, including a recall, and shadow estimates;
  - date range filtering and invalid ranges;
  - daily entries;
  - session sorting, paging, search with literal wildcards, and invalid queries;
  - session detail with content, and without content when storage is off;
  - list and summary endpoints never returning content;
  - 404 for unknown and foreign sessions;
  - settings defaults and overrides;
  - invalid settings rejected;
  - project thresholds applied to real traffic;
  - another user gets 404 on every endpoint;
  - no token gets 401.
- **Frontend unit** (Vitest, added in this step, 48 tests):
  - token, dollar, percent and relative-time formatting;
  - reduction and headline savings (shadow, on, off);
  - chart series;
  - the auto-login guard, including refusing to run in production, and sign-in with a mocked backend;
  - URL state and API paths;
  - settings form conversion and validation;
  - setup snippets.
- **Manual check in the browser** with the seeded demo data, in dark and light mode, saved under `docs/progress/screenshots/`. Covered:
  - project switching;
  - the overview charts and the shadow label;
  - sessions search, sort and paging;
  - the session timeline and decisions;
  - creating a key (shown once) and revoking it;
  - saving a threshold and resetting it;
  - the On warning and confirmation, then cancelling.

  A production build (`next build`) also succeeds.
- **Last runs:**
  - Backend `npm test`: 429 passed (32 suites).
  - Backend `npm run test:e2e`: 205 passed (14 suites).
  - Frontend `bun run test`: 48 passed; `bun run lint` 0 warnings; `bun run typecheck` clean.

## Decisions and trade-offs

- **Per-project thresholds** (your choice) as nullable project columns, rather than a separate settings table. The GC merges them over the env defaults.
- **Dollars saved price saved tokens at the input list price.** Cache discounts are ignored, which overstates the savings for heavily cached traffic. The step 12 comparison showed real savings are lower when the cache discount is high.
- **A backend proxy route plus server-side calls instead of exposing the JWT.** The auto-login token stays httpOnly. The route only forwards `/projects` paths, so the browser cannot reach the user or admin APIs through it.
- **Server pages await their prefetch.** The client query function calls `/api/parsim`, which is not reachable during server rendering, so data must be in the cache before the client components render. This is a small first-load cost.
- **Project selection in a cookie**, so every page and server render agrees without a project id in every URL.
- **All demo pages removed** (your choice), along with the packages only they used. Generic UI components were kept even where unused for now.

## How to verify

From `backend/`:

```bash
npm run migration:run
```

```bash
npm run seed:demo
```

```bash
npm test
```

Expect 429 passing.

```bash
npm run test:e2e
```

Expect 205 passing.

```bash
npm run start:dev
```

From `frontend/`, with `PARSIM_API_URL=http://localhost:3001` and `DEV_AUTO_LOGIN=true` in `.env.local` (see `env.example.txt`):

```bash
bun run test
```

```bash
bun run lint
```

```bash
bun run typecheck
```

```bash
bun run dev
```

Open http://localhost:3000, pick "Demo research agent" in the switcher at the bottom of the sidebar, and go through every page.

## Known issues and next steps

- **Sign-in is development-only.** The auto-login signs in as the seeded admin; step 18 replaces it with real sign-in. With it off, the dashboard only shows "Not signed in".
- **No project creation in the UI yet.** Projects are created through the API or the demo seed.
- **The demo data has no stored content**, so the "Original tool result" view only shows for real traffic in projects that store content.
- **Dollars saved ignore cache discounts** (see Decisions). A cache-aware savings figure could come with replay (step 15).
- **The UTC day buckets** cast `usage_record.createdAt`, a timestamp without time zone, using the database session's time zone. It should be the same as the server's, as it is locally. Making the column `timestamptz` would remove the assumption.
- **Still pending from earlier steps:**
  - the live cache comparison (Gemini free-tier quota);
  - the Anthropic live tests (no key);
  - the recall live test;
  - the manual Claude Code check;
  - regenerating the Observe secret and the Gemini key that were pasted in chat.
