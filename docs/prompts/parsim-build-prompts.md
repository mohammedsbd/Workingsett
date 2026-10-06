# Parsim build prompts

Paste these into Claude Code one at a time, from the repo root. Step 01 creates `CLAUDE.md`; after that, Claude Code loads it automatically, so every later prompt relies on its rules (branches, commits, tests, step summaries).

## How to use

1. Start with an empty GitHub repo cloned locally (it may contain only a README). Install Node.js 24+, Bun, Git and PostgreSQL 17 (Windows installer). No Docker.
2. Paste the step 01 prompt.
3. When Claude stops, read the step summary in `docs/progress/`, run the "How to verify" commands yourself, and review the branch on GitHub.
4. Merge the branch into `main`, then run `git checkout main && git pull`.
5. Paste the next prompt. If something is wrong, tell Claude in the same session before merging.

Authentication (sign-in pages, Google and GitHub, emails) is deliberately the last step, so the early steps focus on the product. Until step 18 the dashboard has no login and must only run locally. Do not deploy Parsim publicly before step 18 is done.

At the start of every step, Claude lists what it needs from you (keys, decisions, budgets) and waits. When Claude asks for an API key, paste it in the chat and Claude writes it into the gitignored `backend/.env` itself. It never echoes, logs or commits it. Because keys you paste stay in the chat history, use keys with a spending limit, and rotate any key you think was exposed.

## What you need to provide

| What | When | How |
| --- | --- | --- |
| PostgreSQL 17, installed locally | step 01 | Windows installer; Claude gives you the psql commands to create the app database in step 03 |
| Google OAuth client ID and secret | step 18 | Google Cloud Console, Credentials, OAuth client (web app). Claude tells you the localhost origins and redirect URIs to enter |
| GitHub OAuth app client ID and secret | step 18 | GitHub, Settings, Developer settings, OAuth Apps. Claude tells you the homepage and callback URLs |
| Email sending, optional at first | step 18 | Locally nothing is needed (emails go to `npx maildev`). For real inboxes: a Resend API key and a domain you own, verified in Resend |
| Gemini API key (`GEMINI_API_KEY`) | step 06 | Google AI Studio, "Get API key". Give it to Claude when asked. Set a spending limit in Google Cloud billing. The free tier is fine for development, but never send real customer data through it |
| Anthropic API key (`ANTHROPIC_API_KEY`), optional | step 07 | only for its live tests; skipped if missing |
| OpenAI API key (`OPENAI_API_KEY`), optional | step 06 | only for its live tests; skipped if missing |
| A budget for the benchmark | step 16 | Claude asks before spending |
| A domain and hosting | when you deploy | not needed to build |

## Steps

| Step | What it builds |
| --- | --- |
| 01 | Repo setup, both starter projects, project rules (CLAUDE.md) |
| 02 | Remove Docker from both projects |
| 03 | Run both apps locally and remove Clerk auth |
| 04 | Parsim dashboard theme |
| 05 | Backend cleanup and test infrastructure |
| 06 | Proxy: OpenAI format, forwarding to OpenAI or Gemini, with streaming and usage |
| 07 | Proxy: Anthropic pass-through |
| 08 | Proxy: Gemini native API |
| 09 | Agent sessions and context storage |
| 10 | GC engine v1 (drop and archive) with shadow mode |
| 11 | Recall of archived context |
| 12 | Prompt-cache stability |
| 12b | Content compression with Headroom (JSON and text), recallable |
| 13 | Dashboard: real Parsim pages |
| 14 | Compression with background summaries |
| 15 | Replay |
| 16 | Demo agent and benchmark |
| 17 | Developer integration (docs, llms.txt, CLI) |
| 18 | Authentication: email, Google and GitHub sign-in, real emails, protected dashboard (last, before deploying) |

---

## Step 01: Repo setup and project rules

