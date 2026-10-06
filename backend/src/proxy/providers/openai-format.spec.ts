import {
  injectIncludeUsage,
  readOpenAiUsage,
  toTokenUsage,
} from './openai-format';

describe('openai-format', () => {
  describe('injectIncludeUsage', () => {
    it('should add stream_options and keep every other byte as sent', () => {
      const raw = '{ "model":"m",\n  "stream" : true ,"messages":[] }\n';
      const out = injectIncludeUsage(Buffer.from(raw)).toString();

      expect(out).toBe(
        '{ "model":"m",\n  "stream" : true ,"messages":[] ,"stream_options":{"include_usage":true}}\n',
      );
      expect(JSON.parse(out)).toEqual({
        model: 'm',
        stream: true,
        messages: [],
        stream_options: { include_usage: true },
      });
    });

    it('should not add a comma to an empty object', () => {
      expect(injectIncludeUsage(Buffer.from('{ }')).toString()).toBe(
        '{ "stream_options":{"include_usage":true}}',
      );
    });

    it('should keep non-ASCII content intact', () => {
      const raw = '{"messages":[{"content":"héllo 👋 }"}],"stream":true}';
      const out = JSON.parse(
        injectIncludeUsage(Buffer.from(raw)).toString(),
      ) as { messages: { content: string }[] };
      expect(out.messages[0].content).toBe('héllo 👋 }');
    });

    it('should refuse a body that is not an object', () => {
      expect(() => injectIncludeUsage(Buffer.from('[1,2]'))).toThrow();
    });
  });

  describe('toTokenUsage', () => {
    const body = {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 64 },
      },
    };

    it('should read OpenAI usage including cached prompt tokens', () => {
      expect(toTokenUsage(readOpenAiUsage(body))).toEqual({
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 64,
        cacheWriteInputTokens: null,
      });
    });

    it('should count hidden thinking tokens from total_tokens when asked (Gemini)', () => {
      expect(toTokenUsage(readOpenAiUsage(body), true)?.outputTokens).toBe(50);
    });

    it('should never report fewer output tokens than completion_tokens', () => {
      const odd = {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 12 },
      };
      expect(toTokenUsage(readOpenAiUsage(odd), true)?.outputTokens).toBe(5);
    });

    it('should return null when usage is missing, null or incomplete', () => {
      expect(toTokenUsage(readOpenAiUsage({}))).toBeNull();
      expect(toTokenUsage(readOpenAiUsage({ usage: null }))).toBeNull();
      expect(
        toTokenUsage(readOpenAiUsage({ usage: { prompt_tokens: 1 } })),
      ).toBeNull();
      expect(toTokenUsage(readOpenAiUsage('text'))).toBeNull();
    });
  });
});
