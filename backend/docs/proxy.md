# Proxy

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Projects and keys](#projects-and-keys)
- [Request headers](#request-headers)
- [What is forwarded](#what-is-forwarded)
- [Streaming and usage](#streaming-and-usage)
- [Errors, timeouts and disconnects](#errors-timeouts-and-disconnects)
- [Usage records and prices](#usage-records-and-prices)
- [Gemini's OpenAI-compatible endpoint](#geminis-openai-compatible-endpoint)
- [Anthropic Messages API](#anthropic-messages-api)
- [Using Claude Code through Parsim](#using-claude-code-through-parsim)
- [Configuration](#configuration)
- [Adding a provider](#adding-a-provider)

## Overview

Parsim serves two client APIs and forwards each request to the project's upstream:

| Endpoint | Project upstream | Forwarded to |
| --- | --- | --- |
| `POST /v1/chat/completions` (OpenAI format) | `openai` | `{PROXY_OPENAI_BASE_URL}/v1/chat/completions` (default `https://api.openai.com`) |
| `POST /v1/chat/completions` (OpenAI format) | `gemini` | `{PROXY_GEMINI_BASE_URL}/chat/completions` (default `https://generativelanguage.googleapis.com/v1beta/openai`) |
| `POST /v1/messages` (Anthropic format) | `anthropic` | `{PROXY_ANTHROPIC_BASE_URL}/v1/messages` (default `https://api.anthropic.com`) |
| `POST /v1/messages/count_tokens` | `anthropic` | `{PROXY_ANTHROPIC_BASE_URL}/v1/messages/count_tokens` |

The routes are outside the `/api` prefix, so OpenAI SDKs work with `baseURL` set to `https://<host>/v1` and Anthropic SDKs and tools with `ANTHROPIC_BASE_URL=https://<host>`. Calling an endpoint that does not match the project's upstream returns a 400 that names the right endpoint.

The code lives in `src/proxy`: one shared pipeline (`proxy.service.ts`) and one adapter per client API and upstream in `src/proxy/providers`. Usage is stored by `src/usage-records`.

## Projects and keys

- `POST /api/v1/projects`, `GET /api/v1/projects`, `GET` and `PATCH /api/v1/projects/:id` (JWT). A project has a name, an upstream (`openai`, `gemini` or `anthropic`) and an optional stored provider key.
- `POST /api/v1/projects/:id/api-keys`, `GET /api/v1/projects/:id/api-keys`, `POST /api/v1/projects/:id/api-keys/:keyId/revoke` (JWT).
- Users only see their own projects. Until sign-in pages exist (step 18), use the seeded admin.
- A Parsim key is `psm_` plus 32 random bytes (base64url). Only its SHA-256 hash and a 12-character display prefix are stored; the full key is returned once, at creation.
- Stored provider keys are encrypted with AES-256-GCM using `PARSIM_ENCRYPTION_KEY` and never returned (the API shows `hasProviderKey`).

## Request headers

Each client API has a normal API key header: `Authorization: Bearer` for OpenAI, `x-api-key` for Anthropic (Parsim also reads a bearer token on `/v1/messages`, which tools send for `ANTHROPIC_AUTH_TOKEN`).

| What | Where |
| --- | --- |
| Parsim key | `x-parsim-key`, or the normal API key header when it holds a `psm_...` key |
| Provider key | `x-provider-key`, or the normal API key header when it holds anything else, or the key stored on the project (in that order) |

So a client can either use the Parsim key as its API key (and send `x-provider-key`, or rely on the stored key), or keep the provider key as its API key and send `x-parsim-key`.

Missing, unknown, malformed or revoked Parsim keys get a 401, in the format of the API that was called:

```json
{ "error": { "message": "...", "type": "invalid_request_error", "param": null, "code": "invalid_parsim_key" } }
```

```json
{ "type": "error", "error": { "type": "authentication_error", "message": "..." } }
```

## What is forwarded

- The request body exactly as received (byte for byte). The one exception is described under streaming.
- The provider key (`Authorization: Bearer` for OpenAI and Gemini, `x-api-key` for Anthropic), `content-type` and `accept`. For OpenAI also `openai-organization` and `openai-project`; for Anthropic `anthropic-version` and `anthropic-beta`. No other client header is forwarded; the Parsim key never leaves Parsim.
- The upstream status, body and headers come back unchanged, except hop-by-hop headers (`content-length`, `transfer-encoding`, `content-encoding`, `connection` and similar).

## Streaming and usage

With `"stream": true` the SSE stream is relayed as it arrives. Only the current incomplete event is ever held back.

To record token usage for streams, Parsim needs the provider to report it. If the client did not set `stream_options`, Parsim adds `"stream_options":{"include_usage":true}` to the forwarded body (inserted before the final `}`; every other byte is unchanged). It then removes from the stream what the client did not ask for:

- the usage-only chunk (`"choices": []`) that OpenAI sends at the end, and
- the `usage` field on other chunks (OpenAI sends `"usage": null`, Gemini sends the full usage on every chunk).

If the client set `stream_options` itself, the body and the stream pass through untouched.

Anthropic streams always pass through untouched: Anthropic reports usage in every stream, in `message_start` (input and cache tokens) and `message_delta` (final output tokens), so Parsim reads it without changing the request.

## Errors, timeouts and disconnects

- Upstream errors pass through with the same status and body.
- `PROXY_UPSTREAM_TIMEOUT_MS` (default 10 minutes) limits the wait for upstream headers and every gap between streamed chunks. Before headers: 504 with code `upstream_timeout`. Mid-stream: the stream is ended and the usage record gets status 504.
- If the upstream cannot be reached: 502 with code `upstream_unreachable`.
- If the client disconnects, the upstream request is cancelled and the usage record gets status 499.

## Usage records and prices

Each forwarded generation request writes one `usage_record`: project, upstream, model, input tokens, output tokens, cache read tokens (`cachedInputTokens`), cache write tokens (`cacheWriteInputTokens`, Anthropic), cost in USD, latency in ms, status and whether it streamed. `POST /v1/messages/count_tokens` is not billed and not recorded. Prompt and response content are never stored or logged.

`inputTokens` is always the full prompt: for Anthropic it is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, because Anthropic reports those three separately.

Cost comes from [config/model-prices.json](../config/model-prices.json) (USD per 1M tokens, with a `lastUpdated` date and sources). Cache reads use `cachedInput`, cache writes use `cacheWrite` (5-minute cache) or `cacheWrite1h` (1-hour cache, when Anthropic reports the split), and the rest uses `input`. Model ids match exactly, without a `models/` prefix, or without a dated suffix like `-2024-08-06` or `-20251001`. Models not in the table get cost `null`. Edit the file and restart to change prices; a malformed file stops the app at startup.

## Gemini's OpenAI-compatible endpoint

Observed against `gemini-3.8-flash` on 2026-10-06 and handled in `GeminiOpenAiAdapter` and the stream filter:

1. **Thinking tokens.** `usage.completion_tokens` leaves out thinking tokens, but `total_tokens` includes them and they are billed as output. Example: `prompt_tokens: 7, completion_tokens: 3, total_tokens: 153`. Parsim records output as `total_tokens - prompt_tokens` for Gemini.
2. **Usage in streams.** With `stream_options.include_usage`, Gemini puts the usage object on every content chunk and sends no separate usage-only chunk. Parsim strips it when it injected the option.
3. **Errors are arrays.** Errors come back as `[{"error": {"code": 503, "message": "...", "status": "UNAVAILABLE"}}]`, not OpenAI's `{"error": {...}}`. They pass through unchanged, as the proxy promises; clients using Gemini through any OpenAI-compatible path already see this shape.
4. **Thought signatures.** Responses carry `extra_content.google.thought_signature`. They are passed through so multi-turn tool use keeps working.
5. **Free tier limits.** The free tier allowed 20 requests per day per model for `gemini-3.8-flash`, and 503 "high demand" responses still counted. Live tests use very few calls.

Not observed yet (the model was overloaded): whether Gemini reports usage in a stream when `stream_options` is absent. Parsim always asks for it when the client did not, so this does not affect usage records.

## Anthropic Messages API

- `POST /v1/messages` forwards to Anthropic with the body unchanged, streamed or not. Text, `tool_use` and `tool_result` blocks, thinking blocks and every SSE event (`message_start`, `content_block_*`, `ping`, `message_delta`, `message_stop`) pass through exactly as sent.
- `anthropic-version` and `anthropic-beta` are passed through from the client. Parsim does not add a default `anthropic-version`; Anthropic rejects requests without one, as it would without Parsim.
- `POST /v1/messages/count_tokens` passes through and is not recorded as usage.
- Anthropic errors (`{"type":"error","error":{...}}`, including `529 overloaded_error`) pass through unchanged. Errors Parsim itself returns on these endpoints use the same shape.

### Tools that only let you set a base URL and an API key

Many tools, Claude Code among them, only let you set `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` (sent as `x-api-key`). Parsim supports them like this:

1. Create a project with `"upstream":"anthropic"` and store the real Anthropic key on it (`"providerKey":"sk-ant-..."`). It is encrypted at rest and never returned.
2. Create a Parsim key for the project.
3. Set `ANTHROPIC_BASE_URL` to Parsim and `ANTHROPIC_API_KEY` to the Parsim key (`psm_...`).

Parsim sees a `psm_` key in `x-api-key`, uses it to find the project, and forwards with the stored Anthropic key. The real key never leaves the server, and revoking the Parsim key cuts the tool off.

Customers who do not want their Anthropic key stored can send it per request in `x-provider-key` instead (with the Parsim key in `x-api-key` or `x-parsim-key`), or keep the Anthropic key in `x-api-key` and send the Parsim key in `x-parsim-key`. A key sent with the request always wins over the stored one. In local development, `PARSIM_REQUIRE_KEY=false` also works: requests without a Parsim key use the oldest project.

## Using Claude Code through Parsim

A manual check that Claude Code works through the local proxy. It uses your Anthropic API key, so it costs a little (a few cents for a short session) and bills your API account, not a Claude subscription.

1. Start the backend (`npm run start:dev`) and log in as the seeded admin (see "Use the proxy" in the README).
2. Create an Anthropic project with your key stored on it, then a Parsim key:

   ```bash
   curl -s http://localhost:3001/api/v1/projects -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"name":"Claude Code","upstream":"anthropic","providerKey":"sk-ant-..."}'
   ```

   ```bash
   curl -s http://localhost:3001/api/v1/projects/<projectId>/api-keys -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"name":"claude-code"}'
   ```

3. Start Claude Code pointed at Parsim. In PowerShell:

   ```powershell
   $env:ANTHROPIC_BASE_URL = "http://localhost:3001"; $env:ANTHROPIC_API_KEY = "psm_..."; claude
   ```

   In Git Bash or macOS/Linux:

   ```bash
   ANTHROPIC_BASE_URL=http://localhost:3001 ANTHROPIC_API_KEY=psm_... claude
   ```

   Claude Code may ask once whether to use this API key; accept it.

4. Ask it something small (for example "list the files in this folder"), then check:
   - the backend log shows lines like `messages project=... upstream=anthropic model=... status=200 streamed=true`;
   - usage was recorded:

     ```bash
     psql -d api -c 'SELECT model, "inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens", "costUsd", streamed FROM usage_record ORDER BY "createdAt" DESC LIMIT 5'
     ```

     Claude Code uses prompt caching, so after the first turn `cachedInputTokens` should be well above zero.

If Claude Code calls an Anthropic endpoint Parsim does not serve yet, it shows up in the backend log as a 404 for that path. This check was not run during step 07 because no Anthropic key was available; the same flow is covered by e2e tests that drive the official `@anthropic-ai/sdk` against the fake upstream.

## Agent sessions

Every generation request is also recorded as part of an agent session, with its context items. Send `x-parsim-session-id: <your run id>` to group requests reliably; without it, Parsim derives a session from the system prompt and first user message. See [Agent sessions and context storage](agent-sessions.md).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PARSIM_REQUIRE_KEY` | `true` | `false` lets requests from localhost without a key use the oldest project. Ignored when `NODE_ENV=production`. |
| `PROXY_OPENAI_BASE_URL` | `https://api.openai.com` | OpenAI base URL |
| `PROXY_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI-compatible base URL |
| `PROXY_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Anthropic base URL |
| `PROXY_UPSTREAM_TIMEOUT_MS` | `600000` | Timeout for upstream headers and between chunks |
| `PROXY_BODY_LIMIT` | `32mb` | Max request body |
| `PARSIM_ENCRYPTION_KEY` | none | 32 bytes, base64. Needed to store provider keys on projects |
| `PARSIM_MODEL_PRICES_PATH` | `config/model-prices.json` | Price table |

## Adding a provider

Write a class implementing `ProviderAdapter` (`src/proxy/providers/provider-adapter.ts`) for a client API (`openai-chat` or `anthropic-messages`) and an upstream: build the upstream URL and headers, and read usage from responses and stream events. Add it to `ADAPTERS` in `ProxyModule` and its upstream name to `UPSTREAMS`. The proxy pipeline does not change. A new client API (for example Gemini's native format) also needs a `ProxyOperation` and a controller.

---

Previous: [Auth](auth.md)

Next: [Agent sessions and context storage](agent-sessions.md)
