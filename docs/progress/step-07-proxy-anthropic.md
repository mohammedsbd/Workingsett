# Step 07: proxy for the Anthropic Messages API

## Goal

Add the Anthropic Messages API to the proxy, reusing step 06's auth, key handling, streaming and usage recording through shared provider adapters, and make tools that only allow `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` (such as Claude Code) work with Parsim.

## What was built

- **`POST /v1/messages`.** Forwards to Anthropic (`PROXY_ANTHROPIC_BASE_URL`, default `https://api.anthropic.com`).
  - The body goes upstream byte for byte, and the response comes back unchanged, streamed or not.
  - Text, `tool_use`, `tool_result` and thinking blocks pass through untouched, and so does every SSE event (`message_start`, `content_block_*`, `ping`, `message_delta`, `message_stop`).
  - `anthropic-version` and `anthropic-beta` from the client are passed through.
- **`POST /v1/messages/count_tokens`.** Passes through and is not recorded as usage, since token counting isn't billed.
- **Shared provider adapters (refactor).**
  - `ProviderAdapter` replaces step 06's `ChatCompletionsAdapter`. There is one adapter per client API and upstream: OpenAI-chat to OpenAI, OpenAI-chat to Gemini, and Anthropic-messages to Anthropic.
  - One pipeline in `ProxyService` handles all endpoints: auth, provider key, forwarding, streaming, timeouts, disconnects and usage records.
  - Errors Parsim returns use the format of the API that was called: OpenAI-style on `/v1/chat/completions`, Anthropic-style (`{"type":"error","error":{...}}`) on `/v1/messages`.
  - Calling the wrong endpoint for a project's upstream returns a 400 that names the right endpoint.
- **Auth for Anthropic clients** (the design you approved):
  - **Parsim key:** `x-parsim-key`, or `x-api-key` when it starts with `psm_`, or a `psm_` bearer token (tools send that for `ANTHROPIC_AUTH_TOKEN`).
  - **Anthropic key:** `x-provider-key`, a non-Parsim `x-api-key`, or the key stored (encrypted) on the project, in that order. A key sent with the request always wins over the stored one.
  - **For Claude Code and similar tools:** store the Anthropic key on the project and set `ANTHROPIC_API_KEY=psm_...` and `ANTHROPIC_BASE_URL=http://host`.
  - **Keeping the key off the server:** customers can send it per request in `x-provider-key` instead, as you asked.
- **Usage with cache tokens.**
  - Usage is read from the response body, or from `message_start` (input, cache read and cache write tokens) plus `message_delta` (final output tokens, and repeated input and cache counts when newer API versions send them).
  - Parsim's `inputTokens` is the full prompt: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
  - A new usage column, `cacheWriteInputTokens`, was added (migration `AddUsageCacheWriteTokens`).
- **Prices.**
  - Cache reads, 5-minute cache writes and 1-hour cache writes are each priced at their own rate (`cachedInput`, `cacheWrite`, `cacheWrite1h`). The 1-hour rate is used when Anthropic reports that split.
  - 13 Claude models were added to the price table, copied from the Anthropic pricing page on 2026-10-06.
  - Dated Anthropic IDs like `claude-haiku-4-5-20251001` match their base model.
- **Docs.** `backend/docs/proxy.md` gains an Anthropic section, the tool setup, and a manual Claude Code check. The README has a new Anthropic SDK and Claude Code part.

## Files changed

Backend:
- **Added:**
  - `src/proxy/providers/anthropic.adapter.ts`, `src/proxy/providers/anthropic-format.ts`, `src/proxy/messages.controller.ts`
  - `src/database/migrations/1791307920028-AddUsageCacheWriteTokens.ts`
  - Tests: `src/proxy/proxy-error.spec.ts`, `src/proxy/providers/anthropic-format.spec.ts`, `src/proxy/providers/anthropic.adapter.spec.ts`, `test/proxy/anthropic-proxy.e2e-spec.ts`, `test/live/anthropic-proxy.live-spec.ts`
- **Renamed:**
  - `providers/chat-completions-adapter.ts` to `providers/provider-adapter.ts`
  - `openai-error.ts` to `proxy-error.ts`
  - `proxy.controller.ts` to `chat-completions.controller.ts`
- **Modified:**
  - Pipeline: `src/proxy/proxy.service.ts`, `proxy-credentials.ts`, `proxy.module.ts`, `streaming/sse-stream-filter.ts`, `providers/openai-compatible.adapter.ts`, `providers/openai-format.ts`
  - Config: `src/proxy/config/*`, `src/app-setup.ts`
  - Usage and pricing: `src/usage-records/**`, `config/model-prices.json`
  - Project imports: `src/projects/**`
  - Env examples: `.env.example`, `.env.test.example`
  - `package.json`: `@anthropic-ai/sdk` added as a dev dependency
  - Test helpers: `test/utils/fake-upstream.ts` (and its spec), `test/utils/proxy-helpers.ts`
  - Docs: `README.md`, `docs/proxy.md`, `docs/tests.md`

Frontend:
- None

Other:
- Added: this file
- Modified: `docs/progress/README.md`

## Tests

Added:
- **Unit:**
  - `anthropic-format.spec.ts`: usage from JSON with cache reads and writes, the 1-hour split, missing usage; usage across `message_start` and `message_delta`, including repeated counts and a missed `message_start`; a full Anthropic stream through the filter, unchanged byte for byte.
  - `anthropic.adapter.spec.ts`: URLs, headers, body never changed.
  - `proxy-error.spec.ts`: both error formats.
  - Anthropic header cases in `proxy-credentials.spec.ts`.
  - Cache-write pricing in `model-pricing.spec.ts`.
  - The fake upstream's `count_tokens` route.
