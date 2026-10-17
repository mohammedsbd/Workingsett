import { describe, expect, it } from 'vitest';
import { ConfigError, providerConfig } from '../src/config.js';
import {
  checkContext,
  ContextTooLargeError,
  estimateRequestTokens,
} from '../src/llm/context-guard.js';
import {
  fromGeminiResponse,
  toGeminiContents,
} from '../src/llm/gemini-model.js';
import { toAnthropic } from '../src/llm/anthropic-model.js';
import {
  parseDuration,
  QuotaExhaustedError,
  rateLimitInfo,
  RateLimitedError,
  withRateLimitRetry,
} from '../src/llm/rate-limit.js';
import type { ChatMessage } from '../src/llm/types.js';

describe('context guard', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 's'.repeat(3000) },
    { role: 'user', content: 'u'.repeat(3000) },
  ];

  it('should estimate about one token per 3 characters', () => {
    expect(estimateRequestTokens(messages, [])).toBeGreaterThanOrEqual(2000);
    expect(estimateRequestTokens(messages, [])).toBeLessThan(2100);
  });

  it('should refuse a request above the context window or the per-request limit', () => {
    expect(() =>
      checkContext(messages, [], {
        contextTokens: 2500,
        maxOutputTokens: 1000,
      }),
    ).toThrow(ContextTooLargeError);
    const error = (() => {
      try {
        checkContext(messages, [], {
          contextTokens: 131_072,
          maxRequestTokens: 2500,
          maxOutputTokens: 1000,
        });
      } catch (e) {
        return e as ContextTooLargeError;
      }
    })();
    expect(error?.limitName).toBe('the per-request token limit');
    expect(error?.message).toMatch(/2500 tokens/);
    expect(
      checkContext(messages, [], {
        contextTokens: 131_072,
        maxOutputTokens: 1000,
      }),
    ).toBeGreaterThan(3000);
  });
});

describe('rate limits', () => {
  it('should read the wait from Retry-After or the error text, and spot daily limits', () => {
    expect(parseDuration('7m54.24s')).toBe(474_240);
    expect(rateLimitInfo({ 'retry-after': '2' }, '')).toEqual({
      retryAfterMs: 2000,
      daily: false,
    });
    expect(
      rateLimitInfo(
        undefined,
        'Rate limit reached on tokens per day (TPD). Please try again in 1h2m.',
      ),
    ).toEqual({ retryAfterMs: 3_720_000, daily: true });
  });

  it('should back off exponentially without a given wait and stop on a daily limit', async () => {
    const waits: number[] = [];
    let n = 0;
    await withRateLimitRetry(
      () =>
        ++n < 3
          ? Promise.reject(
              new RateLimitedError({ retryAfterMs: null, daily: false }),
            )
          : Promise.resolve('ok'),
      { baseDelayMs: 50, sleep: (ms) => (waits.push(ms), Promise.resolve()) },
    );
    expect(waits).toEqual([50, 100]);
    await expect(
      withRateLimitRetry(() =>
        Promise.reject(
          new RateLimitedError({ retryAfterMs: null, daily: true }),
        ),
      ),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });
});

describe('provider config', () => {
  const env = {
    GROQ_MODEL: 'groq-model',
    GROQ_API_KEY: 'gsk-test',
    GROQ_CONTEXT_TOKENS: '131072',
    GROQ_MAX_REQUEST_TOKENS: '8000',
    GROQ_FREE_TIER: 'true',
    GEMINI_MODEL: 'flash',
    GEMINI_API_KEY: 'g-test',
    PARSIM_BASE_URL: 'http://localhost:3001/',
    PARSIM_API_KEY: 'psm_test',
  };

  it('should read the model, key and limits, with Groq at its OpenAI-compatible base', () => {
    expect(providerConfig('groq', 'direct', env)).toMatchObject({
      model: 'groq-model',
      apiKey: 'gsk-test',
      baseUrl: 'https://api.groq.com/openai/v1',
      contextTokens: 131_072,
      maxRequestTokens: 8000,
      freeTier: true,
      temperature: 0,
      headers: {},
    });
  });

  it('should point the SDK at Parsim with the Parsim key in x-parsim-key', () => {
    expect(providerConfig('groq', 'parsim', env)).toMatchObject({
      baseUrl: 'http://localhost:3001/v1',
      apiKey: 'gsk-test',
      headers: { 'x-parsim-key': 'psm_test' },
    });
    expect(providerConfig('gemini', 'parsim', env).baseUrl).toBe(
      'http://localhost:3001',
    );
  });

  it('should refuse a missing model, key or Parsim setting', () => {
    expect(() => providerConfig('openai', 'direct', env)).toThrow(
      /OPENAI_MODEL is not set/,
    );
    expect(() =>
      providerConfig('groq', 'parsim', { ...env, PARSIM_API_KEY: '' }),
    ).toThrow(ConfigError);
    expect(() =>
      providerConfig('groq', 'direct', { ...env, GROQ_CONTEXT_TOKENS: 'lots' }),
    ).toThrow(/positive whole number/);
  });
});

describe('message conversion', () => {
  const history: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'a', name: 'web_search', arguments: { query: 'x' } },
        { id: 'b', name: 'fetch_page', arguments: { url: 'u' } },
      ],
    },
    { role: 'tool', toolCallId: 'a', name: 'web_search', content: 'r1' },
    { role: 'tool', toolCallId: 'b', name: 'fetch_page', content: 'r2' },
  ];

  it('should merge tool results into one user turn for Gemini and keep model parts as sent', () => {
    const raw = [
      {
        functionCall: { id: 'a', name: 'web_search', args: { query: 'x' } },
        thoughtSignature: 'sig',
      },
    ];
    const { system, contents } = toGeminiContents([
      ...history.slice(0, 2),
      {
        ...(history[2] as Extract<ChatMessage, { role: 'assistant' }>),
        raw: { provider: 'gemini', content: raw },
      },
      ...history.slice(3),
    ]);
    expect(system).toBe('sys');
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1]!.parts).toBe(raw);
    expect(contents[2]!.parts).toHaveLength(2);
    expect(contents[2]!.parts![0]).toMatchObject({
      functionResponse: {
        id: 'a',
        name: 'web_search',
        response: { output: 'r1' },
      },
    });
  });

  it('should give id-less Gemini function calls stable ids, also in the parts sent back', () => {
    const turn = fromGeminiResponse(
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'thinking', thought: true },
                { functionCall: { name: 'web_search', args: { query: 'x' } } },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 3,
        },
      } as never,
      'call_7',
    );
    expect(turn.text).toBe('');
    expect(turn.toolCalls).toEqual([
      { id: 'call_7_1', name: 'web_search', arguments: { query: 'x' } },
    ]);
    expect(
      (turn.raw!.content as { functionCall?: { id: string } }[])[1]!
        .functionCall!.id,
    ).toBe('call_7_1');
    expect(turn.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
    });
  });

  it('should send Anthropic tool results as one user message after the tool_use turn', () => {
    const { system, messages } = toAnthropic(history);
    expect(system).toBe('sys');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1]!.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'web_search', input: { query: 'x' } },
      { type: 'tool_use', id: 'b', name: 'fetch_page', input: { url: 'u' } },
    ]);
    expect(messages[2]!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'r1' },
      { type: 'tool_result', tool_use_id: 'b', content: 'r2' },
    ]);
  });
});
