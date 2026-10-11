import { describe, expect, it } from '@jest/globals';
import { TokenUsage } from '../../usage-records/domain/token-usage';
import {
  geminiResponseUsage,
  geminiStreamUsage,
  geminiUsage,
} from './gemini-format';

describe('Gemini usage', () => {
  it.each([
    {
      name: 'should read prompt and candidate tokens',
      metadata: { promptTokenCount: 42, candidatesTokenCount: 7 },
      expected: { inputTokens: 42, outputTokens: 7, cachedInputTokens: null },
    },
    {
      name: 'should bill thinking tokens as output',
      metadata: {
        promptTokenCount: 42,
        candidatesTokenCount: 7,
        thoughtsTokenCount: 20,
        totalTokenCount: 69,
      },
      expected: { inputTokens: 42, outputTokens: 27, cachedInputTokens: null },
    },
    {
      name: 'should report cached tokens, which the prompt count includes',
      metadata: {
        promptTokenCount: 1000,
        cachedContentTokenCount: 800,
        candidatesTokenCount: 5,
      },
      expected: { inputTokens: 1000, outputTokens: 5, cachedInputTokens: 800 },
    },
    {
      name: 'should add tool-use prompt tokens to the input',
      metadata: {
        promptTokenCount: 10,
        toolUsePromptTokenCount: 30,
        candidatesTokenCount: 2,
      },
      expected: { inputTokens: 40, outputTokens: 2, cachedInputTokens: null },
    },
    {
      name: 'should derive output from the total when no output count is sent',
      metadata: { promptTokenCount: 10, totalTokenCount: 15 },
      expected: { inputTokens: 10, outputTokens: 5, cachedInputTokens: null },
    },
    {
      name: 'should count zero output for a prompt-only report',
      metadata: { promptTokenCount: 10 },
      expected: { inputTokens: 10, outputTokens: 0, cachedInputTokens: null },
    },
  ])('$name', ({ metadata, expected }) => {
    expect(geminiUsage(metadata)).toEqual({
      ...expected,
      cacheWriteInputTokens: null,
    });
  });

  it.each([
    undefined,
    null,
    {},
    { promptTokenCount: -1 },
    { totalTokenCount: 3 },
  ])('should return null without a valid prompt count (%j)', (metadata) => {
    expect(geminiUsage(metadata)).toBeNull();
  });

  it('should read usage from a generateContent response', () => {
    expect(
      geminiResponseUsage({
        candidates: [],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
      }),
    ).toMatchObject({ inputTokens: 3, outputTokens: 4 });
    expect(geminiResponseUsage({ candidates: [] })).toBeNull();
    expect(geminiResponseUsage('not json')).toBeNull();
  });

  it('should read the last usage from a streamed JSON array response', () => {
    expect(
      geminiResponseUsage([
        { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } },
        { candidates: [] },
        { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 9 } },
      ]),
    ).toMatchObject({ inputTokens: 3, outputTokens: 9 });
  });

  it('should keep the latest running totals across stream chunks', () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
      { usageMetadata: { promptTokenCount: 42 } },
      { candidates: [] },
      {
        usageMetadata: {
          promptTokenCount: 42,
          candidatesTokenCount: 7,
          thoughtsTokenCount: 3,
        },
      },
      'garbage',
    ];
    let usage: TokenUsage | null = null;
    const seen = chunks.map(
      (chunk) => (usage = geminiStreamUsage(chunk, usage)),
    );

    expect(seen[0]).toBeNull();
    expect(seen[1]).toMatchObject({ inputTokens: 42, outputTokens: 0 });
    expect(seen[2]).toBe(seen[1]);
    expect(seen[4]).toMatchObject({ inputTokens: 42, outputTokens: 10 });
  });
});
