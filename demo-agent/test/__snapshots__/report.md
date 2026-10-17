# Benchmark: support agent, groq openai/gpt-oss-120b

> **Development run, not for publishing.** It used a free-tier model; costs are at the model's list price.

**Parsim on: 37.5% lower net cost, success 100.0% vs 100.0% for full context. Truncation: 62.5% lower net cost, success 66.7%.**

- Command: `npm run bench -- --agent support --runs 1 --provider groq --tasks 3`
- Model: groq `openai/gpt-oss-120b`; internal model (summaries): `openai/gpt-oss-120b`
- Parsim: backend 1.2.0, commit `abc1234`
- Run date: 2026-10-17T12:00:00.000Z to 2026-10-17T12:30:00.000Z
- Runs: 1; tasks: the first 3 of the support agent; tools replay recordings; temperature 0
- Baselines: last N = 6 turns kept; summary refreshed every M = 6 turns
- Prices (USD per 1M tokens): model input 0.15, cached input 0.075, output 0.6. Free tier: the run cost nothing; costs are at the list price, so arms can be compared.

## Results by arm

| Arm | Success | vs full | Input tokens | Output tokens | Cached | Raw cost | Net cost | Cache-adjusted | Net vs full | Recalls | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 100.0% ± 0.0% | - | 40,000 | 600 | 100 | $0.0400 | $0.0440 | $0.0360 | - | 0.0 | 12.0s |
| truncate | 66.7% ± 0.0% | single run | 15,000 | 600 | 100 | $0.0150 | $0.0165 | $0.0135 | 62.5% lower | 0.0 | 12.0s |
| summarize | 66.7% ± 0.0% | single run | 20,000 | 600 | 100 | $0.0200 | $0.0220 | $0.0180 | 50.0% lower | 0.0 | 12.0s |
| parsim-shadow | 100.0% ± 0.0% | single run | 40,000 | 600 | 100 | $0.0400 | $0.0440 | $0.0360 | 0.0% lower | 0.0 | 12.0s |
| parsim-on | 100.0% ± 0.0% | single run | 25,000 | 600 | 100 | $0.0250 | $0.0275 | $0.0225 | 37.5% lower | 0.0 | 12.0s |

## Success by task type

| Arm | normal | cross_ticket |
| --- | --- | --- |
| full | 100.0% (2 tasks) | 100.0% (1 task) |
| truncate | 100.0% (2 tasks) | 0.0% (1 task) |
| summarize | 100.0% (2 tasks) | 0.0% (1 task) |
| parsim-shadow | 100.0% (2 tasks) | 100.0% (1 task) |
| parsim-on | 100.0% (2 tasks) | 100.0% (1 task) |

## Latency

| Arm | p50 per step | p95 per step | Overhead vs full (p50 / p95) |
| --- | --- | --- | --- |
| full | 400 ms | 800 ms | - |
| truncate | 380 ms | 760 ms | - |
| summarize | 390 ms | 780 ms | - |
| parsim-shadow | 420 ms | 840 ms | 20 ms / 40 ms |
| parsim-on | 430 ms | 860 ms | 30 ms / 60 ms |

## Recalls

- parsim-shadow: 0.0 recalls per run; 0.0 brought back a fact the task needed
- parsim-on: 0.0 recalls per run; 0.0 brought back a fact the task needed

## Side-effect safety

Every arm's side-effect calls against the full arm in the same run: a call missing, made twice, made with a different value (status or answer), or extra.

| Arm | Missing | Duplicated | Changed | Extra |
| --- | --- | --- | --- | --- |
| truncate | 1 | 0 | 0 | 0 |
| summarize | 0 | 0 | 0 | 0 |
| parsim-shadow | 0 | 0 | 0 | 0 |
| parsim-on | 0 | 0 | 1 | 0 |

truncate:
- run 1: missing update_ticket for t02

parsim-on:
- run 1: changed update_ticket for t02 (refunded -> investigating)

## Method

- **Arms:** full context without Parsim; naive truncation (system prompt, first user goal and the last N turns); naive summarization (one internal-model summary of everything older than N turns, refreshed every M turns); Parsim in shadow mode; Parsim on. All arms run the same tasks with the same model, temperature 0 and the same tool recordings.
- **Success:** exact checks of each task's expected answer against the side-effect log (`save_report`, `update_ticket` and `send_reply`). With `--judge`, the internal model also grades each task against its checklist.
- **Significance:** One run: there is no run-to-run spread, so no difference can be called significant.
- **Cost:** raw prices every input token at the input price; net adds what Parsim sent upstream for recalls, Parsim's compression summaries and the summarize baseline's summaries; cache-adjusted prices cached input tokens at the cached input price.
- **Latency:** time per model call, as the agent saw it. Overhead is the Parsim arm's p50 and p95 minus the full arm's.

![Task success against net cost](2026-10-17-support-groq-openai-gpt-oss-120b.svg)

Raw numbers: [2026-10-17-support-groq-openai-gpt-oss-120b.json](2026-10-17-support-groq-openai-gpt-oss-120b.json)
