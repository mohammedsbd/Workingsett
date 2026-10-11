# Step 10: GC engine v1 (drop and archive) with shadow mode

## Goal

Build the first version of the context garbage collector: a pure, deterministic engine that drops duplicate and superseded tool results and archives large old ones, wired into the proxy with per-project modes (off, shadow, on). Shadow mode, the default, only records what the GC would have saved. Step 08 (Gemini native API) is still postponed, so the Gemini native parts of this step were skipped.

## What was built

- **Pure GC engine** (`src/gc`).
  - `runGc` takes the request in the internal message model, the config, a token counter and the session's earlier decisions. It returns the new request plus a list of decisions: item, decision, reason, detail, tokens before and after, stub and archive ID.
  - It never modifies its input.
- **Three rules**, on tool results only, applied in this order:
  1. Exact duplicates (same content hash) are dropped, and the most recent copy is kept.
  2. A result is dropped when the same tool is called later with the same arguments (in any key order) and that later call succeeds.
  3. Results over 1,500 tokens that are more than 6 turns old are archived and replaced with `[parsim archived: <tool name> result, <n> tokens, id <archive id>]`.
- **New decisions only above 8,000 context tokens.** A rewrite is only made if its stub is smaller than the original.
- **Protections.** The engine never touches:
  - the system prompt;
  - the first user message (and anything before the first assistant message);
  - the last 6 turns;
  - assistant messages;
  - side-effect tool calls and their results;
  - results whose call is missing.

  Side-effect tools are the configured names plus the default patterns `send_`, `create_`, `delete_`, `update_`, `pay` and `refund`. Pattern matching is in snake case, so `sendEmail` and `gmail_send_email` match.
- **Valid tool pairs.** A dropped or archived result stays in place with its tool call ID; only its content becomes a stub. If an Anthropic block inside the result had a `cache_control` breakpoint, the stub keeps it.
- **Sticky rewrites.** Each decision is stored once per session. Every later request reapplies it byte for byte (same stub, same archive ID), even below the threshold, so the prompt prefix stays cacheable. Decisions are only ever added.
- **Per-project `gcMode`** (`off`, `shadow` by default, `on`), settable through the projects API.
  - **Shadow** runs after the response and adds no latency. It forwards the original request and stores the run plus decisions, including the tokens the GC would have saved.
  - **On** runs before forwarding, stores the archived originals, then forwards the smaller request. Streaming and `include_usage` injection still work on the rewritten body.
  - **Off** does nothing.
- **Fail open.** If the GC fails for any reason (engine error, unparseable body, archive storage error), the original request is forwarded unchanged. The error is logged by class name only, never with its message, and the run is stored as failed.
- **Storage.**
  - `gc_run` (one row per evaluated request): mode, ran, applied, failed, error class, tokens before and after, decision counts, duration, session and usage record links.
  - `gc_decision` (one row per rewritten item per session, unique on session and item key).
  - `archived_item` (archived originals per project and archive ID). These are stored whatever `storeContent` says, so they stay recallable in step 11.
  - `project.gcMode`.
- **Config** in `.env`: `GC_MIN_CONTEXT_TOKENS`, `GC_PROTECTED_TURNS`, `GC_ARCHIVE_MIN_TOKENS`, `GC_ARCHIVE_AFTER_TURNS`, `GC_SIDE_EFFECT_TOOLS`, `GC_SIDE_EFFECT_PATTERNS`. Empty values use the defaults.

### Token reduction on each fixture

Counted with the GC's own token counter. The OpenAI and Anthropic formats give the same numbers.

| Fixture | Config | Before | After | Saved |
| --- | --- | --- | --- | --- |
| short-chat | defaults | 107 | 107 | 0% (below the 8,000 threshold, no tools) |
| support-agent-session | defaults | 1,647 | 1,647 | 0% (below the threshold) |
| support-agent-session | threshold 0 | 1,647 | 1,107 | 32.8% (3 repeated policy articles dropped) |
| research-agent-session | defaults | 27,301 | 7,061 | 74.1% (16 duplicates, 12 superseded) |
| research-agent-session | archive above 500 tokens | 27,301 | 5,481 | 79.9% (plus 2 archived) |

The research fixture's tool results are about 900 tokens each, under the 1,500-token archive default, so the archive rule only fires there with a lower limit (which is what the e2e tests use).

## Files changed

### Backend

