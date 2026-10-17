# Parsim demo agents

Two long-running agents for measuring Parsim honestly. They are TypeScript on Node (Windows-friendly), use the official SDKs (openai, @google/genai, @anthropic-ai/sdk), and can talk to a provider directly or through Parsim.

- **Research agent:** works through 24 questions about energy storage sites over about 112 steps, with web search, fetch page, take note and the side-effect tool `save_report`.
- **Support agent:** works through 20 tickets for an outdoor gear shop, with look up order and the side-effect tools `update_ticket` and `send_reply` (logged only: nothing is ever sent).

Everything the agents read is synthetic and invented (see [Worlds](#worlds)), so a model cannot answer from what it already knows, and no real data is involved.

## Setup

```bash
cd demo-agent
npm install
```

Copy `.env.example` to `.env` and fill in the provider you use. Model names are never hardcoded: set `GEMINI_MODEL`, `GROQ_MODEL`, `OPENAI_MODEL` or `ANTHROPIC_MODEL`.

## Run

```bash
npm run agent -- --agent support --task T03 --provider groq
```

| Option | Meaning |
| --- | --- |
| `--agent research\|support` | Which agent |
| `--task <id>` | Run the tasks up to and including this one (a run is one conversation, so later tasks need the earlier ones). Default: all |
| `--mode replay\|record\|live` | Tools: replay recordings (default), record new ones, or run live without saving |
| `--provider gemini\|groq\|openai\|anthropic` | Default `DEMO_PROVIDER`, else `gemini` |
| `--via direct\|parsim` | Straight to the provider (default), or through Parsim |
| `--max-steps <n>` | Most model calls per task (15) |

Each run prints one line per step (tool names only, no content), then a pass or fail per task, and writes `runs/<session id>/summary.json` and `runs/<session id>/side-effects.jsonl` (gitignored).

### Through Parsim

Set `PARSIM_BASE_URL` (for example `http://localhost:3001`) and `PARSIM_API_KEY`, and use `--via parsim`. The SDK's base URL points at Parsim, the Parsim key goes in `x-parsim-key`, and the provider key stays the SDK's API key, which Parsim forwards with. The project's upstream must match the provider. For Groq, create an `openai-compatible` project with base URL `https://api.groq.com/openai/v1` (allowed by default; see `PARSIM_CUSTOM_UPSTREAM_HOSTS` in `backend/.env.example`).

Every task run sends its own `x-parsim-session-id`, so Parsim keeps each run's context apart.

## Providers and free tiers

Gemini Flash is the default, and published benchmark numbers use a paid key. Groq's free tier (no card) is for development runs only; never send real customer data through a free-tier key.

The free tier has per-model limits on requests and tokens per minute and per day:

- **Per-minute limits** are retried after the wait the provider gives (`Retry-After`, or "try again in" in the error), with backoff otherwise.
- **A daily quota** stops the run cleanly, with the time it can resume. The run exits with code 2 and keeps what it did.
- **A request above the tokens-per-minute limit** is rejected outright by the free tier. Set `GROQ_MAX_REQUEST_TOKENS` to that limit and the agent stops before sending, with a clear message. The context window guard (`<PROVIDER>_CONTEXT_TOKENS`) works the same way.

In practice the support agent fits Groq's free tier, but the research agent with full context grows past a free-tier per-minute limit after a few questions. Use Gemini Flash, a paid tier, or Parsim (which keeps the context smaller) for full research runs.

## Recorded tools

Tools without side effects (web search, fetch page, look up order) run in one of three modes:

- **record:** run the real tool and save the result to `recordings/<agent>/<tool>/<hash>.json`
- **replay:** return the saved result; a missing recording fails loudly
- **live:** run the real tool and save nothing

The hash is of the tool's canonical arguments, so different wordings of the same request replay the same recording. A search is canonicalized to the site it is about, a URL to the page and its revision, and an order id to the order. Unknown pages and orders all map to one "not found" recording.

All recordings are committed, so benchmark runs need no network for tools. To regenerate them:

```bash
npm run record
```

## Worlds

- **Research** (`src/world/research-world.ts`): 24 fictional storage sites. Each has a site page (capacity, efficiency, commissioning year) and a news page (operator, cell supplier, region), and there is one overview page per technology. Pages are about 3,000 characters of mostly filler prose. The site pages of sites 1 to 8 are revised from question 17 on.
- **Support** (`src/world/support-world.ts`): 24 orders with items, totals, statuses (delayed, damaged, lost, delivered) and verbose shipping histories.

Both are generated from fixed seeds, so they never change between runs.

## Tasks

`tasks/research.json` and `tasks/support.json` are generated from the worlds (`npm run tasks:export`) and validated on load. Each task has a known expected answer, a checklist for an LLM judge, and a type:

- **normal:** answerable from what the agent reads for the task
- **late_recall** (research, 8 of 24 questions, 33%): the storage capacity a site page reported when the agent first read it, at least 60 planned steps earlier. That page has been revised since, so re-reading it gives the wrong figure: only the agent's memory (or Parsim's recall of the archived original) has the answer.
- **cross_ticket** (support, 4 of 20 tickets): needs a detail the same customer gave only in an earlier ticket (a gift card, a phone number, a gift note, an order id)

Answers are checked exactly from the side-effect log: `save_report` for research, `update_ticket` and `send_reply` for support.

## Side-effect log

Every side-effect call (tool, arguments, step, task) is kept in order and written to `runs/<session id>/side-effects.jsonl`, so the benchmark can compare runs and flag missing, duplicated or changed actions.

## Context strategies

The agent builds each request through a `ContextStrategy` (`src/agent/context-strategy.ts`). The default sends the full context. The benchmark adds naive truncation and naive summarization as baselines. Parsim is not a strategy: it is selected with `--via parsim`, with the full context, exactly as a customer's agent would use it.

## Tests

```bash
npm test
npm run lint
```

The tests use scripted models and never call a provider.
