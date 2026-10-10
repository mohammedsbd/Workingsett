# Agent sessions and context storage

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Agent sessions](#agent-sessions)
  - [Limits of derived session ids](#limits-of-derived-session-ids)
- [Context items](#context-items)
- [The internal message model](#the-internal-message-model)
- [Token counts](#token-counts)
- [Content storage and privacy](#content-storage-and-privacy)
- [When storing happens](#when-storing-happens)
- [Tables](#tables)

## Overview

After every proxied generation request (`/v1/chat/completions` and `/v1/messages`), Parsim records which agent session the request belongs to and which pieces of context it contained. This is the data the garbage collector (step 10) works on. `count_tokens` requests are not recorded.

The code lives in `src/context` (hashing, the internal model, converters, token counting, session ids and the capture service) and the persistence modules `src/agent-sessions`, `src/context-items` and `src/context-contents`.

## Agent sessions

An agent session is one run of an agent: many requests that share a growing conversation. It is not the boilerplate's login session.

A request's session is identified by:

1. The `x-parsim-session-id` header, if the client sends one (1 to 200 printable ASCII characters). This is the reliable way and is recommended for every agent that can set a header. The header is never forwarded upstream.
2. Otherwise a derived id, `derived:<hash>`: a SHA-256 over the project's upstream, the model family (the model without a `models/` prefix or a dated snapshot suffix, so `gpt-4o-2024-08-06` and `gpt-4o` match), the system prompt and the first user message.

Sessions belong to a project: the same id in two projects is two sessions. Each session records its provider, the model of its latest request, when it was first and last seen, and how many requests it has had.

### Limits of derived session ids

A derived id assumes that one agent run keeps the same system prompt and first user message while it appends to the conversation. That is how most agents work, but:

- **Separate runs of the same task merge.** Two runs (or two parallel workers) with the same system prompt and first message are one session. Their items still dedupe correctly, but request counts and "first seen" numbers mix.
- **Changing the start splits a run.** If the system prompt contains something that changes between calls (a timestamp, a random id, retrieved documents) or the agent rewrites its first message, every call becomes a new session.
- **Agents that trim history break continuity.** When an agent drops its first user message to save space, its later calls get a new id.
- **Switching models splits a run.** A change of model family (for example from `gpt-4o` to `gpt-4o-mini` mid-run) starts a new session.
- **No first user message.** Requests without a user message hash only the system prompt, so all of them share one session per system prompt.

Send `x-parsim-session-id` to avoid all of these.

## Context items

A request is split into context items, in conversation order:

| Kind | What |
| --- | --- |
| `system` | The system prompt (Anthropic `system`, or an OpenAI `system` or `developer` message) |
| `user` / `assistant` | The plain content of a message: text, images, thinking and anything else |
| `tool_call` | One tool call (OpenAI `tool_calls[]` entry or Anthropic `tool_use` block) |
| `tool_result` | One tool result (OpenAI `tool` message or Anthropic `tool_result` block) |

An assistant message with text and two tool calls gives three items. Each item has a position (0-based), a role, its tool call id (for tool items), a content hash, a token count and the number of the session's request that first contained it.

The content hash is a SHA-256 of a canonical JSON form (keys sorted, no whitespace) of the item's provider-neutral content. It deliberately leaves out:

- `cache_control` markers, because clients move them between turns (Claude Code puts one on the newest message), so the same content keeps the same hash;
- tool call ids, so the same tool output under different call ids is recognized as the same content (the id is kept on the item).

On each request, items whose position and hash are already stored for the session are skipped; only new items are written. If a client rewrites earlier messages, the changed items are stored as new items at their positions.

## The internal message model

`src/context/normalization` defines one provider-neutral model (`InternalRequest`, messages made of text, image, tool call, tool result, thinking and other parts). Each adapter has a converter to and from it: `OpenAiChatConverter` (OpenAI and Gemini through its OpenAI-compatible endpoint) and `AnthropicMessagesConverter`.

- Converting a request to the model and back gives an identical request: the same keys, key order and values (`JSON.stringify` output is byte for byte the same). This is tested on all fixture conversations and on requests with images, audio, documents, thinking and tool use.
- Every part keeps the provider JSON it came from. Rebuilding starts from it and only writes the fields the model owns, so fields Parsim does not model are never lost, and edits to a part (what the GC will do) show up in the rebuilt request.
- Images are references: a URL, or the SHA-256, media type and size of inline base64 data. Image data itself is not copied into stored content.
- `cache_control` markers are kept on each part.

Gemini's native format is not supported yet (step 08 comes after step 10).

## Token counts

Each new item gets a token count, used by the GC to decide what is worth compressing. Billing numbers always come from the usage the provider reports.

| Upstream | How | `tokenizer` value |
| --- | --- | --- |
| OpenAI (known model) | js-tiktoken with the model's encoding, the same tokenizer OpenAI uses | `tiktoken:o200k_base` or `tiktoken:cl100k_base` |
| OpenAI (unknown model) | o200k_base, which all current OpenAI models use | `approx:o200k_base` |
| Anthropic, Gemini | o200k_base as an approximation | `approx:o200k_base` |

Notes on the approximation:

- Anthropic and Gemini do not publish their tokenizers. o200k_base is usually within about 10 to 20 percent for English text. Claude 4.7 and later use a newer tokenizer that produces about 30 percent more tokens for the same text, so counts for those models are low by roughly that much.
- Calling Anthropic's or Gemini's count-tokens endpoint for every item would be exact but costs a request each, adds load and needs the customer's key after the response. It was not used.
- Images count as a fixed 85 tokens (OpenAI's low-detail cost). Larger images cost more with every provider.
- Counts cover the item's text, tool names and arguments, not the few formatting tokens providers add per message.

## Content storage and privacy

- Item metadata (kind, position, hash, token count) is always stored.
- Content is stored in `context_content`, once per project per hash, only when the project stores content: the project's `storeContent` setting, or `PARSIM_STORE_CONTENT` when the project has not set it. `PARSIM_STORE_CONTENT` defaults to true outside production and false in production.
- Set it per project with `PATCH /api/v1/projects/:id` and `{"storeContent": false}` (or `null` to use the default).
- Content is never written to logs at info level. With `DEBUG_CONTENT=true`, the start of each new item is logged at debug level; never enable that in production.
- Usage records never contain content.

## When storing happens

Context is stored after the response has been sent to the client (for streams, after the stream ends), inside the same process. It adds no latency to the request, and if storing fails the request has already succeeded: the error is logged and the usage record is saved without a session link. On shutdown, the proxy waits for running requests to finish storing.

A pg-boss job queue was not used yet: storing runs after the response anyway, and a queue would need the request body (with content) in the database even for projects that do not store content. It can be added when storing gets heavier.

## Tables

| Table | Key columns |
| --- | --- |
| `agent_session` | `projectId`, `externalId` (unique per project), `idSource`, `provider`, `model`, `firstSeenAt`, `lastSeenAt`, `requestCount` |
| `context_item` | `agentSessionId`, `position`, `role`, `kind`, `toolCallId`, `contentHash`, `tokenCount`, `tokenizer`, `firstSeenRequest`; unique on session, position and hash |
| `context_content` | `projectId`, `hash` (unique per project), `content` (jsonb), `sizeBytes` |
| `usage_record` | new `agentSessionId` (null if storing failed) |
| `project` | new `storeContent` (null means the default) |

---

Previous: [Proxy](proxy.md)

Next: [Context GC](gc.md)