- `src/gc/gc-config.ts`, `gc-types.ts`, `gc-engine.ts`: the engine, config defaults and side-effect detection.
- `src/gc/gc-config.spec.ts`, `gc-engine.spec.ts`: unit tests.
- `src/proxy/proxy-gc.service.ts` (+ spec): runs the engine for the proxy, stores archives, runs and decisions, and fails open.
- `src/proxy/proxy.service.ts`, `proxy.module.ts`:
  - on mode before forwarding;
  - shadow mode after the response;
  - the GC run recorded with the usage record ID.
- `src/proxy/config/gc.config.ts`, `src/config/config.type.ts`, `src/app.module.ts`: the `gc` config namespace.
- `src/gc-runs`, `src/gc-decisions`, `src/archived-items`: domain classes and relational persistence (generated, then reduced to the step 09 pattern without REST endpoints).
- `src/database/migrations/1791655313641-AddGcRunsDecisionsAndArchive.ts`: the three tables and `project.gcMode`.
- `src/projects/**`: the `gcMode` field in the domain, entity, mapper, DTOs and service.
- `src/agent-sessions/**`: `findByExternalId`, so on mode can find the session (and its decisions) before forwarding.
- `src/context/context-items.ts` (+ spec): items now point at their message and part index.
- `test/gc/gc.e2e-spec.ts`: e2e tests.
- `test/utils/fixtures.ts`: `toOpenAiBody` and `toAnthropicBody` for fixtures.
- `.env.example`, `.env.test.example`: the GC block.
- `docs/gc.md` (new), `docs/readme.md`, `docs/proxy.md`, `docs/agent-sessions.md`, `README.md`.

### Other

- `docs/progress/step-10-gc-engine-v1.md`, `docs/progress/README.md`.

## Tests

- **Rules, table-driven over the fixtures** (`gc-engine.spec.ts`). Each row runs in both the OpenAI and Anthropic formats:
  - duplicates and superseded results in the research session;
  - archive of large old results;
  - duplicates and archives in the support session;
  - nothing to do in the short chat.

  Every decision is checked against its rule. A separate test checks the order in which rules apply.
- **One test per invariant, named after it**, each in both formats:
  - never changes or removes the system prompt;
  - never changes the first user goal;
  - never changes the last N turns (N = 1, 3, 6, 10);
  - never drops or archives a side-effect tool call or its result;
  - never changes the model's responses;
  - keeps archived content recallable;
  - produces deterministic output (byte-identical request JSON and decisions);
  - keeps every tool call paired with its tool result.
- **Sticky and prefix stability**, replaying the research session one assistant turn at a time:
  - decisions are only added, never changed or undone;
  - rewritten items are byte-identical on every later request;
  - the processed prefix is byte-identical when appended messages add no new decision.

  Also covered: prior decisions are reapplied below the threshold, a prior rewrite is reapplied exactly, and it is not reapplied once the item becomes protected.
- **Edge cases**:
  - below the threshold;
  - input not modified;
  - the `cache_control` breakpoint moves onto the stub;
  - a missing call keeps its result;
  - no superseding by a failed later call;
  - argument key order;
  - a stub that would cost more than the original;
  - item keys.
- **Side-effect detection** (`gc-config.spec.ts`): defaults, snake casing, 16 tool names.
- **`ProxyGcService`** (`proxy-gc.service.spec.ts`, with in-memory repositories):
  - on mode stores archives and forwards a smaller body;
  - nothing to rewrite;
  - shadow;
  - sticky reuse of stored decisions;
  - fail open on bad JSON, a non-object body and an archive storage failure;
  - recording only new decisions;
  - no decisions without a session;
  - `record` never throws.
- **E2E** (`test/gc/gc.e2e-spec.ts`, real app, real Postgres, fake upstream; each case in both the OpenAI and Anthropic formats where it applies):
  - new projects default to shadow, and an unknown mode is rejected;
  - shadow forwards the original byte for byte, stores the run and decisions, and archives nothing;
  - on forwards a request under half the size, keeps every tool pair and stores hash-checked archived originals;
  - on sends rewritten items byte-identical on the next request, and decisions are only added;
  - a short conversation is forwarded unchanged;
  - fail open when the engine throws (no content in the logs) and when the archive cannot be stored;
  - archives are stored even with `storeContent: false`;
  - streaming with a rewritten body (OpenAI);
  - fail open in shadow mode;
  - off mode stores nothing.
