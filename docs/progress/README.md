# Progress index

One line per step: date, branch, summary.

- Step 01 (2026-10-02, `feat/step-01-project-rules-and-docker-removal`): added permanent project rules, root .gitignore and README, imported both upstream projects and removed Docker from both.
- Step 02 (2026-10-02, `feat/step-02-remove-clerk-auth`): removed Clerk from the frontend so the app opens straight on the dashboard with no sign-in.
- Step 03 (2026-10-03, `feat/step-03-parsim-project-rules`): renamed the product to Parsim and rewrote CLAUDE.md with the architecture, GC invariants and required NestJS unit and e2e tests.
- Step 01 recheck (2026-10-05, `feat/step-01-repo-setup`): checked the repo against the step 01 brief, added `.env.test` to the root gitignore and confirmed lint, typecheck and build pass in both projects.
- Step 04 (2026-10-05, `feat/step-04-parsim-dashboard-theme`): added the Parsim dark-first brand theme with GC decision colors, made it the default and renamed the app to Parsim.
- Step 05 (2026-10-05, `feat/step-05-backend-test-infrastructure`): made the backend PostgreSQL only, renamed the env example to .env.example with provider keys, and added the test database, in-process e2e tests, a fake upstream LLM server and fixture conversations.
- Step 06 (2026-10-06, `feat/step-06-proxy-openai`): added projects, hashed Parsim API keys, the OpenAI-format proxy forwarding to OpenAI or Gemini with streaming, and usage records with costs.
- Step 07 (2026-10-06, `feat/step-07-proxy-anthropic`): added the Anthropic Messages API (/v1/messages and count_tokens) on shared provider adapters, with cache-aware usage and Parsim-key-as-API-key support for tools like Claude Code.
- Step 09 (2026-10-08, `feat/step-09-agent-sessions`): added agent sessions, context items with canonical hashes, token counts and deduplicated content, and a lossless internal message model for the OpenAI and Anthropic formats (Gemini native postponed with step 08).
