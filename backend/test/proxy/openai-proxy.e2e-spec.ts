import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import {
  defaultResponse,
  FAKE_GEMINI_THINKING_TOKENS,
  FAKE_REPLY_TEXT,
  FAKE_USAGE,
  FakeUpstream,
  parseSse,
} from '../utils/fake-upstream';
import {
  chatBody,
  createProjectWithKey,
  dumpAllTables,
  ProxyFixture,
  waitFor,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const PROVIDER_KEY = 'sk-test-provider-0123456789abcdef';
const PROMPT = 'Summarize the attached quarterly report.';

type ChatChunk = {
  choices: { delta?: { content?: string } }[];
  usage?: unknown;
};

describe('Proxy: POST /v1/chat/completions', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  let fx: ProxyFixture;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      PROXY_GEMINI_BASE_URL: `${upstream.baseUrl}/v1beta/openai`,
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
    fx = await createProjectWithKey(t);
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const proxy = () =>
    request(t.server)
      .post('/v1/chat/completions')
      .set('content-type', 'application/json');

  describe('non-streamed requests', () => {
    it('should forward the body byte for byte and return the response unchanged', async () => {
      const body = chatBody();
      const canned = defaultResponse('openai', false, JSON.parse(body));
      upstream.respondNext({
        ...canned,
        headers: { 'x-request-id': 'req_123', 'openai-processing-ms': '42' },
      } as typeof canned);

      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(body)
        .expect(200);

      expect(upstream.lastRequest.rawBody).toBe(body);
      expect(upstream.lastRequest.path).toBe('/v1/chat/completions');
      expect(res.text).toBe(JSON.stringify((canned as { body: unknown }).body));
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['x-request-id']).toBe('req_123');
      expect(res.headers['openai-processing-ms']).toBe('42');
    });

    it('should authenticate upstream with the provider key and never forward the Parsim key', async () => {
      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(200);

      const headers = upstream.lastRequest.headers;
      expect(headers.authorization).toBe(`Bearer ${PROVIDER_KEY}`);
      expect(JSON.stringify(headers)).not.toContain(fx.parsimKey);
      expect(headers['x-provider-key']).toBeUndefined();
    });

    it('should accept the Parsim key as the bearer token (OpenAI SDK apiKey)', async () => {
      await proxy()
        .set('authorization', `Bearer ${fx.parsimKey}`)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(200);
    });

    it('should use the provider key stored on the project when none is sent', async () => {
      const stored = await createProjectWithKey(t, {
        providerKey: 'sk-stored-on-project-987',
      });

      await proxy()
        .set('x-parsim-key', stored.parsimKey)
        .send(chatBody())
        .expect(200);

      expect(upstream.lastRequest.headers.authorization).toBe(
        'Bearer sk-stored-on-project-987',
      );
    });

    it('should return 401 when no provider key is available', async () => {
      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .send(chatBody())
        .expect(401);

      expect(res.body.error.code).toBe('missing_provider_key');
      expect(upstream.requests).toHaveLength(0);
    });

    it('should reject a body that is not a JSON object', async () => {
      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send('{not json')
        .expect(400);

      expect(res.body.error.type).toBe('invalid_request_error');
      expect(upstream.requests).toHaveLength(0);
    });

    it('should not be served under the /api prefix', async () => {
      await request(t.server)
        .post('/api/v1/chat/completions')
        .set('x-parsim-key', fx.parsimKey)
        .send(chatBody())
        .expect(404);
    });
  });

  describe('Parsim key checks', () => {
    it.each([
      { name: 'missing', headers: {}, code: 'missing_parsim_key' },
      {
        name: 'unknown',
        headers: { 'x-parsim-key': 'psm_' + 'x'.repeat(43) },
        code: 'invalid_parsim_key',
      },
      {
        name: 'malformed',
        headers: { authorization: 'Bearer psm_short' },
        code: 'invalid_parsim_key',
      },
    ])(
      'should reject a $name Parsim key with 401 in OpenAI format',
      async ({ headers, code }) => {
        const res = await proxy()
          .set(headers)
          .set('x-provider-key', PROVIDER_KEY)
          .send(chatBody())
          .expect(401);

        expect(res.body).toEqual({
          error: {
            message: expect.any(String),
            type: 'invalid_request_error',
            param: null,
            code,
          },
        });
        expect(upstream.requests).toHaveLength(0);
      },
    );

    it('should reject a revoked key with 401', async () => {
      await request(t.server)
        .post(
          `/api/v1/projects/${fx.project.id}/api-keys/${fx.parsimKeyId}/revoke`,
        )
        .auth(fx.adminToken, { type: 'bearer' })
        .expect(200);

      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(401);

      expect(res.body.error.code).toBe('invalid_parsim_key');
      expect(upstream.requests).toHaveLength(0);
    });

    it('should record when a key was last used', async () => {
      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(200);
      const [row] = await t.dataSource.query(
        'SELECT "lastUsedAt" FROM parsim_api_key WHERE id = $1',
        [fx.parsimKeyId],
      );

      expect(row.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe('upstream errors', () => {
    it.each([
      {
        status: 400,
        body: {
          error: {
            message: 'Invalid model',
            type: 'invalid_request_error',
            param: 'model',
            code: null,
          },
        },
      },
      {
        status: 429,
        body: {
          error: { message: 'Rate limited', type: 'rate_limit_exceeded' },
        },
      },
      { status: 500, body: { error: { message: 'Upstream exploded' } } },
    ])(
      'should pass a $status through with the same body',
      async ({ status, body }) => {
        upstream.failNext(status, body);

        const res = await proxy()
          .set('x-parsim-key', fx.parsimKey)
          .set('x-provider-key', PROVIDER_KEY)
          .send(chatBody({ stream: true }))
          .expect(status);

        expect(res.text).toBe(JSON.stringify(body));
        const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
        expect(record).toMatchObject({
          status,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
        });
      },
    );
  });

  describe('streamed requests', () => {
    it('should stream chunks in order without usage the client did not ask for', async () => {
      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody({ stream: true }))
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      const events = parseSse(res.text);
      expect(events[events.length - 1].data).toBe('[DONE]');
      const chunks = events
        .slice(0, -1)
        .map((e) => JSON.parse(e.data) as ChatChunk);
      expect(
        chunks.map((c) => c.choices[0]?.delta?.content ?? '').join(''),
      ).toBe(FAKE_REPLY_TEXT);
      expect(chunks.every((c) => !('usage' in c))).toBe(true);
      expect(chunks.every((c) => c.choices.length > 0)).toBe(true);
    });

    it('should ask upstream for usage and record it', async () => {
      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody({ stream: true }))
        .expect(200);

      expect(upstream.lastRequest.body).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
      });
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({
        streamed: true,
        status: 200,
        inputTokens: FAKE_USAGE.input,
        outputTokens: FAKE_USAGE.output,
      });
    });

    it('should leave stream_options alone and pass usage through when the client set it', async () => {
      const body = chatBody({
        stream: true,
        stream_options: { include_usage: true },
      });

      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(body)
        .expect(200);

      expect(upstream.lastRequest.rawBody).toBe(body);
      const usageChunk = parseSse(res.text)
        .slice(0, -1)
        .map((e) => JSON.parse(e.data) as ChatChunk)
        .find((c) => c.choices.length === 0);
      expect(usageChunk?.usage).toMatchObject({
        prompt_tokens: FAKE_USAGE.input,
      });
    });

    it('should forward chunks as they arrive instead of buffering the stream', async () => {
      const canned = defaultResponse(
        'openai',
        true,
        JSON.parse(chatBody({ stream: true })),
      );
      upstream.respondNext({ ...canned, delayMs: 150 } as typeof canned);
      const url = await t.listen();

      const startedAt = Date.now();
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-parsim-key': fx.parsimKey,
          'x-provider-key': PROVIDER_KEY,
        },
        body: chatBody({ stream: true }),
      });
      const reader = res.body!.getReader();
      const arrivals: number[] = [];
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arrivals.push(Date.now() - startedAt);
        text += Buffer.from(value).toString();
      }

      // 5 events, 150 ms apart: the first must arrive long before the last.
      expect(arrivals.length).toBeGreaterThan(1);
      expect(arrivals[arrivals.length - 1] - arrivals[0]).toBeGreaterThan(400);
      expect(text).toContain('[DONE]');
    });

    it('should cancel the upstream request when the client disconnects', async () => {
      const canned = defaultResponse(
        'openai',
        true,
        JSON.parse(chatBody({ stream: true })),
      );
      upstream.respondNext({ ...canned, delayMs: 300 } as typeof canned);
      const url = await t.listen();
      const controller = new AbortController();

      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-parsim-key': fx.parsimKey,
          'x-provider-key': PROVIDER_KEY,
        },
        body: chatBody({ stream: true }),
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();

      await waitFor(() => Promise.resolve(upstream.closedEarly === 1));
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record.status).toBe(499);
    });
  });

  describe('usage records', () => {
    it('should record tokens, cost, latency and status, and no content', async () => {
      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(200);

      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({
        upstream: 'openai',
        model: 'gpt-4o',
        inputTokens: FAKE_USAGE.input,
        outputTokens: FAKE_USAGE.output,
        cachedInputTokens: null,
        status: 200,
        streamed: false,
      });
      // gpt-4o: 42 input * $2.50 + 7 output * $10.00, per 1M tokens
      expect(Number(record.costUsd)).toBeCloseTo(0.000175, 8);
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);

      const everything = await dumpAllTables(t.dataSource);
      expect(everything).not.toContain(PROMPT);
      expect(everything).not.toContain('You are terse.');
      expect(everything).not.toContain(FAKE_REPLY_TEXT);
    });

    it('should store a null cost for models missing from the price table', async () => {
      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody({ model: 'some-future-model' }))
        .expect(200);

      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record.model).toBe('some-future-model');
      expect(record.inputTokens).toBe(FAKE_USAGE.input);
      expect(record.costUsd).toBeNull();
    });
  });

  describe('secrets', () => {
    it('should never put provider keys in logs or the database in plain text', async () => {
      const storedKey = 'sk-stored-secret-provider-key-555';
      const stored = await createProjectWithKey(t, { providerKey: storedKey });

      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody({ stream: true }))
        .expect(200);
      await proxy()
        .set('x-parsim-key', stored.parsimKey)
        .send(chatBody())
        .expect(200);
      upstream.failNext(401, { error: { message: 'bad key' } });
      await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .set('authorization', `Bearer ${PROVIDER_KEY}`)
        .send(chatBody())
        .expect(401);
      await waitForUsageRecords(t.dataSource, fx.project.id, 2);
      await waitForUsageRecords(t.dataSource, stored.project.id, 1);

      const logs = t.logs.text;
      const database = await dumpAllTables(t.dataSource);
      expect(logs).toContain('chat.completions');
      for (const secret of [PROVIDER_KEY, storedKey, fx.parsimKey]) {
        expect(logs).not.toContain(secret);
        expect(database).not.toContain(secret);
      }
      expect(logs).not.toContain(PROMPT);
    });
  });

  describe('Gemini upstream (OpenAI-compatible endpoint)', () => {
    let gemini: ProxyFixture;

    beforeEach(async () => {
      gemini = await createProjectWithKey(t, { upstream: 'gemini' });
    });

    it('should forward to the Gemini path and count thinking tokens as output', async () => {
      const body = chatBody({ model: 'gemini-3.8-flash' });

      const res = await proxy()
        .set('x-parsim-key', gemini.parsimKey)
        .set('x-provider-key', 'gemini-test-key')
        .send(body)
        .expect(200);

      expect(upstream.lastRequest.format).toBe('gemini-openai');
      expect(upstream.lastRequest.path).toBe('/v1beta/openai/chat/completions');
      expect(upstream.lastRequest.rawBody).toBe(body);
      expect(upstream.lastRequest.headers.authorization).toBe(
        'Bearer gemini-test-key',
      );
      expect(res.body.choices[0].message.content).toBe(FAKE_REPLY_TEXT);

      const [record] = await waitForUsageRecords(
        t.dataSource,
        gemini.project.id,
      );
      expect(record).toMatchObject({
        upstream: 'gemini',
        inputTokens: FAKE_USAGE.input,
        outputTokens: FAKE_USAGE.output + FAKE_GEMINI_THINKING_TOKENS,
      });
      // 42 * $0.75 + 27 * $3.75, per 1M tokens
      expect(Number(record.costUsd)).toBeCloseTo(0.00013275, 8);
    });

    it('should strip the per-chunk usage Gemini adds when Parsim asked for it', async () => {
      const res = await proxy()
        .set('x-parsim-key', gemini.parsimKey)
        .set('x-provider-key', 'gemini-test-key')
        .send(chatBody({ model: 'gemini-3.8-flash', stream: true }))
        .expect(200);

      const chunks = parseSse(res.text)
        .slice(0, -1)
        .map((e) => JSON.parse(e.data) as ChatChunk);
      expect(chunks.every((c) => !('usage' in c))).toBe(true);
      expect(
        chunks.map((c) => c.choices[0]?.delta?.content ?? '').join(''),
      ).toBe(FAKE_REPLY_TEXT);
      const [record] = await waitForUsageRecords(
        t.dataSource,
        gemini.project.id,
      );
      expect(record.outputTokens).toBe(
        FAKE_USAGE.output + FAKE_GEMINI_THINKING_TOKENS,
      );
    });

    it('should pass Gemini array-shaped errors through unchanged', async () => {
      const geminiError = [
        {
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand.',
            status: 'UNAVAILABLE',
          },
        },
      ];
      upstream.failNext(503, geminiError);

      const res = await proxy()
        .set('x-parsim-key', gemini.parsimKey)
        .set('x-provider-key', 'gemini-test-key')
        .send(chatBody({ model: 'gemini-3.8-flash' }))
        .expect(503);

      expect(res.text).toBe(JSON.stringify(geminiError));
    });
  });
});