- **Coverage**: `src/gc` 98.5% lines (`gc-config.ts` 100%, `gc-engine.ts` 100%; `gc-types.ts` only holds two unused constant arrays), and `proxy-gc.service.ts` 100% lines.
- **Last runs**: `npm test` 271 passed (22 suites); `npm run test:e2e` 125 passed (10 suites).

## Decisions and trade-offs

- **Sticky rewrites** (your decision). A rewrite is stored and reapplied byte for byte, so a prefix that was sent once stays the same and keeps provider prompt caching. Untouched items can still be rewritten later as they age or get duplicated, which changes the prefix from that point; step 12 limits how often.
- **Drop means "replace the content with a stub", not "remove the message".** Removing a tool result would leave its call unanswered, which OpenAI and Anthropic reject, and would lose the action log. The stub costs about 15 tokens.
- **Archive ID from the content hash** (`arc_` plus 16 hex characters). The same content gets the same ID in every request, which keeps rewrites deterministic and stores each original once per project.
- **Turn = an assistant message plus what follows it.** That fits agent loops, where each tool round is a turn. Everything before the first assistant message is treated as the goal and protected.
- **Superseded only counts a later successful call.** An older good result is not dropped in favor of a later error.
- **Side-effect patterns over-match on purpose.** `pay` also matches `display_results`. Over-matching only keeps more context, while under-matching could erase the action log. The research fixture's `save_note` matches no default pattern, so tests configure it through `GC_SIDE_EFFECT_TOOLS`.
- **Shadow runs after the response; on runs before forwarding.**
  - Shadow adds no latency.
  - On adds one session lookup, a decision lookup, tokenization of the request, and the archive insert before the request leaves. Archives are stored before forwarding so the stub's ID always resolves.
- **Archives are stored whatever `storeContent` says.** Archived content must always be recallable. `storeContent: false` still keeps `context_content` empty.
- **Decisions need the agent session.** In on mode the session is looked up by its external ID before forwarding. The decisions are written after the response, once context capture has created or updated the session.
- **The GC config is global (env) and the mode is per project.** Per-project thresholds and side-effect lists can come later with the dashboard.
- **Errors are logged and stored by class name only**, because error messages can contain content.

## How to verify

From `backend/`:

```bash
npm run migration:run
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

Expect 271 passing.

```bash
npm run test:e2e
```

Expect 125 passing.

```bash
npx jest src/gc src/proxy/proxy-gc --coverage --collectCoverageFrom=src/gc/** --collectCoverageFrom=src/proxy/proxy-gc.service.ts
```

Expect `src/gc` above 90% lines.

Manual check with the dev server (`npm run start:dev`):

1. Create a project; it shows `"gcMode": "shadow"`.
2. Send a long agent conversation through `/v1/chat/completions` or `/v1/messages`. The upstream gets the original, and the log shows `gc project=... mode=shadow ran=true applied=false tokensBefore=... tokensAfter=...`. `gc_run` and `gc_decision` have rows.
3. `PATCH /api/v1/projects/:id` with `{ "gcMode": "on" }` and send it again. The upstream request now contains `[parsim dropped: ...]` and `[parsim archived: ...]` stubs, and `archived_item` holds the originals.

## Known issues and next steps

- **Gemini native (step 08) is still postponed.** Tool pairing for Gemini native function calls and function responses, its converter, and their GC tests are not done. The Gemini OpenAI-compatible endpoint is covered through the OpenAI format.
- **Recall is step 11.** Archived originals are stored and addressable by archive ID, but the model cannot fetch them yet (no `parsim_recall` tool). Until then, on mode should only be used where losing old large results is acceptable. Shadow is the default.
- **Rewrite frequency.** New rewrites can still happen on many requests in a row, each changing part of the prefix. Step 12 should batch them, for example only re-running the GC when the context grows by a margin.
- **On mode adds latency** for tokenizing the request (tens of milliseconds on a 30,000-token context) and two small queries plus the archive insert. Not benchmarked yet.
- **`count_tokens` (Anthropic) is never GC'd.** In on mode, its counts reflect the original request, not the smaller one that is sent.
- **Concurrent requests of the same session** can both make the same new decision. The unique index keeps one row, and the engine makes the same decision either way, so the output is the same.
- **Token counts for Anthropic and Gemini are approximate** (o200k_base), the same as step 09. They drive thresholds and the "would have saved" numbers, not billing.
- **Pending from earlier steps:**
  - live tests (no Gemini or Anthropic key in this step);
  - the manual Claude Code check;
  - the dev DB test projects;
  - regenerating the Observe secret and the Gemini key that were pasted in chat.
