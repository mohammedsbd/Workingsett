# Step 15: Replay to prove quality held

## Goal

Show that the GC keeps answer quality: replay recorded agent sessions with and without the GC'd context against the same model, compare the answers, and report agreement and cost, within a hard budget.

## What was built

### Backend

- **Request snapshots** (your choice): content storage keeps each message's canonical content, but not tool call ids, tool definitions or request parameters, so it cannot rebuild a request exactly.
  - When a project stores content, the proxy now also stores each request after the response: as received and, when the GC changed it, as the GC made it. In on mode that is what was forwarded (state blocks included); in shadow mode, what would have been sent.
  - Bodies are split into an envelope (everything but the messages) and the messages, stored once per project by SHA-256 as JSON text (`snapshot_part`), with the list of hashes per request (`request_snapshot`). A long session stores each message once.
  - Writing a snapshot never affects the request.
- **Replay of one request point** (`src/replay/replay-runner.ts`):
  - the original, then the GC'd request, with the recorded model, not streamed, at temperature 0 where supported;
  - it retries without the temperature if the model rejects it, and Anthropic extended thinking keeps its temperature;
  - the GC'd version gets `parsim_recall` and has its recall calls answered, as in the proxy.
- **Comparison**:
  - exact match (text and tool calls);
  - same tool calls with the same arguments (argument key order and parallel call order ignored);
  - an LLM judge score from 1 to 5 with a short reason, only when the answers differ.
  - A point agrees when identical or scored at 4 or above (`REPLAY_JUDGE_PASS_SCORE`).
- **Judge**: Parsim's internal model (`REPLAY_JUDGE_MODEL` or `PARSIM_INTERNAL_MODEL`, Gemini Flash by default). A project can pay for it with its own key and model instead (`replayJudgeKeySource`, `replayJudgeModel`; your choice, default Parsim). The replay calls themselves always use the project's stored provider key.
- **Cost estimate and hard budget**:
  - The estimate prices both versions (input tokens and the recorded output) and one judge call per point.
  - Before every call, the budget checks the most that call can cost (input plus its output limit). If that could pass the budget, the call never starts and the replay stops as `budget_exceeded`.
  - Defaults (your choice): $1 budget, 5 points (the requests the GC changed, spread over the session), at most $25 and 20 points.
- **Jobs**:
  - pg-boss queue `replay-run`, never retried on its own (replays spend money);
  - statuses `queued`, `running`, `completed`, `budget_exceeded` and `failed`, with progress and spend after each point;
  - every call is a usage record with kind `replay` or `replay_judge`, outside the dashboard's proxy totals.
- **API** under `/api/v1/projects/:id/sessions/:id/replays`:
  - `options`: points, defaults, and why a session cannot be replayed;
  - `estimate`: sends nothing upstream;
  - start, list, and the report.
  - The report hides answers and judge reasons once the project stops storing content.
  - The settings endpoint returns the judge settings and budget limits.
- **CLI**: `npm run replay:fixtures -- --model <model>`:
  - plays each fixture as a session through the GC engine and replays the points the GC changed against OpenAI or Gemini's OpenAI-compatible endpoint, with the same runner, budget and judge;
  - shows the estimate and asks before sending (`--dry-run`, `--yes`, `--points`, `--budget`, `--fixtures`, `--out`);
  - needs no database.

### Frontend

- Session page, new Replay tab:
  - choose request points (the ones the GC changed are marked and selected by default) and the budget;
  - see the estimate per point and in total, with a warning when it is above the budget;
  - start a replay and follow its progress (polled while it runs);
  - the report shows the agreement rate, tokens and cost of both versions, replay cost against the budget, and each point's verdict with both answers side by side and the judge's reason.
- Settings: a Replay judge card to choose who pays for the judge.

## Files changed

### Backend

- `src/request-snapshots/` (service, body split and join, domain, persistence), `src/snapshot-parts/` (persistence)
- `src/replay/`: `replay-runner.ts`, `compare.ts`, `judge.ts`, `budget.ts`, `cost.ts`, `replay-request.ts`, `answer.ts`, `replay.service.ts`, `replay.controller.ts`, `replay.module.ts`, `replay.types.ts`, `dto/`, `config/`, `fixtures/fixture-replay.ts`, `cli/replay-fixtures.ts`, with `replay.spec.ts` and `fixtures/fixture-replay.spec.ts`
- `src/replays/`, `src/replay-results/` (persistence)
- `src/proxy/proxy.service.ts`, `proxy.module.ts`, `src/recall/recallable.ts`
- `src/projects/` (judge settings, `storesContent`), `src/usage-records/` (kinds), `src/utils/numeric-transformer.ts`
- `src/dashboard/dashboard.service.ts`, `dashboard.types.ts`, `src/compression/summarizer.ts`, `src/app.module.ts`, `src/config/config.type.ts`
- `src/database/migrations/1792054697560-AddReplays.ts`
- `test/replay/replay.e2e-spec.ts`, `test/replay/request-snapshots.e2e-spec.ts`, `test/live/replay.live-spec.ts`, `test/proxy/*` (no-content checks), `test/dashboard/dashboard.e2e-spec.ts`
- `docs/replay.md`, `docs/agent-sessions.md`, `docs/dashboard.md`, `docs/readme.md`
- `.env.example`, `.env.test.example`, `package.json` (`replay:fixtures`)

### Frontend

- `src/features/sessions/components/session-replay.tsx`, `session-detail.tsx`, `api/service.ts`, `api/queries.ts`
- `src/features/settings/` (form, values, service), `src/features/parsim.test.ts`
- `src/lib/parsim/types.ts`, `format.ts`, `format.test.ts`
- `docs/parsim-dashboard.md`

