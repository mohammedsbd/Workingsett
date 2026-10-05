# Parsim project rules

Parsim is a garbage collector for the context of long-running AI agents, focused on non-coding agents (research, support, operations, data and browser agents). It is a drop-in proxy that speaks the OpenAI, Anthropic and Google Gemini APIs. On every request it decides, for each piece of context, whether to **keep** it, **compress** it into a state block, **archive** it (store it, leave a stub, let the model recall it) or **drop** it (duplicate or superseded). It forwards the smaller request upstream, returns the response unchanged, and records tokens and dollars saved. Shadow mode and replay prove that quality did not drop.

These rules are permanent and apply to every step.

## Codebase

- Never create new projects from scratch. Extend `frontend/` and `backend/` and follow their existing patterns:
  - backend (NestJS + TypeORM + PostgreSQL, relational setup): the boilerplate's module structure with `domain` / `infrastructure` / `persistence`. Use its generators (`npm run generate:resource:relational`) for new entities where they fit.
  - frontend (Next.js + shadcn/ui, no auth for now): the existing layout, sidebar, data tables, cards and charts.
- Reuse proven libraries before writing our own (for example `js-tiktoken` for token counting, pg-boss for jobs, OpenTelemetry for tracing). The GC decision logic, recall and replay are ours and are never outsourced.
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
