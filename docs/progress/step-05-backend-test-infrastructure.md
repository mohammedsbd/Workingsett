# Step 05: backend cleanup and test infrastructure

## Goal

Make the backend relational only and Parsim-ready, then build the test foundation every later step relies on: a separate test database, in-process e2e tests, a fake upstream LLM server and fixture conversations.

## What was built

Part A, cleanup:
- **MongoDB removed.** The boilerplate's own PostgreSQL-only cleanup (`remove-mongodb.ts` plus the document and all-db generator removals) was run directly as a function, not through the interactive `app:config` menu. It removed:
  - the document persistence folders, the Mongoose dependencies and `env-example-document`;
  - the document seeds and hygen templates, and the database switch in `app.module.ts` and the domain models.

  Leftovers it missed were removed by hand: the `isDocumentDatabase` config flag, the `postseed:create:document` hook and the `prompts` dependency.
- **Install scripts removed.** `.install-scripts` and the `app:config` script are gone.
- **`.env.example`:**
  - renamed from `env-example-relational`, with every reference updated;
  - `WORKER_HOST` (Redis) removed; no code read it;
  - new entries: empty `GEMINI_API_KEY`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, `PARSIM_INTERNAL_PROVIDER=gemini` and an empty `PARSIM_INTERNAL_MODEL`, each with a comment.
- **Generator tests removed** (`test/generators`, its bash runners, its npm scripts and the `cli.yml` workflow). See Decisions.
- **Docs updated:** installation, database, CLI, architecture, auth, README, the backend `CLAUDE.md` and the generate skill now describe a PostgreSQL-only setup.

Part B, test infrastructure:
- **Test database.**
  - `backend/.env.test.example` is committed; `backend/.env.test` is gitignored and was created locally from your `.env`, with `DATABASE_NAME=api_test` and `NODE_ENV=test`.
  - `npm run test:db:setup` (a TypeScript script, no bash) creates `api_test` if it is missing and runs the migrations. `npm run test:e2e` runs the same setup first.
  - Tests refuse any database name that does not end in `_test`, and refuse `DATABASE_URL`.
- **In-process e2e tests.**
  - `test/utils/test-app.ts` boots `AppModule` with `Test.createTestingModule`, applies the same global setup as `main.ts`, and calls `app.init()`. supertest calls it directly, with no port.
  - `test:e2e` loads `.env.test` through env-cmd and runs `--runInBand`.
  - `reset()` truncates every table, restarts id sequences and re-runs the existing seed services before each test.
  - SMTP is replaced by an in-memory mailer that still renders the templates (your choice).
- **Existing e2e tests converted.** The admin auth, admin users and user auth suites now run in-process, and every test creates its own data. They pass in random order (`--randomize`).
- **Fake upstream LLM server** (`test/utils/fake-upstream.ts`).
  - Listens on a random port.
  - Serves OpenAI `/v1/chat/completions`, Anthropic `/v1/messages`, and Gemini `/v1beta/models/{model}:generateContent` and `:streamGenerateContent`.
  - Returns canned JSON, or canned SSE when streaming is requested, with fixed usage numbers.
  - `failNext(status, body)` and `respondNext(...)` override the next response, and every request is recorded (headers, raw body, parsed body).
- **Fixture conversations** (`test/fixtures/conversations/`, OpenAI message format, synthetic data, only `example.com` emails):
  - `short-chat`: 7 messages.
  - `research-agent-session`: 117 messages. Large page fetches, the same search and pages fetched repeatedly (duplicates), newer page revisions (superseded), and side-effect tools.
  - `support-agent-session`: 4 tickets, 45 messages. The same help-center article on every ticket, plus refunds and replies as side-effect tools.

## Files changed

Backend:
- Deleted:
  - MongoDB: `src/**/persistence/document/`, `src/database/mongoose-config.service.ts`, `src/database/seeds/document/`, `src/utils/document-entity-helper.ts`, `env-example-document`.
  - Generators: `.hygen` document and all-db templates, `.install-scripts/`, `test/generators/`, `.github/workflows/cli.yml`, `test/utils/types/mail-message.type.ts`.
- Renamed: `env-example-relational` to `.env.example`.
- Added:
  - `.env.test.example`
  - `test/setup-test-db.ts`
  - `test/utils/` helpers: `test-database.ts`, `test-app.ts`, `in-memory-mailer.ts`, `auth-helpers.ts`, `fake-upstream.ts`, `fixtures.ts`
  - fixture files: `test/fixtures/conversations/*.json`
  - test files: `test/infrastructure.e2e-spec.ts`, `test/utils/fake-upstream.spec.ts`, `test/fixtures/conversations/conversations.spec.ts`, `src/auth/config/auth.config.spec.ts`
- Modified:
  - `package.json`/`package-lock.json`: dependencies and scripts; unit tests now also run `*.spec.ts` under `test/`.
  - `app.module.ts`, the files modules, `session.module.ts`, `users.module.ts`, the user, role and status domain models: MongoDB switch removed.
  - `database.config.ts`, `database-config.type.ts`: `isDocumentDatabase` flag removed.
  - `typeorm-config.service.ts`: no SQL logging under `NODE_ENV=test`.
  - `auth.config.ts`: message text only.
  - `tsconfig.json`, `test/jest-e2e.json`, the three converted e2e specs, `test/utils/constants.ts`.
  - docs: `docs/*.md`, `README.md`, `CLAUDE.md`, `.claude/skills/generate/SKILL.md`.

