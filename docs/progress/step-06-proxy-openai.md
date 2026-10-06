# Step 06: proxy pass-through for the OpenAI format

## Goal

Make Parsim a working drop-in proxy for OpenAI-format chat requests: authenticate with a Parsim key, forward unchanged to OpenAI or to Gemini's OpenAI-compatible endpoint, relay the response (streamed or not), and record tokens and cost for every request.

## What was built

- **Projects** (`/api/v1/projects`, JWT):
  - Endpoints to create, list, get and update projects.
  - Each project belongs to a user (for now the seeded admin) and has an upstream, `openai` or `gemini`.
  - A project can store a provider key, encrypted with AES-256-GCM. The API never returns the key; it shows `hasProviderKey` instead.
  - Users only see their own projects; anyone else gets 404.
- **Parsim API keys** (`/api/v1/projects/:id/api-keys`, JWT):
  - Endpoints to create, list and revoke keys.
  - A key is `psm_` plus 32 random bytes. Only its SHA-256 hash and a 12-character display prefix are stored. The full key is shown once, at creation.
  - `lastUsedAt` is updated on every proxied request.
- **Proxy: `POST /v1/chat/completions`.** It sits outside the `/api` prefix, so OpenAI SDKs work with `baseURL: http://host/v1`.
  - **Parsim key:** read from `x-parsim-key`, or from `Authorization: Bearer psm_...`.
  - **Provider key:** read from `x-provider-key`, or from a non-Parsim bearer token, or taken from the key stored on the project.
  - **Missing, unknown, malformed or revoked keys:** 401 in OpenAI error format, and nothing is sent upstream.
  - **Forwarding:** the body goes to the project's upstream byte for byte, and the response comes back unchanged, headers included (hop-by-hop headers excepted).
  - **Provider adapters:** `OpenAiAdapter` and `GeminiOpenAiAdapter` sit behind one `ChatCompletionsAdapter` interface. Adding a provider means writing an adapter and registering it; the pipeline doesn't change.
  - **Streaming:** SSE is relayed event by event, never buffered as a whole. If the client did not set `stream_options`, Parsim asks upstream for usage (`include_usage`) by inserting it into the body without changing any other byte. It then removes the usage data the client didn't ask for from the stream.
  - **Errors:** upstream errors (400, 429, 500, and Gemini's array-shaped errors) pass through with the same status and body.
  - **Timeouts:** `PROXY_UPSTREAM_TIMEOUT_MS` covers waiting for headers and every gap between chunks. A timeout before headers returns 504; mid-stream, the stream is ended.
  - **Network failures:** an unreachable upstream returns 502.
  - **Client disconnects:** the upstream request is cancelled, and the usage record gets status 499.
  - **Shutdown:** running requests finish and record their usage before the app stops.
- **Usage records.** One row per forwarded request: project, upstream, model, input tokens, output tokens, cached input tokens, cost in USD, latency, status and whether it streamed. Prompt and response content are never stored or logged.
- **Price table** (`backend/config/model-prices.json`):
  - USD per 1M tokens for 31 OpenAI and Gemini models, copied from the official pricing pages on 2026-10-06, with a "last updated" note and the sources.
  - Unknown models get cost `null`.
  - The Gemini 3.6 to 3.8 Flash prices are promotional until 2026-12-31.
- **`PARSIM_REQUIRE_KEY=false`:** a dev-only option. Requests from localhost without a key use the oldest project. It is ignored when `NODE_ENV=production`.
- **Gemini's OpenAI-compatible endpoint**, checked live on 2026-10-06 and documented in `backend/docs/proxy.md`:
  - Thinking tokens are left out of `completion_tokens` but billed in `total_tokens`. Parsim records output as total minus prompt; one live call reported `completion_tokens: 3` and `total_tokens: 153`.
  - With `include_usage`, every streamed chunk carries the usage object, and there is no separate usage-only chunk.
  - Errors come back as a JSON array, `[{"error": {...}}]`.
  - Responses carry `thought_signature` fields; these are passed through untouched.

## Files changed

Backend:
- **Added:**
  - Proxy: `src/proxy/` (config, `proxy.service.ts`, `proxy.controller.ts`, `proxy.module.ts`, `proxy-credentials.ts`, `openai-error.ts`, `providers/`, `streaming/sse-stream-filter.ts`).
  - Resources: `src/projects/`, `src/parsim-api-keys/`, `src/usage-records/` (all scaffolded with the relational generator, then trimmed).
  - Setup and data: `src/app-setup.ts`, `src/database/migrations/1791301311631-CreateProxyTables.ts`, `config/model-prices.json`, `docs/proxy.md`.
- **Modified:**
  - `src/main.ts`: uses the shared app setup.
  - `src/app.module.ts`, `src/config/config.type.ts`: register the new modules and the proxy config.
  - `.env.example` and `.env.test.example`: proxy settings, plus a fixed test-only encryption key in the test example.
  - `package.json`: `test:live` script; `openai` and `cross-env` added as dev dependencies.
  - Docs: `README.md` (new "Use the proxy" section), `docs/readme.md`, `docs/tests.md`.
- **Tests added:**
  - Unit: 7 new spec files under `src/`.
  - E2E: `test/projects/projects.e2e-spec.ts`, `test/proxy/openai-proxy.e2e-spec.ts`, `test/proxy/proxy-options.e2e-spec.ts`.
  - Live: `test/live/proxy.live-spec.ts`, `test/jest-live.json`.
  - Helpers: `test/utils/proxy-helpers.ts`, `test/utils/capturing-logger.ts`.
  - Updated: `test/utils/fake-upstream.ts` (and its spec), `test/utils/test-app.ts`.

Frontend:
- None

Other:
- Added: this file
- Modified: `docs/progress/README.md`

## Tests

Added:
- **Unit:**
  - `parsim-key.spec.ts`: key generation, hashing, verification helpers.
  - `proxy-credentials.spec.ts`: header parsing.
  - `model-pricing.spec.ts`: cost calculation, cached tokens, unknown models get null, the shipped table loads.
  - `sse-stream-filter.spec.ts`: stream usage extraction and filtering, chunk boundaries, CRLF, multi-byte characters.
  - `openai-format.spec.ts`: body injection, usage parsing.
  - `adapters.spec.ts`: URLs, headers, Gemini thinking tokens.
  - `provider-key-cipher.spec.ts`: encryption round trip and tampering.
  - `fake-upstream.spec.ts`: 4 new tests for the Gemini route, stream usage, delays and disconnects.
- **E2E** (all against the fake upstream):
  - Projects and keys: ownership, validation, key shown once and stored as a hash, revoke.
  - Non-streamed request forwarded byte for byte, with the response and headers unchanged.
  - The provider key goes upstream; the Parsim key never does.
  - Streamed chunks arrive in order and as they come (timing checked over real HTTP).
  - Injected usage is stripped from the stream; usage the client asked for passes through.
  - Upstream 400, 429 and 500 pass through.
  - Missing, unknown, malformed and revoked keys get 401.
  - Usage record has the correct tokens and cost, and no content; unknown model gets cost null.
  - Provider and Parsim keys never appear in logs or the database.
  - Gemini projects use the Gemini path and count thinking tokens.
  - Client disconnect cancels the upstream request.
  - Upstream timeout returns 504, before headers and mid-stream.
  - Keyless dev mode.
- **Live:** one non-streamed and one streamed call per provider through the official `openai` SDK, run with `npm run test:live`.

Last run:
- `npm run lint`: pass
- `npx tsc --noEmit`: pass
- `npm test`: 10 suites, **101 passed**, 0 failed
- `npm run test:e2e`: 7 suites, **66 passed**, 0 failed (also passes with `--randomize`)
- `npm run test:live`: **not run yet**. The Gemini free-tier quota for `gemini-3.8-flash` (20 requests per day) ran out during the endpoint checks at the start of the step. Without `LIVE_TESTS` the 4 live tests skip cleanly. OpenAI live tests skip because no `OPENAI_API_KEY` was given.
- Every commit was checked on its own: tsc, eslint and unit tests pass at each one.
- Manual check with `npm run start:dev` (port 3002):
  - The seeded admin logs in, and a project and key can be created.
  - A request without a key gets a 401 in OpenAI format.
  - A request with a bad provider key reaches real Gemini, and its 400 error array is returned unchanged.

## Decisions and trade-offs

- **The body is forwarded as raw bytes.** `/v1` routes get the raw request buffer (`express.raw`), and JSON is parsed only to read `model`, `stream` and `stream_options`. The other API routes keep the normal JSON parser. Body parsing and the rest of the app setup moved into `src/app-setup.ts`, used by both `main.ts` and the tests, so tests run the exact production setup.
- **`include_usage` is injected by text, not re-serialized.** The option is inserted before the closing `}`, so key order, spacing and numbers stay exactly as sent. This was the only way to meet both "forward unchanged" and "record usage for streams".
- **Usage chunks are removed per event, not dropped wholesale.** OpenAI sends `usage: null` on every chunk plus a final usage-only chunk; Gemini puts usage on every chunk. The filter handles both. Events without usage are forwarded byte for byte.
- **The provider key can also be the bearer token.** A non-Parsim `Authorization: Bearer` token is treated as the provider key, so SDK users can keep their provider key as `apiKey` and add `x-parsim-key`. `x-provider-key` wins if both are sent.
- **Parsim keys are hashed with plain SHA-256, not bcrypt.** The keys have 256 bits of randomness, so a slow hash adds nothing, and the hash lets a key be looked up with one indexed query.
- **Owner ids are explicit columns.** `ownerId` and `projectId` are real columns next to the relations, so ownership checks don't load users. Real users in step 18 need no database change.
- **Usage is recorded after the response ends.** That keeps database time out of the client's latency. The proxy tracks in-flight requests and waits for them on shutdown; tests wait for them before truncating tables, which also fixed a deadlock.
- **Cost is stored at request time.** Later price changes don't rewrite history. Gemini Flash prices are promotional until 2026-12-31, so the table needs an update in January.
- **Encryption key in the test env example.** `.env.test.example` ships a fixed, public, test-only key so a fresh clone's e2e tests work. Your local `.env` and `.env.test` got their own random keys.
- **The OpenAI live test model comes from config.** `OPENAI_LIVE_TEST_MODEL` (default `gpt-5-nano`) is set in `.env.test`, not hardcoded.
- **Added dev dependencies:** `openai` (required for the live tests) and `cross-env` (CLAUDE.md requires it for env vars in npm scripts).

## How to verify

```bash
git log --oneline main..feat/step-06-proxy-openai
```

```bash
cd backend && npm ci && npm run lint && npx tsc --noEmit && npm test && npm run test:e2e
```

Expect 101 unit tests and 66 e2e tests to pass.

```bash
cd backend && npm run migration:run && npm run start:dev
```

Then follow "Use the proxy" in `backend/README.md`: log in as `admin@example.com` / `secret`, create a project and a key, and call `http://localhost:3001/v1/chat/completions`.

```bash
cd backend && npm run test:live
```

Run this once the Gemini quota has reset. It makes 2 real Gemini calls and should pass 2 tests; the 2 OpenAI tests skip without `OPENAI_API_KEY`.

## Known issues and next steps

- **Live tests have not run yet.** The Gemini free-tier quota (20 requests per day for `gemini-3.8-flash`) was used up by the endpoint checks; the 503 "high demand" retries counted too. Run `npm run test:live` after the reset. Parsim's own model calls in later steps will need a paid key or a model with more free quota.
- **One stream case is unconfirmed.** I could not see whether Gemini sends usage in a stream when `stream_options` is absent (the model was overloaded). Parsim always asks for usage in that case, so usage records are not affected.
- **The keyless mode has no production test.** `PARSIM_REQUIRE_KEY=false` being ignored under `NODE_ENV=production` is enforced in code but not tested, because booting the app in production mode in tests is awkward.
- **Your dev database has a test project.** I created a project called "Dev check", with one key, while testing `start:dev`. Delete it or reuse it.
- **No dashboard view of usage yet.** Usage records have no read endpoint; the dashboard step adds one.
- **Upstream allowlist is narrow.** Only `openai-organization` and `openai-project` client headers are forwarded to OpenAI. Add others (for example `openai-beta`) if a client needs them.
- **A failed test boot can hang Jest.** If `createTestApp` fails during module compile (for example a bad env value), Jest can hang on the open database pool. Running with `--forceExit` helps while debugging.