- **E2E** (fake upstream in Anthropic format):
  - Non-streamed request forwarded byte for byte, with Anthropic headers, and the response returned unchanged.
  - Streamed events pass through unchanged and in order.
  - `tool_use` blocks pass through, streamed and not.
  - 400, 429 and 529 errors pass through.
  - Usage recorded with cache tokens and the right cost, streamed and not.
  - All key options: Parsim key in `x-api-key` with the stored key, `x-provider-key` per request, per-request key winning over the stored one; missing, unknown and revoked Parsim keys, and a missing Anthropic key.
  - Keys and content never reach the logs or the database.
  - `count_tokens` passes through and is not recorded.
  - Wrong-endpoint errors in both formats.
  - 4 tests that drive the proxy with the official `@anthropic-ai/sdk`: create, stream, count tokens, and an auth error surfacing as `AuthenticationError`.
- **Live:** `anthropic-proxy.live-spec.ts`, with one non-streamed and one streamed call through `@anthropic-ai/sdk`.

Last run:
- `npm run lint`: pass
- `npx tsc --noEmit`: pass
- `npm test`: 13 suites, **134 passed**, 0 failed (was 101)
- `npm run test:e2e`: 8 suites, **91 passed**, 0 failed (was 66; also passes with `--randomize`)
- `npm run test:live` (Anthropic): **skipped, no `ANTHROPIC_API_KEY`**, as agreed. Both tests skip cleanly.
- Every commit was checked on its own: tsc, eslint and unit tests pass at each one.
- Manual check with `npm run start:dev`:
  - All three proxy routes are mapped.
  - `/v1/messages` without a key returns a 401 in Anthropic format.
  - A Parsim key in `x-api-key` plus a fake Anthropic key reached the real `api.anthropic.com`, and its 401 "API key is invalid" came back unchanged.

## Decisions and trade-offs

- **Parsim key as the Anthropic API key** (your choice). A `psm_` value in `x-api-key` is the Parsim key, and the real Anthropic key comes from the project or from `x-provider-key`.
  - This works with any tool that only exposes `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`, keeps real keys off client machines, and lets you cut a tool off by revoking its Parsim key.
  - The alternative of mapping the Anthropic key itself to a project was not built: it would make a provider key double as a Parsim credential.
- **Refactor instead of a second pipeline.** `ProxyService` is now generic over an "operation" (endpoint). Adapters are looked up by client API and upstream, so a Gemini project can't be called through `/v1/messages`, and adding Gemini's native API in step 08 means a new adapter, operation and controller, with no pipeline changes. The stream filter now passes the usage seen so far to the adapter, which Anthropic needs.
- **Anthropic bodies and streams are never modified.** Anthropic always reports usage, so unlike OpenAI there is nothing to inject or strip.
- **No default `anthropic-version`.** Parsim only passes the client's header through. Real clients always send it, and adding one could hide client bugs.
- **`inputTokens` means the same thing for every provider.** For Anthropic it adds cache reads and writes to `input_tokens`, so savings and dashboards can compare providers. The parts are stored separately (`cachedInputTokens`, `cacheWriteInputTokens`).
- **The 1-hour cache split isn't stored.** The cost uses it when Anthropic reports it, but only the total cache writes are stored.
- **`count_tokens` is not recorded.** It isn't a billed generation call. It still shows up in the logs.
- **`cacheWriteInputTokens` was added by hand.** The generator's property command needs markers that were removed when the usage-record files were rewritten in step 06; the migration was generated by TypeORM.
- **SDK-driven e2e tests stand in for the missing live test.** The official `@anthropic-ai/sdk` talks to Parsim in the e2e suite, so SDK compatibility (paths, headers, stream parsing, error classes) is tested on every run without a key.

## How to verify

```bash
git log --oneline main..feat/step-07-proxy-anthropic
```

```bash
cd backend && npm ci && npm run migration:run && npm run lint && npx tsc --noEmit && npm test && npm run test:e2e
```

Expect 134 unit tests and 91 e2e tests to pass.

With an Anthropic key in `backend/.env.test`, run the live test:

```bash
cd backend && npm run test:live
```

The 2 Anthropic tests should pass, alongside the Gemini and OpenAI ones.

For the manual Claude Code check, follow [Using Claude Code through Parsim](../../backend/docs/proxy.md#using-claude-code-through-parsim).

## Known issues and next steps

- **No live run yet.** The Anthropic live test and the manual Claude Code check have not been run, because no key was available. Run both when you have a key; a short Claude Code session costs a few cents on your API account.
- **Other endpoints aren't proxied.** Claude Code may call Anthropic endpoints Parsim doesn't serve (for example a models list). Those would show up as 404s in the backend log during the manual check; add pass-through routes if needed.
- **Your dev database has another test project.** I created a project called "Anthropic dev check" while testing `start:dev`, with one key. Delete it or reuse it.
- **Gemini live tests from step 06 are still pending.** They are waiting for the free-tier quota to reset.
- **Fast mode isn't priced.** Anthropic charges premium rates for fast mode and a 1.1x multiplier for US-only inference. The usage response does not say which applied, so those requests are priced at standard rates.