```text
Step 01: set up the repo with both starter projects and the permanent project rules.

Work on a new branch feat/step-01-repo-setup from main. Never commit to main.

1. Add the two starter projects as plain files (no nested .git folders, no submodules):
   - backend/ from https://github.com/brocoders/nestjs-boilerplate
   - frontend/ from https://github.com/Kiranism/next-shadcn-dashboard-starter
   Use npx degit, or clone and delete the .git folder. Commit each one unchanged in its own commit ("chore(backend): import brocoders nestjs-boilerplate as is", "chore(frontend): import kiranism next-shadcn-dashboard-starter as is"), so every later change is a reviewable diff against upstream. Keep both LICENSE files.
2. Add a root .gitattributes with "* text=auto eol=lf" (and eol=crlf for *.bat, *.cmd, *.ps1) BEFORE the import commits, so files are stored and checked out with LF. Without it, Windows CRLF checkouts make the backend's prettier lint fail with thousands of errors.
3. Add a root .gitignore covering node_modules/, dist/, build/, .next/, coverage/, .env, .env.local, .env.test and *.log.
4. Add a short root README.md: what Parsim is (one paragraph, taken from CLAUDE.md below), the folder layout (backend/, frontend/, docs/, CLAUDE.md), and links to backend/README.md and frontend/README.md for setup.
5. Create CLAUDE.md at the repo root with exactly the content between the two lines of ==== below.
6. Create docs/progress/README.md as the step index described in CLAUDE.md.
7. Install dependencies (npm ci in backend/, bun install in frontend/) and run lint and typecheck in both (backend: npm run lint, npx tsc --noEmit, npm run build; frontend: bun run lint, bun run typecheck). They must pass before the end of the step.

====
# Parsim project rules

Parsim is a garbage collector for the context of long-running AI agents, focused on non-coding agents (research, support, operations, data and browser agents). It is a drop-in proxy that speaks the OpenAI, Anthropic and Google Gemini APIs. On every request it decides, for each piece of context, whether to **keep** it, **compress** it into a state block, **archive** it (store it, leave a stub, let the model recall it) or **drop** it (duplicate or superseded). It forwards the smaller request upstream, returns the response unchanged, and records tokens and dollars saved. Shadow mode and replay prove that quality did not drop.

These rules are permanent and apply to every step.

## Codebase

- Never create new projects from scratch. Extend `frontend/` and `backend/` and follow their existing patterns:
  - backend (NestJS + TypeORM + PostgreSQL, relational setup): the boilerplate's module structure with `domain` / `infrastructure` / `persistence`. Use its generators (`npm run generate:resource:relational`) for new entities where they fit.
  - frontend (Next.js + shadcn/ui, no auth for now): the existing layout, sidebar, data tables, cards and charts.
- Reuse proven libraries before writing our own (for example `js-tiktoken` for token counting, pg-boss for jobs, OpenTelemetry for tracing). The GC decision logic, recall and replay are ours and are never outsourced.
- Headroom (https://github.com/headroomlabs-ai/headroom, Apache 2.0) may be used for content-level compression only (for example its SmartCrusher JSON compressor and Kompress text model), behind our own compressor interface so it can be swapped out. Our GC engine still makes every keep, compress, archive and drop decision, and our archive stores every original so `parsim_recall` works. Keep Headroom's license and NOTICE text in a THIRD_PARTY_NOTICES file, pin its version, and turn its telemetry off (`HEADROOM_BEACON=off`). Never run it in Docker.
- No Docker, ever. No Dockerfiles, no docker-compose, no Docker commands in scripts, docs or instructions. Postgres runs as a local install or a hosted Postgres URL in `.env`.
- No Redis. Background jobs use pg-boss (Postgres-backed queue).
- Must work on Windows. Use `cross-env` in npm scripts that set env vars. No bash-only scripts.
- TypeScript strict. Avoid `any`.
- Secrets only from `.env`. Keep the env example files updated in both projects.
- Never log raw prompt or tool content at info level. Content logging only behind `DEBUG_CONTENT=true`.
- No em dashes in UI copy or docs.
- If a step conflicts with the existing code, explain and propose the smallest change. Ask before deleting large parts of either repo.
- Keep the original LICENSE files of `frontend/` and `backend/` (MIT requires keeping their copyright notices).

## Things you need from me

- At the start of every step, before writing code, list anything you need from me: API keys, accounts, budgets, or decisions. Then wait for my answer.
- For an API key, ask me for it by name (for example `GEMINI_API_KEY`). When I give it to you, write it into the right gitignored env file yourself (`backend/.env`, and `backend/.env.test` if tests need it), creating the file from its example if needed. Then check that the file is gitignored. Never echo the key back, never print it in output or logs, never put it in any other file, and never commit it. Refer to it only by its variable name.
- If a key is missing during a step, skip only the tests that need it (live tests), say so in the step summary, and continue with everything else.
- Never ask for my PostgreSQL superuser password. Give me the exact commands to run myself instead.
- Ask before any action that spends more than a small amount of money (live benchmarks, large replays), and state the estimated cost.

## Providers and models

- Supported upstream providers, in build order:
  1. OpenAI format (`/v1/chat/completions`), forwarding either to OpenAI or to Google Gemini's OpenAI-compatible endpoint (configurable per project). This is how Gemini is supported first.
  2. Anthropic Messages API (`/v1/messages`).
  3. Gemini native API (`generateContent` and `streamGenerateContent`).
- Every provider is an adapter behind one interface. Adding a provider must not change the GC engine.
- Parsim's own internal model calls (compression summaries, the replay judge, the demo agent, benchmarks and live tests) default to a Gemini Flash model through `GEMINI_API_KEY`. The provider and model are configurable in `.env`; never hardcode a model name in code.
- Customers bring their own provider keys. Parsim forwards with them and never pays for customer traffic.
- Never send real customer data through a free-tier key.

## Architecture (build in this order)

1. **Proxy.** `POST /v1/chat/completions` (OpenAI format, upstream OpenAI or Gemini), `POST /v1/messages` (Anthropic format), then the Gemini native endpoints. Authenticate with a Parsim key, run the GC, forward with the customer's provider key, stream the response back unchanged (SSE), and record the usage the provider reports. Upstream errors pass through with the same status and body.
2. **Storage.** Postgres entities for sessions, messages, context items (with a content hash), archived originals, GC decisions and usage records.
3. **GC engine.** A pure, deterministic module: same input and same config give byte-identical output. Each decision is recorded with a reason.
4. **Recall.** Archived items become a short stub. Parsim adds a `parsim_recall` tool; when the model calls it, Parsim fetches the original from Postgres and continues the call itself, so the agent never sees the round trip.
5. **Cache stability.** Keep the prompt prefix stable so provider prompt caching keeps working: once a message is rewritten, it is rewritten the same way on every later call, and GC passes run only when the context crosses a threshold, not on every call.
6. **Shadow mode, dashboard, replay.** Shadow mode runs the GC but forwards the original request and only records what would have changed. The dashboard shows savings. Replay re-sends recorded sessions with and without the GC and compares the outcomes.

### GC invariants (never break these, and test every one)

- Never change or remove the system prompt, the first user goal, or the last N turns (N is configurable).
- Never drop or archive a tool call that has side effects, or its result (the action log).
- Never change the model's response.
- Archived content must always be recallable.
- Output is deterministic.
- If the GC throws, forward the original request unchanged and log the error. Parsim must never break the customer's agent.

## Testing (required in every step)

Every step ships with real NestJS tests. A step is not done until its tests are written and passing.

### Unit tests (`npm test`)

- Jest, with files next to the code as `*.spec.ts` under `backend/src`.
- Build modules with `Test.createTestingModule` from `@nestjs/testing`, and provide real classes. Mock only external boundaries: the upstream LLM provider, the clock and randomness.
- The GC engine is covered by table-driven tests built from fixture conversations in `backend/test/fixtures/`. Every GC invariant above has at least one test.
- Determinism test: run the GC twice on the same input and assert the outputs are byte-identical, including after appending new messages to a processed session (the already-processed prefix must not change).
- Keep coverage of the GC module at 90% lines or more (`npm run test:cov`).

### End-to-end tests (`npm run test:e2e`)

- Files in `backend/test/` named `*.e2e-spec.ts`.
- Boot the real Nest app in the test (`Test.createTestingModule({ imports: [AppModule] })`, then `app.init()`) and call it with `supertest`.
- Use a real PostgreSQL test database (for example `api_test`), configured in `backend/.env.test`, never the dev database. Run migrations before the suite and clean tables between tests.
- Replace the real LLM provider with a local fake upstream (an in-process HTTP server started by the test) that returns canned JSON and canned SSE streams, and records what it received. Point the provider base URL at it through config.
- Every proxy endpoint gets e2e tests for: a normal request, a streamed request, an upstream error passing through, a bad or missing Parsim key, usage being recorded, shadow mode forwarding the original request, and the GC actually shrinking a long fixture conversation.
- Recall gets an e2e test where the fake upstream calls `parsim_recall` and the test asserts the archived original was sent back upstream and the final response reached the client.
- Tests must not depend on each other or on test order.

### Live tests (opt-in only)

- Tests that call real providers live in files named `*.live-spec.ts`, run only when `LIVE_TESTS=true`, use the cheapest model (Gemini Flash by default, other providers only when their key is set), skip cleanly when a key is missing, and are never part of the default test run or CI.

### Frontend

- Lint and typecheck on every step. When we add frontend logic beyond layout (for example data formatting or the savings calculations), add unit tests for it.

### Before every commit

- `npm run lint`, `npx tsc --noEmit` and `npm test` pass in `backend/`; `bun run lint` and `bun run typecheck` pass in `frontend/`.
- Before the end of a step, `npm run test:e2e` also passes.

## Working in steps

- Work one step at a time. After each step: run lint, typecheck, unit tests and e2e tests, summarize what changed, list exact commands to verify, then stop and wait.
- Step summary (required at the end of EVERY step):
  1. Write `docs/progress/step-XX-<short-name>.md` (XX = step number) with these sections:
     - Goal: one or two sentences on what this step was for
     - What was built: features, entities, endpoints, pages, in plain language
     - Files changed: the main files added or modified, grouped by backend / frontend / other
     - Tests: which tests were added, and the pass counts from the last run of `npm test` and `npm run test:e2e`
     - Decisions and trade-offs: choices made and why
     - How to verify: exact commands to run and what should be seen
     - Known issues and next steps: anything unfinished, risky or worth revisiting
  2. Commit it as `docs(progress): add step XX summary`.
  3. Also print the same summary in chat, followed by the commit list.
  4. Keep `docs/progress/README.md` as an index: one line per step with its date, branch name and a one-sentence summary.

## Git workflow

- Never commit directly to `main`. Each step gets its own branch named `feat/step-XX-short-description` (`fix/...` for bug-fix work).
- Commit often: one logical change per commit (one entity, one endpoint, one rule, one test file, one page). A step should usually produce 5 to 15 commits.
- Only commit when lint, typecheck and the relevant tests pass. Never commit a broken build.
- Tests may be committed with the code they cover, or in their own `test(...)` commit right after it.
- Use Conventional Commits: `type(scope): summary`
  - types: feat, fix, refactor, test, docs, chore, build, ci, perf, style
  - scopes: backend, frontend, proxy, gc, recall, compaction, savings, replay, observability, dashboard, auth, db, demo-agent, docs, repo
  - summary: imperative mood, lower case, no period, max 72 characters
  - add a body when the reason is not obvious (why, not what)
  - examples:
    - `feat(gc): archive stale tool results above token threshold`
    - `test(gc): prove byte-identical output for processed session prefix`
    - `feat(proxy): stream upstream SSE responses with usage capture`
    - `test(proxy): add e2e tests against fake upstream for streaming`
    - `docs(backend): add windows setup steps without docker`
- Never commit `.env` files, secrets, API keys, `node_modules`, `dist` or build output. Keep the root `.gitignore` covering these.
- No empty or artificial commits. Every commit must contain a real, meaningful change.
- At the end of each step: push the branch to `origin`, list the commits made (`git log --oneline main..HEAD`), and say the branch is ready to review. Do not merge to `main`.
====

Finish with the step summary as CLAUDE.md describes, push the branch, and stop.
```

