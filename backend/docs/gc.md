# Context GC

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Modes](#modes)
- [Rules](#rules)
- [What is never touched](#what-is-never-touched)
- [Turns](#turns)
- [Stubs](#stubs)
- [Sticky rewrites and prompt caching](#sticky-rewrites-and-prompt-caching)
- [Failing open](#failing-open)
- [Configuration](#configuration)
- [Tables](#tables)
- [Token reduction on the fixtures](#token-reduction-on-the-fixtures)

## Overview

On every generation request (`/v1/chat/completions` and `/v1/messages`), Parsim's garbage collector looks at the tool results in the conversation and decides whether to keep each one, drop it (a duplicate or superseded result) or archive it (store the original and leave a short stub). Everything else in the request is left alone.

The engine is a pure function, `runGc` in `src/gc/gc-engine.ts`: it takes the request in the internal message model, the config, a token counter and the decisions made by earlier requests of the session, and returns the new request plus a list of decisions (item, decision, reason, tokens before and after). Same input, same output, byte for byte. It knows nothing about providers: the converters in `src/context/normalization` turn OpenAI and Anthropic requests into the internal model and back.

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

A dropped or archived result stays in place with its tool call id; only its content is replaced. Every tool call keeps exactly one answer, so the request stays valid for OpenAI and Anthropic.

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

The archive id is `arc_` plus the first 16 hex characters of the content hash, so the same content always gets the same id. Recall (step 11) fetches the original by this id.

If a block inside an Anthropic tool result carried a `cache_control` breakpoint, the stub carries it instead.

## Sticky rewrites and prompt caching

Providers cache the prompt prefix. To keep cache hits, once a tool result has been rewritten it is rewritten the same way (same stub, same archive id) in every later request of the session. Decisions are stored the first time they are made (`gc_decision`) and passed back to the engine on the next request, which reapplies them byte for byte, even below the token threshold. Decisions are only ever added, never changed or undone.

Items that were left alone can still be rewritten later, when they become duplicates or old enough. That changes the prefix from that point on. Step 12 limits how often this happens.

A stored decision is not reapplied if its item is now protected (for example after a tool was added to `GC_SIDE_EFFECT_TOOLS`): protection always wins.

## Failing open

If anything in the GC fails (an engine error, a body it cannot parse, or the archive not being stored), the original request is forwarded unchanged. The error is logged by its class name only (for example `GC failed, forwarding the original request project=... mode=on error=RangeError`), never with its message, which could contain content. The run is stored with `failed = true`.

## Configuration

Shared by every project, in `.env` (empty means the default):

| Variable | Default | Meaning |
| --- | --- | --- |
| `GC_MIN_CONTEXT_TOKENS` | 8000 | New decisions only above this many context tokens |
| `GC_PROTECTED_TURNS` | 6 | The last N turns are never changed |
| `GC_ARCHIVE_MIN_TOKENS` | 1500 | Tool results above this size can be archived |
| `GC_ARCHIVE_AFTER_TURNS` | 6 | ...once they are more than this many turns old |
| `GC_SIDE_EFFECT_TOOLS` | (none) | Comma-separated tool names with side effects |
| `GC_SIDE_EFFECT_PATTERNS` | (none) | Extra name patterns, added to the defaults |

Token counts use the same counter as context items (exact for OpenAI models, approximate for others).

## Tables

- `gc_run`: one row per evaluated request. Mode, whether the threshold was crossed (`ran`), whether the GC'd request was forwarded (`applied`), whether it failed (and the error class), tokens before and after, how many rewrites were applied and how many were new, duration, and links to the agent session and usage record. In shadow mode, `tokensBefore - tokensAfter` is what the GC would have saved.
- `gc_decision`: one row per rewritten tool result per session, stored the first time: item key (tool call id and content hash), position, tool, decision, reason, detail (no content), tokens before and after, the stub, and the archive id.
- `archived_item`: the original of every archived tool result, per project and archive id, with its token count. Stored in on mode before the request is forwarded, whatever the project's `storeContent` setting, because archived content must stay recallable.

## Token reduction on the fixtures

Counted with the GC's own token counter (OpenAI and Anthropic formats give the same numbers):

| Fixture | Config | Tokens before | After | Saved |
| --- | --- | --- | --- | --- |
| short-chat | defaults | 107 | 107 | 0% (below threshold) |
| support-agent-session | defaults | 1,647 | 1,647 | 0% (below threshold) |
| support-agent-session | threshold 0 | 1,647 | 1,107 | 32.8% (3 duplicate policy articles) |
| research-agent-session | defaults | 27,301 | 7,061 | 74.1% (16 duplicates, 12 superseded) |
| research-agent-session | archive above 500 tokens | 27,301 | 5,481 | 79.9% (plus 2 archived) |

---

Previous: [Agent sessions and context storage](agent-sessions.md)

Next: [Serialization](serialization.md)
