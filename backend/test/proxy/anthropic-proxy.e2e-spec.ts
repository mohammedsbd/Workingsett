import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import Anthropic from '@anthropic-ai/sdk';
import request from 'supertest';
import { ProxyService } from '../../src/proxy/proxy.service';
import {
  defaultResponse,
  FAKE_ANTHROPIC_CACHE,
  FAKE_REPLY_TEXT,
  FAKE_USAGE,
  FakeUpstream,
  parseSse,
} from '../utils/fake-upstream';
import {
  createProjectWithKey,
  dumpAllTables,
  ProxyFixture,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const ANTHROPIC_KEY = 'sk-ant-test-0123456789abcdef';
const PROMPT = 'Draft a reply to the customer about the late order.';

/** An Anthropic Messages request body, as raw text, formatted unusually. */
function messagesBody(fields: Record<string, unknown> = {}): string {
  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    system: [
      {
        type: 'text',
        text: 'You are a support agent.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: PROMPT }],
    ...fields,
  };
  return JSON.stringify(body, null, 2).replace(/": /g, '" :   ') + '\n';
}

describe('Proxy: POST /v1/messages (Anthropic)', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  let fx: ProxyFixture;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({ PROXY_ANTHROPIC_BASE_URL: upstream.baseUrl });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
    fx = await createProjectWithKey(t, { upstream: 'anthropic' });
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const messages = () =>
    request(t.server)
      .post('/v1/messages')
      .set('content-type', 'application/json')
      .set('anthropic-version', '2023-06-01');

  describe('non-streamed requests', () => {
    it('should forward the body byte for byte with Anthropic headers and return the response unchanged', async () => {
      const body = messagesBody();
      const canned = defaultResponse('anthropic', false, JSON.parse(body));
      upstream.respondNext({
        ...canned,
        headers: {
          'request-id': 'req_abc',
          'anthropic-ratelimit-requests-remaining': '99',
        },
      } as typeof canned);

      const res = await messages()
        .set('anthropic-beta', 'prompt-caching-2024-07-31')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-api-key', ANTHROPIC_KEY)
        .send(body)
        .expect(200);

      const forwarded = upstream.lastRequest;
      expect(forwarded.path).toBe('/v1/messages');
      expect(forwarded.rawBody).toBe(body);
      expect(forwarded.headers['x-api-key']).toBe(ANTHROPIC_KEY);
      expect(forwarded.headers['anthropic-version']).toBe('2023-06-01');
      expect(forwarded.headers['anthropic-beta']).toBe(
        'prompt-caching-2024-07-31',
      );
      expect(JSON.stringify(forwarded.headers)).not.toContain(fx.parsimKey);
      expect(res.text).toBe(JSON.stringify((canned as { body: unknown }).body));
      expect(res.headers['request-id']).toBe('req_abc');
      expect(res.headers['anthropic-ratelimit-requests-remaining']).toBe('99');
    });

    it('should pass tool_use blocks through unchanged', async () => {
      const toolUse = {
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: [
          { type: 'text', text: 'Let me look that up.' },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'get_order',
            input: { orderId: 'O-5001', include: ['shipping', 'items'] },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 40 },
      };
      upstream.respondNext({ kind: 'json', body: toolUse });
      const body = messagesBody({
        tools: [
          {
            name: 'get_order',
            description: 'Get an order by id.',
            input_schema: {
              type: 'object',
              properties: { orderId: { type: 'string' } },
              required: ['orderId'],
            },
          },
        ],
        messages: [
          { role: 'user', content: 'Where is order O-5001?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_00',
                name: 'get_order',
                input: { orderId: 'O-5000' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_00',
                content: '{"status":"delivered"}',
              },
            ],
          },
        ],
      });

      const res = await messages()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-api-key', ANTHROPIC_KEY)
        .send(body)
        .expect(200);

      expect(upstream.lastRequest.rawBody).toBe(body);
      expect(res.text).toBe(JSON.stringify(toolUse));
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({ inputTokens: 120, outputTokens: 40 });
    });

    it('should not be served under the /api prefix', async () => {
      await request(t.server)
        .post('/api/v1/messages')
        .set('x-api-key', fx.parsimKey)
        .send(messagesBody())
        .expect(404);
    });
  });

  describe('keys', () => {
    it('should accept the Parsim key as x-api-key and use the stored Anthropic key', async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'anthropic',
        providerKey: 'sk-ant-stored-on-project',
      });

      await messages()
        .set('x-api-key', stored.parsimKey)
        .send(messagesBody())
        .expect(200);

      expect(upstream.lastRequest.headers['x-api-key']).toBe(
        'sk-ant-stored-on-project',
      );
    });

    it('should accept the real Anthropic key per request in x-provider-key', async () => {
      await messages()
        .set('x-api-key', fx.parsimKey)
        .set('x-provider-key', ANTHROPIC_KEY)
        .send(messagesBody())
        .expect(200);

      expect(upstream.lastRequest.headers['x-api-key']).toBe(ANTHROPIC_KEY);
    });

    it('should prefer the per-request key over the stored one', async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'anthropic',
        providerKey: 'sk-ant-stored',
      });

      await messages()
        .set('x-api-key', stored.parsimKey)
        .set('x-provider-key', 'sk-ant-per-request')
        .send(messagesBody())
        .expect(200);

      expect(upstream.lastRequest.headers['x-api-key']).toBe(
        'sk-ant-per-request',
      );
    });

    it.each([
      { name: 'missing', headers: { 'x-api-key': ANTHROPIC_KEY } },
      { name: 'unknown', headers: { 'x-api-key': 'psm_' + 'q'.repeat(43) } },
    ])(
      'should reject a $name Parsim key with 401 in Anthropic format',
      async ({ headers }) => {
        const res = await messages()
          .set(headers)
          .send(messagesBody())
          .expect(401);

        expect(res.body).toEqual({
          type: 'error',
          error: { type: 'authentication_error', message: expect.any(String) },
        });
        expect(upstream.requests).toHaveLength(0);
      },
    );

    it('should reject a revoked key', async () => {
      await request(t.server)
        .post(
          `/api/v1/projects/${fx.project.id}/api-keys/${fx.parsimKeyId}/revoke`,
        )
        .auth(fx.adminToken, { type: 'bearer' })
        .expect(200);

      await messages()
        .set('x-api-key', fx.parsimKey)
        .set('x-provider-key', ANTHROPIC_KEY)
        .send(messagesBody())
        .expect(401);
      expect(upstream.requests).toHaveLength(0);
    });

    it('should explain a missing Anthropic key in Anthropic format', async () => {
      const res = await messages()
        .set('x-api-key', fx.parsimKey)
        .send(messagesBody())
        .expect(401);

      expect(res.body.error.type).toBe('authentication_error');
      expect(res.body.error.message).toContain('provider API key');
    });
  });

  describe('upstream errors', () => {
    it.each([
      {
        status: 400,
        body: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'max_tokens: Field required',
          },
        },
      },
      {
        status: 429,
        body: {
          type: 'error',
          error: { type: 'rate_limit_error', message: 'Slow down' },
        },
      },
      {
        status: 529,
        body: {
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        },
      },
    ])(
      'should pass a $status through with the same body',
      async ({ status, body }) => {
        upstream.failNext(status, body);

        const res = await messages()
          .set('x-parsim-key', fx.parsimKey)
          .set('x-api-key', ANTHROPIC_KEY)
          .send(messagesBody({ stream: true }))
          .expect(status);

        expect(res.text).toBe(JSON.stringify(body));
        const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
        expect(record).toMatchObject({ status, inputTokens: 0, costUsd: null });
      },
    );
  });

  describe('streamed requests', () => {
    it('should pass every SSE event through unchanged and in order', async () => {
      const body = messagesBody({ stream: true });
      const canned = defaultResponse('anthropic', true, JSON.parse(body));
      const expected = (
        canned as { events: { event?: string; data: unknown }[] }
      ).events
        .map(
          ({ event, data }) =>
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        )
        .join('');

      const res = await messages()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-api-key', ANTHROPIC_KEY)
        .send(body)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(upstream.lastRequest.rawBody).toBe(body);
      expect(res.text).toBe(expected);
      const events = parseSse(res.text);
      expect(events.map((e) => e.event)).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
      ]);
      const text = events
        .filter((e) => e.event === 'content_block_delta')
        .map(
          (e) => (JSON.parse(e.data) as { delta: { text: string } }).delta.text,
        )
        .join('');
      expect(text).toBe(FAKE_REPLY_TEXT);
    });

    it('should pass streamed tool_use blocks through unchanged', async () => {
      const events = [
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_t',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-haiku-4-5',
              usage: { input_tokens: 50, output_tokens: 1 },
            },
          },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'toolu_02',
              name: 'get_order',
              input: {},
            },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"orderId":' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '"O-5001"}' },
          },
        },
        {
          event: 'content_block_stop',
          data: { type: 'content_block_stop', index: 0 },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 22 },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ];
      upstream.respondNext({ kind: 'sse', events });

      const res = await messages()
        .set('x-parsim-key', fx.parsimKey)
        .set('x-api-key', ANTHROPIC_KEY)
        .send(messagesBody({ stream: true }))
        .expect(200);

      expect(res.text).toBe(
        events
          .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
          .join(''),
      );
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({
        inputTokens: 50,
        outputTokens: 22,
        streamed: true,
      });
    });
  });

  describe('usage records', () => {
    it.each([false, true])(
      'should record input, output and cache tokens with their cost (streamed: %s)',
      async (stream) => {
        await messages()
          .set('x-parsim-key', fx.parsimKey)
          .set('x-api-key', ANTHROPIC_KEY)
          .send(messagesBody({ stream }))
          .expect(200);

        const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
        expect(record).toMatchObject({
          upstream: 'anthropic',
          model: 'claude-haiku-4-5',
          inputTokens:
            FAKE_USAGE.input +
            FAKE_ANTHROPIC_CACHE.read +
            FAKE_ANTHROPIC_CACHE.write,
          outputTokens: FAKE_USAGE.output,
          cachedInputTokens: FAKE_ANTHROPIC_CACHE.read,
          cacheWriteInputTokens: FAKE_ANTHROPIC_CACHE.write,
          status: 200,
          streamed: stream,
        });
        // Haiku 4.5: 42 uncached * $1 + 30 reads * $0.10 + 10 writes * $1.25
        // + 7 output * $5, per 1M tokens
        expect(Number(record.costUsd)).toBeCloseTo(0.0000925, 9);
      },
    );

    it('should never store or log keys or content', async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'anthropic',
        providerKey: 'sk-ant-stored-secret-777',
      });
      await messages()
        .set('x-api-key', stored.parsimKey)
        .send(messagesBody({ stream: true }))
        .expect(200);
      await messages()
        .set('x-api-key', fx.parsimKey)
        .set('x-provider-key', ANTHROPIC_KEY)
        .send(messagesBody())
        .expect(200);
      await waitForUsageRecords(t.dataSource, stored.project.id);
      await waitForUsageRecords(t.dataSource, fx.project.id);

      const logs = t.logs.text;
      const database = await dumpAllTables(t.dataSource);
      expect(logs).toContain('messages project=');
      for (const secret of [
        ANTHROPIC_KEY,
        'sk-ant-stored-secret-777',
        fx.parsimKey,
        stored.parsimKey,
      ]) {
        expect(logs).not.toContain(secret);
        expect(database).not.toContain(secret);
      }
      // Content may only live in context_content (when the project stores it).
      const outsideContent = await dumpAllTables(t.dataSource, [
        'context_content',
      ]);
      for (const content of [PROMPT, FAKE_REPLY_TEXT]) {
        expect(logs).not.toContain(content);
        expect(outsideContent).not.toContain(content);
      }
    });
  });

  describe('with the official @anthropic-ai/sdk', () => {
    // Configured like a tool that only offers ANTHROPIC_BASE_URL and
    // ANTHROPIC_API_KEY: the Parsim key is the API key, the real Anthropic
    // key is stored on the project.
    const sdkClient = async () => {
      const stored = await createProjectWithKey(t, {
        upstream: 'anthropic',
        providerKey: ANTHROPIC_KEY,
      });
      const client = new Anthropic({
        apiKey: stored.parsimKey,
        baseURL: await t.listen(),
        maxRetries: 0,
      });
      return { stored, client };
    };

    it('should create a message', async () => {
      const { stored, client } = await sdkClient();

      const message = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: PROMPT }],
      });

      expect(message.content).toEqual([
        { type: 'text', text: FAKE_REPLY_TEXT },
      ]);
      expect(upstream.lastRequest.headers['x-api-key']).toBe(ANTHROPIC_KEY);
      expect(upstream.lastRequest.headers['anthropic-version']).toBeDefined();
      const [record] = await waitForUsageRecords(
        t.dataSource,
        stored.project.id,
      );
      expect(record.cachedInputTokens).toBe(FAKE_ANTHROPIC_CACHE.read);
    });

    it('should stream a message', async () => {
      const { stored, client } = await sdkClient();

      const stream = client.messages.stream({
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: PROMPT }],
      });
      let text = '';
      stream.on('text', (delta) => {
        text += delta;
      });
      const final = await stream.finalMessage();

      expect(text).toBe(FAKE_REPLY_TEXT);
      expect(final.usage.output_tokens).toBe(FAKE_USAGE.output);
      const [record] = await waitForUsageRecords(
        t.dataSource,
        stored.project.id,
      );
      expect(record).toMatchObject({
        streamed: true,
        outputTokens: FAKE_USAGE.output,
      });
    });

    it('should count tokens', async () => {
      const { client } = await sdkClient();

      const count = await client.messages.countTokens({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: PROMPT }],
      });

      expect(count.input_tokens).toBe(FAKE_USAGE.input);
    });

    it('should surface Parsim auth errors as SDK errors', async () => {
      const client = new Anthropic({
        apiKey: 'psm_' + 'n'.repeat(43),
        baseURL: await t.listen(),
        maxRetries: 0,
      });

      await expect(
        client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toBeInstanceOf(Anthropic.AuthenticationError);
    });
  });

  describe('POST /v1/messages/count_tokens', () => {
    it('should pass the request and response through without recording usage', async () => {
      const body = messagesBody();

      const res = await request(t.server)
        .post('/v1/messages/count_tokens')
        .set('content-type', 'application/json')
        .set('anthropic-version', '2023-06-01')
        .set('x-api-key', fx.parsimKey)
        .set('x-provider-key', ANTHROPIC_KEY)
        .send(body)
        .expect(200);

      expect(upstream.lastRequest.path).toBe('/v1/messages/count_tokens');
      expect(upstream.lastRequest.rawBody).toBe(body);
      expect(upstream.lastRequest.headers['x-api-key']).toBe(ANTHROPIC_KEY);
      expect(res.body).toEqual({ input_tokens: FAKE_USAGE.input });
      await t.app.get(ProxyService).whenIdle();
      const rows: unknown[] = await t.dataSource.query(
        'SELECT * FROM usage_record',
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('projects with another upstream', () => {
    it('should refuse /v1/messages for an OpenAI project, in Anthropic format', async () => {
      const openai = await createProjectWithKey(t, { upstream: 'openai' });

      const res = await messages()
        .set('x-api-key', openai.parsimKey)
        .set('x-provider-key', 'sk-openai')
        .send(messagesBody())
        .expect(400);

      expect(res.body).toEqual({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'This project forwards to openai. Send its requests to /v1/chat/completions.',
        },
      });
      expect(upstream.requests).toHaveLength(0);
    });

    it('should refuse /v1/chat/completions for an Anthropic project, in OpenAI format', async () => {
      const res = await request(t.server)
        .post('/v1/chat/completions')
        .set('content-type', 'application/json')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', ANTHROPIC_KEY)
        .send('{"model":"claude-haiku-4-5","messages":[]}')
        .expect(400);

      expect(res.body.error).toMatchObject({
        code: 'wrong_endpoint',
        message:
          'This project forwards to anthropic. Send its requests to /v1/messages.',
      });
      expect(upstream.requests).toHaveLength(0);
    });
  });
});
