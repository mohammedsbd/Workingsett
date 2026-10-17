# Step 16a: Demo agents, free model support and recorded mode

## Goal

Build the long-running demo agents that the benchmark (step 16b) will measure Parsim with. Add free Groq support for development runs, and make tool results recordable so benchmark runs are repeatable and cheap.

## What was built

### Part A: free model support (Groq)

- **CLAUDE.md:** internal calls, the demo agent and the benchmark still default to Gemini Flash. They can use Groq or any other OpenAI-compatible provider configured in `.env`. Free tiers are for development only.
- **Internal model client:** a new `openai-compatible` provider for Parsim's own calls (compression summaries, the replay judge).
  - It uses the official openai SDK.
  - It is configured by `PARSIM_INTERNAL_PROVIDER=openai-compatible`, `PARSIM_INTERNAL_BASE_URL`, `PARSIM_INTERNAL_API_KEY` (empty uses `GROQ_API_KEY`), `PARSIM_INTERNAL_MODEL` and `PARSIM_INTERNAL_CONTEXT_TOKENS`.
  - One helper (`internal-target.ts`) now builds the targets of summaries and the replay judge, replacing three copies.
- **Proxy upstream:** projects can use the new `openai-compatible` upstream with their own `upstreamBaseUrl`, through the existing OpenAI adapter.
  - Custom base URLs are a server-side request forgery risk. A URL is allowed only with `PARSIM_ALLOW_CUSTOM_UPSTREAM=true` (development, ignored in production), or when it is https, has no credentials, and uses a host in `PARSIM_CUSTOM_UPSTREAM_HOSTS` (default `api.groq.com`).
  - The check runs when a project is saved (422) and again on every request (403 `custom_upstream_refused`), so removing a host takes effect at once. Replays and project-paid summaries check it too.
