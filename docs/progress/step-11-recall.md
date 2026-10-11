# Step 11: Recall

## Goal

Let the model get archived context back. In GC `on` mode, requests with archive stubs get a `parsim_recall` tool. When the model calls it, Parsim fetches the original, continues the conversation upstream itself, and returns only the final answer, for OpenAI, Anthropic and Gemini native, streamed or not.

## What was built

- **Tool injection** (`src/recall`), only when the forwarded request contains an archive stub:
  - `parsim_recall` (one argument, `archive_id`) is appended to the client's tools. For OpenAI and Anthropic it goes at the end of `tools`; for Gemini it joins the first `functionDeclarations` list. Existing tools are never changed or reordered.
  - A constant system line explains the stubs and the tool:
    - OpenAI: a system message after the leading system and developer messages;
    - Anthropic: a text block after the client's blocks, so `cache_control` breakpoints stay put;
    - Gemini: a `systemInstruction` part.
  - The additions are byte-identical on every call, so prompt caching keeps working.
- **The recall loop** (`ProxyService.forwardWithRecall`):
  1. Parsim finds `parsim_recall` calls in the response.
  2. It looks up each archive in the project's `archived_item` table.
  3. It sends a follow-up request with the model's turn and one tool result per recall.
  4. It repeats until the response has no recall.

  The client never sees `parsim_recall`. An unknown archive ID gets the tool result `Archive id <id> was not found. Continue without it.`
- **Mixed calls** (your choice): when `parsim_recall` and client tools are called in one response, the follow-up keeps only the recall calls. The model sees the recalled content and calls its tools again if it still needs them.
- **Loop limit** (your choice):
  - At most 3 recalls per request (`PARSIM_RECALL_MAX_PER_REQUEST`).
  - A recall over the limit gets a "limit reached" result, and the follow-up turns tool use off (`tool_choice: none` / `{type: none}` / `mode: NONE`), so the model must answer.
  - At most limit + 2 upstream calls per request.
- **Streaming:**
  - Text streams as it arrives. Tool calls are held from the first tool call event to the end of the response, because any of them may be `parsim_recall`; without a recall they are then sent unchanged.
  - Follow-up streams are spliced into the client's stream:
    - OpenAI chunk IDs are rewritten to the first response's ID;
    - the Anthropic follow-up `message_start` is dropped and block indexes continue;
    - Gemini chunks pass through.
- **Usage** (your choice): one `usage_record` per client request, with tokens and cost summed over all upstream calls and a new `upstreamCalls` count.
- **A new `recall` table** with one row per recall: archive ID, found, refused, tokens restored, session and usage record. No content.
- **Fail open:**
  - if injection fails, the request goes out without the tool;
  - an unreadable archive is answered as not found;
  - `PARSIM_RECALL_MAX_PER_REQUEST=0` turns recall off.
- **Fix found by the e2e tests:** archived Gemini function responses are now returned as their `output` text instead of JSON wrapped in a second `{"output": ...}`.

## Files changed

### Backend

- `src/recall/` (new):
  - `recall-tool.ts`: tool definition, system line, result texts, archive rendering.
  - `recall-format.ts`, `recall-formats.ts`: the per-format interface and registry.
  - `openai-recall.ts`, `anthropic-recall.ts`, `gemini-recall.ts`: injection, response and stream parsing, follow-ups, splicing.
  - `sse-events.ts`, `archive-stubs.ts`, `recall-limit.ts`.
  - `recall.service.ts`.
  - Specs: `recall.spec.ts`, `recall.service.spec.ts`.
- `src/recalls/`: the `recall` entity and relational persistence (generated, reduced to the step 09 pattern).
- `src/database/migrations/1791717740738-AddRecallsAndUpstreamCalls.ts`: the `recall` table and `usage_record.upstreamCalls`.
- `src/usage-records/**`: `upstreamCalls`.
- `src/proxy/proxy.service.ts`:
  - forwarding split into shared helpers (`openLink`, `callUpstream`, `readBody`, `sendHead`);
  - `forwardWithRecall` and `relayRecallStream`;
  - recall planning, `addUsage`, recording recalls.
- `src/proxy/proxy.module.ts`, `src/proxy/config/*`, `.env.example`, `.env.test.example`: `PARSIM_RECALL_MAX_PER_REQUEST`.
- `test/recall/recall.e2e-spec.ts` (new).
- `test/gc/gc.e2e-spec.ts`: one assertion now ignores the OpenAI recall system message.
- `docs/recall.md` (new), `docs/gc.md`, `docs/readme.md`, `README.md`.

