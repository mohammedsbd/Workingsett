# Step 09: agent sessions and context storage

## Goal

Record which agent session each proxied request belongs to and which pieces of context it contained (with content hashes, token counts and deduplicated content), so the garbage collector in step 10 has the data it needs. Step 08 (Gemini native API) is postponed until after step 10, so Gemini native parts were skipped.

## What was built

- **Agent sessions.**
  - A session is identified by the `x-parsim-session-id` header (not forwarded upstream). Without the header, the ID is derived from a hash of the upstream, the model family, the system prompt and the first user message.
  - Sessions are unique per project. Each request upserts its session in one atomic statement, so parallel requests never lose a count or create a duplicate.
  - Each session records its provider, its latest model, when it was first and last seen, and its request count.
  - The limits of derived IDs are documented.
- **Context items.** Each request is split into items: the system prompt, each message's plain content, and every tool call and tool result as an item of its own.
  - Each item stores its position, role, kind, tool call ID, content hash, token count, the tokenizer used, and the number of the request that first contained it.
  - Only items not yet stored for the session are written.
- **Content hashing.** Hashes are SHA-256 of a canonical JSON form (keys sorted at every depth). They leave out `cache_control` markers, which clients move between turns, and tool call IDs, so identical tool output is recognized as the same content.
- **Deduplicated content.** `context_content` stores each piece of content once per project per hash.
- **One internal message model.** OpenAI chat (also used for Gemini's OpenAI-compatible endpoint) and Anthropic messages each have a converter to and from it, attached to their provider adapters.
  - Converting a request to the model and back gives an identical request.
  - Every part keeps its original JSON, so fields Parsim doesn't model are never lost, and edits to a part (what the GC will do) show up in the rebuilt request.
  - Images are stored as references: a URL, or the hash, type and size of inline data.
  - `cache_control` markers are kept on each part.
- **Token counts.** OpenAI models are counted exactly with js-tiktoken and the model's encoding. Anthropic and Gemini use an approximation (o200k_base), marked as `approx:` in the stored tokenizer field. Images count as a fixed 85 tokens. Provider-reported usage stays the source of truth for billing.
- **Storage after the response.** Storage runs after the response has been sent (after the stream ends for streaming requests), so it adds no latency. If it fails, the request has already succeeded: the error is logged and the usage record is saved without a session link.
- **Usage records** now link to their agent session (`agentSessionId`).
- **Content setting.**
  - Projects get a `storeContent` setting. When it isn't set, `PARSIM_STORE_CONTENT` applies, which defaults to on outside production and off in production.
  - With content off, metadata (hashes, kinds, token counts) is still stored.
  - `DEBUG_CONTENT=true` logs item previews at debug level only; content never appears in logs at info level.
- **Docs:** `backend/docs/agent-sessions.md`.

## Files changed

Backend:
- **Added:**
  - Core: `src/context/` (canonical JSON, the internal model and its OpenAI and Anthropic converters, context items, session IDs, token counter, capture service, module).
  - Persistence: `src/agent-sessions/`, `src/context-items/`, `src/context-contents/` (domain and persistence only; scaffolded with the generator, then trimmed).
  - Migration: `src/database/migrations/1791480423762-AddAgentSessionsAndContext.ts`.
  - Tests: `test/context/agent-sessions.e2e-spec.ts`.
  - Docs: `docs/agent-sessions.md`.
- **Modified:**
  - Proxy and adapters: `src/proxy/proxy.service.ts`, `proxy.module.ts`, `providers/*` (each adapter gets its converter), `config/*` (`PARSIM_STORE_CONTENT`, `DEBUG_CONTENT`).
  - Usage and projects: `src/usage-records/**` (session link), `src/projects/**` (`storeContent`).
  - Env examples: `.env.example`, `.env.test.example`.
  - `package.json`: `js-tiktoken` added.
  - Proxy e2e suites and `test/utils/proxy-helpers.ts`.
  - Docs: `docs/proxy.md`, `docs/readme.md`, `README.md`.

Frontend:
- None

Other:
- Added: this file
- Modified: `docs/progress/README.md`

## Tests

Added:
- **Unit** (40 new tests):
  - `canonical-json.spec.ts`: key order doesn't change the hash, at any depth.
  - `openai-chat.converter.spec.ts`: byte-identical round trip of all 3 fixture conversations, plus a request with every content form (images, audio, refusal, empty tool calls, tool messages); roles, parts, image references, edits.
  - `anthropic-messages.converter.spec.ts`: byte-identical round trip of a tool-use session with thinking and cache markers, and of images, documents, redacted thinking and string system prompts; a moving cache marker.
  - `context-items.spec.ts`: item splitting for both formats; hashes stable across tool call IDs, cache markers and appended messages.
  - `session-id.spec.ts`: header handling, a derived ID stable as the conversation grows, what changes it, model family.
  - `token-counter.spec.ts`: exact OpenAI counts, older encodings, approximations, images.
- **E2E** (`test/context/agent-sessions.e2e-spec.ts`, 15 tests):
  - Three sequential requests from the research fixture (10, 40 and 117 messages) create one session with 3 requests, store each item once with the right request number, store repeated content once, count tokens with the OpenAI tokenizer, and link all 3 usage records.
  - Re-sending a request adds nothing new.
  - Header-based sessions are used and not forwarded upstream.
  - Different conversations and different projects stay apart.
  - An Anthropic cache marker moving between turns stores no duplicates.
  - With `storeContent` off, no content is stored anywhere.
  - Content is stored by default.
  - A storage failure still returns 200 and saves the usage record.
  - Streamed requests are captured.
  - Content never reaches the logs.

Last run:
- `npm run lint`: pass
- `npx tsc --noEmit`: pass
- `npm test`: 19 suites, **174 passed**, 0 failed (was 134)
- `npm run test:e2e`: 9 suites, **106 passed**, 0 failed (was 91; also passes with `--randomize`)
- Every commit was checked on its own: tsc, eslint and unit tests pass at each one.
- Manual check with `npm run start:dev`: a request with `x-parsim-session-id: dev-check-1` and a fake OpenAI key got OpenAI's 401 back unchanged, and the session plus its 2 items (system and user, counted with `tiktoken:o200k_base`) were stored.

## Decisions and trade-offs

- **"Identical request" means identical JSON.** The internal model rebuilds the same keys, key order and values, so `JSON.stringify` output is byte for byte the same. Whitespace inside the client's raw bytes can't survive any JSON round trip; the proxy still forwards the raw bytes when nothing changes.
- **Every part keeps its original JSON.** A model that only held the modelled fields would lose provider details (`signature` on thinking blocks, `name` on messages, citations, new fields Anthropic or OpenAI add). Keeping each part's raw JSON makes the model lossless by construction.
- **Item boundaries.** Tool calls and tool results are items of their own; other content in a message forms one item. The GC can then archive one large tool result without touching the message around it.
- **Hash exclusions.** `cache_control` and tool call IDs are left out of the hash. Including them would make Claude Code's moving cache marker re-store items every turn and would stop identical tool output from deduplicating. Tool call IDs are kept on the item row.
- **Content is stored per project, not globally.** Deduplicating across projects would save little and would tie one customer's data to another's deletion. The research fixture shows deduplication within a project working.
- **Storage runs in-process after the response, not in pg-boss yet.** It's already off the request path, and a queue would have to store the full request body (with content) in the database even for projects that don't store content. Revisit when storage gets heavier (compression in step 14).
- **Token counts for Anthropic and Gemini are approximations.** Exact counts would need one paid count-tokens call per new item, with the customer's key, after the response. The approximation is labelled per item; Claude 4.7 and later models produce about 30% more tokens than o200k_base, as noted in the docs.
- **New entities used the generator.** The three entities were scaffolded with `npm run generate:resource:relational`, then reduced to domain and persistence, because nothing needs a CRUD API yet. Project `storeContent` and the usage-record session link were added by hand, because those files no longer have the generator's markers.
- **Upserts and inserts use raw SQL.** The session upsert is one SQL statement (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), and items and content use `ON CONFLICT DO NOTHING`. Concurrent requests of one session are therefore safe without locks.
- **Old privacy tests were narrowed.** The step 06 and 07 checks that prompt text never appears in the database now exclude `context_content`, which stores content on purpose. The new "storeContent off" test checks that no content is stored anywhere.

## How to verify

```bash
git log --oneline main..feat/step-09-agent-sessions
```

```bash
cd backend && npm ci && npm run migration:run && npm run lint && npx tsc --noEmit && npm test && npm run test:e2e
```

Expect 174 unit tests and 66 + 15 + 25 = 106 e2e tests to pass.

```bash
cd backend && npm run start:dev
```

Send a few requests through the proxy with `x-parsim-session-id: my-run` (see "Use the proxy" in `backend/README.md`), then look at the stored data:

```bash
psql -d api -c 'SELECT "externalId", "requestCount" FROM agent_session ORDER BY "lastSeenAt" DESC LIMIT 5'
```

```bash
psql -d api -c 'SELECT position, kind, "tokenCount", tokenizer, "firstSeenRequest" FROM context_item ORDER BY "createdAt" DESC LIMIT 10'
```

## Known issues and next steps

- **Gemini native format (postponed with step 08).**
  - No converter for Gemini's native `contents`, `parts`, `functionCall` and `functionResponse` format.
  - No Gemini-native round-trip tests.
  - No session or context capture for `/v1beta/models/...` requests.

  Do these together with step 08 after step 10. Gemini traffic through the OpenAI-compatible endpoint is already covered.
- **No read API or dashboard view** for sessions and items yet; step 13 adds the dashboard.
- **Approximate token counts.** Anthropic and Gemini counts are approximations, and images are a flat 85 tokens. Fine for GC thresholds, not for billing.
- **Derived session IDs merge identical runs.** Two runs of the same task with the same start become one session. Recommend `x-parsim-session-id` in the integration docs (step 17).
- **Storage runs before the usage record is written** (both after the response). A very slow database delays usage records but never the client.
- **Your dev database has another test project.** I created a project called "Sessions dev check", with one session and 2 items, during the manual check. Delete it or reuse it.
- **Still pending from earlier steps:** the Anthropic live test (no key), the Gemini live tests, and the manual Claude Code check.
