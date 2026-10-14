# Compression

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [When it runs](#when-it-runs)
- [Finished stretches](#finished-stretches)
- [The state block](#the-state-block)
- [Applying a block](#applying-a-block)
- [The summary job](#the-summary-job)
- [Who pays](#who-pays)
- [Cost and savings](#cost-and-savings)
- [Configuration](#configuration)
- [Tables](#tables)
- [Extra token reduction on the fixtures](#extra-token-reduction-on-the-fixtures)
- [Example](#example)

## Overview

The GC removes duplicate and superseded tool results and archives large old ones. Compression goes further on long sessions: a finished stretch of the conversation (whole turns, well before the latest ones) is summarized in the background into a **state block**, and later requests send that block instead of those turns.

The block lists the goal, the decisions made, the facts learned and what is still open, plus one compact line per side-effect action and the archive id of every original message. The originals are stored, so the model can get any of them back with `parsim_recall` (see [Recall](recall.md)).

Requests never wait for a summary. Until a block is ready, the original turns are sent, after the usual GC.

The code is in `src/compression`: `stretch.ts` (detection), `state-block.ts` (parsing and layout), `apply.ts` (replacing a stretch), `summary-prompt.ts`, `summarizer.ts` (the model call) and `compression.service.ts` (enqueue, job, apply). The jobs run on pg-boss (`src/jobs`), in the app's own Postgres.

## When it runs

Only for projects with the GC in **on** mode and `compressionEnabled` set (off by default, since each summary is a paid model call). Never in shadow mode. It is set per project in the dashboard's Settings page or with `PATCH /api/v1/projects/:id`:

```json
{ "compressionEnabled": true, "compressionKeySource": "parsim", "compressionModel": null }
```

## Finished stretches

After each on-mode response, Parsim looks for the session's next finished stretch. The heuristics are simple on purpose:

- **Whole turns only.** A turn starts at an assistant message and includes the tool results and user messages after it.
- **Never the start or the end.** The system prompt and the first user goal come before the first turn and are never part of a stretch. Neither are the last N turns (the GC's protected turns, 6 by default).
- **After the previous block.** A stretch starts at the first assistant message after the session's last ready compression, so stretches never overlap. One summary per session is pending at a time.
- **No open tool calls.** Every call in the stretch has its result in it, and every result its call.
- **No system or developer messages inside.** They mark a change the client made on purpose.
- **Large enough, measured as sent.** At least `COMPRESSION_MIN_TOKENS` (6,000) tokens in the request as forwarded, after the GC.
- **Worth it.** The block (its lines for actions and original ids, plus 600 tokens for the summary) and the side-effect calls kept beside it must take at most half of the stretch as sent. When the GC has already shrunk a stretch to stubs, a block would add tokens, so no summary is paid for.

A stretch is identified by its message range and the content hashes of its items (`stretchKey`). If the client later sends different content there, the key no longer matches and the block is not used.

## The state block

The summarizer returns JSON (`goal`, `decisions`, `facts`, `openItems`). Parsim checks it, trims and bounds it (30 items of 600 characters at most per list) and renders the block with a fixed layout:

```text
[parsim state block: turns 1 to 34 were compressed. Call parsim_recall with an id from Originals to see an original message.]
Goal: ...
Decisions made:
- ...
Facts learned:
- ...
Open items:
- ...
Actions taken (their calls and results follow this block, unchanged):
- save_note({"title":"..."}) -> {"ok":true,...}
Originals:
- turn 1: arc_1a2b3c4d5e6f7a8b, arc_...
- turn 2: arc_...
[end of parsim state block]
```

The rendered block is stored once and sent byte for byte on every later request, so the prompt prefix stays cacheable (see [cache stability](gc.md#sticky-rewrites-and-prompt-caching)).

## Applying a block

Before forwarding, after the GC, every ready block whose stretch is still in the request, unchanged, replaces that stretch:

1. An assistant message holding the block text, followed by every side-effect tool call of the stretch, unchanged.
2. Their results, unchanged: the original tool messages (OpenAI format) or one user message with the original result parts (Anthropic, Gemini).
3. Without side effects, a short user note (`[parsim] Turns X to Y are summarized in the state block above. Continue the task.`) follows the block instead, so roles still alternate.

So the invariants hold with compression on: the system prompt, the first goal and the protected turns are never changed, side-effect calls and their results are never dropped (they are in the block as lines and in place unchanged), every tool call still has its result, and the output is deterministic. When a block is present, `parsim_recall` is added to the request like it is for archive stubs.

If loading or applying blocks fails, the GC'd request is forwarded without them and the error is logged by class name.

## The summary job

The job (queue `compression-summarize`):

1. Builds the prompt: the goal, then the stretch as a transcript (each message clipped to 12,000 characters).
2. Calls the summarizer (one non-streamed call, JSON output, temperature 0 where the API allows it).
3. Records a `usage_record` with `kind = 'compression'` and its cost (even if the answer turns out invalid, since it was paid for).
4. Parses the summary, stores each original message in `archived_item` under its archive id, renders the block and marks the compression ready.

Network errors, timeouts, 429, 5xx and invalid summaries are retried (`COMPRESSION_RETRY_LIMIT`, with backoff). Other errors, and the last retry, mark the compression `failed` with a short reason (never content). The input of a pending job (the stretch's canonical content) is cleared when it is ready.

## Who pays

- `compressionKeySource: "parsim"` (default): Parsim's internal model, `PARSIM_INTERNAL_PROVIDER` and `PARSIM_INTERNAL_MODEL`, with that provider's key from `.env` (`GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).
- `compressionKeySource: "project"`: the project's stored provider key and upstream, with `compressionModel`. Without both, summaries fail.

Never point the internal model at a free-tier key for real customer traffic.

## Cost and savings

`gc_run.compressionSavedTokens` records the tokens the blocks removed on each request, and `gc_run.tokensAfter` is what was actually sent. The dashboard summary reports, next to the GC savings:

- `compression`: the number of summaries, the tokens they saved, and what they cost;
- `netDollarsSaved`: applied dollars saved minus the summary cost.

Request counts and token totals count proxied requests only (`kind = 'proxy'`); summaries are reported apart. The daily series has `compressionCostUsd`, and the session page lists its compressions (with the block when the project stores content).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPRESSION_MIN_TOKENS` | 6000 | A stretch is summarized only above this many tokens, as sent |
| `COMPRESSION_WORKER` | true | Run the summary worker in this process (false in the test env, except the compression e2e suite) |
| `COMPRESSION_POLL_SECONDS` | 2 | How often the worker looks for jobs |
| `COMPRESSION_RETRY_LIMIT` | 2 | Retries before a summary is marked failed |
| `PARSIM_INTERNAL_PROVIDER` | gemini | gemini, openai or anthropic |
| `PARSIM_INTERNAL_MODEL` | (empty) | The internal model; summaries fail without it |
| `PARSIM_INTERNAL_BASE_URL` | (empty) | Overrides the provider's base URL (tests point it at a fake) |

## Tables

- `compression`: one row per stretch and session (`stretchKey` is unique per session): range, turns, status (`pending`, `ready`, `failed`), the job input while pending, the state block, tokens before and after, the usage record of the summary, and the error.
- `usage_record.kind`: `proxy` or `compression`.
- `gc_run.compressionSavedTokens`.
- pg-boss keeps its own tables in the `pgboss` schema.

## Extra token reduction on the fixtures

Tokens of the context (OpenAI format, `gpt-4o` encoding), with the default GC settings and `save_note` as a side-effect tool, and a summary of realistic size (5 decisions, 10 facts, 3 open items):

| Fixture | Messages | Tokens | After GC | GC + compression | Extra |
| --- | --- | --- | --- | --- | --- |
| short-chat | 7 | 107 | 107 | 107 | 0 (no stretch) |
| support-agent-session | 45 | 1,647 | 1,647 | 1,647 | 0 (no stretch) |
| research-agent-session | 117 | 27,301 | 7,061 | 7,061 | 0 (under 6,000 as sent) |
| long session, 60 rounds | 160 | 35,750 | 7,826 | 7,826 | 0 (under 6,000 as sent) |
| long session, 120 rounds | 324 | 76,320 | 10,378 | 10,378 | 0 (under 6,000 as sent) |
| long session, 200 rounds | 536 | 125,639 | 13,813 | 13,813 | 0 (not worth it: 9,220 sent, block estimate 11,647) |

These fixtures repeat their tool output, so the GC alone removes 74% to 89% and leaves little for a summary; compression correctly declines. Before the "worth it" rule, a block on the 120-round session added 1,873 tokens.

Where the GC has made no decisions yet (for example below `GC_MIN_CONTEXT_TOKENS`, or with content that has no duplicates), the block does the work:

| Fixture | Tokens | Compression alone | Reduction |
| --- | --- | --- | --- |
| research-agent-session | 27,301 | 6,268 | 77.0% |
| long session, 60 rounds | 35,750 | 7,628 | 78.7% |
| long session, 200 rounds | 125,639 | 16,139 | 87.2% |

## Example

The opt-in live test (`npm run test:live`, file `test/live/compression.live-spec.ts`) summarizes the research fixture's first finished stretch with the internal model and writes the result to a temp file to check by hand.

---

Previous: [Recall](recall.md)

Next: [Dashboard API](dashboard.md)
