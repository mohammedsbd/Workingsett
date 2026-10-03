# Parsim build prompts

Paste these into Claude Code one at a time, from the repo root. `CLAUDE.md` is loaded automatically, so every prompt relies on its rules (branches, commits, tests, step summaries).

## How to use

1. Before each step, merge the previous step's branch into `main` (on GitHub, after reviewing it), then run `git checkout main && git pull`.
2. Paste the next prompt.
3. When Claude stops, read the step summary in `docs/progress/`, run the "How to verify" commands yourself, and review the branch.
4. Only then move on. If something is wrong, tell Claude in the same session before merging.

Steps 01 to 03 are already done (rules, Docker removal, Clerk removal, Parsim rules).

| Step | What it builds |
| --- | --- |
| 04 | Parsim dashboard theme |
| 05 | Backend cleanup and test infrastructure |
| 06 | Proxy: OpenAI pass-through with streaming and usage |
| 07 | Proxy: Anthropic pass-through |
| 08 | Agent sessions and context storage |
| 09 | GC engine v1 (drop and archive) with shadow mode |
| 10 | Recall of archived context |
| 11 | Prompt-cache stability |
| 12 | Dashboard: real Parsim pages |
| 13 | Compression with background summaries |
| 14 | Replay |
| 15 | Demo agent and benchmark |
| 16 | Developer integration (docs, llms.txt, CLI) |

---

## Step 04: Parsim dashboard theme

```text
Step 04: add a Parsim theme to the dashboard.

Follow CLAUDE.md. Branch: feat/step-04-parsim-dashboard-theme from main.

Goal
Add a "Parsim" theme to the frontend that matches the landing page at https://co-ui2.vercel.app/, and make it the default. Keep all existing themes (Claude, Vercel, Supabase and so on) in the theme switcher.

How themes work here (read first)
- frontend/docs/themes.md explains the theme system.
- Theme files: frontend/src/styles/themes/*.css using [data-theme='name'] and [data-theme='name'].dark
- Imported in frontend/src/styles/theme.css
- Registered in the THEMES array in frontend/src/components/themes/theme.config.ts
- DEFAULT_THEME is in theme.config.ts (docs/themes.md wrongly says active-theme.tsx; fix that line in the docs)
- Fonts: frontend/src/components/themes/font.config.ts
Copy the structure of an existing theme file (vercel.css or claude.css) so every token is defined.

Brand palette (from the landing page)
Accent:
- Primary #FF3B00 (orange-red): buttons, active nav item, focus rings, key highlights
- Secondary #FF7700 (orange): secondary highlights, glows
Dark surfaces, darkest first:
- #000000 page base, #0A0A0A, #0E0E0E sections, #141414 raised cards, #171717 cards and panels, #262626 borders and hover surfaces
Text, brightest first:
- #FFFFFF headings, #F5F5F5, #D4D4D4 body, #A1A1A1 secondary, #737373 labels, #525252 dim labels
- Text on orange buttons: #000000
Fonts:
- Poppins for headings and body (add with next/font/google)
- JetBrains Mono for numbers, labels, code and IDs (already loaded)

What to build
1. frontend/src/styles/themes/parsim.css in oklch like the other themes:
   - Dark mode is the main look: black and near-black backgrounds, #171717 cards, #262626 borders, #FF3B00 as --primary with black --primary-foreground, #FF3B00 as --ring, a matching dark sidebar with #FF3B00 as --sidebar-primary.
   - Light mode: a clean light version that keeps #FF3B00 as the accent, with readable contrast.
   - --destructive must be clearly different from the orange primary.
   - Sharp and minimal: small radius, very subtle shadows.
2. --chart-1 to --chart-5: distinguishable on dark backgrounds (also for colorblind users), starting with the brand orange. Example: #FF3B00, #FF7700, #FFC24D, #D4D4D4 and one soft cool color such as a muted blue.
3. Four semantic variables for GC decisions, used later in charts and badges: --gc-keep, --gc-compress, --gc-archive, --gc-drop. Each clearly distinct and readable in both modes. Suggestion: keep = neutral near-white, compress = #FF7700, archive = a muted cool color, drop = #FF3B00. Map them in the theme's inline mappings so they work as Tailwind classes.
4. Register "Parsim" first in THEMES and set DEFAULT_THEME = 'parsim'.
5. Make dark the default color mode (the layout uses defaultTheme='system'), still allowing light.
6. Optional, only if clean: a subtle orange radial glow in the top corner of the main content area, like the landing page.
7. Rename the visible app name to "Parsim" in the sidebar header, page titles and metadata.

Rules
- Do not change page layouts or components beyond what the theme needs.
- Do not remove other themes.

Checks
- bun run lint and bun run typecheck pass.
- Check overview, product, users and kanban pages in dark and light mode, plus the theme switcher. Aim for WCAG AA contrast (4.5:1 for normal text), including text on orange buttons.
- Save screenshots of the overview page in dark and light mode under docs/progress/screenshots/.

Finish with the step summary, push, and stop.
```

