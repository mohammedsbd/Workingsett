# Parsim dashboard

The dashboard shows what the context GC saved for each project, and manages its API keys and settings. It reads the Parsim backend's dashboard API (see `backend/docs/dashboard.md`).

## Pages

| Page | What it shows |
| --- | --- |
| Overview (`/dashboard/overview`) | Tokens and dollars saved, context reduction, requests and recalls for 7, 30 or 90 days, a daily savings chart, and decisions by type in the `--gc-*` colors. Shadow-mode projects are labelled "Shadow mode: estimated savings". |
| Agent sessions (`/dashboard/sessions`) | Every agent run, searchable by session id or model, sortable and paged on the server. |
| Session detail (`/dashboard/sessions/:id`) | Each request's context before and after GC, the GC decisions with their reasons and stubs, recalls, compressions, and the Replay tab: pick request points and a budget, see the cost estimate, start a replay, follow its progress and read the report (agreement rate, both versions' tokens and cost, answers side by side). The original tool result and the answers are only shown when the project stores content. |
| API keys (`/dashboard/api-keys`) | Create a key (shown once, with a copy button), list keys, revoke a key. |
| Settings (`/dashboard/settings`) | GC mode (with a warning and a confirmation before switching to On), thresholds (empty uses the server default), side-effect tools, compression, who pays for the replay judge, and content storage. |
| Setup (`/dashboard/setup`) | One-line integration snippets for OpenAI, Gemini (OpenAI-compatible and the Google GenAI SDK), Anthropic and Claude Code, with the Parsim endpoint filled in. |

The project switcher at the bottom of the sidebar picks the project every page shows (stored in the `parsim_project` cookie).

## Running it locally

1. Start the backend on port 3001 with its database migrated and seeded (`npm run migration:run`, `npm run seed:run:relational`), and optionally `npm run seed:demo` for demo data.
2. In `frontend/.env.local` (see `env.example.txt`):

   ```bash
   PARSIM_API_URL=http://localhost:3001
   DEV_AUTO_LOGIN=true
   DEV_AUTO_LOGIN_EMAIL=admin@example.com
   DEV_AUTO_LOGIN_PASSWORD=secret
   ```

3. `bun run dev` and open http://localhost:3000.

## Development auto-login

There is no sign-in page yet (step 18). With `DEV_AUTO_LOGIN=true`, `src/proxy.ts` signs in as the configured user when there is no token cookie, and keeps the backend JWT in the httpOnly `parsim_token` cookie until shortly before it expires. It refuses to run when `NODE_ENV=production` (the request fails with a 500 that says so). Without it, the dashboard shows "Not signed in".

The token never reaches browser JavaScript:

- Server components call the backend directly with the token (`src/lib/parsim/server-api.ts`).
- Client components call `/api/parsim/...`, a route handler that adds the token and only forwards `/projects` paths (`src/app/api/parsim/[...path]/route.ts`).

## Data fetching

Each feature has the starter's `api/service.ts` and `api/queries.ts`. Server pages prefetch with the same query keys through the server fetcher, awaited so the data is in the cache before the client components render, and hydrate it with `HydrationBoundary`. Values shared by the server page and the client view (URL parsers) live in `api/params.ts`, outside `'use client'` modules, and import from `nuqs/server`.

## Tests

```bash
bun run test
```

Vitest runs the unit tests (`src/**/*.test.ts`) for formatting, savings, the settings form's values, setup snippets, URL state and the auto-login guard.
