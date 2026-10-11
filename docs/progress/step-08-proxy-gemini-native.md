# Step 08: Gemini native API in the proxy

## Goal

Serve Google Gemini's native API (`generateContent`, `streamGenerateContent`, `countTokens`) through the same proxy pipeline as OpenAI and Anthropic, so the official Google GenAI SDK can point at Parsim by changing only its base URL. This step was postponed until after step 10, so it also finishes the Gemini native parts skipped in steps 09 and 10: the converter for the internal message model, and GC tool pairing for function calls and responses.

## What was built

- **Endpoints**, served outside the `/api` prefix with Google's paths:
  - `POST /v1beta/models/{model}:generateContent`
  - `POST /v1beta/models/{model}:streamGenerateContent` (with or without `alt=sse`)
  - `POST /v1beta/models/{model}:countTokens`

  A new `GeminiNativeAdapter` plugs into the existing pipeline (auth, provider keys, streaming, usage records, context capture and GC). The model is read from the URL. An unknown method (for example `:embedContent`) gets a Google-format 404.
- **Keys.**
  - The Google key is accepted from `x-goog-api-key` or the `key` query parameter. It is always sent upstream in `x-goog-api-key`, never in the URL.
  - The `key` parameter is stripped before the upstream URL is built. URLs are never logged or stored.
  - A `psm_` key in either place is the Parsim key, so the SDK can use the Parsim key as its `apiKey` with the Google key stored on the project (as in step 07). `x-parsim-key` and `x-provider-key` work too.
- **Pass-through.** The body is forwarded byte for byte, including:
  - `contents`, `systemInstruction` and `cachedContent` references;
  - `tools` with `functionDeclarations`, and `toolConfig`;
  - `functionCall` and `functionResponse` parts, with their `thoughtSignature`;
  - `generationConfig` and `safetySettings`.

  Responses and SSE chunks come back unchanged. Other query parameters (`alt=sse`) are passed on.
- **Usage** from `usageMetadata`:
  - input = `promptTokenCount` (already includes cached tokens) + `toolUsePromptTokenCount`;
  - output = `candidatesTokenCount` + `thoughtsTokenCount`;
  - cache reads = `cachedContentTokenCount`.

  For streams, the latest running totals win. A stream without `alt=sse` comes back as one JSON array, and its last chunk's usage is used. `countTokens` passes through and is not recorded.
- **Errors.** Upstream errors pass through with the same status and body. Parsim's own errors on these endpoints use Google's format (`{"error":{"code","message","status"}}`).
- **Gemini native converter** (`GeminiNativeConverter`) for the internal message model:
  - Role `model` maps to assistant, `systemInstruction` to the system prompt, and `functionCall` / `functionResponse` parts to tool calls and results. Images, thinking and other parts are mapped too.
  - Converting to the model and back gives an identical request.
  - Gemini call IDs are optional, so a response without one is paired with the oldest unanswered call of the same name. Calls without an ID get an internal ID from their position, which is never written back.
  - Converters now take the model as an option, since Gemini puts it in the URL.
- **Context capture and GC on Gemini.**
  - Gemini native requests are recorded as agent sessions with context items, like the other formats.
  - The GC works on them in shadow and on modes. A rewritten function response keeps its name and becomes `{"output": "<stub>"}`, so every call still has its answer and Gemini accepts the request.
- **Config:** `PROXY_GEMINI_NATIVE_BASE_URL` (default `https://generativelanguage.googleapis.com`).
- **Prices:** Gemini models were already in `config/model-prices.json` from step 06 (`gemini-3.8-flash` down to `gemini-2.5-flash-lite`). The native endpoints use the same entries. No new models were added, since I did not want to add prices I could not check against Google's pricing page in this step.

### GC token reduction on the fixtures in Gemini format