---

## Step 05: Backend cleanup and test infrastructure

```text
Step 05: prepare the backend for Parsim and set up the test infrastructure.

Follow CLAUDE.md. Branch: feat/step-05-backend-test-infrastructure from main.

Part A: cleanup (ask me before deleting anything not listed here)
1. Switch the backend to relational only (TypeORM + PostgreSQL). Remove MongoDB/Mongoose support: the document persistence folders, mongoose dependencies, env-example-document, the document seeds and the database switch in app.module.ts. The boilerplate's .install-scripts/remove-mongodb.ts shows exactly what belongs to Mongo; use it as the checklist (run it if it works non-interactively on Windows, otherwise do the same changes by hand). Then remove .install-scripts and the app:config script.
2. Rename env-example-relational to .env.example and update every reference (docs, README).
3. Remove WORKER_HOST (Redis) from .env.example and any code that reads it.
4. Port the bash generator test scripts (test/generators/run-static.sh, _matrix.sh) to Node, or remove them and their npm scripts if they no longer make sense after removing Mongo. Explain the choice.

Part B: test infrastructure
1. A separate test database: backend/.env.test (gitignored) and backend/.env.test.example (committed) pointing at a database named api_test. Add an npm script that creates and migrates the test database on Windows (Node script, no bash), e.g. npm run test:db:setup.
2. Make npm run test:e2e boot the app inside the test (Test.createTestingModule({ imports: [AppModule] }), app.init(), supertest), load .env.test via cross-env/env-cmd, run with --runInBand, and clean tables between tests. Keep the existing e2e tests working, converting them from calling a running server to the in-process app.
3. A reusable fake upstream LLM server for tests in backend/test/utils/fake-upstream.ts: an in-process HTTP server on a random port that
   - serves POST /v1/chat/completions (OpenAI format) and POST /v1/messages (Anthropic format)
   - returns canned JSON, or canned SSE streams when "stream": true
   - can be told to return an error status and body
   - records every request it received (headers and body) so tests can assert on them
4. Fixture conversations in backend/test/fixtures/conversations/: at least a short chat, a long research-agent session (100+ messages with repeated and large tool results), and a support-agent session with several tickets. Plain JSON in OpenAI message format. No real customer data.
5. A first unit test and a first e2e test that prove the setup works (for example, an e2e test that the fake upstream records a request, and the existing auth e2e tests running in-process).

Checks
- npm run lint, npx tsc --noEmit, npm test and npm run test:e2e all pass on Windows.
- The backend still starts with npm run start:dev and the seeded admin can log in.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 06: Proxy, OpenAI pass-through

```text
Step 06: build the proxy pass-through for the OpenAI API format.

Follow CLAUDE.md. Branch: feat/step-06-proxy-openai from main.

Note: the backend already has a "session" module for login sessions. Put all Parsim code under clearly named modules (for example src/proxy, src/projects, src/usage) and never reuse the word "session" for agent sessions without a prefix (use "agent session").

