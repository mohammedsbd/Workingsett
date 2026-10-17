import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  ContextTooLargeError,
  summarize,
  SummarizerError,
  SummarizerQuotaError,
  SummarizerTarget,
} from './summarizer';

const target = (provider: SummarizerTarget['provider']): SummarizerTarget => ({
  provider,
  model: 'test-model',
  baseUrl: 'http://upstream.test',
  apiKey: 'test-key',
});

const response = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Every call gets a fresh response (retries read the body again). */
function respond(status: number, body: unknown) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(response(status, body)));
}

/** Answers each call with the next response. */
function respondInOrder(...responses: (() => Response)[]) {
  const spy = jest.spyOn(globalThis, 'fetch');
  for (const next of responses) {
    spy.mockImplementationOnce(() => Promise.resolve(next()));
  }
  return spy;
}

const noWait = { sleep: () => Promise.resolve() };

const sent = (spy: ReturnType<typeof respond>) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
};

describe('summarize', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call Gemini generateContent with JSON output and read text and usage', async () => {
    const spy = respond(200, {
      candidates: [
        {
          content: {
            parts: [
              { text: 'thinking', thought: true },
              { text: '{"goal":' },
              { text: '"g"}' },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    });
    const result = await summarize(target('gemini'), 'sys', 'prompt');

    expect(result).toEqual({
      text: '{"goal":"g"}',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
      },
    });
    const call = sent(spy);
    expect(call.url).toBe(
      'http://upstream.test/v1beta/models/test-model:generateContent',
    );
    expect(call.headers['x-goog-api-key']).toBe('test-key');
    expect(call.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'prompt' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });
  });

  it('should call OpenAI chat completions', async () => {
    const spy = respond(200, {
      choices: [{ message: { content: '{"goal":"g"}' } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });
    const result = await summarize(target('openai'), 'sys', 'prompt');
    expect(result.text).toBe('{"goal":"g"}');
    expect(result.usage?.inputTokens).toBe(50);
    const call = sent(spy);
    expect(call.url).toBe('http://upstream.test/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer test-key');
    expect(call.body).toMatchObject({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'prompt' },
      ],
    });
  });

  it('should call the Anthropic Messages API', async () => {
    const spy = respond(200, {
      content: [{ type: 'text', text: '{"goal":"g"}' }],
      usage: { input_tokens: 70, output_tokens: 9 },
    });
    const result = await summarize(target('anthropic'), 'sys', 'prompt');
    expect(result.text).toBe('{"goal":"g"}');
    expect(result.usage?.outputTokens).toBe(9);
    const call = sent(spy);
    expect(call.url).toBe('http://upstream.test/v1/messages');
    expect(call.headers['x-api-key']).toBe('test-key');
    expect(call.body).toMatchObject({ model: 'test-model', system: 'sys' });
  });

  it.each([
    [429, true],
    [503, true],
    [400, false],
    [401, false],
  ])(
    'should fail on status %i, retryable=%s, without the body in the message',
    async (status, retryable) => {
      respond(status, { error: { message: 'secret prompt text' } });
      const error = await summarize(target('gemini'), 's', 'p', {
        retry: { maxRetries: 0 },
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SummarizerError);
      expect((error as SummarizerError).retryable).toBe(retryable);
      expect((error as Error).message).toBe(`upstream returned ${status}`);
    },
  );

  it('should fail retryably on network errors, bad JSON and empty text', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    await expect(summarize(target('openai'), 's', 'p')).rejects.toMatchObject({
      retryable: true,
    });

    jest.restoreAllMocks();
    respond(200, 'not json');
    await expect(summarize(target('openai'), 's', 'p')).rejects.toThrow(
      'invalid JSON',
    );

    jest.restoreAllMocks();
    respond(200, { candidates: [] });
    await expect(summarize(target('gemini'), 's', 'p')).rejects.toThrow(
      'no text',
    );
  });

  describe('openai-compatible providers (Groq)', () => {
    const groq: SummarizerTarget = {
      provider: 'openai-compatible',
      model: 'groq-model',
      baseUrl: 'https://api.groq.test/openai/v1',
      apiKey: 'gsk-test',
      contextTokens: 131_072,
    };
    const completion = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'groq-model',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: '{"goal":"g"}' },
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46 },
    };
    const callOf = (spy: ReturnType<typeof respond>, i = 0) => {
      const [url, init] = spy.mock.calls[i] as [
        string | URL | Request,
        RequestInit,
      ];
      return {
        url: String(url instanceof Request ? url.url : url),
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
    };

    it('should call /chat/completions through the openai SDK', async () => {
      const spy = respond(200, completion);
      const result = await summarize(groq, 'sys', 'prompt');

      expect(result.text).toBe('{"goal":"g"}');
      expect(result.usage).toMatchObject({ inputTokens: 40, outputTokens: 6 });
      const call = callOf(spy);
      expect(call.url).toBe('https://api.groq.test/openai/v1/chat/completions');
      expect(call.headers.get('authorization')).toBe('Bearer gsk-test');
      expect(call.body).toMatchObject({
        model: 'groq-model',
        temperature: 0,
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'prompt' },
        ],
      });
    });

    it('should wait as long as Retry-After says, then succeed', async () => {
      const waits: number[] = [];
      const spy = respondInOrder(
        () =>
          response(
            429,
            {
              error: {
                message: 'Rate limit reached on requests per minute (RPM).',
              },
            },
            { 'retry-after': '2' },
          ),
        () => response(200, completion),
      );
      const result = await summarize(groq, 's', 'p', {
        retry: {
          sleep: (ms) => {
            waits.push(ms);
            return Promise.resolve();
          },
        },
      });
      expect(result.text).toBe('{"goal":"g"}');
      expect(waits).toEqual([2000]);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should stop on a used-up daily quota and say when it can resume', async () => {
      respond(429, {
        error: {
          message:
            'Rate limit reached for model `groq-model` on tokens per day (TPD): Limit 200000, Used 199000, Requested 5000. Please try again in 7m30s.',
          code: 'rate_limit_exceeded',
        },
      });
      const before = Date.now();
      const error = await summarize(groq, 's', 'p', { retry: noWait }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(SummarizerQuotaError);
      const quota = error as SummarizerQuotaError;
      expect(quota.retryable).toBe(false);
      expect(quota.message).toMatch(/daily quota/);
      expect(quota.resumeAt!.getTime()).toBeGreaterThanOrEqual(
        before + 450_000,
      );
    });

    it('should refuse a prompt larger than the context window without calling', async () => {
      const spy = respond(200, completion);
      const error = await summarize(
        { ...groq, contextTokens: 8000 },
        's',
        'x'.repeat(30_000),
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ContextTooLargeError);
      expect((error as ContextTooLargeError).retryable).toBe(false);
      expect((error as Error).message).toMatch(
        /context window \(8000 tokens\)/,
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('should map server errors to retryable and others to final errors', async () => {
      respond(503, { error: { message: 'overloaded' } });
      await expect(summarize(groq, 's', 'p')).rejects.toMatchObject({
        retryable: true,
        message: 'upstream returned 503',
      });
      jest.restoreAllMocks();
      respond(401, { error: { message: 'bad key' } });
      await expect(summarize(groq, 's', 'p')).rejects.toMatchObject({
        retryable: false,
        message: 'upstream returned 401',
      });
    });
  });

  it('should give up on a per-minute limit after the retries, retryably', async () => {
    const spy = respond(429, { error: { message: 'slow down' } });
    await expect(
      summarize(target('gemini'), 's', 'p', {
        retry: { ...noWait, maxRetries: 2 },
      }),
    ).rejects.toMatchObject({
      retryable: true,
      message: 'upstream returned 429',
    });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