| Fixture | Config | Before | After | Saved |
| --- | --- | --- | --- | --- |
| short-chat | defaults | 107 | 107 | 0% (below threshold) |
| support-agent-session | defaults | 1,725 | 1,725 | 0% (below threshold) |
| support-agent-session | threshold 0 | 1,725 | 1,173 | 32.0% (3 duplicates) |
| research-agent-session | defaults | 28,166 | 7,262 | 74.2% (16 duplicates, 12 superseded) |
| research-agent-session | archive above 500 tokens | 28,166 | 5,632 | 80.0% (plus 2 archived) |

The decisions are the same as in the OpenAI and Anthropic formats. The counts are slightly higher because each function response is a JSON object.

## Files changed

### Backend

- `src/proxy/gemini.controller.ts` (new): the `/v1beta/models/{model}:{method}` route.
- `src/proxy/providers/gemini-native.adapter.ts` (+ spec), `gemini-format.ts` (+ spec): the adapter and usage extraction.
- `src/proxy/proxy-credentials.ts` (+ spec):
  - `x-goog-api-key` and `key` parameter handling;
  - `omitKey`, `queryWithoutKey` and `urlWithoutKey`.
- `src/proxy/proxy-error.ts` (+ spec): the Google error format and the unknown-method error.
- `src/proxy/proxy.service.ts`:
  - model from the URL;
  - streaming decided by the endpoint;
  - query parameters without the key passed to adapters;
  - the model passed to context capture and the GC.
- `src/proxy/providers/provider-adapter.ts`: the `gemini-native` API, three operations, `stream` on operations, and `query` in `prepare`.
- `src/proxy/proxy.module.ts`, `src/app-setup.ts`: the new adapter, controller, raw body parsing and the prefix exclusion for `/v1beta`.
- `src/proxy/config/*`, `.env.example`, `.env.test.example`: `PROXY_GEMINI_NATIVE_BASE_URL`.
- `src/context/normalization/gemini-native.converter.ts` (+ spec): the new converter.
- `internal-model.ts`, `openai-chat.converter.ts`, `anthropic-messages.converter.ts`, `context-capture.service.ts`, `proxy-gc.service.ts`: the `model` option.
- `src/gc/gc-engine.spec.ts`: every rule, invariant, sticky and pairing test now also runs on Gemini native requests.
- `test/proxy/gemini-native-proxy.e2e-spec.ts` (new): e2e tests.
- `test/live/gemini-native-proxy.live-spec.ts` (new): live test.
- `test/utils/fake-upstream.ts`: the Gemini `countTokens` route.
- `test/utils/fixtures.ts`: `toGeminiBody`.
- `package.json`: `@google/genai` 2.28.0 as a dev dependency.
- `docs/proxy.md`, `docs/agent-sessions.md`, `docs/gc.md`, `README.md`.

### Other

- `docs/progress/step-08-proxy-gemini-native.md`, `docs/progress/README.md`.

## Tests

- **Unit:**
  - Gemini usage from JSON responses, JSON-array streams and streamed chunks (14 tests): thinking, cached and tool-use tokens, total-only reports, invalid data.
  - Key extraction from `x-goog-api-key` and `key`, Parsim key in either place, precedence.
  - Key stripping from query strings and URLs.
  - Google error format.
  - Adapter URL, headers, `alt=sse` pass-through and no key in the URL.
  - Converter: identical round trip with every part type, model option, pairing by ID and by name, repeated calls, error responses, edited responses written under `output`, synthetic IDs never written, context items.
- **GC on Gemini:** all rule, invariant, sticky-prefix and pairing tests run in the Gemini format (26 more cases), including "keeps every tool call paired with its tool result" for function calls without IDs.
- **E2E** (`gemini-native-proxy.e2e-spec.ts`, 26 tests, fake upstream in Gemini native format):
  - non-streamed byte-for-byte forwarding with function calls, `thoughtSignature`, tools, `generationConfig`, `safetySettings` and `cachedContent`;
  - usage with the model from the URL;
  - thinking and cached tokens;
  - session and context items with paired function calls;
  - no `/api` prefix, and the unknown-method 404;
  - SSE streams passed through with `alt=sse`;
  - streamed function calls;
  - JSON-array streams without `alt=sse`;
  - `countTokens` not recorded;
  - Parsim key as `x-goog-api-key` or as `key`, and a Google key moved from `key` to the header;
  - missing Parsim or Google key answered in Google format;
  - the key and the content never stored or logged;
  - upstream errors 400, 403, 429, 500 and 503 passed through;
  - wrong project upstream;
  - GC on mode shrinking the research fixture with valid function responses;
  - the official `@google/genai` SDK pointed at Parsim: generate, stream and count tokens.
