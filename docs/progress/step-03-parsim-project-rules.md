# Step 03: Parsim project rules

## Goal

Rename the product to Parsim and update the permanent rules so every future step follows the same architecture and ships real NestJS tests.

## What was built

- `CLAUDE.md` rewritten for Parsim:
  - product description: keep, compress, archive and drop, for OpenAI and Anthropic APIs
  - the build order: proxy, storage, GC engine, recall, cache stability, then shadow mode, dashboard and replay
  - GC invariants that must never break, each one requiring a test
  - testing rules: Jest unit tests with `@nestjs/testing`, e2e tests that boot the real app with `supertest` against a real Postgres test database and a fake upstream provider, and opt-in live tests behind `LIVE_TESTS=true`
  - step summaries now include test pass counts
- Root `README.md` renamed from ContextGC to Parsim.

## Files changed

Backend:
- None.

Frontend:
- None.

Other:
- `CLAUDE.md`, `README.md`, `docs/progress/README.md`, this file

## Tests

- No code changed, so no tests were added. The rules for tests apply from step 04.

## Decisions and trade-offs

- **Real database in e2e tests, fake LLM provider.** Postgres behavior (migrations, constraints, JSON columns) is part of what we ship, so it is tested for real. Real provider calls are slow, cost money and give different answers each run, so they are replaced by a local fake upstream and only run live when opted in.
- **Determinism tests are required.** Provider prompt caching only works if Parsim rewrites history the same way every time, so byte-identical output is treated as a correctness rule, not an optimization.
- **Fail open.** If the GC throws, Parsim forwards the original request. A bug in Parsim should cost savings, never break a customer's agent.

## How to verify

```bash
git log --oneline feat/step-02-remove-clerk-auth..feat/step-03-parsim-project-rules
```

Open `CLAUDE.md` and check the Architecture, GC invariants and Testing sections.

## Known issues and next steps

- The backend has no `.env.test` or `api_test` database yet. Step 04 should create them together with the first e2e test.
- Earlier progress notes still mention ContextGC. They are history and were left as written.
- This branch is based on step 02, which is based on step 01. Merge them in order.
- Next step: the proxy pass-through (OpenAI and Anthropic endpoints, streaming, usage recording) with unit and e2e tests.