Frontend:
- None

Other:
- Added: this file
- Modified: `docs/progress/README.md`

## Tests

Added:
- Unit (`npm test`, 3 suites):
  - `fake-upstream.spec.ts` (12 tests): all three formats, plain and streamed, recording, errors, overrides and unknown routes.
  - `conversations.spec.ts` (22 tests): structure checks for every fixture.
  - `auth.config.spec.ts` (4 tests): config mapping, validation and placeholder secrets.
- E2E (`npm run test:e2e`, 4 suites):
  - `infrastructure.e2e-spec.ts` (5 tests): runs on the test DB, serves in-process, reset wipes and re-seeds, ids restart, fake upstream runs alongside and records.
  - the converted admin auth (1), admin users (4) and user auth (14) suites.

Last run:
- `npm run lint`: pass
- `npx tsc --noEmit`: pass
- `npm test`: 3 suites, **38 passed**, 0 failed
- `npm run test:e2e`: 4 suites, **24 passed**, 0 failed (about 14 s; also passed with `--randomize`)
- `npm run start:dev` (on port 3002, because port 3001 was in use): the app started, `GET /` returned 200, and `admin@example.com` / `secret` logged in with 200.

## Decisions and trade-offs

- **Generator tests removed, not ported.** They tested the boilerplate's hygen templates, not Parsim. They ran from bash, rewrote `src/` and reset it with `git checkout` (so they needed a clean tree), half of them covered the MongoDB templates removed here, and their CRUD phases already had no runner after step 01. The boilerplate's own `remove-install-scripts` deletes them too. `npm run generate:resource:relational` still works.
- **The boilerplate's scripts were run, not imitated.** The cleanup functions were called directly (only the menu is interactive), so the result matches what upstream's "PostgreSQL only" option produces. The remaining gaps were then fixed by hand.
- **In-memory mail instead of maildev** (your choice). SMTP is an external boundary. The capture still renders the Handlebars templates, so template errors still fail tests.
- **Tables are reset before every test** with `TRUNCATE ... RESTART IDENTITY CASCADE`, then the existing seed services run. Each test therefore starts from the same data, with ids 1 and 2 for the admin and tester users.
- **The test database is created through TypeORM, not `pg`.** `pg` has no type definitions installed, so using TypeORM's connection avoids adding `@types/pg`.
- **Test database user.** `.env.test` uses your `root` user, which already has `CREATEDB` (your choice). No superuser access was needed.
- **Unit test roots include `test/`.** Tests for the test utilities (fake upstream, fixtures) need no database, so they run with `npm test`. Coverage is still measured on `src/` only.
- **The fixture generator is not committed.** The fixtures are plain JSON as asked. They came from a one-off deterministic script.
- **The first two commits list removed dependencies.** `chore(backend): remove generator test suite...` and `refactor(db): remove mongodb...` still have `prompts`/`mongoose` in `package.json`, which `npm ci` installs at those commits. Each commit was checked with tsc and eslint.

## How to verify

```bash
git log --oneline main..feat/step-05-backend-test-infrastructure
```

```bash
cd backend && npm ci && npm run lint && npx tsc --noEmit && npm test
```

```bash
cd backend && cp .env.test.example .env.test && npm run test:db:setup && npm run test:e2e
```

Set the database credentials in `.env.test` first if they differ from the defaults. Expect 38 unit tests and 24 e2e tests to pass.

```bash
cd backend && npm run start:dev
```

Then log in as the seeded admin (`admin@example.com` / `secret`) at `POST http://localhost:3001/api/v1/auth/email/login`.

```bash
git grep -n -i -E "mongo|env-example|app:config|WORKER_HOST" -- backend ":!backend/CHANGELOG.md" ":!backend/package-lock.json"
```

This should print nothing.

## Known issues and next steps

- `PARSIM_INTERNAL_MODEL` is empty. Fill in the current Gemini Flash model name in your `backend/.env` when Parsim's own model calls start (compression, step 14). Nothing reads it yet.
- Your local `backend/.env` still has a `WORKER_HOST=redis://...` line. Nothing reads it, so it is harmless; delete it whenever you like. I did not edit `.env`.
- The backend `tsconfig.json` is not fully `strict` (it sets `strictNullChecks` and `noImplicitAny`, but not `strict: true`). CLAUDE.md asks for strict TypeScript. Turning it on is worth a small separate step.
- `.github/workflows` is now empty in `backend/`. CI for lint, unit and e2e tests (with a Postgres service, no Docker image builds) is worth adding later. Workflows inside `backend/.github` don't run anyway, because GitHub only reads the repo root.
- There is no Parsim code yet, so CLAUDE.md's GC coverage target (`npm run test:cov`) does not apply yet.
- The fake upstream does not cover Gemini's non-SSE stream mode (a JSON array returned when `alt=sse` is missing). Add it if the Gemini adapter needs it (step 08).
- Uncommitted on disk: another session changed `docs/prompts/parsim-build-prompts.md` (adds an authentication step 18). It is not part of this step and was left uncommitted.