---

## Step 02: Remove Docker

```text
Step 02: remove Docker completely from both projects.

Follow CLAUDE.md. Branch: feat/step-02-remove-docker from main.

1. Inventory first: search both projects for every Docker-related item (Dockerfiles, docker-compose files, .dockerignore, container startup scripts such as startup.*.sh and wait-for-it.sh, npm scripts that call docker, CI workflows or jobs that use Docker, docs and agent instruction files that mention Docker, and the boilerplate's .install-scripts that reference Docker files). Put the full list in the step summary.
2. Delete the Docker files and scripts, remove the Docker npm scripts and CI jobs, and remove references from the install scripts.
3. In the backend env examples, replace Docker service hostnames (postgres, maildev, mongo) with localhost.
4. Rewrite the setup docs (backend README and docs/, frontend README, AGENTS.md, CLAUDE.md of the starter, docs/deployment.md, env.example.txt, scripts/cleanup.js entries that edit Dockerfiles, and the bundled next-best-practices skill files) so they describe a local PostgreSQL install or a hosted Postgres URL instead. Suggest npx maildev as an optional local mail catcher.
5. Leave backend/CHANGELOG.md as is (it is release history).
6. Verify that this prints nothing:
   git grep -n -i docker -- backend frontend ":!backend/CHANGELOG.md" ":!backend/package-lock.json"
   (the lockfile mentions is-docker, an unrelated npm dependency).

Commit backend and frontend changes separately. Lint, typecheck and build must still pass in both projects.

Finish with the step summary, push, and stop.
```

---

## Step 03: Run locally and remove Clerk

```text
Step 03: run both apps locally on Windows and remove Clerk auth from the frontend.

Follow CLAUDE.md. Branch: feat/step-03-run-locally-remove-clerk from main.

Part A: backend runs locally
1. Check that PostgreSQL is installed and running (Windows service postgresql-x64-17, port 5432).
2. The backend expects a database role and database matching backend/.env (copied from the env example; .env is never committed). Do NOT ask me for my postgres superuser password and do not type it anywhere. Instead, give me the exact psql commands to run myself to create the role and database the env example expects, and wait until I confirm.
3. Run migrations and seeds, start the backend, and smoke-test it: GET / and GET /docs return 200, the seeded admin can log in, GET /api/v1/auth/me and GET /api/v1/users work with the token, and return 401 without it. Put the results in the step summary.

Part B: remove Clerk from the frontend
1. The frontend uses Clerk for auth. Remove it completely with the starter's own tool: run node scripts/cleanup.js --dry-run clerk first, review the output, then node scripts/cleanup.js clerk.
2. The script misses the auth.protect() gate in src/app/dashboard/layout.tsx. Remove that and the @clerk/nextjs import by hand, then search src/ for any other Clerk leftovers.
3. Delete any *.cleanup-backup files the script leaves. Recreate frontend/.env.local from env.example.txt with Sentry disabled (NEXT_PUBLIC_SENTRY_DISABLED="true"); never commit it.
4. Run bun install, bun run lint and bun run typecheck.
5. Start the dev server and check: / redirects to /dashboard/overview with no sign-in; /dashboard/overview, /dashboard/product, /dashboard/users and /dashboard/kanban return 200; /auth/sign-in returns 404. Look at the overview page in a browser.

Commit the code changes and the doc changes separately. Note in the summary that the dashboard has no login for now; it comes back in step 13 against the backend's JWT auth.

Finish with the step summary, push, and stop.
```

---

## Step 04: Parsim dashboard theme

```text
Step 04: add a Parsim theme to the dashboard.

Follow CLAUDE.md. Branch: feat/step-04-parsim-dashboard-theme from main.

Goal
Add a "Parsim" theme to the frontend that matches the landing page at https://co-ui2.vercel.app/, and make it the default. Keep all existing themes (Claude, Vercel, Supabase and so on) in the theme switcher.

How themes work here (read first)
- frontend/docs/themes.md explains the theme system.
- Theme files: frontend/src/styles/themes/*.css using [data-theme='name'] and [data-theme='name'].dark
- Imported in frontend/src/styles/theme.css
- Registered in the THEMES array in frontend/src/components/themes/theme.config.ts
- DEFAULT_THEME is in theme.config.ts (docs/themes.md wrongly says active-theme.tsx; fix that line in the docs)
- Fonts: frontend/src/components/themes/font.config.ts
Copy the structure of an existing theme file (vercel.css or claude.css) so every token is defined.

Brand palette (from the landing page)
Accent:
- Primary #FF3B00 (orange-red): buttons, active nav item, focus rings, key highlights
- Secondary #FF7700 (orange): secondary highlights, glows
Dark surfaces, darkest first:
- #000000 page base, #0A0A0A, #0E0E0E sections, #141414 raised cards, #171717 cards and panels, #262626 borders and hover surfaces
Text, brightest first:
- #FFFFFF headings, #F5F5F5, #D4D4D4 body, #A1A1A1 secondary, #737373 labels, #525252 dim labels
- Text on orange buttons: #000000
Fonts:
- Poppins for headings and body (add with next/font/google)
- JetBrains Mono for numbers, labels, code and IDs (already loaded)

What to build
1. frontend/src/styles/themes/parsim.css in oklch like the other themes:
   - Dark mode is the main look: black and near-black backgrounds, #171717 cards, #262626 borders, #FF3B00 as --primary with black --primary-foreground, #FF3B00 as --ring, a matching dark sidebar with #FF3B00 as --sidebar-primary.
   - Light mode: a clean light version that keeps #FF3B00 as the accent, with readable contrast.
   - --destructive must be clearly different from the orange primary.
   - Sharp and minimal: small radius, very subtle shadows.
2. --chart-1 to --chart-5: distinguishable on dark backgrounds (also for colorblind users), starting with the brand orange. Example: #FF3B00, #FF7700, #FFC24D, #D4D4D4 and one soft cool color such as a muted blue.
3. Four semantic variables for GC decisions, used later in charts and badges: --gc-keep, --gc-compress, --gc-archive, --gc-drop. Each clearly distinct and readable in both modes. Suggestion: keep = neutral near-white, compress = #FF7700, archive = a muted cool color, drop = #FF3B00. Map them in the theme's inline mappings so they work as Tailwind classes.
4. Register "Parsim" first in THEMES and set DEFAULT_THEME = 'parsim'.
5. Make dark the default color mode (the layout uses defaultTheme='system'), still allowing light.
6. Optional, only if clean: a subtle orange radial glow in the top corner of the main content area, like the landing page.
7. Rename the visible app name to "Parsim" in the sidebar header, page titles and metadata.

Rules
- Do not change page layouts or components beyond what the theme needs.
- Do not remove other themes.

Checks
- bun run lint and bun run typecheck pass.
- Check overview, product, users and kanban pages in dark and light mode, plus the theme switcher. Aim for WCAG AA contrast (4.5:1 for normal text), including text on orange buttons.
- Save screenshots of the overview page in dark and light mode under docs/progress/screenshots/.

Finish with the step summary, push, and stop.
```

