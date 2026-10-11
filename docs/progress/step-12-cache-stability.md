# Step 12: Prompt-cache stability

## Goal

Keep provider prompt caching working with the GC on:
- rewritten messages stay byte-identical across a session;
- GC passes run in batches instead of on every request;
- Anthropic `cache_control` markers and Gemini caching are respected;
- cache hits with the GC off and on are measured.

## What was built

- **Sticky decisions per session** (point 1). This was already built in step 10 (`gc_decision`, reapplied byte for byte even when the rules would now decide otherwise). Step 12 adds the batching that limits how often new rewrites change the prefix.
- **Batched passes** (`GC_BATCH_TOKENS`, default 4,000).
  - A pass (new decisions) runs only when the context is above 8,000 tokens and the context added since the session's last pass is above 4,000 tokens.
  - Each session stores where its last pass ended (`agent_session.gcProcessedPosition`).
  - Between passes, requests are only rewritten with stored decisions, so each one starts with the whole previous request, byte for byte.
  - If the client trims its history below the stored position, the next request is a pass.
- **Anthropic `cache_control`.** Parsim never adds, removes or moves a client's marker to another message. The system prompt, the first message and the newest turns (where Claude Code puts its moving marker) are never changed.
  - **Chosen behavior when a marker sits on content the GC archives or drops:** a marker on the `tool_result` block stays on that block, and a marker inside its content moves onto the stub that replaces that content. Both now sit on the stub, which is byte-identical in every later request. The prefix up to that marker changes once, at the pass that rewrote it, and is cached again on that request.
- **Gemini.**
  - Implicit caching gets the same stable prefixes. Cached tokens come from `usageMetadata.cachedContentTokenCount` (built in step 08; now covered by an e2e test).
  - Explicit `cachedContent` references pass through untouched. The cached contents live with Google and are never in the request, so the GC cannot change them.
  - Gemini rejects tools or a system instruction next to `cachedContent`, so `parsim_recall` cannot be added to such requests. They get **drops only** (your choice): nothing is archived, earlier archive decisions are not reapplied, and no recall tool is added.
- **Measurement.**
  - Cached input tokens per request were already recorded in `usage_record.cachedInputTokens`.
  - An offline prompt-cache model replays sessions with the GC off and on; results below.
  - A live Gemini comparison test was added but could not complete today (see Tests).

### Cache comparison (offline model, OpenAI tokenizer)

| Session | Requests | GC | Passes | Input | Cached | Uncached | Billed, cache at 10% | Billed, cache at 50% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| research-agent-session | 43 | off | 0 | 625,657 | 595,366 | 30,291 | 89,828 | 327,974 |
| research-agent-session | 43 | on | 5 | 336,863 | 278,465 | 58,398 | 86,245 (-4%) | 197,631 (-40%) |
| support-agent-session | 22 | off / on | 0 | 31,749 | 29,138 | 2,611 | 5,525 (same) | 17,180 (same) |
| long session, 60 turns | 60 | off | 0 | 1,223,125 | 1,183,151 | 39,974 | 158,289 | 631,550 |
| long session, 60 turns | 60 | on | 7 | 547,389 | 466,947 | 80,442 | 127,137 (-20%) | 313,916 (-50%) |
| long session, 200 turns | 200 | off | 0 | 13,961,450 | 13,821,581 | 139,869 | 1,522,027 | 7,050,660 |
| long session, 200 turns | 200 | on | 26 | 3,367,390 | 3,077,547 | 289,843 | 597,598 (-61%) | 1,828,617 (-74%) |

**Answer to "are cache hits the same with GC on as off": no.**
- Between passes, every request is a full cache hit, exactly as without the GC.
- Each pass invalidates the cache from the first rewritten message onward. So with the GC on, fewer tokens come from the cache, and about twice as many are uncached.
- The bill is still lower in every case, because far fewer tokens are sent:
  - with a 10% cache price (Anthropic reads, Gemini): 4% lower on the 43-request fixture, up to 61% lower on a 200-request session;
  - with a 50% cache price (OpenAI): 40% to 74% lower.
- The support session stays below the threshold, so it is identical with the GC on and off.

The model is an upper bound for both runs. Real providers need a minimum prefix (1,024+ tokens), cache at token level and may evict, and Anthropic charges extra to write the cache.

## Files changed

### Backend

- `src/gc/gc-config.ts`, `gc-types.ts`, `gc-engine.ts`:
  - `batchTokens`, and the `processedPosition` input and output;
  - `unprocessedTokens`;
  - `allowArchive` (no archives, and prior archives skipped, when false).
- `src/proxy/config/gc.config.ts`, `.env.example`, `.env.test.example`: `GC_BATCH_TOKENS`.
- `src/agent-sessions/**`: `gcProcessedPosition` and `markGcProcessed`.
- `src/database/migrations/1791721431412-AddGcProcessedPosition.ts`.
- `src/proxy/proxy-gc.service.ts`:
  - passes and stores each session's processed position;
  - `usesCachedContent` disables archiving.
