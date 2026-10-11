# Context GC

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Modes](#modes)
- [Rules](#rules)
- [What is never touched](#what-is-never-touched)
- [Turns](#turns)
- [Stubs](#stubs)
- [Sticky rewrites and prompt caching](#sticky-rewrites-and-prompt-caching)
  - [Batched passes](#batched-passes)
  - [Anthropic cache_control markers](#anthropic-cache_control-markers)
  - [Gemini caching](#gemini-caching)
  - [Measured effect on caching](#measured-effect-on-caching)
- [Failing open](#failing-open)
- [Configuration](#configuration)
- [Tables](#tables)
- [Token reduction on the fixtures](#token-reduction-on-the-fixtures)

## Overview

On every generation request (`/v1/chat/completions` and `/v1/messages`), Parsim's garbage collector looks at the tool results in the conversation and decides whether to keep each one, drop it (a duplicate or superseded result) or archive it (store the original and leave a short stub). Everything else in the request is left alone.

The engine is a pure function, `runGc` in `src/gc/gc-engine.ts`: it takes the request in the internal message model, the config, a token counter and the decisions made by earlier requests of the session, and returns the new request plus a list of decisions (item, decision, reason, tokens before and after). Same input, same output, byte for byte. It knows nothing about providers: the converters in `src/context/normalization` turn OpenAI, Anthropic and Gemini native requests into the internal model and back.

`ProxyGcService` (`src/proxy/proxy-gc.service.ts`) runs the engine for the proxy and stores what it decided.

## Modes

Each project has a `gcMode`, set with `POST` or `PATCH /api/v1/projects`:

| Mode | What happens |
| --- | --- |
| `off` | No GC. |
| `shadow` (default) | The original request is forwarded. After the response, the GC runs on it and records its decisions and the tokens it would have saved. Adds no latency. |
| `on` | The GC runs before forwarding. Archived originals are stored, then the smaller request is sent. |

`count_tokens` requests are never changed.

## Rules

Rules apply to tool results only, in this order (the first match wins):

1. **Duplicate**: the same tool output (same content hash, which ignores tool call ids and `cache_control`) appears again later. The older copies are dropped; the most recent one is kept.
2. **Superseded**: the same tool was called again later with the same arguments (key order does not matter) and that later call got a successful answer. The older result is dropped.
3. **Stale and large**: the result is over `archiveMinTokens` (1,500) tokens and more than `archiveAfterTurns` (6) turns old. It is archived.

New decisions are made only when the whole context is over `minContextTokens` (8,000). A rewrite is only made if its stub is smaller than the original.

A dropped or archived result stays in place with its tool call id; only its content is replaced. Every tool call keeps exactly one answer, so the request stays valid for OpenAI, Anthropic and Gemini. In Gemini's format the function response keeps its name and its `response` becomes `{"output": "<stub>"}`.

## What is never touched

- The system prompt.
- The first user message (the agent's goal), and anything before the first assistant message.
- The last `protectedTurns` (6) turns.
- Tool calls with side effects and their results (the action log). A tool has side effects when its name is in `GC_SIDE_EFFECT_TOOLS`, or matches a pattern: `send_`, `create_`, `delete_`, `update_` (at the start of the name or after another word, so `gmail_send_email` matches), `pay` or `refund` (anywhere, so `process_payment` matches). Names are compared in snake case, so `sendEmail` counts as `send_email`. Over-matching only keeps more context.
- A tool result whose tool call is not in the request (Parsim cannot tell which tool made it).
- Assistant messages (the model's responses), user text, images and thinking blocks.

## Turns

A turn starts at each assistant message and includes the tool results and user messages that follow it, up to the next assistant message. The newest turn is 1 turn old. In agent loops each tool round is one turn.

## Stubs

| Decision | Stub |
| --- | --- |
| Archive | `[parsim archived: <tool name> result, <n> tokens, id <archive id>]` |
| Duplicate | `[parsim dropped: <tool name> result, duplicate of a later tool result]` |
| Superseded | `[parsim dropped: <tool name> result, superseded by a later <tool name> call with the same arguments]` |

The archive id is `arc_` plus the first 16 hex characters of the content hash, so the same content always gets the same id. The model can get the original back with the `parsim_recall` tool; see [Recall](recall.md).

If a block inside an Anthropic tool result carried a `cache_control` breakpoint, the stub carries it instead.

## Sticky rewrites and prompt caching

Providers cache the prompt prefix. To keep cache hits, once a tool result has been rewritten it is rewritten the same way (same stub, same archive id) in every later request of the session. Decisions are stored the first time they are made (`gc_decision`) and passed back to the engine on the next request, which reapplies them byte for byte, even below the token threshold. Decisions are only ever added, never changed or undone.

Items that were left alone can still be rewritten later, when they become duplicates or old enough. That changes the prefix from that point on, so it only happens in batched passes.

A stored decision is not reapplied if its item is now protected (for example after a tool was added to `GC_SIDE_EFFECT_TOOLS`): protection always wins.

### Batched passes

New decisions are made only in a **pass**. A pass runs when the context is above `GC_MIN_CONTEXT_TOKENS` (8,000) **and** the context added since the session's last pass is above `GC_BATCH_TOKENS` (4,000). Each session stores where its last pass ended (`agent_session.gcProcessedPosition`, the number of context items it saw).

Between passes, a request is only rewritten with the stored decisions. Since the client sends the same history plus new messages, every such request starts with the whole previous request, byte for byte, and the provider can serve all of it from its cache. A pass may rewrite older items that are now duplicates, superseded or old enough; from the first rewritten message on, the prefix changes once and is stable again afterwards.

If a client trims its history so that the session has fewer items than the stored position, the position is ignored and the next request is a pass.

### Anthropic cache_control markers

Parsim never adds, removes or moves a client's `cache_control` marker to another message:

- The system prompt, the first user message and the last turns (where Claude Code puts its moving marker) are never changed, markers included.
- A marker on a `tool_result` block that gets archived or dropped stays on that block. The block's content becomes the stub, which is byte-identical in every later request, so the marker still sits on stable content. The cached prefix up to that marker changes once, at the pass that rewrote the block, and is written to the cache again on that request.
- A marker on a block inside the tool result's content moves onto the stub that replaces that content (the same position in the message), for the same reason.

### Gemini caching

- **Implicit caching** depends on a stable prefix, which the rules above give Gemini as well. Gemini reports cached tokens in `usageMetadata.cachedContentTokenCount`, recorded as `cachedInputTokens`.
- **Explicit `cachedContent`** references pass through untouched. The cached contents live with Google and are never part of the request, so the GC cannot change them. Gemini rejects requests that set `systemInstruction` or `tools` next to a `cachedContent`, so Parsim cannot add `parsim_recall` to them. Without recall, archived content would be lost to the model, so for these requests the GC only drops duplicates and superseded results: nothing is archived and earlier archive decisions are not reapplied.

### Measured effect on caching

Offline, with a simple model of a provider prompt cache (a request's cached tokens are the leading messages it shares byte for byte with the session's previous request, an upper bound for both runs), replaying each session one request per agent turn with the OpenAI tokenizer:

| Session | Requests | GC | Passes | Input tokens | Cached | Uncached | Billed at 10% cache price | Billed at 50% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| research-agent-session | 43 | off | 0 | 625,657 | 595,366 | 30,291 | 89,828 | 327,974 |
| research-agent-session | 43 | on | 5 | 336,863 | 278,465 | 58,398 | 86,245 (-4%) | 197,631 (-40%) |
| support-agent-session | 22 | off | 0 | 31,749 | 29,138 | 2,611 | 5,525 | 17,180 |
| support-agent-session | 22 | on | 0 | 31,749 | 29,138 | 2,611 | 5,525 (same) | 17,180 (same) |
| long session (60 turns) | 60 | off | 0 | 1,223,125 | 1,183,151 | 39,974 | 158,289 | 631,550 |
| long session (60 turns) | 60 | on | 7 | 547,389 | 466,947 | 80,442 | 127,137 (-20%) | 313,916 (-50%) |
| long session (200 turns) | 200 | off | 0 | 13,961,450 | 13,821,581 | 139,869 | 1,522,027 | 7,050,660 |
| long session (200 turns) | 200 | on | 26 | 3,367,390 | 3,077,547 | 289,843 | 597,598 (-61%) | 1,828,617 (-74%) |

What this shows:

- **Cache hits are not the same.** Between passes every request is a full cache hit, as without the GC, but each pass invalidates the cache from the first rewritten message on. With the GC on, fewer tokens come from the cache and roughly twice as many are uncached.
- **The bill is still lower**, because far fewer tokens are sent at all: at Anthropic's and Gemini's 10% price for cached tokens, 4% lower on the 43-request fixture and 61% lower on the 200-request session. At OpenAI's 50%, 40% to 74% lower. The longer the session, the larger the gain.
- Larger batches mean fewer passes and fewer misses, but less pruning. At a 10% cache price, a 16,000-token batch billed 78,362 on the 43-request fixture (better than 4,000), 126,780 at 60 turns (about the same) and 607,719 at 200 turns (slightly worse); at a 50% cache price 4,000 was better everywhere. 4,000 stays the default.

## Failing open

If anything in the GC fails (an engine error, a body it cannot parse, or the archive not being stored), the original request is forwarded unchanged. The error is logged by its class name only (for example `GC failed, forwarding the original request project=... mode=on error=RangeError`), never with its message, which could contain content. The run is stored with `failed = true`.

## Configuration

Server defaults, in `.env` (empty means the built-in default). Each project can override the thresholds and add side-effect tools; see [Per-project GC settings](dashboard.md#per-project-gc-settings).

| Variable | Default | Meaning |
| --- | --- | --- |
| `GC_MIN_CONTEXT_TOKENS` | 8000 | New decisions only above this many context tokens |
| `GC_BATCH_TOKENS` | 4000 | ...and only when this many tokens were added since the session's last pass |
| `GC_PROTECTED_TURNS` | 6 | The last N turns are never changed |
| `GC_ARCHIVE_MIN_TOKENS` | 1500 | Tool results above this size can be archived |
| `GC_ARCHIVE_AFTER_TURNS` | 6 | ...once they are more than this many turns old |
| `GC_SIDE_EFFECT_TOOLS` | (none) | Comma-separated tool names with side effects |
| `GC_SIDE_EFFECT_PATTERNS` | (none) | Extra name patterns, added to the defaults |

Token counts use the same counter as context items (exact for OpenAI models, approximate for others).

## Tables

- `gc_run`: one row per evaluated request. Mode, whether a pass ran (`ran`), whether the GC'd request was forwarded (`applied`), whether it failed (and the error class), tokens before and after, how many rewrites were applied and how many were new, duration, and links to the agent session and usage record. In shadow mode, `tokensBefore - tokensAfter` is what the GC would have saved.
- `gc_decision`: one row per rewritten tool result per session, stored the first time: item key (tool call id and content hash), position, tool, decision, reason, detail (no content), tokens before and after, the stub, and the archive id.
- `archived_item`: the original of every archived tool result, per project and archive id, with its token count. Stored in on mode before the request is forwarded, whatever the project's `storeContent` setting, because archived content must stay recallable.

## Token reduction on the fixtures

Counted with the GC's own token counter. The OpenAI and Anthropic formats give the same numbers:

| Fixture | Config | Tokens before | After | Saved |
| --- | --- | --- | --- | --- |
| short-chat | defaults | 107 | 107 | 0% (below threshold) |
| support-agent-session | defaults | 1,647 | 1,647 | 0% (below threshold) |
| support-agent-session | threshold 0 | 1,647 | 1,107 | 32.8% (3 duplicate policy articles) |
| research-agent-session | defaults | 27,301 | 7,061 | 74.1% (16 duplicates, 12 superseded) |
| research-agent-session | archive above 500 tokens | 27,301 | 5,481 | 79.9% (plus 2 archived) |

The Gemini native format counts a little more, because each function response is a JSON object (`{"output": ...}`): research-agent-session 28,166 to 7,262 (74.2%) with the defaults and to 5,632 (80.0%) when archiving above 500 tokens; support-agent-session 1,725 to 1,173 (32.0%) with threshold 0. The decisions are the same.

---

Previous: [Agent sessions and context storage](agent-sessions.md)

Next: [Recall](recall.md)
