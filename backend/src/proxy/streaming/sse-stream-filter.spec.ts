import { toTokenUsage, readOpenAiUsage } from '../providers/openai-format';
import { eventData, SseStreamFilter } from './sse-stream-filter';

const openAiUsage = (chunk: unknown) => toTokenUsage(readOpenAiUsage(chunk));
const geminiUsage = (chunk: unknown) =>
  toTokenUsage(readOpenAiUsage(chunk), true);

const sse = (...events: unknown[]) =>
  events
    .map(
      (data) =>
        `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    )
    .join('');

const content = (text: string, extra: object = {}) => ({
  choices: [{ index: 0, delta: { content: text } }],
  ...extra,
});

const usage = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 };

/** Feeds the stream in pieces of `size` bytes and collects the output. */
function run(filter: SseStreamFilter, input: string, size = 7): string {
  const bytes = Buffer.from(input, 'utf8');
  const out: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(filter.push(bytes.subarray(i, i + size)));
  }
  out.push(filter.flush());
  return Buffer.concat(out).toString('utf8');
}

describe('SseStreamFilter', () => {
  describe('when the client asked for usage itself (pass-through)', () => {
    it('should forward every byte unchanged and still read the usage', () => {
      const stream = sse(
        content('Hel', { usage: null }),
        content('lo', { usage: null }),
        { choices: [], usage },
        '[DONE]',
      );
      const filter = new SseStreamFilter(openAiUsage, false);

      expect(run(filter, stream)).toBe(stream);
      expect(filter.usage).toEqual({
        inputTokens: 10,
        outputTokens: 4,
        cachedInputTokens: null,
      });
    });

    it('should forward each chunk immediately, not at the end', () => {
      const filter = new SseStreamFilter(openAiUsage, false);
      const first = Buffer.from(sse(content('a')));

      expect(filter.push(first)).toEqual(first);
    });
  });

  describe('when Parsim injected include_usage', () => {
    it('should drop the usage-only chunk and the usage: null fields (OpenAI)', () => {
      const filter = new SseStreamFilter(openAiUsage, true);
      const out = run(
        filter,
        sse(
          content('Hel', { usage: null }),
          content('lo', { usage: null }),
          { choices: [], usage },
          '[DONE]',
        ),
      );

      expect(out).toBe(sse(content('Hel'), content('lo'), '[DONE]'));
      expect(filter.usage?.inputTokens).toBe(10);
    });

    it('should strip usage from content chunks and count thinking tokens (Gemini)', () => {
      const geminiTotals = { ...usage, total_tokens: 40 };
      const filter = new SseStreamFilter(geminiUsage, true);
      const out = run(
        filter,
        sse(
          content('Hi', { usage: geminiTotals }),
          content('!', { usage: geminiTotals }),
          '[DONE]',
        ),
      );

      expect(out).toBe(sse(content('Hi'), content('!'), '[DONE]'));
      expect(filter.usage).toEqual({
        inputTokens: 10,
        outputTokens: 30,
        cachedInputTokens: null,
      });
    });

    it('should keep events without usage byte for byte', () => {
      const filter = new SseStreamFilter(openAiUsage, true);
      const raw = 'event: ping\ndata: {"choices":[],"x":1}\n\n: comment\n\n';

      expect(run(filter, raw)).toBe(raw);
    });

    it('should only hold back an incomplete event', () => {
      const filter = new SseStreamFilter(openAiUsage, true);
      const event = sse(content('a'));

      expect(filter.push(Buffer.from(event.slice(0, 5)))).toHaveLength(0);
      expect(filter.push(Buffer.from(event.slice(5))).toString()).toBe(event);
    });
  });

  describe('parsing', () => {
    it('should handle CRLF separators and multi-byte characters split across chunks', () => {
      const filter = new SseStreamFilter(openAiUsage, true);
      const stream =
        `data: ${JSON.stringify(content('héllo 👋', { usage: null }))}\r\n\r\n` +
        `data: ${JSON.stringify({ choices: [], usage })}\r\n\r\n`;

      expect(run(filter, stream, 3)).toBe(
        `data: ${JSON.stringify(content('héllo 👋'))}\r\n\r\n`,
      );
      expect(filter.usage?.outputTokens).toBe(4);
    });

    it('should read cached tokens when reported', () => {
      const filter = new SseStreamFilter(openAiUsage, false);
      run(
        filter,
        sse({
          choices: [],
          usage: { ...usage, prompt_tokens_details: { cached_tokens: 6 } },
        }),
      );
      expect(filter.usage?.cachedInputTokens).toBe(6);
    });

    it('should ignore malformed data and streams without usage', () => {
      const filter = new SseStreamFilter(openAiUsage, false);
      run(filter, 'data: {not json\n\ndata: [DONE]\n\n');
      expect(filter.usage).toBeNull();
    });

    it('should flush a final event without a trailing separator', () => {
      const filter = new SseStreamFilter(openAiUsage, true);
      expect(run(filter, `data: ${JSON.stringify(content('end'))}`)).toBe(
        `data: ${JSON.stringify(content('end'))}`,
      );
    });

    it('should join multi-line data fields', () => {
      expect(eventData('event: x\ndata: a\ndata: b')).toBe('a\nb');
      expect(eventData(': only a comment')).toBeNull();
    });
  });
});
