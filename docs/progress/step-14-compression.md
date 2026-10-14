# Step 14: Compression with background summaries

## Goal

Compress finished stretches of long agent sessions into a state block (goal, decisions, facts, open items, the action log and the archive ids of the originals), summarized in a background job so requests never wait, and report the savings net of what the summaries cost.

## What was built

### Backend

- **Stretch detection** (`src/compression/stretch.ts`), simple documented heuristics:
  - whole turns only, after the session's last block and before the protected tail;
  - never the system prompt or the first goal;
  - no open tool calls and no system messages inside;
  - at least `COMPRESSION_MIN_TOKENS` (6,000) tokens as sent, after the GC.
  - A "worth it" check: the block plus the side-effect calls kept beside it must take at most half of the stretch. Otherwise no summary is paid for.
- **State block** (`state-block.ts`): the summarizer's JSON is parsed, checked and bounded, then rendered with a fixed layout: goal, decisions made, facts learned, open items, actions taken (one compact line per side-effect call), and the originals' archive ids per turn.
- **Applying blocks** (`apply.ts`): each ready block whose stretch is still in the request, unchanged (checked by a content key), replaces it. It is applied after the GC, failing open to the GC result.
  - Side-effect calls and their results stay unchanged and in order right after the block (your choice), so tool pairing and role alternation stay valid in OpenAI, Anthropic and Gemini formats.
  - Without side effects, a short continue note follows the block.
  - The stored block is reused byte for byte.
  - `parsim_recall` is offered when a block is present, and every original is stored in `archived_item`, so it can be recalled.
- **Background job on pg-boss** (`src/jobs`, your choice): pg-boss 11.1.2 (12 is ESM-only, which Jest cannot load) in the app's own Postgres, schema `pgboss`, with its own small pool.
  - Queue `compression-summarize`: one pending summary per session.
  - Retries with backoff for network errors, 429, 5xx and invalid summaries; other errors mark the compression `failed` with a short reason, never content.
- **Summarizer** (`summarizer.ts`): one non-streamed JSON call to Gemini native, OpenAI chat or Anthropic Messages, with usage read by the existing helpers.
  - By default it uses Parsim's internal model (`PARSIM_INTERNAL_PROVIDER`, `PARSIM_INTERNAL_MODEL` and that provider's key).
  - Or the project's own stored key with `compressionModel`.
- **Project settings** (your choice: on mode only, opt-in): `compressionEnabled` (default false), `compressionKeySource` (`parsim` or `project`), `compressionModel`.
- **Cost and savings**:
  - Each summary is a `usage_record` with `kind = 'compression'` and its cost.
  - `gc_run.compressionSavedTokens` records what blocks removed, and `tokensAfter` is what was actually sent.
- **Dashboard API**:
  - Requests and tokens count proxied requests only.
  - The summary adds `compression` (summaries, tokens saved, cost) and `netDollarsSaved`.
  - Daily entries add `compressionCostUsd`.
  - The session detail lists compressions, with the block only when the project stores content.
  - Settings return the compression options.

### Frontend

- Overview: dollars saved are net of the summary cost, with "net of $X for N summaries" under them.
- Settings: a Compression card with the on/off switch, who pays, and the summary model when the project pays.
- Session detail: a Compressions tab with status, turns, tokens before and after, summary cost, and the state block when content is stored.

## Files changed

### Backend

- `src/compression/`: `stretch.ts`, `state-block.ts`, `apply.ts`, `summary-prompt.ts`, `summarizer.ts`, `compression.service.ts`, `compression.module.ts`, `config/`, with `compression.spec.ts` and `summarizer.spec.ts`
- `src/compressions/`: domain, entity, mapper, repository (`compression` table)
- `src/jobs/`: `jobs.service.ts`, `jobs.module.ts` (pg-boss)
- `src/proxy/proxy-gc.service.ts`, `proxy.service.ts`, `proxy.module.ts`, `proxy-gc.service.spec.ts`
- `src/projects/` (compression settings), `src/usage-records/` (kind), `src/gc-runs/` (compressionSavedTokens)
- `src/dashboard/dashboard.service.ts`, `dashboard.types.ts`
- `src/database/migrations/1792000663627-AddCompressions.ts`
- `test/compression/compression.e2e-spec.ts`, `test/live/compression.live-spec.ts`
- `docs/compression.md`, `docs/dashboard.md`, `docs/recall.md`, `docs/readme.md`
- `.env.example`, `.env.test.example`, `package.json` (pg-boss)

### Frontend

- `src/lib/parsim/types.ts`, `format.ts`, `format.test.ts`
- `src/features/overview/components/overview-view.tsx`
- `src/features/settings/` (form, values, service), `src/features/parsim.test.ts`
- `src/features/sessions/components/session-detail.tsx`

### Other

- `docs/progress/step-14-compression.md`, `docs/progress/README.md`

## Tests

- **Unit** (`compression.spec.ts`, `summarizer.spec.ts`, `proxy-gc.service.spec.ts`):
  - stretch detection on the fixtures (short, support, research, long sessions), keys, open calls and system messages, and the "worth it" rule;
  - summary parsing and bounds, and the exact state block layout;
  - the invariants with compression on, in all three formats: system prompt and goal unchanged, side-effect calls and results present and byte-identical, every call paired with its result, the same bytes on every request, and working on top of the GC;
  - the summarizer for each provider with retryable and final errors;
  - the proxy queuing one summary per session, sending originals until a block is ready and then the block, and failing open.
