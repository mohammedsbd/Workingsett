# Replay

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [What is recorded](#what-is-recorded)
- [Replaying a request point](#replaying-a-request-point)
- [Comparing the answers](#comparing-the-answers)
- [Cost estimate and budget](#cost-estimate-and-budget)
- [Who pays](#who-pays)
- [Jobs](#jobs)
- [API](#api)
- [Fixture replays from the command line](#fixture-replays-from-the-command-line)
- [Configuration](#configuration)
- [Tables](#tables)
- [Limits](#limits)

## Overview

Replay checks that the GC kept quality: it sends a recorded request again twice, once as the client sent it and once as the GC made it, with the same model, and compares the two answers. The report gives the agreement rate, the differences side by side, and the tokens and cost of both versions.

There are two ways to run it:

- From the dashboard, on a recorded agent session (a session page's Replay tab). This needs content storage.
- From the command line on the fixture conversations: `npm run replay:fixtures -- --model <model>`. No database is needed.

The code is in `src/replay`: `replay-runner.ts` (one request point), `compare.ts`, `judge.ts`, `budget.ts`, `cost.ts`, `replay-request.ts`, `answer.ts`, `replay.service.ts` (estimate, job, report), `replay.controller.ts`, and `fixtures/` and `cli/` for the fixture replays. Recording is in `src/request-snapshots`.

## What is recorded

Content storage only keeps each message's canonical content, without tool call ids, tool definitions or request parameters, so it cannot rebuild a request exactly. When a project stores content, the proxy therefore also stores a **request snapshot** after each response (`request_snapshot`, `snapshot_part`):

- the request as the client sent it;
- when the GC changed it, the request as the GC made it: as forwarded in on mode (state blocks included, before `parsim_recall` is added), or as it would have been sent in shadow mode.

Each request body is split into its envelope (every field, with the message list emptied in place) and its messages. Both are stored as JSON text, once per project, addressed by their SHA-256; the snapshot keeps the list of hashes. A session's requests repeat their earlier messages and usually their envelope, so a long session stores each message once. The text keeps the client's key order (jsonb would sort keys), so the rebuilt body is the same JSON.

Snapshots are written after the response and never affect the request; a failure is logged by class name. Sessions recorded before this step have no snapshots and cannot be replayed.

## Replaying a request point

For each chosen request (by its number in the session), the runner:

1. Rebuilds the original and the GC'd request. If the GC changed nothing, the original is sent twice (this measures the model's own variation).
2. Turns streaming off and sets temperature 0 (`generationConfig.temperature` for Gemini). Anthropic requests with extended thinking keep their temperature, which must be 1. If the model rejects the temperature (a 400 that mentions it), the request is sent again without it, and the report says so.
3. Sends the original, then the GC'd version, to the project's upstream through the proxy's own adapters, with the project's stored provider key and the recorded model.
4. For the GC'd version only, adds `parsim_recall` when it carries archive stubs or a state block, and answers recall calls from the archive like the proxy does (`PARSIM_RECALL_MAX_PER_REQUEST` per request).

Each call is a usage record with `kind = 'replay'` (and the judge's with `kind = 'replay_judge'`), so its cost is visible; the dashboard's savings and request counts only include proxied requests.

## Comparing the answers

Each answer is reduced to its text and its tool calls (name and parsed arguments). Thinking and `parsim_recall` calls are left out.

- **Exact match**: the same text (leading and trailing whitespace ignored) and the same tool calls.
- **Same tool calls**: the same calls with the same arguments. Argument key order and the order of parallel calls do not matter; each call counts as often as it appears. True when neither answer calls a tool.
- **Judge**: when the answers are not identical, an LLM judge sees the latest user message or tool result of the request and both answers, and returns `{"score": 1-5, "reason": "..."}` (5 equivalent, 4 minor differences, 3 acceptable, 2 a different decision or a missing fact, 1 wrong). Identical answers are not sent to the judge (score 5, "Identical answers.").

A point **agrees** when the answers are identical or the judge scores it at `REPLAY_JUDGE_PASS_SCORE` (4) or above. The **agreement rate** is agreeing points over points with a verdict; a point whose judge failed (unreadable answer, upstream error) has no verdict and is left out, and failed points are counted separately.

## Cost estimate and budget

Before a replay starts, the estimate prices, for each point:

- both versions: their input tokens (messages and tool definitions, counted like the GC) and the output tokens of the recorded response (`REPLAY_DEFAULT_OUTPUT_TOKENS` when unknown), at the recorded model's price;
- one judge call: about 900 tokens of instructions and context plus both answers in, 150 out, at the judge model's price.

The judge is skipped for identical answers, so the estimate is an upper estimate there; `parsim_recall` follow-ups are not included. A model without a price in `config/model-prices.json` cannot be replayed (400).

Each replay has a **hard budget** (`REPLAY_DEFAULT_BUDGET_USD`, at most `REPLAY_MAX_BUDGET_USD`). Before every call, upstream or judge, the runner checks the most that call can cost: its input tokens plus its output limit (the request's own `max_tokens`, `max_completion_tokens` or `maxOutputTokens`, else `REPLAY_OUTPUT_RESERVE_TOKENS`; 4096 for the judge). If that could take the spend above the budget, the call never starts and the replay ends as `budget_exceeded`, keeping the points already done. Actual costs are added after each call. A failed upstream call is counted as free; a successful one without usage counts as its maximum.

## Who pays

- The replay calls always use the **project's stored provider key** (customers pay for their own traffic). A project without a stored key cannot be replayed.
- The **judge** uses Parsim's internal model by default (`REPLAY_JUDGE_MODEL`, or `PARSIM_INTERNAL_MODEL`, through `PARSIM_INTERNAL_PROVIDER` and its key). A project can pay for it instead (`replayJudgeKeySource = 'project'` with `replayJudgeModel`), so its content never goes through Parsim's key. Set it in the dashboard's Settings page or with `PATCH /api/v1/projects/:id`.

## Jobs

Replays run on pg-boss (queue `replay-run`) in the app's Postgres. Starting a replay stores it as `queued` and sends a job; the worker (`REPLAY_WORKER`, on by default) marks it `running`, replays the points in order, stores each point's result and updates the progress and spend after each point, then ends as `completed`, `budget_exceeded` or `failed`. Replays spend money, so a failed job is never retried on its own.

## API

All under `/api/v1/projects/:projectId/sessions/:sessionId/replays`, for the project's owner (JWT); any other project or session is a 404.

| Method and path | What it does |
| --- | --- |
| `GET options` | The recorded requests (and whether the GC changed each), the default points and budget, the limits, the judge, and `blockedReason` when the session cannot be replayed. |
| `POST estimate` | The cost estimate for `{ requestNumbers?, budgetUsd? }`. Sends nothing upstream. |
| `POST /` | Starts a replay with the same body; returns it as `queued`. |
| `GET /` | The session's replays, newest first. |
| `GET :replayId` | Progress and the report: status, points done, spend, agreement, both versions' totals, and each point's comparison. The answers and the judge's reasons are only included while the project stores content. |

Without `requestNumbers`, up to `REPLAY_DEFAULT_POINTS` requests the GC changed are chosen, spread over the session (or any requests if the GC changed none).

## Fixture replays from the command line

```bash
npm run replay:fixtures -- --model gemini-3.8-flash --dry-run
npm run replay:fixtures -- --model gemini-3.8-flash --fixtures research-agent-session --points 3 --budget 0.25
```

Each fixture in `test/fixtures/conversations` is played as a session (request N holds the messages before the N-th assistant turn) through the GC engine with the server's GC settings, earlier decisions reapplied as in the proxy. The points the GC changed are replayed with `--model` on `--provider` (`gemini` through Gemini's OpenAI-compatible endpoint, or `openai`; default `PARSIM_INTERNAL_PROVIDER`) with the key from `.env`, and judged by the internal model. Recall is answered from the GC's own archive.

The command prints the estimate per point and asks before starting (`--yes` skips the question, `--dry-run` stops after the estimate). It then prints each point's verdict, the agreement rate, both versions' tokens and cost and the total spent; `--out report.json` also writes the report. The fixtures are synthetic, so nothing real goes through the key.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPLAY_WORKER` | `true` | Run the replay worker in this process (off in `.env.test`). |
| `REPLAY_POLL_SECONDS` | `2` | How often the worker looks for replays. |
| `REPLAY_DEFAULT_BUDGET_USD` | `1` | Budget when none is given. |
| `REPLAY_MAX_BUDGET_USD` | `25` | The largest budget allowed. |
| `REPLAY_DEFAULT_POINTS` | `5` | Points chosen when none are given. |
| `REPLAY_MAX_POINTS` | `20` | The most points in one replay. |
| `REPLAY_JUDGE_MODEL` | `PARSIM_INTERNAL_MODEL` | The judge model on Parsim's key. |
| `REPLAY_JUDGE_PASS_SCORE` | `4` | Judge scores at or above this agree. |
| `REPLAY_OUTPUT_RESERVE_TOKENS` | `4096` | Output reserved per call for the budget check when the request sets no limit. |
| `REPLAY_DEFAULT_OUTPUT_TOKENS` | `500` | Output assumed in the estimate when the recorded response has none. |

## Tables

- `request_snapshot`: one row per recorded request: session, request number, usage record, client API, model, whether it was streamed, and the envelope and message hashes of the original and (if changed) the GC'd request.
- `snapshot_part`: envelopes and messages as JSON text, unique per project and hash. Holds content, like `context_content`.
- `replay`: one row per replay: points, budget, estimate, spend, judge, status, progress and a short error (never content).
- `replay_result`: one row per replayed point: both versions (answer, tokens, cost, temperature, calls, recalls), exact match, same tool calls, judge score and reason, verdict.

## Limits

- Only sessions recorded while content storage was on can be replayed.
- Streamed requests are replayed without streaming; the answer content is the same, but stream-only behavior is not exercised.
- The original version is replayed now, not compared with the recorded response: both versions face the same model on the same day.
- Temperature 0 does not make every provider deterministic, so a few differences between identical contexts are normal; replaying a point the GC did not change shows that baseline.
- A replay interrupted by a server restart stays `running`; start a new one.