### Other

- `docs/progress/step-11-recall.md`, `docs/progress/README.md`.

## Tests

- **Unit** (`recall.spec.ts`, `recall.service.spec.ts`, 43 tests):
  - Tool injection for all three formats keeps existing tools unchanged, appends `parsim_recall` and the system line, and is byte-identical across calls. Also covered: OpenAI system placement, Anthropic string/absent/block system, Gemini with no tools.
  - Stub detection across formats, ignoring dropped stubs and malformed IDs.
  - Splitting recall and client calls in responses of each format.
  - Follow-up building and tool choice none.
  - Stream watchers holding from the first tool call and rebuilding turns, including Anthropic thinking signatures and streamed tool input.
  - Splicers.
  - The loop limit planner (5 cases).
  - Archive rendering and archive ID parsing.
  - The SSE splitter.
  - The service: found, missing, empty and refused calls, project isolation, unreadable archives, recording that never throws.
  - Usage summing.
- **E2E** (`recall.e2e-spec.ts`, 22 tests, fake upstream scripted to call `parsim_recall`). Each of the following runs in OpenAI, Anthropic and Gemini native:
  - injection is byte-identical across requests and keeps the client's tools;
  - the archived original is sent upstream in the follow-up, the client receives only the final answer, usage sums both calls with `upstreamCalls: 2`, and the recall row is stored;
  - streaming: one spliced stream with the text of both responses and no `parsim_recall`;
  - mixed recall and client tool calls;
  - a missing archive ID;
  - the loop limit: 5 upstream calls, the last with tool use off, 3 found and 1 refused.

  Also: the loop limit on an Anthropic stream with block indexes 0 to 4, a client tool call passed through with one upstream call, held client tool calls streamed unchanged, and no injection without stubs.
- **Coverage:** `src/recall` 99.6% lines, `src/gc` 98.5%.
- **Last runs:** `npm test` 387 passed (27 suites); `npm run test:e2e` 173 passed (12 suites).
- **No live test.** A real model calling `parsim_recall` was not tried (see Known issues).

## Decisions and trade-offs

- **Only archive stubs trigger recall.** Dropped duplicates and superseded results are still in the conversation in their newer form.
- **Drop client tool calls next to a recall** (your choice). The alternative, placeholder results, would feed the model fake tool output.
- **Final call without tools at the limit** (your choice), so the client always gets an answer and the loop always ends.
- **One summed usage row per request** (your choice), with recalls in their own table. Summing usage before pricing gives the same cost as pricing each call, because the model is the same.
- **Hold tool calls in streams, not text.** Text is never delayed. Tool calls arrive at the client at the end of the response instead of incrementally, which no SDK depends on for correctness.
- **Splice rather than buffer follow-ups.** The client keeps one HTTP response and one logical message.
- **A follow-up failing mid-stream** ends the stream. The status cannot change after headers are sent; the usage record gets the upstream status.
- **Recall text** is the archived original as plain text (structured values as JSON, images as `[image]`).

## How to verify

From `backend/`:

```bash
npm run migration:run
```

```bash
npm test
```

Expect 387 passing.

```bash
npm run test:e2e
```

Expect 173 passing.

Manual check with the dev server:

1. Set a project to `"gcMode":"on"` and send a long agent conversation whose old tool results are archived. The upstream request contains `parsim_recall` and the system line.
2. When the model calls `parsim_recall`, the log shows `recall project=... calls=1 found=1`. `usage_record.upstreamCalls` is 2 and the `recall` table has a row.

## Known issues and next steps

- **Not yet tried against a real model.** The flow is covered against the fake upstream in all three formats, but no live model has called `parsim_recall` yet. A live test with Gemini Flash on the research fixture in `on` mode would cost about 3 cents; I can add it in a later step if you want.
- **Anthropic extended thinking:** thinking blocks are passed back with their signatures in follow-ups. This is tested with the fake upstream only.
- **Tool calls in recall-enabled streams arrive at the end of the response** (see Decisions).
- **Gemini JSON-array streams (no `alt=sse`) are not checked for recalls.** The SDK always uses `alt=sse`.
- **Step 12 (prompt-cache stability)** should measure cache hits with the recall tool present, and limit how often new rewrites change the prefix.
- **Still pending from earlier steps:**
  - the Anthropic live test (no key);
  - the manual Claude Code check;
  - regenerating the Observe secret and the Gemini key that were pasted in chat.
