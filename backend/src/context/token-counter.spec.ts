import { IMAGE_TOKENS, TokenCounter } from './token-counter';

describe('TokenCounter', () => {
  const counter = new TokenCounter();

  it('should count exactly with the model tokenizer for OpenAI models', () => {
    expect(
      counter.count('hello world', 0, { upstream: 'openai', model: 'gpt-4o' }),
    ).toEqual({ tokens: 2, tokenizer: 'tiktoken:o200k_base' });
  });

  it('should use the older tokenizer for older OpenAI models', () => {
    expect(
      counter.count('hello world', 0, { upstream: 'openai', model: 'gpt-4' })
        .tokenizer,
    ).toBe('tiktoken:cl100k_base');
  });

  it('should approximate unknown OpenAI models with o200k and say so', () => {
    expect(
      counter.count('hello world', 0, {
        upstream: 'openai',
        model: 'some-future-model',
      }),
    ).toEqual({ tokens: 2, tokenizer: 'approx:o200k_base' });
  });

  it.each(['anthropic', 'gemini'] as const)(
    'should mark %s counts as approximations',
    (upstream) => {
      const count = counter.count(
        'Summarize the attached quarterly report.',
        0,
        {
          upstream,
          model: 'm',
        },
      );

      expect(count.tokenizer).toBe('approx:o200k_base');
      expect(count.tokens).toBe(8);
    },
  );

  it('should add a fixed amount per image', () => {
    expect(
      counter.count('', 3, { upstream: 'openai', model: 'gpt-4o' }).tokens,
    ).toBe(3 * IMAGE_TOKENS);
  });

  it('should count long text', () => {
    const text = 'Section one of the report. '.repeat(500);
    const { tokens } = counter.count(text, 0, {
      upstream: 'openai',
      model: 'gpt-4o',
    });

    expect(tokens).toBeGreaterThan(2000);
    expect(tokens).toBeLessThan(4000);
  });
});
