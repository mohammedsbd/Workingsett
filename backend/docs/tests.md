# Tests

## Table of Contents <!-- omit in toc -->

- [Unit Tests](#unit-tests)
- [E2E Tests](#e2e-tests)
  - [Test database](#test-database)
  - [How the e2e tests work](#how-the-e2e-tests-work)
- [Test utilities](#test-utilities)
  - [Fake upstream LLM server](#fake-upstream-llm-server)
  - [Fixture conversations](#fixture-conversations)

## Unit Tests

```bash
npm test
```

Unit tests are `*.spec.ts` files next to the code in `src/`, plus tests for the test utilities in `test/` (fake upstream, fixtures). They need no database and no network.

## E2E Tests

```bash
npm run test:e2e
```

E2E tests are `*.e2e-spec.ts` files in `test/`. They load `backend/.env.test`, run in band, and boot the real `AppModule` inside the test process.

### Test database

E2E tests use a separate PostgreSQL database (`api_test` by default), never the dev database.

1. Copy `.env.test.example` as `.env.test` (gitignored) and set the database credentials.
1. Create and migrate the test database:

   ```bash
   npm run test:db:setup
   ```

`npm run test:e2e` also runs this setup first, so a fresh clone only needs `.env.test`. The database user needs the `CREATEDB` permission, or you create `api_test` yourself.

Safety checks: tests refuse to run unless `DATABASE_NAME` ends in `_test`, and refuse `DATABASE_URL`, because they wipe every table between tests.

### How the e2e tests work

`createTestApp()` in `test/utils/test-app.ts`:

- builds the app with `Test.createTestingModule({ imports: [AppModule] })` and the same global prefix, versioning, validation pipe and interceptors as `main.ts`, then calls `app.init()` (no port is opened; supertest calls the HTTP server directly);
- replaces only the SMTP mailer with `InMemoryMailer`, which still renders the templates but keeps messages in memory (`t.mailer.findHash(email, 'confirm-email')` returns the hash from a link);
- returns `reset()`, which truncates every table, restarts id sequences and re-runs the role, status and user seeds (`admin@example.com` and `john.doe@example.com`, password `secret`).

Every suite calls `t.reset()` in `beforeEach`, so tests do not depend on each other or on order (`--randomize` passes).

```ts
let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
beforeEach(async () => { await t.reset(); });
afterAll(async () => { await t?.close(); });

it('should ...', () => request(t.server).get('/api/v1/auth/me').expect(401));
```

## Test utilities

### Fake upstream LLM server

`test/utils/fake-upstream.ts` is an in-process HTTP server on a random port that stands in for the LLM providers:

- `POST /v1/chat/completions` (OpenAI format, also Gemini's OpenAI-compatible endpoint)
- `POST /v1/messages` (Anthropic)
- `POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent` (Gemini native)

It returns canned JSON, or canned SSE streams when streaming is requested, with fixed usage numbers (`FAKE_USAGE`). `failNext(status, body)` and `respondNext(...)` override the next response. Every request is recorded in `requests` (headers, raw and parsed body).

```ts
const upstream = await FakeUpstream.start();
// point the provider base URL at upstream.baseUrl
upstream.failNext(429, { error: { message: 'Slow down' } });
expect(upstream.lastRequest.headers.authorization).toBe('Bearer sk-test');
await upstream.stop();
```

### Fixture conversations

`test/fixtures/conversations/` holds synthetic sessions in OpenAI message format, loaded with `loadConversation(id)` from `test/utils/fixtures.ts`:

- `short-chat`: 7 messages, no tools.
- `research-agent-session`: 117 messages with large page fetches, duplicate and superseded tool results, and side-effect tools (`save_note`, `send_report`).
- `support-agent-session`: 4 tickets, a repeated help-center article, and side-effect tools (`issue_refund`, `send_reply`).

They contain no real customer data; all emails use `example.com`.

---

Previous: [File uploading](file-uploading.md)

Next: [Benchmarking](benchmarking.md)
