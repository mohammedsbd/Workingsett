import { SseStreamFilter } from '../streaming/sse-stream-filter';
import {
  anthropicResponseUsage,
  anthropicStreamUsage,
  anthropicUsage,
} from './anthropic-format';

describe('anthropic-format', () => {
  describe('anthropicUsage (JSON responses)', () => {
    it('should add cache reads and writes to the input tokens', () => {
      expect(
        anthropicUsage({
          input_tokens: 12,
          output_tokens: 80,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 200,
        }),
      ).toEqual({
        inputTokens: 1212,
        outputTokens: 80,
        cachedInputTokens: 1000,
        cacheWriteInputTokens: 200,
      });
    });

    it('should report the 1-hour cache write split when present', () => {
      expect(
        anthropicUsage({
          input_tokens: 5,
          output_tokens: 1,
          cache_creation_input_tokens: 300,
          cache_creation: {
            ephemeral_5m_input_tokens: 100,
            ephemeral_1h_input_tokens: 200,
          },
        }),
      ).toMatchObject({
        cacheWriteInputTokens: 300,
        cacheWrite1hInputTokens: 200,
      });
    });

    it('should leave cache fields null when the response has none', () => {
      expect(anthropicUsage({ input_tokens: 9, output_tokens: 3 })).toEqual({
        inputTokens: 9,
        outputTokens: 3,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
      });
    });

    it('should return null when usage is missing or incomplete', () => {
      expect(anthropicResponseUsage({ type: 'message' })).toBeNull();
      expect(anthropicUsage({ input_tokens: 1 })).toBeNull();
      expect(anthropicUsage('nope')).toBeNull();
    });

    it('should read usage from a full message response', () => {
      expect(
        anthropicResponseUsage({
          type: 'message',
          content: [{ type: 'text', text: 'Hi' }],
          usage: { input_tokens: 4, output_tokens: 2 },
        })?.outputTokens,
      ).toBe(2);
    });
  });

  describe('anthropicStreamUsage (stream events)', () => {
    const messageStart = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        usage: {
          input_tokens: 10,
          output_tokens: 1,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 40,
        },
      },
    };

    it('should take input and cache tokens from message_start', () => {
      expect(anthropicStreamUsage(messageStart, null)).toEqual({
        inputTokens: 550,
        outputTokens: 1,
        cachedInputTokens: 500,
        cacheWriteInputTokens: 40,
      });
    });

    it('should take the final output tokens from message_delta and keep the rest', () => {
      const start = anthropicStreamUsage(messageStart, null);
      const end = anthropicStreamUsage(
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 75 },
        },
        start,
      );

      expect(end).toEqual({
        inputTokens: 550,
        outputTokens: 75,
        cachedInputTokens: 500,
        cacheWriteInputTokens: 40,
      });
    });

    it('should use input and cache counts that message_delta repeats', () => {
      const end = anthropicStreamUsage(
        {
          type: 'message_delta',
          usage: {
            input_tokens: 20,
            output_tokens: 75,
            cache_read_input_tokens: 600,
            cache_creation_input_tokens: 0,
          },
        },
        anthropicStreamUsage(messageStart, null),
      );

      expect(end).toEqual({
        inputTokens: 620,
        outputTokens: 75,
        cachedInputTokens: 600,
        cacheWriteInputTokens: 0,
      });
    });

    it('should ignore events without usage', () => {
      const start = anthropicStreamUsage(messageStart, null);
      for (const event of [
        { type: 'content_block_start', index: 0 },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'x' },
        },
        { type: 'ping' },
        { type: 'message_stop' },
      ]) {
        expect(anthropicStreamUsage(event, start)).toBe(start);
      }
    });

    it('should still count output when message_start was missed', () => {
      expect(
        anthropicStreamUsage(
          { type: 'message_delta', usage: { output_tokens: 7 } },
          null,
        ),
      ).toEqual({
        inputTokens: 0,
        outputTokens: 7,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
      });
    });
  });

  describe('with the stream filter', () => {
    it('should pass an Anthropic stream through unchanged and read its usage', () => {
      const stream = [
        ['message_start', messageStartWithCache()],
        [
          'content_block_start',
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        ],
        ['ping', { type: 'ping' }],
        [
          'content_block_delta',
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hé 👋' },
          },
        ],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        [
          'message_delta',
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 12 },
          },
        ],
        ['message_stop', { type: 'message_stop' }],
      ]
        .map(
          ([event, data]) =>
            `event: ${event as string}\ndata: ${JSON.stringify(data)}\n\n`,
        )
        .join('');
      const filter = new SseStreamFilter(anthropicStreamUsage, false);
      const bytes = Buffer.from(stream);
      const out: Buffer[] = [];
      for (let i = 0; i < bytes.length; i += 5) {
        out.push(filter.push(bytes.subarray(i, i + 5)));
      }
      out.push(filter.flush());

      expect(Buffer.concat(out).toString()).toBe(stream);
      expect(filter.usage).toEqual({
        inputTokens: 25 + 300 + 50,
        outputTokens: 12,
        cachedInputTokens: 300,
        cacheWriteInputTokens: 50,
      });
    });
  });
});

function messageStartWithCache() {
  return {
    type: 'message_start',
    message: {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      content: [],
      usage: {
        input_tokens: 25,
        output_tokens: 1,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 50,
      },
    },
  };
}