What to build
1. Projects and Parsim API keys
   - Entity Project (name, created by user) and ParsimApiKey (project, hashed key, prefix for display, created at, last used at, revoked at). Store only a hash of the key; show the full key once at creation.
   - Endpoints (JWT-protected, using the boilerplate's auth): create a project, list projects, create, list and revoke API keys.
2. Proxy endpoint POST /v1/chat/completions (no /api prefix, so SDKs work with baseURL https://host/v1)
   - Authenticate with the Parsim key from the header x-parsim-key, or from Authorization: Bearer when it starts with the Parsim key prefix. Missing or bad key: 401 in OpenAI error format.
   - The customer's own provider key is sent in a separate header, x-provider-key, or configured per project (encrypted at rest with a key from .env). Never log it.
   - Forward the body unchanged to the upstream base URL (config, default https://api.openai.com) and return the response unchanged.
   - Streaming: when "stream": true, pipe the SSE stream through as it arrives, without buffering the whole response. Ask upstream for usage in the stream (stream_options.include_usage) only if the client did not set stream_options, and do not send that extra usage chunk to the client unless it asked for it.
   - Upstream errors and timeouts pass through with the same status and body. Client disconnects cancel the upstream request.
3. Usage records
   - Entity UsageRecord: project, model, input tokens, output tokens, cached input tokens if reported, latency in ms, status, streamed yes/no, created at. No prompt or response content.
   - A model price table in config (a JSON file, editable, with a "last updated" note) used to compute cost. Unknown models get cost null, not a guess.
4. A dev-only option PARSIM_REQUIRE_KEY=false to skip the Parsim key on localhost, documented in .env.example.

Tests
- Unit: key hashing and verification, header parsing, cost calculation (including unknown models), stream usage extraction.
- E2E (fake upstream): non-streamed request is forwarded byte-for-byte and the response returned unchanged; streamed request arrives as a stream with chunks in order; upstream 400/429/500 pass through; missing and revoked keys get 401; a usage record is written with correct token counts and no content; the provider key is never present in logs or the database in plain text.
- Live (LIVE_TESTS=true only): one real call through the official openai npm SDK pointed at the running proxy.

Docs: add a "Use the proxy" section to backend/README.md with a curl example and an OpenAI SDK example.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 07: Proxy, Anthropic pass-through

```text
Step 07: add the Anthropic Messages API to the proxy.

Follow CLAUDE.md. Branch: feat/step-07-proxy-anthropic from main.

What to build
1. POST /v1/messages that forwards to the Anthropic API (config, default https://api.anthropic.com), reusing the auth, provider-key handling, streaming pipeline and usage recording from step 06. Refactor shared parts into provider adapters (one interface, an OpenAI adapter and an Anthropic adapter) instead of duplicating code.
2. Pass through Anthropic headers the client sends (anthropic-version, anthropic-beta). The provider key comes from x-api-key or x-provider-key.
3. Parsim key for Anthropic clients: also accept it in x-parsim-key. Document how to use it with tools that only let you set ANTHROPIC_BASE_URL (for example, a project-level setting that maps the Anthropic key to the project, or PARSIM_REQUIRE_KEY=false in dev). Explain the option you chose in the summary.
4. Streaming: Anthropic SSE events (message_start, content_block_delta, message_delta, message_stop) pass through unchanged; read usage from message_start and message_delta, including cache read and cache creation tokens.
5. POST /v1/messages/count_tokens passes through.

Tests
- Unit: Anthropic usage extraction from JSON and from streams, including cache tokens.
- E2E (fake upstream in Anthropic format): non-streamed and streamed requests, tool use blocks pass through, errors pass through, usage recorded with cache tokens.
- Live (LIVE_TESTS=true only): one real call with the official @anthropic-ai/sdk, and a documented manual check of running Claude Code with ANTHROPIC_BASE_URL pointed at the local proxy.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 08: Agent sessions and context storage

```text
Step 08: track agent sessions and store context items.

Follow CLAUDE.md. Branch: feat/step-08-agent-sessions from main.

What to build
1. Agent session identification
   - If the request has the header x-parsim-session-id, use it.
   - Otherwise derive a stable id from a hash of the provider, model family, system prompt and first user message. Document the limits of this.
2. Entities (all under the project)
   - AgentSession: external id, project, provider, model, first seen, last seen, request count.
   - ContextItem: agent session, position, role, kind (system, user, assistant, tool_call, tool_result), content hash (sha256 of a canonical JSON form), token count, first seen at request number. Store content in a separate ContextContent table keyed by hash, so identical content is stored once.
   - Link each UsageRecord to its agent session.
3. Normalization: one internal message model that both the OpenAI and Anthropic adapters convert to and from, without losing anything (tool calls, tool results, images as references, cache_control markers). Converting a request to the internal model and back must give an identical request.
4. Token counting with js-tiktoken for OpenAI models and a documented approximation for Anthropic models; the provider's reported usage stays the source of truth for billing numbers.
5. Storing happens after the response starts streaming (or in a pg-boss job) so it never adds latency to the request. If storing fails, the request still succeeds.
6. Content is stored only when the project setting "store content" is on (default on in dev). Respect DEBUG_CONTENT for logs.

Tests
- Unit: canonical hashing (key order does not change the hash), round-trip conversion for OpenAI and Anthropic messages including tool use (byte-identical), session id derivation, token counting.
- E2E: three sequential requests from the same fixture conversation create one agent session, the new items only, and deduplicated content; a request where storing fails still returns 200.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 09: GC engine v1 with shadow mode

```text
Step 09: build the GC engine v1 (drop and archive) and shadow mode.

Follow CLAUDE.md, especially the GC invariants. Branch: feat/step-09-gc-engine-v1 from main.

What to build
1. A pure GC module (src/gc) with no database or HTTP access: input = the normalized message list plus a config, output = the new message list plus a list of decisions (item, decision, reason, tokens before, tokens after).
2. Rules for v1:
   - Drop exact duplicate tool results (same hash), keeping the most recent.
   - Drop a tool result superseded by a later call to the same tool with the same arguments.
   - Archive tool results over a token threshold (default 1,500) that are more than K turns old (default 6), replacing them with a stub:
     [parsim archived: <tool name> result, <n> tokens, id <archive id>]
   - Never touch: the system prompt, the first user message, the last N turns (default 6), tool calls marked as side effects (config list of tool names, plus a default list of name patterns such as send_, create_, delete_, update_, pay, refund), and their results.
   - Keep tool_call and tool_result pairs valid for both providers: never leave a tool result without its call or the reverse.
3. Thresholds: only run when the request context is over a configurable size (default 8,000 tokens).
4. Fail open: any error inside the GC forwards the original request and logs the error without content.
5. Modes per project: off, shadow (default), on.
   - shadow: forward the original request, store the decisions and the "would have saved" token counts.
   - on: forward the GC'd request and store the archived originals so they can be recalled in step 10.
6. Record per request: tokens before GC, tokens after GC, and the decisions.

Tests (this is the core of the product, so be thorough)
- Table-driven unit tests over the fixture conversations, one per rule.
- One test per GC invariant, named after the invariant.
- Determinism: same input twice gives byte-identical output.
- Prefix stability: running the GC on a conversation, then on the same conversation with new messages appended, never changes the already-processed part.
- Tool pairing stays valid for OpenAI and Anthropic formats.
- Fail open: a rule that throws leads to the original request being forwarded.
- Coverage of src/gc at 90% lines or more.
- E2E: shadow mode forwards the request unchanged (fake upstream receives the original) and stores decisions; "on" mode forwards a smaller request, and the archived originals are stored.

Finish with the step summary (include test counts and the token reduction on each fixture), push, and stop.
```

---

## Step 10: Recall

```text
Step 10: let the model recall archived context.

Follow CLAUDE.md. Branch: feat/step-10-recall from main.

What to build
1. When a request in "on" mode contains archived stubs, add a tool named parsim_recall (input: archive id) to the request, in the right format for OpenAI and Anthropic, without breaking tools the client already sent. Add one short line to the system prompt explaining the stubs and the tool, written so it stays byte-identical across calls.
2. When the model responds with a parsim_recall call:
   - Parsim handles it itself: fetch the original from storage, send a follow-up request upstream with the tool result, and return that final response to the client.
   - The client never sees parsim_recall. If the model calls parsim_recall together with other tools in one response, resolve parsim_recall first and continue until the response contains only client tools or text.
   - Limit recalls per request (default 3) to avoid loops.
3. Streaming: support recall for streamed requests too. Buffer only while a parsim_recall call is being detected, then stream the follow-up response to the client. Document any trade-offs.
4. Record each recall (archive id, tokens restored) and count all upstream calls in usage.
5. If an archive id is missing, return a clear tool result saying it was not found instead of failing.

Tests
- Unit: tool injection for both formats keeps existing tools unchanged; stub detection; recall loop limit.
- E2E with the fake upstream scripted to call parsim_recall: the archived original is sent upstream in the follow-up request, the client receives only the final answer, usage counts both calls; the same for streaming; mixed parsim_recall and client tool calls; a missing archive id; the loop limit.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 11: Prompt-cache stability

```text
Step 11: keep provider prompt caching working with the GC on.

Follow CLAUDE.md. Branch: feat/step-11-cache-stability from main.

What to build
1. Store the GC decisions per agent session, so that once a message is rewritten, every later request in that session uses exactly the same rewritten version (byte-identical), even if the rules or thresholds would decide differently now.
2. Batch GC passes: only run a new pass when the unprocessed part of the context grows past a threshold (default 4,000 tokens), not on every request.
3. Anthropic cache_control markers: keep the client's markers valid. Never move a marker onto content that changes between calls. If a marker sits on content the GC archives, explain the chosen behavior.
4. Measure: record cached input tokens per request (from step 06/07 usage) and show in the step summary whether cache hits on the fixtures are the same with GC on as with GC off.

Tests
- Unit: replaying a 200-request fixture session through the GC gives a prefix that only changes at batch points, and never changes a processed message.
- E2E: two sequential requests from the same session with GC on send byte-identical prefixes upstream (assert on what the fake upstream received).
- Live (LIVE_TESTS=true only): a short real session against Anthropic with cache_control, comparing cache read tokens with GC off and on.

Finish with the step summary (include test counts and the cache comparison), push, and stop.
```

---

## Step 12: Dashboard with real Parsim pages

```text
Step 12: replace the starter's demo pages with real Parsim pages.

Follow CLAUDE.md. Branch: feat/step-12-dashboard from main.

Backend
- Read-only endpoints for the dashboard (JWT-protected, scoped to the user's projects): savings summary over a date range, savings over time (daily), agent sessions list (paged, sortable), one agent session's timeline (requests with tokens before and after, decisions by type, recalls), API keys and project settings (GC mode, thresholds, side-effect tool names, store content).
- Never return raw content unless the project allows content storage, and then only on the session detail endpoint.

Frontend (use the existing layout, data tables, cards and charts; Parsim theme from step 04)
1. Login page against the backend's existing JWT auth (/api/v1/auth/email/login), with the token stored securely and refreshed. The dashboard routes require login again.
2. Overview: tokens saved, dollars saved, percent reduction, requests, recalls; a savings-over-time chart; decisions by type using the --gc-* colors; a clear "Shadow mode: estimated savings" label when the project is in shadow mode.
3. Agent sessions: data table with search, sort and paging.
4. Session detail: a timeline of requests, and the decisions with their reasons. Show content only if allowed.
5. API keys: create (show the key once with a copy button), list, revoke.
6. Settings: GC mode (off, shadow, on) with a clear warning when switching to on, and the thresholds.
7. Setup page: the one-line integration snippets for OpenAI and Anthropic with the user's endpoint filled in.
8. Remove the starter's demo pages and mock data (product, kanban, chat and so on) and their nav items. Ask me first if any of them looks useful to keep.

Tests
- Backend unit and e2e tests for every new endpoint, including that one user cannot see another user's projects.
- Frontend: unit tests for the formatting and savings calculations (add Vitest if no test runner exists), lint and typecheck.
- Manually check every page in the browser with seeded data, in dark and light mode, and save screenshots under docs/progress/screenshots/.

Add a seed script that creates a demo project with realistic fake usage, so the dashboard has data to show.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 13: Compression with background summaries

```text
Step 13: compress finished stretches of a conversation into a state block.

Follow CLAUDE.md. Branch: feat/step-13-compression from main.

What to build
1. Detect finished stretches: a run of turns older than the protected tail, with no open tool calls, above a token size (default 6,000). Start with simple, documented heuristics.
2. Summarize them in a pg-boss background job with a cheap model (configurable provider and model, using the project's provider key or a Parsim key from .env). The summary is a structured state block: goal, decisions made, facts learned, open items, and the archive ids of the original messages so they stay recallable.
3. The next request in that session uses the state block in place of those turns. Requests never wait for a summary; until it is ready, the original turns are sent (archive and drop still apply).
4. Never compress the system prompt, the first goal, the protected tail, or side-effect actions and their results (keep the action log as compact lines in the state block AND unchanged where the invariants require).
5. Respect cache stability from step 11: a state block, once used, is reused byte-identical.
6. Record the summarization cost in usage, so savings are reported net of it.

Tests
- Unit: stretch detection on fixtures, the state block format, invariants still hold with compression on, savings net of summarization cost.
- E2E: a long fixture session triggers a job; before the job finishes the original turns are sent; after it finishes the state block is sent; archived originals of compressed turns are recallable.
- Live (LIVE_TESTS=true only): one real summary of a fixture stretch, checked by hand and saved as an example in docs.

Finish with the step summary (include test counts and the extra token reduction on each fixture), push, and stop.
```

---

## Step 14: Replay

```text
Step 14: build replay to prove quality held.

Follow CLAUDE.md. Branch: feat/step-14-replay from main.

What to build
1. Replay a recorded agent session (only when content storage is on): for chosen request points, send the request upstream twice, once with the original context and once with the GC'd context, using the same model and temperature 0 where supported.
2. Compare the two responses: exact match, same tool calls with the same arguments, and an LLM judge score (configurable model) with a short reason. Store the results.
3. Run replays as pg-boss jobs with a cost estimate shown before starting and a hard budget limit per replay.
4. Dashboard: start a replay from a session page, see progress, and see a report: agreement rate, differences side by side, tokens and cost for both versions.
5. CLI script to replay the fixture sessions: npm run replay:fixtures -- --model <model>.

Tests
- Unit: comparison logic (exact, tool-call equivalence, judge result parsing), budget limit, cost estimate.
- E2E with the fake upstream scripted to return identical and different answers: the report shows the right agreement rate; the budget stops a replay.
- Live (LIVE_TESTS=true only): replay one fixture session with a cheap model.

Finish with the step summary (include test counts), push, and stop.
```

---

## Step 15: Demo agent and benchmark

```text
Step 15: build a demo agent and a benchmark that measures Parsim honestly.

Follow CLAUDE.md. Branch: feat/step-15-demo-agent-benchmark from main.

What to build
1. A demo long-running agent in a new folder demo-agent/ (TypeScript, Node, Windows-friendly), using the official SDKs pointed at a configurable base URL:
   - a research agent that works through a list of questions over 100+ steps, using tools: web search (behind an interface, with a recorded/cached mode so benchmark runs are repeatable and cheap), fetch page, take note, and a side-effect tool "save_report"
   - a support agent that works through 20 scripted tickets with tools: look up order, update ticket, send reply (side effect, logged only)
2. Each task has a known expected answer or a checklist for an LLM judge.
3. A benchmark runner: npm run bench -- --agent research --runs 3 --model <model> that runs every task three ways: without Parsim, Parsim in shadow mode, Parsim on. It records task success, input and output tokens, cost, wall time and number of recalls.
4. Write the results to docs/benchmarks/<date>-<agent>-<model>.md with a table, the exact command, the model and the Parsim version. Report variance across runs. Never edit numbers by hand.

Tests
- Unit tests for the runner's metrics and the report generation.
- A dry-run mode with the fake upstream, used in CI, that runs the full pipeline without real calls.

Then run the benchmark once with a cheap real model (ask me before spending more than the budget I give you) and include the results in the step summary.

Finish with the step summary, push, and stop.
```

---

## Step 16: Developer integration

```text
Step 16: make Parsim very easy to integrate, including by coding agents.

Follow CLAUDE.md. Branch: feat/step-16-developer-integration from main.

What to build
1. docs/integration.md: setup for the OpenAI SDK (TypeScript and Python), the Anthropic SDK (TypeScript and Python), and tools configured by environment variables, plus how to set x-parsim-session-id and how to mark side-effect tools.
2. An AGENTS.md section and a public llms.txt (served by the backend at /llms.txt) written so a coding agent can add Parsim to a project from one instruction: what to change, where, and how to verify it worked.
3. A small CLI package in cli/ (npx parsim init) that detects whether a project uses the OpenAI or Anthropic SDK, shows the exact change, applies it only after confirmation, and writes the env variables to .env.example (never real keys).
4. A /v1/parsim/health endpoint and a "verify my setup" check in the dashboard setup page that shows the first request received from a new key.

Tests
- Unit tests for the CLI's project detection and the code changes it proposes, using sample projects in cli/test/fixtures.
- E2E for /llms.txt and the health endpoint.
- Manual check: in a fresh sample project, ask Claude Code "add Parsim to this project" with only llms.txt as guidance, and record whether it succeeded in the step summary.

Finish with the step summary (include test counts), push, and stop.
```

---

## Tips

- If Claude Code proposes a different approach than a prompt describes, let it explain why first. Accept changes that are smaller or safer.
- If a step gets too big, ask Claude to split it into two branches.
- Keep an eye on spending during live tests and the benchmark. Set a monthly limit with each provider.