---

## Step 05: Backend cleanup and test infrastructure

```text
Step 05: prepare the backend for Parsim and set up the test infrastructure.

Follow CLAUDE.md. Branch: feat/step-05-backend-test-infrastructure from main.

Part A: cleanup (ask me before deleting anything not listed here)
1. Switch the backend to relational only (TypeORM + PostgreSQL). Remove MongoDB/Mongoose support: the document persistence folders, mongoose dependencies, env-example-document, the document seeds and the database switch in app.module.ts. The boilerplate's .install-scripts/remove-mongodb.ts shows exactly what belongs to Mongo; use it as the checklist (run it if it works non-interactively on Windows, otherwise do the same changes by hand). Then remove .install-scripts and the app:config script.
2. Rename env-example-relational to .env.example and update every reference (docs, README).
3. Remove WORKER_HOST (Redis) from .env.example and any code that reads it. Add empty GEMINI_API_KEY, OPENAI_API_KEY and ANTHROPIC_API_KEY entries and PARSIM_INTERNAL_PROVIDER / PARSIM_INTERNAL_MODEL (default provider gemini, model left for me to fill with the current Gemini Flash model name), each with a short comment.
4. Port the bash generator test scripts (test/generators/run-static.sh, _matrix.sh) to Node, or remove them and their npm scripts if they no longer make sense after removing Mongo. Explain the choice.

Part B: test infrastructure
1. A separate test database: backend/.env.test (gitignored) and backend/.env.test.example (committed) pointing at a database named api_test. Add an npm script that creates and migrates the test database on Windows (Node script, no bash), e.g. npm run test:db:setup.
2. Make npm run test:e2e boot the app inside the test (Test.createTestingModule({ imports: [AppModule] }), app.init(), supertest), load .env.test via cross-env/env-cmd, run with --runInBand, and clean tables between tests. Keep the existing e2e tests working, converting them from calling a running server to the in-process app.
3. A reusable fake upstream LLM server for tests in backend/test/utils/fake-upstream.ts: an in-process HTTP server on a random port that
   - serves POST /v1/chat/completions (OpenAI format, also used for Gemini's OpenAI-compatible endpoint), POST /v1/messages (Anthropic format), and POST /v1beta/models/{model}:generateContent and :streamGenerateContent (Gemini native format)
   - returns canned JSON, or canned SSE streams when streaming is requested
   - can be told to return an error status and body
   - records every request it received (headers and body) so tests can assert on them
4. Fixture conversations in backend/test/fixtures/conversations/: at least a short chat, a long research-agent session (100+ messages with repeated and large tool results), and a support-agent session with several tickets. Plain JSON in OpenAI message format. No real customer data.
5. A first unit test and a first e2e test that prove the setup works (for example, an e2e test that the fake upstream records a request, and the existing auth e2e tests running in-process).

Checks
- npm run lint, npx tsc --noEmit, npm test and npm run test:e2e all pass on Windows.
- The backend still starts with npm run start:dev and the seeded admin can log in.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 06: Proxy, OpenAI pass-through

```text
Step 06: build the proxy pass-through for the OpenAI API format, forwarding to OpenAI or to Google Gemini.

Follow CLAUDE.md. Branch: feat/step-06-proxy-openai from main.

Before you start: ask me for GEMINI_API_KEY (required for live tests), optionally OPENAI_API_KEY, and the Gemini Flash model name to use. Write the keys into backend/.env and backend/.env.test yourself as CLAUDE.md describes. Wait for my answer.

Note: the backend already has a "session" module for login sessions. Put all Parsim code under clearly named modules (for example src/proxy, src/projects, src/usage) and never reuse the word "session" for agent sessions without a prefix (use "agent session").

