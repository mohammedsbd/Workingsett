# Recall

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [The tool and the system line](#the-tool-and-the-system-line)
- [The recall loop](#the-recall-loop)
- [Mixed calls](#mixed-calls)
- [The loop limit](#the-loop-limit)
- [Streaming](#streaming)
- [Usage and records](#usage-and-records)
- [Failing open](#failing-open)
- [Configuration](#configuration)

## Overview

In GC `on` mode, large old tool results are archived and replaced by a stub such as `[parsim archived: fetch_page result, 912 tokens, id arc_0123456789abcdef]` (see [Context GC](gc.md)). Recall lets the model get the original back: Parsim adds a `parsim_recall` tool to the request, and when the model calls it, Parsim answers the call itself and continues the conversation upstream. The client only ever sees the final answer, never `parsim_recall`.

The format-specific parts live in `src/recall` (one module each for OpenAI, Anthropic and Gemini native). The loop runs in `ProxyService.forwardWithRecall`, and `RecallService` reads archives and records recalls.

## The tool and the system line

Recall is only added when the forwarded request contains at least one archive stub. Dropped duplicates and superseded results have no stub to recall: their content is still in the conversation.

| Format | Tool | System line |
| --- | --- | --- |
| OpenAI | appended to `tools` as a function | a `system` message right after the client's leading system and developer messages |
| Anthropic | appended to `tools` | a text block after the client's system blocks (their `cache_control` breakpoints stay where they are), or appended to a string system prompt |
| Gemini native | added to the client's first `functionDeclarations` list, or a new tool when there is none | a part appended to `systemInstruction` |

The client's own tools are never changed or reordered. The tool takes one argument, `archive_id`. The system line is a constant:

> Some earlier tool results were archived to save space and replaced by stubs like [parsim archived: <tool> result, <n> tokens, id <archive id>]. If you need one, call parsim_recall with its archive id to get the full result.

Because the tool and the line are always the same, every request of a session that has stubs carries byte-identical additions, so provider prompt caching keeps working. The first request with a stub changes the prefix once.

## The recall loop

1. The request (with the tool) goes upstream.
2. If the response contains `parsim_recall` calls, Parsim looks up each archive id in the project's `archived_item` table. Projects can only recall their own archives.
3. Parsim sends a follow-up request: the previous request, plus the model's turn and one tool result per recall, holding the archived original as text.
4. This repeats until a response has no `parsim_recall` call. That response goes to the client.

An unknown archive id gets the tool result `Archive id <id> was not found. Continue without it.` instead of an error.

## Mixed calls

If the model calls `parsim_recall` and the client's tools in the same response, Parsim cannot run the client's tools. The follow-up then keeps only the recall calls (and the turn's text and thinking) and drops the client tool calls. The model sees the recalled content and calls the client's tools again if it still needs them, and that response goes to the client.

## The loop limit

At most `PARSIM_RECALL_MAX_PER_REQUEST` (default 3) recalls are answered per client request. A recall over the limit gets the tool result "The recall limit for this request was reached. Answer with the information you have.", and that follow-up turns tool use off (`tool_choice: "none"` for OpenAI, `{"type":"none"}` for Anthropic, `functionCallingConfig.mode: "NONE"` for Gemini). The model then has to answer, so the client always gets a real response, and the loop ends.

A request makes at most `limit + 2` upstream calls.

## Streaming

Streamed requests are supported, with these trade-offs:

- **Text streams as it arrives.** Tool calls are held from the first tool call event until the response ends, because any of them may be `parsim_recall`. Without a recall, the held events are then sent unchanged. Clients therefore receive tool calls at the end of the response, all at once, instead of incrementally. Text is never delayed.
- **Follow-ups are spliced into the client's stream**, so it sees one response:
  - OpenAI: follow-up chunks get the first response's `id`.
  - Anthropic: the follow-up's `message_start` is dropped and content block indexes continue after the blocks already sent.
  - Gemini: chunks pass through unchanged.
- **The first response's ending is dropped** when it recalled (its `message_delta`, `message_stop` or `[DONE]`); the client gets the final response's ending. Text the model wrote before calling `parsim_recall` (for example "Let me check.") stays in the client's stream, followed by the final answer.
- **A follow-up that fails** after the stream started cannot change the HTTP status any more. The stream is ended and the usage record gets the upstream status.
- **Gemini streams without `alt=sse`** (a single JSON array) are not inspected for recalls.
- **Usage in streams:** the client sees the usage of the final response only. Parsim records the sum.

## Usage and records

- `usage_record` stays one row per client request. Its tokens and cost are summed over all upstream calls, and `upstreamCalls` says how many there were (1 without recalls).
- `recall` gets one row per recall call: project, agent session, usage record, archive id, whether it was found, whether it was refused by the limit, and the tokens restored (the archived item's token count). Content is never stored there or logged.

## Failing open

- If adding the tool fails, the request is forwarded without it.
- If an archive cannot be read, the model is told it was not found.
- `PARSIM_RECALL_MAX_PER_REQUEST=0` turns recall off: archive stubs are still sent, but no tool is added.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PARSIM_RECALL_MAX_PER_REQUEST` | 3 | Most recalls answered per client request; 0 turns recall off |

---

Previous: [Context GC](gc.md)

Next: [Compression](compression.md)
