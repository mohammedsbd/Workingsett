import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import {
  FAKE_REPLY_TEXT,
  FAKE_ANTHROPIC_CACHE,
  FAKE_GEMINI_THINKING_TOKENS,
  FAKE_USAGE,
  FakeUpstream,
  parseSse,
} from './fake-upstream';

// Just the response fields these tests read.
type OpenAIResponse = {
  model: string;
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number };
};
type OpenAIChunk = { choices: { delta?: { content?: string } }[] };
type AnthropicResponse = {
  content: { text: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};
type AnthropicDelta = { delta: { text: string } };
type GeminiResponse = {
  candidates: { content: { parts: { text: string }[] } }[];
  usageMetadata?: { promptTokenCount: number };
};

describe('FakeUpstream', () => {
  let fake: FakeUpstream;

  beforeAll(async () => {
    fake = await FakeUpstream.start();
  });

  beforeEach(() => {
    fake.reset();
  });

  afterAll(async () => {
    await fake.stop();
  });

  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${fake.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('should listen on a random local port', () => {
    expect(fake.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  describe('OpenAI format: POST /v1/chat/completions', () => {
    const request = {
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    it('should return a canned completion with usage', async () => {
      const res = await post('/v1/chat/completions', request);
      const body = (await res.json()) as OpenAIResponse;

      expect(res.status).toBe(200);
      expect(body.model).toBe('gpt-test');
      expect(body.choices[0].message.content).toBe(FAKE_REPLY_TEXT);
      expect(body.usage.prompt_tokens).toBe(FAKE_USAGE.input);
      expect(body.usage.completion_tokens).toBe(FAKE_USAGE.output);
    });

    it('should stream SSE chunks ending with [DONE] when stream is true', async () => {
      const res = await post('/v1/chat/completions', {
        ...request,
        stream: true,
      });
      const events = parseSse(await res.text());

      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(events[events.length - 1].data).toBe('[DONE]');
      const text = events
        .slice(0, -1)
        .map((e) => JSON.parse(e.data) as OpenAIChunk)
        .map((chunk) => chunk.choices[0]?.delta?.content ?? '')
        .join('');
      expect(text).toBe(FAKE_REPLY_TEXT);
      expect(fake.lastRequest.streamed).toBe(true);
    });
  });

  describe('Anthropic format: POST /v1/messages', () => {
    const request = {
      model: 'claude-test',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
    };

    it('should return a canned message with usage', async () => {
      const res = await post('/v1/messages', request);
      const body = (await res.json()) as AnthropicResponse;

      expect(res.status).toBe(200);
      expect(body.content[0].text).toBe(FAKE_REPLY_TEXT);
      expect(body.usage).toEqual({
        input_tokens: FAKE_USAGE.input,
        output_tokens: FAKE_USAGE.output,
        cache_read_input_tokens: FAKE_ANTHROPIC_CACHE.read,
        cache_creation_input_tokens: FAKE_ANTHROPIC_CACHE.write,
      });
    });

    it('should stream named SSE events when stream is true', async () => {
      const res = await post('/v1/messages', { ...request, stream: true });
      const events = parseSse(await res.text());

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
        .map((e) => (JSON.parse(e.data) as AnthropicDelta).delta.text)
        .join('');
      expect(text).toBe(FAKE_REPLY_TEXT);
    });
  });

  describe('Gemini native format: POST /v1beta/models/{model}:...', () => {
    const request = { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] };

    it('should return a canned generateContent response and record the model', async () => {
      const res = await post(
        '/v1beta/models/gemini-test:generateContent',
        request,
      );
      const body = (await res.json()) as GeminiResponse;

      expect(res.status).toBe(200);
      expect(body.candidates[0].content.parts[0].text).toBe(FAKE_REPLY_TEXT);
      expect(body.usageMetadata?.promptTokenCount).toBe(FAKE_USAGE.input);
      expect(fake.lastRequest).toMatchObject({
        format: 'gemini',
        model: 'gemini-test',
        streamed: false,
      });
    });

    it('should stream SSE for streamGenerateContent', async () => {
      const res = await post(
        '/v1beta/models/gemini-test:streamGenerateContent?alt=sse',
        request,
      );
      const events = parseSse(await res.text());

      const text = events
        .map(
          (e) =>
            (JSON.parse(e.data) as GeminiResponse).candidates[0].content
              .parts[0].text,
        )
        .join('');
      expect(text).toBe(FAKE_REPLY_TEXT);
      expect(fake.lastRequest.query).toEqual({ alt: 'sse' });
      expect(fake.lastRequest.streamed).toBe(true);
    });
  });

  describe('recording', () => {
    it('should record headers and body of every request', async () => {
      await post(
        '/v1/chat/completions',
        { model: 'a', messages: [] },
        { authorization: 'Bearer sk-test' },
      );
      await post(
        '/v1/messages',
        { model: 'b', messages: [] },
        { 'x-api-key': 'anthropic-test' },
      );

      expect(fake.requests).toHaveLength(2);
      expect(fake.requests[0]).toMatchObject({
        format: 'openai',
        path: '/v1/chat/completions',
        body: { model: 'a', messages: [] },
      });
      expect(fake.requests[0].headers.authorization).toBe('Bearer sk-test');
      expect(fake.requests[1].headers['x-api-key']).toBe('anthropic-test');
    });

    it('should keep the raw body even when it is not valid JSON', async () => {
      await fetch(`${fake.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        body: 'not json',
      });

      expect(fake.lastRequest.rawBody).toBe('not json');
      expect(fake.lastRequest.body).toBeUndefined();
    });
  });

  describe('stream usage, like the real providers', () => {
    const chunksOf = async (res: Response) =>
      parseSse(await res.text())
        .filter((e) => e.data !== '[DONE]')
        .map((e) => JSON.parse(e.data) as Record<string, unknown>);

    it('should send no usage in an OpenAI stream unless include_usage is set', async () => {
      const plain = await chunksOf(
        await post('/v1/chat/completions', { model: 'm', stream: true }),
      );
      const withUsage = await chunksOf(
        await post('/v1/chat/completions', {
          model: 'm',
          stream: true,
          stream_options: { include_usage: true },
        }),
      );

      expect(plain.some((c) => 'usage' in c)).toBe(false);
      expect(withUsage.slice(0, -1).every((c) => c.usage === null)).toBe(true);
      expect(withUsage[withUsage.length - 1]).toMatchObject({
        choices: [],
        usage: { prompt_tokens: FAKE_USAGE.input },
      });
    });

    it('should mimic Gemini: thinking tokens only in the total, usage on every chunk', async () => {
      const res = await post('/v1beta/openai/chat/completions', {
        model: 'gemini-test',
      });
      const body = (await res.json()) as {
        usage: { completion_tokens: number; total_tokens: number };
      };
      const chunks = await chunksOf(
        await post('/v1beta/openai/chat/completions', {
          model: 'gemini-test',
          stream: true,
          stream_options: { include_usage: true },
        }),
      );

      expect(fake.requests[0].format).toBe('gemini-openai');
      expect(body.usage.completion_tokens).toBe(FAKE_USAGE.output);
      expect(body.usage.total_tokens).toBe(
        FAKE_USAGE.input + FAKE_USAGE.output + FAKE_GEMINI_THINKING_TOKENS,
      );
      expect(chunks.every((c) => c.usage)).toBe(true);
      expect(chunks.some((c) => (c.choices as unknown[]).length === 0)).toBe(
        false,
      );
    });
  });

  describe('Anthropic token counting', () => {
    it('should answer POST /v1/messages/count_tokens', async () => {
      const res = await post('/v1/messages/count_tokens', {
        model: 'claude-test',
        messages: [],
      });

      expect(await res.json()).toEqual({ input_tokens: FAKE_USAGE.input });
      expect(fake.lastRequest.format).toBe('anthropic-count-tokens');
    });
  });

  describe('timing', () => {
    it('should delay a JSON response when asked', async () => {
      fake.respondNext({ kind: 'json', body: { ok: true }, delayMs: 200 });
      const started = Date.now();

      await post('/v1/chat/completions', {});

      expect(Date.now() - started).toBeGreaterThanOrEqual(180);
    });

    it('should count responses the client closed before they finished', async () => {
      fake.respondNext({
        kind: 'sse',
        events: [{ data: 'a' }, { data: 'b' }],
        delayMs: 300,
      });
      const controller = new AbortController();
      const res = await fetch(`${fake.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      controller.abort();

      for (let i = 0; i < 40 && fake.closedEarly === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fake.closedEarly).toBe(1);
    });
  });

  describe('errors and overrides', () => {
    it('should return the configured error status and body once', async () => {
      const error = {
        error: { type: 'rate_limit_error', message: 'Slow down' },
      };
      fake.failNext(429, error);

      const failed = await post('/v1/messages', { model: 'x', messages: [] });
      expect(failed.status).toBe(429);
      expect(await failed.json()).toEqual(error);

      const next = await post('/v1/messages', { model: 'x', messages: [] });
      expect(next.status).toBe(200);
    });

    it('should serve queued custom responses in order', async () => {
      fake.respondNext({ kind: 'json', body: { first: true } });
      fake.respondNext({ kind: 'sse', events: [{ data: { second: true } }] });

      expect(await (await post('/v1/chat/completions', {})).json()).toEqual({
        first: true,
      });
      expect(
        parseSse(await (await post('/v1/chat/completions', {})).text()),
      ).toEqual([{ event: undefined, data: '{"second":true}' }]);
    });

    it('should answer unknown routes with 404', async () => {
      const res = await post('/v1/embeddings', {});
      expect(res.status).toBe(404);
      expect(fake.requests).toHaveLength(0);
    });
  });
});
