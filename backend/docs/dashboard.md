# Dashboard API

## Table of Contents <!-- omit in toc -->

- [Overview](#overview)
- [Endpoints](#endpoints)
- [Savings](#savings)
- [Content](#content)
- [Per-project GC settings](#per-project-gc-settings)
- [Demo data](#demo-data)

## Overview

Read-only endpoints for the Parsim dashboard, in `src/dashboard`. They need the user's JWT and are scoped to the user's own projects: any other project id is a 404, exactly like a project that does not exist. Writes go through the existing endpoints (`PATCH /api/v1/projects/:id` for settings, `/api/v1/projects/:id/api-keys` for keys).

## Endpoints

All paths start with `/api/v1/projects/:projectId`.

| Endpoint | What it returns |
| --- | --- |
| `GET dashboard/summary?from&to` | Requests, input, output and cached tokens, cost, upstream calls, GC runs with tokens before and after and the reduction, savings (applied and estimated), recalls, and decisions by reason |
| `GET dashboard/daily?from&to` | One entry per UTC day of the range with requests, cost, tokens before and after, and savings |
| `GET sessions?page&limit&sort&order&search` | Agent sessions, paged (limit up to 100), sortable by `lastSeenAt` (default), `firstSeenAt`, `requestCount` or `tokensSaved`, searchable by session id or model (wildcards are literal) |
| `GET sessions/:sessionId` | The session, its requests with their GC run, its decisions with reasons, and its recalls |
| `GET settings` | GC mode, content storage, each threshold with the project's value and the server default, side-effect tools (project, server and patterns), and the recall limit |

`from` and `to` are ISO 8601 dates; `to` is exclusive. The default range is the 30 days before now, and a range can be at most 366 days.

## Savings

Every GC run stores the context tokens before and after the GC. Savings are `tokensBefore - tokensAfter`, summed per run:

- **Applied**: runs in `on` mode, where the smaller request was forwarded.
- **Estimated**: runs in `shadow` mode, where the original was forwarded. The dashboard labels these as estimates.

Dollars saved price the saved tokens at the model's input price from [config/model-prices.json](../config/model-prices.json). Cached-token discounts are not subtracted, so this is the list-price value of the tokens removed.

## Content

No endpoint returns prompt or tool content, except the session detail, and only when the project stores content (`storeContent`, or `PARSIM_STORE_CONTENT` when the project does not set it). There, each decision includes the original tool result from `context_content` (or `null` when it was not stored), and `contentAllowed` says whether content may be shown. Stubs (`[parsim dropped: ...]`) are Parsim's own text and are always returned.

## Per-project GC settings

Projects can override the GC thresholds from `.env` with `PATCH /api/v1/projects/:id`:

| Field | Overrides | Minimum |
| --- | --- | --- |
| `gcMinContextTokens` | `GC_MIN_CONTEXT_TOKENS` | 0 |
| `gcBatchTokens` | `GC_BATCH_TOKENS` | 0 |
| `gcProtectedTurns` | `GC_PROTECTED_TURNS` | 1 |
| `gcArchiveMinTokens` | `GC_ARCHIVE_MIN_TOKENS` | 0 |
| `gcArchiveAfterTurns` | `GC_ARCHIVE_AFTER_TURNS` | 1 |
| `gcSideEffectTools` | added to `GC_SIDE_EFFECT_TOOLS` | up to 100 names |

`null` (the default) uses the server value. Side-effect tools are added to the server list and the default patterns, never replace them, so a project can only protect more.

## Demo data

```bash
npm run seed:demo
```

This creates two projects for the seeded admin with 30 days of fake traffic and no prompt content: "Demo research agent" (Gemini, GC on, with recalls) and "Demo support agent" (OpenAI, shadow mode). Running it again replaces them. It refuses to run with `NODE_ENV=production`, and needs `npm run seed:run:relational` first.

---

Previous: [Recall](recall.md)

Next: [Serialization](serialization.md)