- **Context length guard:** a prompt estimated larger than the configured context window fails before it is sent, with a clear error (`ContextTooLargeError`). This covers Parsim's internal calls and the demo agent. The demo agent also has a per-request limit for free tiers, which reject any request above their tokens-per-minute limit.
- **Rate limits:** a 429 is retried after the wait the provider asks for (`Retry-After`, or Groq's "try again in 7m54s" text), with exponential backoff otherwise. A daily limit, or a wait longer than the retry window, stops with the time it can resume:
  - internal calls fail with `SummarizerQuotaError`, never retried;
  - the demo agent ends the run cleanly with exit code 2, keeping its side-effect log.
- **Frontend:** the project type knows the new upstream, and the setup page has an "OpenAI-compatible (Groq)" snippet.

### Part B: demo agents (`demo-agent/`)

- **Package:** TypeScript on Node with its own `package.json`, `.env.example` and gitignored `.env`.
  - It uses the official SDKs: openai for OpenAI and Groq, @google/genai for Gemini native, @anthropic-ai/sdk for Anthropic.
  - The base URL is configurable: straight to the provider, or through Parsim with `--via parsim`.
  - Gemini Flash is the default provider; model names always come from `.env`.
  - Assistant turns keep the provider's own content, so Gemini gets its thought signatures back.
- **Research agent:** 24 questions in one conversation, 112 planned steps. Tools: `web_search`, `fetch_page`, `take_note`, and the side-effect tool `save_report`.
- **Support agent:** 20 tickets in one conversation, under a written policy. Tools: `lookup_order`, plus the side-effect tools `update_ticket` and `send_reply`. Both are logged only and never act.
- **Synthetic worlds** (your choice):
  - Research: 24 invented storage sites, each with a site page, a news page and technology overviews, about 3,000 characters per page.
  - Support: 24 invented orders with verbose shipping histories.
  - Both come from fixed seeds, so a model cannot answer from training data and nothing real is involved.
- **Recorded mode** for every tool without side effects: record, replay (a missing recording fails loudly) and live.
  - Recordings live at `recordings/<agent>/<tool>/<hash>.json`, keyed by a hash of canonical arguments. A search maps to the site it is about, a URL to the page and its revision, an order id to the order, and unknown pages and orders to one "not found" recording.
  - All 115 recordings are committed (`npm run record` regenerates them), so runs need no network for tools.
- **Tasks that punish forgetting:** each task has an expected answer, an LLM-judge checklist, a planned step count and a type tag.
  - Research: 8 of 24 questions (33%) are late_recall. Each asks for the capacity a site page reported when first read, at least 60 planned steps earlier. Those pages are revised before the question, so re-reading them gives the wrong figure: only memory, or Parsim's recall of the archived original, has the answer.
  - Support: 4 of 20 tickets are cross_ticket. They need a gift card, phone number, gift note or order id that the customer gave only in an earlier ticket.
  - Answers are checked exactly from the side-effect log.
- **Side-effect log:** every side-effect call (tool, arguments, step, task) is written to `runs/<session id>/side-effects.jsonl`, for 16b to compare arms.
- **Context strategy hook:** every request is built through a `ContextStrategy`; the default is full context. Parsim is never a strategy: it is selected with `--via parsim`.
- **Session ids:** each task run sends a unique `x-parsim-session-id`.
- **CLI:** `npm run agent -- --agent research|support --task <id> --mode record|replay|live --provider <name> [--via direct|parsim]`.

## Files changed

### Backend

- `src/compression/rate-limit.ts`, `internal-target.ts`, `summarizer.ts`, `config/*`, `compression.service.ts`
- `src/proxy/custom-upstream.ts`, `providers/custom-openai.adapter.ts`, `providers/openai-compatible.adapter.ts`, `providers/provider-adapter.ts`, `proxy.service.ts`, `proxy-error.ts`, `proxy.module.ts`, `config/*`
- `src/projects/*` (`upstreamBaseUrl`, policy check), `src/database/migrations/1792258309646-AddProjectUpstreamBaseUrl.ts`
- `src/replay/replay.service.ts`, `src/replay/cli/replay-fixtures.ts`
- `test/proxy/openai-compatible-proxy.e2e-spec.ts`, `test/live/proxy.live-spec.ts`, `test/utils/proxy-helpers.ts`
- `.env.example`, `.env.test.example`, `package.json` (openai moved to dependencies)

### Frontend

- `src/lib/parsim/types.ts`, `src/features/setup/snippets.ts`, `src/features/parsim.test.ts`

### Demo agent (new)

- `src/llm/*` (SDK models, guard, rate limits), `src/world/*`, `src/tools/*`, `src/tasks/*`, `src/agent/*`, `src/cli/*`, `src/config.ts`
- `tasks/research.json`, `tasks/support.json`, `recordings/**`
- `test/*.test.ts`, `README.md`, `.env.example`

### Other

- `CLAUDE.md`, `README.md`, `docs/progress/*`

## Tests

- **Backend unit:**
  - rate limit parsing and retries (Retry-After seconds and dates, "try again in" text, daily detection, backoff, stopping);
  - the custom upstream policy (allowlist, https, credentials, schemes, SSRF targets such as 127.0.0.1 and 169.254.169.254);
  - internal and project targets;
  - the openai-compatible summarizer path (through the SDK, Retry-After, daily quota with resume time, context guard without a call, error mapping).
- **Backend e2e** (`openai-compatible-proxy.e2e-spec.ts`):
  - forwarding to the fake upstream at `{base URL}/chat/completions`, streamed and not, with usage recorded;
  - the Anthropic endpoint refused;
  - an error passing through;
  - without `PARSIM_ALLOW_CUSTOM_UPSTREAM`: local, non-allowlisted and missing URLs refused on save, the default Groq host accepted, a no-longer-allowed URL refused at request time without being called, and the base URL cleared when the upstream changes.
- **Live** (`LIVE_TESTS=true`): one real Groq call through the local proxy, streamed and not streamed. Both passed.
- **Demo agent unit (vitest, 39 tests):**
  - recorded mode (same arguments give the same recording, any wording of a search replays it, revisions are keyed, missing recordings fail loudly, every committed recording is present);
  - task loading and validation, including that every late_recall fact is scheduled at least 60 steps before its question;
  - the side-effect log;
  - the context guard;
  - 429 retry with Retry-After, and a daily quota stopping the run cleanly;
  - provider config and message conversion for Gemini and Anthropic;
  - the exact task checks.
- **Last runs:** backend `npm test`: 568 passed (40 suites); `npm run test:e2e`: 235 passed (18 suites); demo agent `npm test`: 39 passed; frontend `bun run test`: 55 passed.
- **Manual check:** support task T01 ran end to end on Groq (`openai/gpt-oss-120b`, free tier) through the local Parsim proxy, tools in replay mode. It passed (status and reply match) in 4 steps, 3 tool calls, 3,108 input and 387 output tokens and 3.8 seconds. Parsim recorded one session, identified by the header, with 4 requests, the same tokens and 4 shadow-mode GC runs.

## Decisions and trade-offs

- **Groq model:** `openai/gpt-oss-120b` (production, 131k context, tool calling; no parallel tool calls, which the agents do not need).
- **Synthetic tool data** (your choice): exact expected answers, deliberate late-recall placement, and no real web or search key.
- **Revised pages make late_recall real:** without them, an agent that forgot could simply re-read the page. With them, only memory gives the right answer, which is exactly what truncation loses and Parsim's recall keeps.
- **Recording keys are canonical arguments**, not raw ones. LLMs word queries differently every time, and raw keys would make replay mode fail constantly.
- **A run is one conversation**, so `--task q20` runs q01 to q20: later tasks depend on earlier ones.
- **Two retry modules:** the rate limit rules are duplicated between the backend and the demo agent, which are separate packages. Both are small and fully tested.
- **The custom upstream check runs on save and on every request**, so an allowlist change takes effect without touching stored projects.

## How to verify

```bash
cd backend && npm run migration:run && npm run lint && npx tsc --noEmit && npm test && npm run test:e2e
```

```bash
cd backend && npm run test:live -- proxy.live
```

```bash
cd demo-agent && npm install && npm run lint && npm test
```

```bash
cd demo-agent && npm run agent -- --agent support --task T01 --provider groq
```

```bash
cd frontend && bun run lint && bun run typecheck && bun run test
```

To run through Parsim:
1. Create an `openai-compatible` project with base URL `https://api.groq.com/openai/v1` and a Parsim key.
2. Set `PARSIM_API_KEY` in `demo-agent/.env`.
3. Add `--via parsim` to the agent command.

## Known issues and next steps

- **Groq free tier:** a request above the tokens-per-minute limit is rejected outright. The support agent fits, but the research agent with full context grows past it after a few questions. Set `GROQ_MAX_REQUEST_TOKENS` to stop cleanly before that. Full research runs need Gemini Flash or a paid tier.
- **No real-model research run yet:** only the support task was checked on a real model. A full research run, and the three-way comparison, come with the benchmark runner in 16b.
- **Exact checks only:** the LLM judge (from the task checklists) is added in 16b.
- **Rotate the Groq key:** it was pasted in chat; I recommend rotating it at console.groq.com.