- `src/proxy/proxy.service.ts`: no `parsim_recall` next to `cachedContent`.
- Tests:
  - `src/gc/gc-batching.spec.ts`, `src/gc/gc-cache-control.spec.ts` (new);
  - `gc-engine.spec.ts` (batch size 0 for the existing rule tests);
  - `gc-config.spec.ts`, `proxy-gc.service.spec.ts`.
- Test utilities: `test/utils/long-session.ts` (a 200-request session built from the research fixture), `test/utils/prefix-cache.ts` (the offline cache model).
- `test/gc/cache-stability.e2e-spec.ts`, `test/live/cache-stability.live-spec.ts` (new).
- `docs/gc.md`: sections on batched passes, `cache_control`, Gemini caching and the measurements.

### Other

- `docs/progress/step-12-cache-stability.md`, `docs/progress/README.md`.

## Tests

- **Unit** (`gc-batching.spec.ts`, 21 tests):
  - A 200-request session replayed in OpenAI, Anthropic and Gemini formats:
    - passes run only in batches (26 of 200 requests);
    - the prefix changes only at pass requests;
    - a rewritten message never changes afterwards;
    - decisions are only added, and only at passes.
  - Pass rules: the first pass, no new pass without new context, the batch size, trimmed history, and no archiving.
  - Offline cache comparison on the research, support and 60-turn sessions: fewer tokens billed with the GC on, every non-pass request a full prefix hit, and identical results when no pass runs.
- **Unit** (`gc-cache-control.spec.ts`, 5 tests): markers never added, removed or moved to another message; the system prompt and newest message untouched; block markers kept and inner markers moved to the stub; marked content byte-identical on later calls; nothing touched while protected.
- **Unit** (`proxy-gc.service.spec.ts`, 2 new): the processed position is stored and no pass runs again on the same context; requests with `cachedContent` get drops only.
- **E2E** (`cache-stability.e2e-spec.ts`, 9 tests):
  - In OpenAI, Anthropic and Gemini: two sequential requests of a session send byte-identical prefixes upstream (no pass on the second), and the next pass runs only after enough new context while rewritten items stay identical.
  - Every Anthropic `cache_control` marker is kept.
  - A Gemini `cachedContent` passes through with no tools, no archive and only drops.
  - Gemini cached tokens are recorded.
- **Live** (`cache-stability.live-spec.ts`): **not completed.**
  - First attempt: Gemini was overloaded (503), so I added a retry with backoff.
  - Second attempt: Gemini 3 rejected function calls in the history without a thought signature, so the test now adds Google's documented placeholder signature to the fixture's calls.
  - Third attempt: the key's free tier allows 20 requests per day for gemini-3.8-flash, and today's quota was used up (resets in about 11 hours). The free tier also means these attempts cost nothing.
  - The Anthropic part is skipped (no `ANTHROPIC_API_KEY`).
- **Coverage:** `src/gc` 98.6% lines.
- **Last runs:** `npm test` 415 passed (29 suites); `npm run test:e2e` 182 passed (13 suites).

## Decisions and trade-offs

- **A "processed message" is a rewritten one.** Rewritten messages never change again. Messages the GC left alone can still be rewritten at a later pass when they become duplicates or old enough, which matches the step 10 sticky decision. Freezing every message a pass has seen would stop the archive and duplicate rules from ever applying to older content.
- **Batching by tokens added since the last pass**, stored per session, so the decision is deterministic and the same in shadow and on modes.
- **Drops only next to a Gemini `cachedContent`** (your choice): no recall tool is possible there, so archiving would make content unreachable.
- **An offline cache model instead of fake-upstream numbers.** The fake upstream returns canned cache counts, which say nothing about prefix stability. The model is applied the same way to both runs.

## How to verify

From `backend/`:

```bash
npm run migration:run
```

```bash
npm test
```

Expect 415 passing.

```bash
npm run test:e2e
```

Expect 182 passing.

When the Gemini quota allows (20 requests per day on the free tier; this test makes 12):

```bash
npm run test:live -- cache-stability
```

It prints cached tokens with the GC off and on.

## Known issues and next steps

- **The live comparison has not run to completion.** Re-run it after the quota resets, or with a paid Gemini key; the test makes 12 requests. The project rules also say real customer data must never go through a free-tier key, so production needs a paid key.
- **Passes cost cache misses**, and the effect is largest with a 10% cache price. Possible improvements:
  - make the batch size adaptive (larger when the cache discount is high);
  - prefer rewriting recent content first, since the duplicate and superseded rules change the oldest copies, which are early in the prefix.
- **The cache model ignores Anthropic cache-write costs** (25% extra) and minimum prefix sizes.
- **Still pending from earlier steps:**
  - the Anthropic live tests (no key);
  - the recall live test (offered in step 11);
  - the manual Claude Code check;
  - regenerating the Observe secret and the Gemini key that were pasted in chat.