### Other

- `docs/progress/step-15-replay.md`, `docs/progress/README.md`

## Tests

- **Unit**:
  - `src/replay/replay.spec.ts` (38 tests):
    - answer extraction for OpenAI, Anthropic and Gemini;
    - tool-call equivalence (key order, call order, counts) and exact match;
    - verdicts and the agreement rate;
    - judge result parsing (code fences, string scores, out of range, invalid JSON, long reasons);
    - budget limit, cost estimate, unknown prices and point spreading;
    - replay requests (streaming off, temperature 0 per API, extended thinking, output limits, rejected temperature);
    - the runner with a fake port: identical answers skip the judge, the judge decides different answers, a failed judge leaves no verdict, recall in the GC'd version only, a temperature retry, a failed upstream call, and the budget stopping before a call.
  - `src/replay/fixtures/fixture-replay.spec.ts` (5 tests): fixture points are the GC-changed requests, deterministic and recallable; a replay against the in-process fake provider, and a budget stop with no call sent.
  - `src/request-snapshots/snapshot-body.spec.ts` (6 tests): byte-for-byte rebuild in all three formats, shared prefixes give the same hashes.
- **E2E**:
  - `test/replay/replay.e2e-spec.ts` (6 tests), with the fake upstream scripted to return identical and different answers and a second fake as the judge:
    - the report shows a 2/3 agreement rate, both versions' tokens and cost and the answers side by side;
    - every call used the project key at temperature 0, not streamed;
    - the GC'd version carried stubs and `parsim_recall`;
    - only differing points were judged;
    - a $0.20 budget stops a replay before its third call;
    - the estimate sends nothing;
    - answers are hidden once content storage is off;
    - refusals (no key, budget over the limit, unknown request) and another project's session.
  - `test/replay/request-snapshots.e2e-spec.ts` (4 tests): on and shadow mode snapshots rebuild exactly; nothing is stored without content storage; messages are deduplicated.
  - Dashboard: the replay judge settings.
- **Live** (`test/live/replay.live-spec.ts`): replays three points of the research fixture with Gemini Flash within $0.25. **Not run in this step**: you chose to skip live runs. It skips cleanly without `LIVE_TESTS=true`.
- **Checked in the browser**:
  - against a local fake provider (no real key used), a five-request session recorded through the dev proxy;
  - the Replay tab showed the defaults and estimate;
  - a four-point replay completed with 100% agreement and 63% fewer input tokens after GC;
  - a $0.05 replay stopped by its budget before any call.
  - The temporary project was then removed from the dev database.
- Last runs:
  - `npm test`: 531 passed (37 suites);
  - `npm run test:e2e`: 225 passed (17 suites);
  - frontend `bun run test`: 55 passed, lint and typecheck clean.

## Decisions and trade-offs

- **Snapshots instead of rebuilding from context items** (your choice): exact replays, tool definitions and call ids included, at the cost of a second copy of the content. Parts are shared across a session's requests, so storage grows with new messages, not with request count. Only sessions recorded from now on can be replayed.
- **The GC'd version is what the GC produced at the time**, not a fresh GC run, so a replay checks what the agent actually got (or would have got in shadow mode).
- **Both versions are replayed now** rather than comparing the GC'd answer with the recorded one: both face the same model on the same day, and temperature 0 keeps them as comparable as the provider allows. Replaying a point the GC did not change shows the model's own variation.
- **The judge only sees differing answers**, with the latest turn as context; identical answers cost nothing extra.
- **The budget reserves each call's worst case** (input plus output limit, 4,096 output tokens when the request sets none), so the limit holds even if a call costs more than expected. The trade-off is that a replay may stop with some budget left.
- **No automatic retry** of replay jobs, and an unknown model price refuses the replay, so spending is never open-ended.
- **The CLI uses the OpenAI format** for OpenAI and Gemini (the fixtures are OpenAI chat requests), and answers recall from the GC's own archive, so it needs no database.
- **The property generator** could not edit the customized projects service, so the two judge fields follow the compression fields by hand. The new entities were scaffolded with the generator and trimmed to persistence, as in earlier steps.

## How to verify

```bash
cd backend
npm run migration:run
npm run lint
npx tsc --noEmit
npm test
npm run test:e2e
npx jest src/replay src/request-snapshots
npx env-cmd -f .env.test -- jest --config ./test/jest-e2e.json --runInBand test/replay
npm run replay:fixtures -- --model gemini-3.8-flash --dry-run
cd ../frontend
bun run lint
bun run typecheck
bun run test
```

The dry run prints the estimate per point (about $0.12 for five research points with Gemini Flash) and sends nothing. To spend for real (live test or a CLI run without `--dry-run`), approve a budget first.

In the dashboard:
1. Turn content storage on for a project with a stored provider key, and run a session through the proxy.
2. Open the session page and its Replay tab.
3. Check the estimate and start a replay.

## Known issues and next steps

- The live replay was not run (no live budget approved). The fixture CLI was only run as a dry run.
- A replay interrupted by a server restart stays `running`; it should be marked failed on startup or resumed.
- Streamed requests are replayed without streaming.
- The estimate leaves out `parsim_recall` follow-ups; the budget check still covers them.
- The CLI supports OpenAI and Gemini, not Anthropic, since the fixtures are OpenAI chat requests.
- The judge sees only the latest turn as context. For tasks where the right next step depends on earlier turns, a longer excerpt may judge more fairly.
- Fixed since step 14: the flaky dashboard e2e failure listed in step 14's known issues (the newest row missing from a dashboard query) was fixed in `fix/dashboard-range-db-clock` (PR #19). Default ranges now end at the database clock, and `usage_record` range bounds are cast to its timestamp type.