- **Live** (`LIVE_TESTS=true`, `GEMINI_API_KEY` and `PARSIM_INTERNAL_MODEL` from `.env.test`): one real call and one real stream through the proxy with `@google/genai`. **Both passed** against the real Gemini API.
- **Last runs:**
  - `npm test`: 344 passed (25 suites).
  - `npm run test:e2e`: 151 passed (11 suites).
  - `npm run test:live -- gemini-native`: 2 passed.
  - Coverage: `src/gc` 98.5% lines, `gemini-native.converter.ts` 100% lines.

## Decisions and trade-offs

- **One route with the model and method in one segment** (`:modelMethod`, split at the last colon). This avoids escaping colons in Express route patterns and gives one place for the unknown-method 404.
- **The model comes from the URL** and is passed to the pipeline, context capture and the GC. Converters take it as an option instead of reading the body.
- **The key never travels in the URL.** Parsim moves a `key` parameter to the `x-goog-api-key` header, so the key cannot end up in upstream access logs or any URL Parsim handles.
- **Parsim key in `x-goog-api-key` or `key`** (your choice, same as step 07). The SDK can then be set up with only a base URL and an API key.
- **Without `alt=sse`, a stream is relayed as one response.** Gemini sends a JSON array, which Parsim cannot split into events without parsing partial JSON, so the client gets it in one piece. The official SDK always sends `alt=sse`, so this only affects hand-written clients.
- **Function responses without IDs are paired by name, in order.** That is how Gemini itself matches them. Internal IDs are positional, so they are stable while the prefix is stable, which sticky GC rewrites need.
- **A rewritten function response is `{"output": "<stub>"}`.** Gemini requires `response` to be an object, and its docs use `output` for a function's result.
- **No new prices.** The Gemini models in the table were added in step 06; see the What was built section.

## How to verify

From `backend/`:

```bash
npm install
```

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

```bash
npm test
```

Expect 344 passing.

```bash
npm run test:e2e
```

Expect 151 passing.

```bash
npm run test:live -- gemini-native
```

Needs `GEMINI_API_KEY` and `PARSIM_INTERNAL_MODEL` in `.env.test`. Expect 2 passing, costing a fraction of a cent.

Manual check with the dev server (`npm run start:dev`):

1. Create a project with `"upstream":"gemini"` and `"providerKey":"<your Google key>"`, then create a Parsim key.
2. Run the SDK snippet from `docs/proxy.md#using-the-google-genai-sdk` with `apiKey` set to the Parsim key.
3. The log shows `gemini.generateContent project=... model=gemini-3.8-flash status=200`, and `usage_record` has a row with the model and token counts.

## Known issues and next steps

- **Streams without `alt=sse` are not relayed incrementally** (see Decisions). The SDK is not affected.
- **No Vertex AI.** Only the Gemini Developer API paths (`/v1beta/models/...`) are served. `/v1/models/...`, `tunedModels/...`, file uploads, caching and embedding endpoints are not proxied.
- **`countTokens` is never GC'd**, like Anthropic's: in on mode its count reflects the original request.
- **The Parsim key in `?key=` reaches Parsim in the URL.** It is never logged, stored or forwarded, but a reverse proxy in front of Parsim could log it. Prefer `x-goog-api-key` (what the SDK uses).
- **Step 11 (recall)** can now inject `parsim_recall` as a Gemini `functionDeclaration` too, since the Gemini native converter exists.
- **Still pending from earlier steps:**
  - the Anthropic live test (no Anthropic key);
  - the manual Claude Code check;
  - regenerating the Observe secret and the Gemini key that were pasted in chat.
