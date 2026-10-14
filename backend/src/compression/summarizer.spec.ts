import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { summarize, SummarizerError, SummarizerTarget } from './summarizer';

const target = (provider: SummarizerTarget['provider']): SummarizerTarget => ({
  provider,
  model: 'test-model',
  baseUrl: 'http://upstream.test',
  apiKey: 'test-key',
});

function respond(status: number, body: unknown) {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

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
      const error = await summarize(target('gemini'), 's', 'p').catch(
        (e: unknown) => e,
      );
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
});