What to build
1. Projects and Parsim API keys
   - Entity Project (name, created by user) and ParsimApiKey (project, hashed key, prefix for display, created at, last used at, revoked at). Store only a hash of the key; show the full key once at creation.
   - Endpoints (JWT-protected, using the boilerplate's existing auth): create a project, list projects, create, list and revoke API keys. There is no sign-in UI until step 18, so every project belongs to a user and, for now, that user is the seeded admin. Tests log in as the seeded admin to get a JWT. Design everything so adding real users later needs no database changes.
2. Proxy endpoint POST /v1/chat/completions (no /api prefix, so SDKs work with baseURL https://host/v1)
   - Authenticate with the Parsim key from the header x-parsim-key, or from Authorization: Bearer when it starts with the Parsim key prefix. Missing or bad key: 401 in OpenAI error format.
   - The customer's own provider key is sent in a separate header, x-provider-key, or configured per project (encrypted at rest with a key from .env). Never log it.
   - Each project has an upstream setting: "openai" (base URL from config, default https://api.openai.com) or "gemini" (Gemini's OpenAI-compatible endpoint, base URL from config, default https://generativelanguage.googleapis.com/v1beta/openai). Forward the body unchanged to the chosen upstream and return the response unchanged. Build this as a provider adapter so more providers can be added without touching the proxy pipeline.
   - Check how Gemini's OpenAI-compatible endpoint reports usage and streams, and handle any differences in the adapter. Document what you found.
   - Streaming: when "stream": true, pipe the SSE stream through as it arrives, without buffering the whole response. Ask upstream for usage in the stream (stream_options.include_usage) only if the client did not set stream_options, and do not send that extra usage chunk to the client unless it asked for it.
   - Upstream errors and timeouts pass through with the same status and body. Client disconnects cancel the upstream request.
3. Usage records
   - Entity UsageRecord: project, model, input tokens, output tokens, cached input tokens if reported, latency in ms, status, streamed yes/no, created at. No prompt or response content.
   - A model price table in config (a JSON file, editable, with a "last updated" note) used to compute cost. Unknown models get cost null, not a guess.
4. A dev-only option PARSIM_REQUIRE_KEY=false to skip the Parsim key on localhost, documented in .env.example.

Tests
- Unit: key hashing and verification, header parsing, cost calculation (including unknown models), stream usage extraction.
- E2E (fake upstream): non-streamed request is forwarded byte-for-byte and the response returned unchanged; streamed request arrives as a stream with chunks in order; upstream 400/429/500 pass through; missing and revoked keys get 401; a usage record is written with correct token counts and no content; the provider key is never present in logs or the database in plain text; a project set to "gemini" forwards to the Gemini path of the fake upstream.
- Live (LIVE_TESTS=true only): one real call to Gemini (Flash) through the official openai npm SDK pointed at the running proxy, streamed and not streamed. One real call to OpenAI only if OPENAI_API_KEY is set; otherwise skip it.

Docs: add a "Use the proxy" section to backend/README.md with a curl example and an OpenAI SDK example for both OpenAI and Gemini upstreams.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 07: Proxy, Anthropic pass-through

```text
Step 07: add the Anthropic Messages API to the proxy.

Follow CLAUDE.md. Branch: feat/step-07-proxy-anthropic from main.

Before you start: ask me for ANTHROPIC_API_KEY for the live tests and write it into backend/.env and backend/.env.test yourself. If I don't have one, skip the live tests and say so in the summary.

What to build
1. POST /v1/messages that forwards to the Anthropic API (config, default https://api.anthropic.com), reusing the auth, provider-key handling, streaming pipeline and usage recording from step 06. Refactor shared parts into provider adapters (one interface, an OpenAI adapter and an Anthropic adapter) instead of duplicating code.
2. Pass through Anthropic headers the client sends (anthropic-version, anthropic-beta). The provider key comes from x-api-key or x-provider-key.
3. Parsim key for Anthropic clients: also accept it in x-parsim-key. Document how to use it with tools that only let you set ANTHROPIC_BASE_URL (for example, a project-level setting that maps the Anthropic key to the project, or PARSIM_REQUIRE_KEY=false in dev). Explain the option you chose in the summary.
4. Streaming: Anthropic SSE events (message_start, content_block_delta, message_delta, message_stop) pass through unchanged; read usage from message_start and message_delta, including cache read and cache creation tokens.
5. POST /v1/messages/count_tokens passes through.

Tests
- Unit: Anthropic usage extraction from JSON and from streams, including cache tokens.
- E2E (fake upstream in Anthropic format): non-streamed and streamed requests, tool use blocks pass through, errors pass through, usage recorded with cache tokens.
- Live (LIVE_TESTS=true only, skipped without ANTHROPIC_API_KEY): one real call with the official @anthropic-ai/sdk, and a documented manual check of running Claude Code with ANTHROPIC_BASE_URL pointed at the local proxy.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 08: Proxy, Gemini native API

```text
Step 08: add Google Gemini's native API to the proxy.

Follow CLAUDE.md. Branch: feat/step-08-proxy-gemini-native from main.

Before you start: check that GEMINI_API_KEY is set in backend/.env (without printing it). If it is missing, ask me for it and write it in yourself.

What to build
1. Gemini native endpoints, reusing the auth, provider-key handling, streaming pipeline and usage recording through a new Gemini adapter:
   - POST /v1beta/models/{model}:generateContent
   - POST /v1beta/models/{model}:streamGenerateContent (support alt=sse)
   - POST /v1beta/models/{model}:countTokens
   The paths match Google's, so the official Google GenAI SDK can point at Parsim by changing its base URL. Check the SDK's base URL option and document exactly how to set it.
2. Provider key: accept it from the x-goog-api-key header or the key query parameter. Never log full URLs, because the key can be in the query string. Strip it from anything stored.
3. The Parsim key comes from x-parsim-key, or the project-level option you chose in step 07 for tools that cannot send extra headers.
4. Pass through unchanged: contents and parts, systemInstruction, tools with functionDeclarations, functionCall and functionResponse parts, generationConfig, safetySettings and cachedContent references.
5. Usage from usageMetadata: promptTokenCount, candidatesTokenCount, cachedContentTokenCount and any thinking tokens it reports. Add Gemini models to the price table.
6. Upstream errors pass through with the same status and body.

Tests
- Unit: usage extraction from JSON and from streamed chunks, key extraction from header and query, key stripping from stored URLs and logs.
- E2E (fake upstream in Gemini native format): non-streamed and streamed requests, function calls pass through, errors pass through, usage recorded, the provider key never stored or logged.
- Live (LIVE_TESTS=true only): one real call with the official Google GenAI SDK (@google/genai) pointed at the running proxy, streamed and not streamed.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 09: Agent sessions and context storage

```text
Step 09: track agent sessions and store context items.

Follow CLAUDE.md. Branch: feat/step-09-agent-sessions from main.

What to build
1. Agent session identification
   - If the request has the header x-parsim-session-id, use it.
   - Otherwise derive a stable id from a hash of the provider, model family, system prompt and first user message. Document the limits of this.
2. Entities (all under the project)
   - AgentSession: external id, project, provider, model, first seen, last seen, request count.
   - ContextItem: agent session, position, role, kind (system, user, assistant, tool_call, tool_result), content hash (sha256 of a canonical JSON form), token count, first seen at request number. Store content in a separate ContextContent table keyed by hash, so identical content is stored once.
   - Link each UsageRecord to its agent session.
3. Normalization: one internal message model that the OpenAI, Anthropic and Gemini adapters convert to and from, without losing anything (tool calls, tool results, images as references, cache_control markers). Converting a request to the internal model and back must give an identical request.
4. Token counting with js-tiktoken for OpenAI models, the provider's countTokens endpoint or a documented approximation for Anthropic and Gemini models; the provider's reported usage stays the source of truth for billing numbers.
5. Storing happens after the response starts streaming (or in a pg-boss job) so it never adds latency to the request. If storing fails, the request still succeeds.
6. Content is stored only when the project setting "store content" is on (default on in dev). Respect DEBUG_CONTENT for logs.

Tests
- Unit: canonical hashing (key order does not change the hash), round-trip conversion for OpenAI, Anthropic and Gemini native messages including tool use (byte-identical), session id derivation, token counting.
- E2E: three sequential requests from the same fixture conversation create one agent session, the new items only, and deduplicated content; a request where storing fails still returns 200.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 10: GC engine v1 with shadow mode

```text
Step 10: build the GC engine v1 (drop and archive) and shadow mode.

Follow CLAUDE.md, especially the GC invariants. Branch: feat/step-10-gc-engine-v1 from main.

What to build
1. A pure GC module (src/gc) with no database or HTTP access: input = the normalized message list plus a config, output = the new message list plus a list of decisions (item, decision, reason, tokens before, tokens after).
2. Rules for v1:
   - Drop exact duplicate tool results (same hash), keeping the most recent.
   - Drop a tool result superseded by a later call to the same tool with the same arguments.
   - Archive tool results over a token threshold (default 1,500) that are more than K turns old (default 6), replacing them with a stub:
     [parsim archived: <tool name> result, <n> tokens, id <archive id>]
   - Never touch: the system prompt, the first user message, the last N turns (default 6), tool calls marked as side effects (config list of tool names, plus a default list of name patterns such as send_, create_, delete_, update_, pay, refund), and their results.
   - Keep tool_call and tool_result pairs valid for all three providers (OpenAI, Anthropic and Gemini native, where function calls and responses are parts): never leave a tool result without its call or the reverse.
3. Thresholds: only run when the request context is over a configurable size (default 8,000 tokens).
4. Fail open: any error inside the GC forwards the original request and logs the error without content.
5. Modes per project: off, shadow (default), on.
   - shadow: forward the original request, store the decisions and the "would have saved" token counts.
   - on: forward the GC'd request and store the archived originals so they can be recalled in step 11.
6. Record per request: tokens before GC, tokens after GC, and the decisions.

Tests (this is the core of the product, so be thorough)
- Table-driven unit tests over the fixture conversations, one per rule.
- One test per GC invariant, named after the invariant.
- Determinism: same input twice gives byte-identical output.
- Prefix stability: running the GC on a conversation, then on the same conversation with new messages appended, never changes the already-processed part.
- Tool pairing stays valid for OpenAI, Anthropic and Gemini native formats.
- Fail open: a rule that throws leads to the original request being forwarded.
- Coverage of src/gc at 90% lines or more.
- E2E: shadow mode forwards the request unchanged (fake upstream receives the original) and stores decisions; "on" mode forwards a smaller request, and the archived originals are stored.

Finish with the step summary (include test counts and the token reduction on each fixture), push, and stop.
```

---

## Step 11: Recall

```text
Step 11: let the model recall archived context.

Follow CLAUDE.md. Branch: feat/step-11-recall from main.

What to build
1. When a request in "on" mode contains archived stubs, add a tool named parsim_recall (input: archive id) to the request, in the right format for OpenAI, Anthropic and Gemini native (functionDeclarations), without breaking tools the client already sent. Add one short line to the system prompt explaining the stubs and the tool, written so it stays byte-identical across calls.
2. When the model responds with a parsim_recall call:
   - Parsim handles it itself: fetch the original from storage, send a follow-up request upstream with the tool result, and return that final response to the client.
   - The client never sees parsim_recall. If the model calls parsim_recall together with other tools in one response, resolve parsim_recall first and continue until the response contains only client tools or text.
   - Limit recalls per request (default 3) to avoid loops.
3. Streaming: support recall for streamed requests too. Buffer only while a parsim_recall call is being detected, then stream the follow-up response to the client. Document any trade-offs.
4. Record each recall (archive id, tokens restored) and count all upstream calls in usage.
5. If an archive id is missing, return a clear tool result saying it was not found instead of failing.

Tests
- Unit: tool injection for all three formats keeps existing tools unchanged; stub detection; recall loop limit.
- E2E with the fake upstream scripted to call parsim_recall: the archived original is sent upstream in the follow-up request, the client receives only the final answer, usage counts both calls; the same for streaming; mixed parsim_recall and client tool calls; a missing archive id; the loop limit.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 12: Prompt-cache stability

```text
Step 12: keep provider prompt caching working with the GC on.

Follow CLAUDE.md. Branch: feat/step-12-cache-stability from main.

What to build
1. Store the GC decisions per agent session, so that once a message is rewritten, every later request in that session uses exactly the same rewritten version (byte-identical), even if the rules or thresholds would decide differently now.
2. Batch GC passes: only run a new pass when the unprocessed part of the context grows past a threshold (default 4,000 tokens), not on every request.
3. Anthropic cache_control markers: keep the client's markers valid. Never move a marker onto content that changes between calls. If a marker sits on content the GC archives, explain the chosen behavior.
4. Gemini: implicit caching depends on a stable prompt prefix, so the same prefix rules apply. Explicit cachedContent references must pass through untouched, and the GC must never rewrite content that belongs to a referenced cache. Read cached token counts from usageMetadata.cachedContentTokenCount.
5. Measure: record cached input tokens per request (from the step 06, 07 and 08 usage records) and show in the step summary whether cache hits on the fixtures are the same with GC on as with GC off.

Tests
- Unit: replaying a 200-request fixture session through the GC gives a prefix that only changes at batch points, and never changes a processed message.
- E2E: two sequential requests from the same session with GC on send byte-identical prefixes upstream (assert on what the fake upstream received).
- Live (LIVE_TESTS=true only): a short real session against Gemini, comparing cached tokens with GC off and on. The same against Anthropic with cache_control only if ANTHROPIC_API_KEY is set.

Finish with the step summary (include test counts and the cache comparison), push, and stop.
```

---

## Step 12b: Content compression with Headroom

```text
Step 12b: add content-level compression using Headroom, on top of our GC engine.

Follow CLAUDE.md, especially the Headroom rule and the GC invariants. Branch: feat/step-12b-headroom-compression from main.

Background
Headroom (https://github.com/headroomlabs-ai/headroom, Apache 2.0) is an open-source context-compression project with a Rust core, a Python package (CLI, proxy) and a TypeScript SDK on npm (headroom-ai). Its parts include SmartCrusher (JSON compression), Kompress-v2-base (a small text-compression model that runs on CPU), ContentRouter (detects content type) and CacheAligner (flags content that would break prompt caching). We use only its compressors. Our GC engine keeps making every decision, and our archive and parsim_recall stay ours.

Part A: evaluate first, then report and wait
1. Read Headroom's README, docs and the sdk/typescript folder. Pin the latest stable version.
2. On Windows, without Docker, check whether the npm package headroom-ai works directly in our NestJS backend: does it run SmartCrusher and Kompress in-process, or does it need native binaries, ONNX Runtime downloads or a running Python proxy? Check startup time, memory use and latency on our fixture tool results (small and large JSON, long text pages).
3. Run Headroom's compressors on our fixture conversations and report, per content type: tokens before and after, time per call, and whether the output is deterministic (same input gives byte-identical output).
4. Recommend one of these and wait for my answer:
   a) use the npm package in-process (preferred if it works well on Windows)
   b) run Headroom's Python package as a local sidecar service started by an npm script (no Docker), called over HTTP
   c) do not use Headroom and write our own JSON compressor instead (only if a and b are not good enough)

Part B: build (after I choose)
1. A Compressor interface in src/gc (input: one content item and its type; output: compressed text plus metadata) with a Headroom implementation and a no-op implementation. Headroom is never imported outside this adapter.
2. Integrate it into the GC engine as part of the "compress" decision for large tool results and long text that are not yet old enough to archive (thresholds in config). Every compressed item:
   - keeps its original in our archive, so parsim_recall returns the full original
   - gets a short marker such as [parsim compressed: <tool name> result, <n> to <m> tokens, id <archive id>]
   - respects all GC invariants (never the system prompt, first goal, protected tail, or side-effect actions and results)
3. Cache stability (step 12): once an item is compressed, the exact same compressed text is reused on every later request in the session. Store it; do not re-run the compressor. If Headroom's output is not deterministic, this storage is what keeps the prefix stable.
4. Use Headroom's CacheAligner (if available from TypeScript) only as an extra warning in logs and metrics, not to make decisions.
5. Fail open: if Headroom errors or times out (timeout in config), keep the item uncompressed and continue.
6. Settings per project: content compression on or off (default on in shadow mode, so savings show up as estimates first).
7. Add THIRD_PARTY_NOTICES.md with Headroom's license and NOTICE text, set HEADROOM_BEACON=off wherever Headroom runs, and document the setup on Windows in backend/README.md.

Tests
- Unit: the Compressor interface with a fake implementation; marker format; thresholds; fail open on error and timeout; invariants hold with compression on; the compressed text is reused byte-identical across requests.
- Integration (runs Headroom for real, no network): SmartCrusher on fixture JSON reduces tokens and keeps key fields; Kompress on a long text fixture reduces tokens.
- E2E: a long fixture session with compression on sends compressed items upstream; parsim_recall on a compressed item returns the full original; shadow mode records the estimated savings without changing the request.

Finish with the step summary (include test counts, the evaluation results from Part A, and the extra token reduction per fixture), push, and stop.
```

---

## Step 13: Dashboard with real Parsim pages

```text
Step 13: replace the starter's demo pages with real Parsim pages.

Follow CLAUDE.md. Branch: feat/step-13-dashboard from main.

Backend
- Read-only endpoints for the dashboard (JWT-protected, scoped to the user's projects): savings summary over a date range, savings over time (daily), agent sessions list (paged, sortable), one agent session's timeline (requests with tokens before and after, decisions by type, recalls), API keys and project settings (GC mode, thresholds, side-effect tool names, store content).
- Never return raw content unless the project allows content storage, and then only on the session detail endpoint.

Frontend (use the existing layout, data tables, cards and charts; Parsim theme from step 04)
1. There is no login page yet (it comes in step 18). Backend endpoints still require the existing JWT. For local use only, add a development auto-login: the frontend's server signs in as the seeded admin and keeps the token in an httpOnly cookie, enabled by DEV_AUTO_LOGIN=true. It must refuse to run when NODE_ENV=production, and step 18 replaces it with real sign-in.
2. Overview: tokens saved, dollars saved, percent reduction, requests, recalls; a savings-over-time chart; decisions by type using the --gc-* colors; a clear "Shadow mode: estimated savings" label when the project is in shadow mode.
3. Agent sessions: data table with search, sort and paging.
4. Session detail: a timeline of requests, and the decisions with their reasons. Show content only if allowed.
5. API keys: create (show the key once with a copy button), list, revoke.
6. Settings: GC mode (off, shadow, on) with a clear warning when switching to on, and the thresholds.
7. Setup page: the one-line integration snippets for OpenAI, Gemini (OpenAI-compatible and native SDK) and Anthropic with the user's endpoint filled in.
8. Remove the starter's demo pages and mock data (product, kanban, chat and so on) and their nav items. Ask me first if any of them looks useful to keep.

Tests
- Backend unit and e2e tests for every new endpoint, including that one user cannot see another user's projects.
- Frontend: unit tests for the formatting and savings calculations (add Vitest if no test runner exists), lint and typecheck.
- Manually check every page in the browser with seeded data, in dark and light mode, and save screenshots under docs/progress/screenshots/.

Add a seed script that creates a demo project with realistic fake usage, so the dashboard has data to show.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 14: Compression with background summaries

```text
Step 14: compress finished stretches of a conversation into a state block.

Follow CLAUDE.md. Branch: feat/step-14-compression from main.

What to build
1. Detect finished stretches: a run of turns older than the protected tail, with no open tool calls, above a token size (default 6,000). Start with simple, documented heuristics.
2. Summarize them in a pg-boss background job with Parsim's internal model (PARSIM_INTERNAL_PROVIDER and PARSIM_INTERNAL_MODEL, default Gemini Flash with GEMINI_API_KEY; the project can choose to use its own provider key instead). The summary is a structured state block: goal, decisions made, facts learned, open items, and the archive ids of the original messages so they stay recallable.
3. The next request in that session uses the state block in place of those turns. Requests never wait for a summary; until it is ready, the original turns are sent (archive and drop still apply).
4. Never compress the system prompt, the first goal, the protected tail, or side-effect actions and their results (keep the action log as compact lines in the state block AND unchanged where the invariants require).
5. Respect cache stability from step 12: a state block, once used, is reused byte-identical.
6. Record the summarization cost in usage, so savings are reported net of it.
7. Where a long text item only needs shortening, not summarizing, prefer the content compressor from step 12b (cheaper, no model call). Summaries are for whole finished stretches.

Tests
- Unit: stretch detection on fixtures, the state block format, invariants still hold with compression on, savings net of summarization cost.
- E2E: a long fixture session triggers a job; before the job finishes the original turns are sent; after it finishes the state block is sent; archived originals of compressed turns are recallable.
- Live (LIVE_TESTS=true only): one real summary of a fixture stretch, checked by hand and saved as an example in docs.

Finish with the step summary (include test counts and the extra token reduction on each fixture), push, and stop.
```

---

## Step 15: Replay

```text
Step 15: build replay to prove quality held.

Follow CLAUDE.md. Branch: feat/step-15-replay from main.

What to build
1. Replay a recorded agent session (only when content storage is on): for chosen request points, send the request upstream twice, once with the original context and once with the GC'd context, using the same model and temperature 0 where supported.
2. Compare the two responses: exact match, same tool calls with the same arguments, and an LLM judge score (Parsim's internal model, default Gemini Flash, configurable) with a short reason. Store the results.
3. Run replays as pg-boss jobs with a cost estimate shown before starting and a hard budget limit per replay.
4. Dashboard: start a replay from a session page, see progress, and see a report: agreement rate, differences side by side, tokens and cost for both versions.
5. CLI script to replay the fixture sessions: npm run replay:fixtures -- --model <model>.

Tests
- Unit: comparison logic (exact, tool-call equivalence, judge result parsing), budget limit, cost estimate.
- E2E with the fake upstream scripted to return identical and different answers: the report shows the right agreement rate; the budget stops a replay.
- Live (LIVE_TESTS=true only): replay one fixture session with Gemini Flash.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 16: Demo agent and benchmark

```text
Step 16: build a demo agent and a benchmark that measures Parsim honestly.

Follow CLAUDE.md. Branch: feat/step-16-demo-agent-benchmark from main.

What to build
1. A demo long-running agent in a new folder demo-agent/ (TypeScript, Node, Windows-friendly), using the official SDKs pointed at a configurable base URL, with Gemini Flash as the default model (switchable to OpenAI or Anthropic through config):
   - a research agent that works through a list of questions over 100+ steps, using tools: web search (behind an interface, with a recorded/cached mode so benchmark runs are repeatable and cheap), fetch page, take note, and a side-effect tool "save_report"
   - a support agent that works through 20 scripted tickets with tools: look up order, update ticket, send reply (side effect, logged only)
2. Each task has a known expected answer or a checklist for an LLM judge.
   - Base the tasks on public agent benchmarks where possible, so the results are credible: customer-support style tasks such as τ-bench (tau-bench) and public multi-step research tasks. Check each benchmark's license, cite its source in the report, and adapt only what the license allows. Explain which tasks you picked and why.
3. A benchmark runner: npm run bench -- --agent research --runs 3 --model <model> that runs every task four ways: without Parsim, Parsim in shadow mode, Parsim on, and Headroom's own proxy (headroom proxy, telemetry off) as a baseline to beat. It records task success, input and output tokens, cost, wall time and number of recalls.
4. Write the results to docs/benchmarks/<date>-<agent>-<model>.md with a table, the exact command, the model and the Parsim version. Report variance across runs. Never edit numbers by hand.

Tests
- Unit tests for the runner's metrics and the report generation.
- A dry-run mode with the fake upstream, used in CI, that runs the full pipeline without real calls.

Then run the benchmark once with Gemini Flash (ask me before spending more than the budget I give you) and include the results in the step summary.

Finish with the step summary, push, and stop.
```

---

## Step 17: Developer integration

```text
Step 17: make Parsim very easy to integrate, including by coding agents.

Follow CLAUDE.md. Branch: feat/step-17-developer-integration from main.

What to build
1. docs/integration.md: setup for the OpenAI SDK (TypeScript and Python), the Anthropic SDK (TypeScript and Python), the Google GenAI SDK (TypeScript and Python), and tools configured by environment variables, plus how to set x-parsim-session-id and how to mark side-effect tools.
2. An AGENTS.md section and a public llms.txt (served by the backend at /llms.txt) written so a coding agent can add Parsim to a project from one instruction: what to change, where, and how to verify it worked.
3. A small CLI package in cli/ (npx parsim init) that detects whether a project uses the OpenAI, Anthropic or Google GenAI SDK, shows the exact change, applies it only after confirmation, and writes the env variables to .env.example (never real keys).
4. A /v1/parsim/health endpoint and a "verify my setup" check in the dashboard setup page that shows the first request received from a new key.

Tests
- Unit tests for the CLI's project detection and the code changes it proposes, using sample projects in cli/test/fixtures.
- E2E for /llms.txt and the health endpoint.
- Manual check: in a fresh sample project, ask Claude Code "add Parsim to this project" with only llms.txt as guidance, and record whether it succeeded in the step summary.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 18: Authentication with email, Google and GitHub

```text
Step 18: authentication with email, Google and GitHub, with real emails. This is the last step before deploying.

Follow CLAUDE.md. Branch: feat/step-18-auth from main.

Before you start, list what you need from me and wait. Expect to ask for:
- GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google Cloud Console, OAuth client for a web app). Tell me the exact authorized JavaScript origins and redirect URIs to enter for localhost.
- GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (GitHub, Settings, Developer settings, OAuth Apps). Tell me the exact homepage URL and callback URL to enter for localhost.
- For real email delivery: whether I want to set up Resend now (a Resend API key and a verified sending domain) or use only the local mail catcher for now.
Write the keys into backend/.env (and frontend/.env.local where the frontend needs a public client ID) yourself, as CLAUDE.md describes. If a key is missing, build and test everything with fakes and skip only the live checks.

Use the auth that already exists in the backend boilerplate. Do not replace it with another auth library. Read these first:
- backend/src/auth (email register, confirm, login, refresh, forgot and reset password, logout, me)
- backend/src/auth-google (verifies a Google ID token sent by the frontend)
- backend/src/mail and backend/src/mailer (email sending with nodemailer over SMTP and handlebars templates)
- backend/docs/auth.md

Part A: backend
1. Remove Facebook and Apple sign-in (modules, config, env entries, docs). We only support email, Google and GitHub.
2. Add GitHub sign-in as a new module backend/src/auth-github, following the structure of auth-google:
   - GET /api/v1/auth/github/start redirects to GitHub's authorize URL with a random state value (stored in a short-lived httpOnly cookie) and the scope needed to read the user's email.
   - GET /api/v1/auth/github/callback checks the state, exchanges the code for an access token, reads the GitHub profile and the primary verified email, then signs the user in or creates the account through the existing social login logic (same as Google). Then it redirects to the frontend with the login completed (see Part C for how tokens reach the frontend safely).
   - If GitHub returns no verified email, show a clear error instead of creating an account without email.
   - Add GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and the callback URL to config and .env.example.
3. Account linking: if someone signs up with email and later uses Google or GitHub with the same verified email, sign them into the same account instead of creating a duplicate. Explain the rule you chose.
4. Email sending:
   - Locally, emails go to a mail catcher: npx maildev (SMTP on 1025, web UI on http://localhost:1080). Document it in backend/README.md.
   - Production uses SMTP settings only (no code changes), for example Resend over SMTP. Document the exact MAIL_* values in .env.example comments.
   - Rebrand the email templates (activation, reset password, confirm new email) to Parsim: Parsim name, a simple clean layout using the brand orange #FF3B00, plain text that still works if HTML is blocked. No em dashes.
   - Check that the links in the emails point to frontend pages that exist (read mail.service.ts for the exact paths and query parameters, and build those pages in Part B).
5. Add rate limiting on login, register, forgot password and resend confirmation (for example @nestjs/throttler), with sensible limits in config.
6. Make sure error messages do not reveal whether an email is registered (forgot password always returns the same response).

Part B: frontend pages (use the existing shadcn/ui components and the current theme)
1. /auth/sign-in: email and password, "Continue with Google", "Continue with GitHub", links to sign up and forgot password.
2. /auth/sign-up: name, email, password (with strength hint), the same Google and GitHub buttons. After sign-up, show "Check your email to confirm your account".
3. The page the confirmation email links to: confirms the account and then sends the user to sign in (or signs them in directly if the backend returns tokens).
4. /auth/forgot-password and the reset password page the reset email links to.
5. "Continue with Google" uses Google Identity Services to get an ID token and sends it to POST /api/v1/auth/google/login, which already exists.
6. "Continue with GitHub" goes to GET /api/v1/auth/github/start.
7. Clear loading, success and error states on every form. No em dashes in any copy.

Part C: sessions and protecting the dashboard
1. Do not store tokens in localStorage. Use Next.js route handlers as a thin layer that calls the backend and keeps the access and refresh tokens in httpOnly, secure, sameSite cookies.
2. Refresh the access token automatically with POST /api/v1/auth/refresh when it expires.
3. Protect every /dashboard route in frontend/src/proxy.ts: signed-out users go to /auth/sign-in and come back to the page they wanted after signing in. Signed-in users visiting /auth pages go to /dashboard/overview.
4. Show the signed-in user's name and email in the existing user menu, with a working "Sign out" that calls the backend logout and clears the cookies.

Tests
- Backend e2e (real Postgres test database), with emails captured by a test mail transport instead of a real server:
  - sign up sends a confirmation email; the link's hash confirms the account; login before confirming is refused if the boilerplate requires confirmation
  - login, refresh and logout
  - forgot password sends an email; the reset link works once and expires
  - the same response for forgot password whether the email exists or not
  - Google login with a faked Google token verifier
  - GitHub start sets the state cookie; callback with a wrong state is refused; callback with a faked GitHub API creates the account or links it by verified email; no verified email gives a clear error
  - rate limiting kicks in on repeated failed logins
- Frontend: unit tests for form validation and the redirect logic (add Vitest if no test runner exists), lint and typecheck.
- Manual check in the browser with the backend and npx maildev running: sign up, open the email in maildev, confirm, sign in, sign out, forgot and reset password, and Google and GitHub sign-in if the keys are set. Save screenshots of the sign-in and sign-up pages under docs/progress/screenshots/.

Notes
- Remove the development-only auto-login from step 13 and replace it with real sign-in. Every dashboard page and endpoint must require a signed-in user, scoped to that user's projects.
- Projects, keys and sessions created so far belong to the seeded admin. Keep them working after this step.

Finish with the step summary (include test counts), push, and stop.
```

---

## Tips

- If Claude Code proposes a different approach than a prompt describes, let it explain why first. Accept changes that are smaller or safer.
- If a step gets too big, ask Claude to split it into two branches.
- Keep an eye on spending during live tests and the benchmark. Set a monthly limit with each provider.
