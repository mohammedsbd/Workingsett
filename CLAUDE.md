# ContextGC project rules

ContextGC is a garbage collector for the context of long-running, non-coding AI agents. It is an OpenAI-compatible proxy that keeps, compresses, externalizes or removes pieces of context on every request, forwards the smaller request upstream, and records tokens and dollars saved.

These rules are permanent and apply to every step.

## Codebase

- Never create new projects from scratch. Extend `frontend/` and `backend/` and follow their existing patterns:
  - backend (NestJS + TypeORM + PostgreSQL, relational setup): the boilerplate's module structure with `domain` / `infrastructure` / `persistence`.
  - frontend (Next.js + shadcn/ui): the existing layout, sidebar, data tables, cards and charts.
- No Docker, ever. No Dockerfiles, no docker-compose, no Docker commands in scripts, docs or instructions. Postgres runs as a local install or a hosted Postgres URL in `.env`.
- No Redis. Background jobs use pg-boss (Postgres-backed queue).
- Must work on Windows. Use `cross-env` in npm scripts that set env vars. No bash-only scripts.
- TypeScript strict. Avoid `any`.
- Secrets only from `.env`. Keep the `.env.example` files updated in both projects.
- Never log raw prompt or tool content at info level. Content logging only behind `DEBUG_CONTENT=true`.
- No em dashes in UI copy or docs.
- If a step conflicts with the existing code, explain and propose the smallest change. Ask before deleting large parts of either repo.
- Keep the original LICENSE files of `frontend/` and `backend/` (MIT requires keeping their copyright notices).

## Working in steps

- Work one step at a time. After each step: run lint, typecheck and tests, summarize what changed, list exact commands to verify, then stop and wait.
- Step summary (required at the end of EVERY step):
  1. Write `docs/progress/step-XX-<short-name>.md` (XX = step number) with these sections:
     - Goal: one or two sentences on what this step was for
     - What was built: features, entities, endpoints, pages, in plain language
     - Files changed: the main files added or modified, grouped by backend / frontend / other
     - Decisions and trade-offs: choices made and why
     - How to verify: exact commands to run and what should be seen
     - Known issues and next steps: anything unfinished, risky or worth revisiting
  2. Commit it as `docs(progress): add step XX summary`.
  3. Also print the same summary in chat, followed by the commit list.
  4. Keep `docs/progress/README.md` as an index: one line per step with its date, branch name and a one-sentence summary.

## Git workflow

- Never commit directly to `main`. Each step gets its own branch named `feat/step-XX-short-description` (`fix/...` for bug-fix work).
- Commit often: one logical change per commit (one entity, one endpoint, one rule, one test file, one page). A step should usually produce 5 to 15 commits.
- Only commit when lint, typecheck and the relevant tests pass. Never commit a broken build.
- Use Conventional Commits: `type(scope): summary`
  - types: feat, fix, refactor, test, docs, chore, build, ci, perf, style
  - scopes: backend, frontend, proxy, gc, recall, compaction, savings, replay, observability, dashboard, auth, db, demo-agent, docs, repo
  - summary: imperative mood, lower case, no period, max 72 characters
  - add a body when the reason is not obvious (why, not what)
  - examples:
    - `feat(gc): externalize stale tool results above token threshold`
    - `test(gc): prove byte-identical output for processed session prefix`
    - `feat(proxy): stream upstream SSE responses with usage capture`
    - `chore(repo): remove docker files and scripts from backend`
    - `docs(backend): add windows setup steps without docker`
- Never commit `.env` files, secrets, API keys, `node_modules`, `dist` or build output. Keep the root `.gitignore` covering these.
- No empty or artificial commits. Every commit must contain a real, meaningful change.
- At the end of each step: push the branch to `origin`, list the commits made (`git log --oneline main..HEAD`), and say the branch is ready to review. Do not merge to `main`.
