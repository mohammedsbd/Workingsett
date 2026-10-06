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
- [Configuration](#configuration)
- [Adding a provider](#adding-a-provider)

## Overview

`POST /v1/chat/completions` accepts OpenAI chat requests and forwards them to the project's upstream:

| Upstream | URL |
| --- | --- |
| `openai` | `{PROXY_OPENAI_BASE_URL}/v1/chat/completions` (default `https://api.openai.com`) |
| `gemini` | `{PROXY_GEMINI_BASE_URL}/chat/completions` (default `https://generativelanguage.googleapis.com/v1beta/openai`) |

The route is outside the `/api` prefix, so SDKs work with `baseURL` set to `https://<host>/v1`. The code lives in `src/proxy`, with one adapter per upstream in `src/proxy/providers`. Usage is stored by `src/usage-records`.

## Projects and keys

- `POST /api/v1/projects`, `GET /api/v1/projects`, `GET` and `PATCH /api/v1/projects/:id` (JWT). A project has a name, an upstream (`openai` or `gemini`) and an optional stored provider key.
- `POST /api/v1/projects/:id/api-keys`, `GET /api/v1/projects/:id/api-keys`, `POST /api/v1/projects/:id/api-keys/:keyId/revoke` (JWT).
- Users only see their own projects. Until sign-in pages exist (step 18), use the seeded admin.
- A Parsim key is `psm_` plus 32 random bytes (base64url). Only its SHA-256 hash and a 12-character display prefix are stored; the full key is returned once, at creation.
- Stored provider keys are encrypted with AES-256-GCM using `PARSIM_ENCRYPTION_KEY` and never returned (the API shows `hasProviderKey`).

## Request headers

| What | Where |
| --- | --- |
| Parsim key | `x-parsim-key`, or `Authorization: Bearer psm_...` |
| Provider key | `x-provider-key`, or `Authorization: Bearer <key>` when that token is not a Parsim key, or the key stored on the project |

So an SDK can either use the Parsim key as `apiKey` and send `x-provider-key`, or keep the provider key as `apiKey` and send `x-parsim-key`.

Missing, unknown, malformed or revoked Parsim keys get a 401 in OpenAI error format:

```json
{ "error": { "message": "...", "type": "invalid_request_error", "param": null, "code": "invalid_parsim_key" } }
```

## What is forwarded

- The request body exactly as received (byte for byte). The one exception is described under streaming.
- `Authorization: Bearer <provider key>`, `content-type` and `accept`. For OpenAI also `openai-organization` and `openai-project`. No other client header is forwarded; the Parsim key never leaves Parsim.
- The upstream status, body and headers come back unchanged, except hop-by-hop headers (`content-length`, `transfer-encoding`, `content-encoding`, `connection` and similar).

## Streaming and usage

With `"stream": true` the SSE stream is relayed as it arrives. Only the current incomplete event is ever held back.

To record token usage for streams, Parsim needs the provider to report it. If the client did not set `stream_options`, Parsim adds `"stream_options":{"include_usage":true}` to the forwarded body (inserted before the final `}`; every other byte is unchanged). It then removes from the stream what the client did not ask for:

- the usage-only chunk (`"choices": []`) that OpenAI sends at the end, and
- the `usage` field on other chunks (OpenAI sends `"usage": null`, Gemini sends the full usage on every chunk).

If the client set `stream_options` itself, the body and the stream pass through untouched.

## Errors, timeouts and disconnects

- Upstream errors pass through with the same status and body.
- `PROXY_UPSTREAM_TIMEOUT_MS` (default 10 minutes) limits the wait for upstream headers and every gap between streamed chunks. Before headers: 504 with code `upstream_timeout`. Mid-stream: the stream is ended and the usage record gets status 504.
- If the upstream cannot be reached: 502 with code `upstream_unreachable`.
- If the client disconnects, the upstream request is cancelled and the usage record gets status 499.

## Usage records and prices

Each forwarded request writes one `usage_record`: project, upstream, model, input tokens, output tokens, cached input tokens (if reported), cost in USD, latency in ms, status and whether it streamed. Prompt and response content are never stored or logged.

Cost comes from [config/model-prices.json](../config/model-prices.json) (USD per 1M tokens, with a `lastUpdated` date and sources). Cached input tokens use the cached rate. Model ids match exactly, without a `models/` prefix, or without a dated suffix like `-2024-08-06`. Models not in the table get cost `null`. Edit the file and restart to change prices; a malformed file stops the app at startup.

## Gemini's OpenAI-compatible endpoint

Observed against `gemini-3.8-flash` on 2026-10-06 and handled in `GeminiOpenAiAdapter` and the stream filter:

1. **Thinking tokens.** `usage.completion_tokens` leaves out thinking tokens, but `total_tokens` includes them and they are billed as output. Example: `prompt_tokens: 7, completion_tokens: 3, total_tokens: 153`. Parsim records output as `total_tokens - prompt_tokens` for Gemini.
2. **Usage in streams.** With `stream_options.include_usage`, Gemini puts the usage object on every content chunk and sends no separate usage-only chunk. Parsim strips it when it injected the option.
3. **Errors are arrays.** Errors come back as `[{"error": {"code": 503, "message": "...", "status": "UNAVAILABLE"}}]`, not OpenAI's `{"error": {...}}`. They pass through unchanged, as the proxy promises; clients using Gemini through any OpenAI-compatible path already see this shape.
4. **Thought signatures.** Responses carry `extra_content.google.thought_signature`. They are passed through so multi-turn tool use keeps working.
5. **Free tier limits.** The free tier allowed 20 requests per day per model for `gemini-3.8-flash`, and 503 "high demand" responses still counted. Live tests use very few calls.

Not observed yet (the model was overloaded): whether Gemini reports usage in a stream when `stream_options` is absent. Parsim always asks for it when the client did not, so this does not affect usage records.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PARSIM_REQUIRE_KEY` | `true` | `false` lets requests from localhost without a key use the oldest project. Ignored when `NODE_ENV=production`. |
| `PROXY_OPENAI_BASE_URL` | `https://api.openai.com` | OpenAI base URL |
| `PROXY_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI-compatible base URL |
| `PROXY_UPSTREAM_TIMEOUT_MS` | `600000` | Timeout for upstream headers and between chunks |
| `PROXY_BODY_LIMIT` | `32mb` | Max request body |
| `PARSIM_ENCRYPTION_KEY` | none | 32 bytes, base64. Needed to store provider keys on projects |
| `PARSIM_MODEL_PRICES_PATH` | `config/model-prices.json` | Price table |

## Adding a provider

Write a class implementing `ChatCompletionsAdapter` (`src/proxy/providers/chat-completions-adapter.ts`): build the upstream URL and headers, and read usage from responses and stream chunks. Register it in `ProxyModule` under `CHAT_COMPLETIONS_ADAPTERS` and add its name to `UPSTREAMS`. The proxy pipeline does not change.

---

Previous: [Auth](auth.md)

Next: [Serialization](serialization.md)