- **E2E** (`compression.e2e-spec.ts`), with a second fake upstream as the internal model:
  - a long session triggers a job;
  - before the job finishes the originals are sent; after it, the state block, byte-identical on the next request;
  - archived originals of compressed turns are recalled through `parsim_recall`;
  - the summary is a `compression` usage record with its cost, and the dashboard reports net savings;
  - a failed summary keeps the originals;
  - no summary is paid for when the GC already shrank the stretch, or in shadow mode.
- **Live** (`LIVE_TESTS=true`): one real summary of the research fixture's first stretch with `gemini-3.8-flash` on the free-tier key (synthetic data). The first three tries got 503 "high demand" from Google; a later run passed. The stretch was turns 1 to 37 and 23,683 tokens, the call used 26,527 input and 670 output tokens, and the block is 2,289 tokens. I checked it against the fixture: every figure is right, and the revision-2 values it leaves out are in the protected tail. It is saved as the example in `backend/docs/compression.md`.
- Last runs:
  - `npm test`: 482 passed (34 suites);
  - `npm run test:e2e`: 212 passed (15 suites);
  - compression e2e after the last change: 7 passed;
  - frontend `bun run test`: 50 passed, lint and typecheck clean.

### Extra token reduction on each fixture

Context tokens with the default GC (`save_note` as a side-effect tool) and a realistically sized summary:

| Fixture | Tokens | After GC | GC + compression | Extra |
| --- | --- | --- | --- | --- |
| short-chat | 107 | 107 | 107 | 0 (no stretch) |
| support-agent-session | 1,647 | 1,647 | 1,647 | 0 (no stretch) |
| research-agent-session | 27,301 | 7,061 | 7,061 | 0 (under 6,000 as sent) |
| long session, 60 rounds | 35,750 | 7,826 | 7,826 | 0 (under 6,000 as sent) |
| long session, 120 rounds | 76,320 | 10,378 | 10,378 | 0 (under 6,000 as sent) |
| long session, 200 rounds | 125,639 | 13,813 | 13,813 | 0 (not worth it: 9,220 sent, block estimate 4,883) |

Where the GC has not acted yet (compression alone):
- research: 27,301 to 5,397 tokens (80.2%);
- 60 rounds: 35,750 to 6,264 (82.5%);
- 120 rounds: 76,320 to 8,552 (88.8%);
- 200 rounds: 125,639 to 9,375 (92.5%).

## Decisions and trade-offs

- **Measured as sent, and only when worth it.** At first a block on the 120-round fixture added 1,873 tokens, because the GC had already shrunk that stretch to stubs while the block listed every original id (repeated ones too) and keeps the side-effect calls. Each id is now listed once. So stretches are measured after GC, and a summary is paid for only if the block would at least halve the stretch. On our fixtures, which repeat their tool output, the GC alone already removes 74% to 89%, and compression declines. It pays off on long sessions with unique content the GC cannot drop.
- **Side effects kept in place** (your choice): the action log is both in the block as compact lines and unchanged after it, so the invariants hold exactly.
- **Blocks after GC, keys on the original request:** the same message indices, and a changed stretch never gets an old block.
- **One pending summary per session**, and a failed stretch is not retried under the same key (a later, longer stretch gets a new one).
- **pg-boss 11 with its own pool:** TypeORM's `query()` reshapes `UPDATE ... RETURNING` results, which pg-boss relies on. Version 12 is ESM-only.
- **Worker off in the test env** except in the compression suite, so no other suite can send a summary to a real key.
- **Negative savings are recorded as they are**, not hidden.

## How to verify

```bash
cd backend
npm run migration:run
npm run lint
npx tsc --noEmit
npm test
npm run test:e2e
npx jest src/compression
npx env-cmd -f .env.test -- jest --config ./test/jest-e2e.json --runInBand test/compression
npm run test:live -- compression
cd ../frontend
bun run lint
bun run typecheck
bun run test
```

In the dashboard:
1. Open Settings, turn compression on for a project in On mode, and save.
2. Run a long session through the proxy.
3. Open the session page and its Compressions tab.

## Known issues and next steps

- One full e2e run had 3 failures: the dashboard request count (3 instead of 4) and the compression tokens saved (0). In both, the newest row was missing from a dashboard query right after it was written. It happened while other test jobs ran at the same time. The two suites passed on their own, and a full rerun passed 212/212. Most likely a timing race around the dashboard's default end of range (`to = now`); worth a closer look.
- The free-tier Gemini model often answers 503 under load; summaries retry with backoff, and a real deployment should use a paid key.
- The fixtures show no extra reduction on top of the default GC. A fixture with long, unique tool output (no duplicates) would show compression's value next to the GC; worth adding for benchmarks.
- The state block lists one archive id per original message, which costs about 10 tokens per message on very long stretches.
- A stretch that failed is not retried until the session grows. There is no manual retry from the dashboard yet.
- Summaries use the first user message as the goal. A goal changed later by the user is only visible through the transcript.
