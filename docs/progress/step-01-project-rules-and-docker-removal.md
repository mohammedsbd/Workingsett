# Step 01: project rules and Docker removal

## Goal

Set up the permanent project rules and repo basics, bring the two upstream projects into the repo, and remove Docker completely so everything runs natively on Windows.

## What was built

- `CLAUDE.md` at the repo root with the permanent rules: extend `backend/` and `frontend/` only, no Docker, no Redis (pg-boss), Windows first with `cross-env`, strict TypeScript, secrets only from `.env`, content logging only behind `DEBUG_CONTENT=true`, no em dashes, the per-step summary format and the git workflow.
- Root `.gitignore` (node_modules, dist, build, .next, coverage, .env, .env.local, *.log) and a short root `README.md`.
- The upstream projects moved from `Backend/nestjs-boilerplate` and `Frontend/next-shadcn-dashboard-starter` to `backend/` and `frontend/`, with their nested `.git` folders removed, and committed untouched as baseline imports.
- Docker removed from both projects: files, npm scripts, CI jobs, docs and agent instructions.

### Docker inventory (everything found and removed)

Backend:
- Dockerfiles: `Dockerfile`, `document.Dockerfile`, `document.e2e.Dockerfile`, `document.test.Dockerfile`, `relational.e2e.Dockerfile`, `relational.test.Dockerfile`, `maildev.Dockerfile`
- Compose files: `docker-compose.yaml`, `docker-compose.document.yaml`, `docker-compose.document.ci.yaml`, `docker-compose.document.test.yaml`, `docker-compose.relational.ci.yaml`, `docker-compose.relational.test.yaml`, `docker-compose.generators-relational.test.yaml`
- `.dockerignore`
- Container entrypoint scripts: `startup.relational.{dev,ci,test}.sh`, `startup.document.{dev,ci,test}.sh`, `wait-for-it.sh`, `test/generators/startup.relational.test.sh`
- Docker test orchestrators: `test/generators/run-crud-relational.sh`, `test/generators/run-crud-document.sh`
- npm scripts: `test:e2e:relational:docker`, `test:e2e:document:docker`, `test:e2e:generators:relational:docker`, `test:e2e:generators:document:docker`
- CI: `.github/workflows/docker-e2e.yml` (deleted), `crud-relational` and `crud-document` jobs in `.github/workflows/cli.yml` (removed)
- Install scripts (`.install-scripts/scripts/remove-{postgresql,mongodb,install-scripts}.ts`): references to the deleted Docker files, workflow and npm scripts
- Env examples: Docker service hostnames (`postgres`, `maildev`, `mongo`) replaced with `localhost`
- Docs: README badge and feature bullet, `docs/introduction.md`, `docs/installing-and-running.md` (Docker steps and "Quick run" sections), `docs/database.md` (MySQL compose section, Adminer), `docs/tests.md` ("Tests in Docker"), `docs/benchmarking.md` (`docker run jordi/ab`), `test/generators/README.md`

Frontend:
- `Dockerfile`, `Dockerfile.bun`, `.dockerignore`
- `scripts/cleanup.js`: entries that edited the Dockerfiles
- Docs: `docs/deployment.md` (Docker section), `AGENTS.md`, `CLAUDE.md`, `README.md`, `env.example.txt` comment
- Bundled agent skill `next-best-practices` (both `.claude/skills` and `.agents/skills` copies): Docker deployment and Docker Compose sections
- No npm scripts and no CI workflows referenced Docker

## Files changed

Backend:
- Deleted: all Docker files, compose files and container scripts listed above
- Modified: `package.json`, `.github/workflows/cli.yml`, `.install-scripts/scripts/*.ts`, `env-example-relational`, `env-example-document`, `README.md`, `docs/installing-and-running.md`, `docs/database.md`, `docs/tests.md`, `docs/benchmarking.md`, `docs/introduction.md`, `test/generators/README.md`

Frontend:
- Deleted: `Dockerfile`, `Dockerfile.bun`, `.dockerignore`
- Modified: `scripts/cleanup.js`, `docs/deployment.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `env.example.txt`, `.claude/skills/next-best-practices/*`, `.agents/skills/next-best-practices/*`

Other:
- Added: `CLAUDE.md`, `.gitignore`, `.gitattributes`, `README.md` (replaced the one-line placeholder), `docs/progress/README.md`, this file

## Decisions and trade-offs

- **Flattened the folder layout (approved).** The projects were nested one level deeper than the brief and were full git clones. They now live at `backend/` and `frontend/` as plain files, matching what degit would have produced. Upstream history is still available on GitHub.
- **Baseline import commits.** Both projects were committed unchanged before any edits, so the Docker removal shows up as a real, reviewable diff against upstream.
- **LF line endings everywhere.** A root `.gitattributes` (`* text=auto eol=lf`) keeps LF in the repo and in working copies. Without it, Windows CRLF checkouts caused about 7600 prettier errors in backend lint. This is a small addition outside the Docker scope, but lint cannot pass on Windows without it.
- **Env examples point to `localhost`.** The old defaults were Docker service names, which only resolve inside compose.
- **Mail catcher via `npx maildev`.** This replaces the maildev container in the setup docs. It is optional.
- **Generator CRUD phases (2 and 3) have no runner now.** Their only runners were Docker-based. The specs are kept, and the static phase still runs.
- **The vendored Next.js skill was edited in place.** Re-syncing it from upstream with the skills tool would bring the Docker sections back. Its `computedHash` in `skills-lock.json` no longer matches.
- **`backend/CHANGELOG.md` was left as is.** It mentions Docker as release history, not as instructions.

## How to verify

```bash
git log --oneline main..feat/step-01-project-rules-and-docker-removal
```

```bash
git grep -n -i docker -- backend frontend ":!backend/CHANGELOG.md"
```

This should print nothing.

```bash
cd backend && npm ci && npm run lint && npx tsc --noEmit && npm run build
```

```bash
cd frontend && bun install && bun run lint && bun run typecheck
```

Lint, typecheck and build should all exit with code 0.

## Known issues and next steps

- `backend/test/generators/run-static.sh` and `_matrix.sh`, plus the `test:generators:*` npm scripts, are bash scripts. Under the Windows rule they should be ported to Node in a later step.
- The backend still ships MongoDB (document) support and `.install-scripts`. Switching to relational only (`npm run app:config`) is a separate step.
- `env-example-relational` and `env-example-document` still contain `WORKER_HOST=redis://...`, and the vendored Next.js skill has a Redis cache handler example. These should be cleaned up when pg-boss is introduced.
- The backend env example files are named `env-example-*`, not `.env.example`. Renaming or adding `.env.example` files is a later step.
- Neither project ships unit tests yet. `npm test` in the backend exits with "No tests found", and the frontend has no test runner. Lint, typecheck and build all pass. Tests start in later steps.
