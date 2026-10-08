import { AnthropicMessagesConverter } from './anthropic-messages.converter';
import { ToolResultPart } from './internal-model';

const converter = new AnthropicMessagesConverter();

const roundTrip = (body: Record<string, unknown>) =>
  JSON.stringify(converter.fromInternal(converter.toInternal(body)));

const toolSession = {
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  system: [
    {
      type: 'text',
      text: 'You are a support agent.',
      cache_control: { type: 'ephemeral' },
    },
  ],
  tools: [
    {
      name: 'get_order',
      description: 'Get an order',
      input_schema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
      },
    },
  ],
  messages: [
    { role: 'user', content: 'Where is O-5001?' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Look it up.', signature: 'sig==' },
        { type: 'text', text: 'Checking.' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'get_order',
          input: { orderId: 'O-5001' },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [{ type: 'text', text: '{"status":"in_transit"}' }],
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: 'plain',
          is_error: true,
        },
        { type: 'text', text: 'Thanks' },
      ],
    },
  ],
  stream: true,
};

describe('AnthropicMessagesConverter', () => {
  describe('round trip', () => {
    it('should rebuild a tool-use session byte for byte', () => {
      expect(roundTrip(toolSession)).toBe(JSON.stringify(toolSession));
    });

    it('should rebuild images, documents, redacted thinking and a string system prompt', () => {
      const body = {
        system: 'Short system prompt.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgo=',
                },
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'image',
                source: { type: 'url', url: 'https://example.com/b.jpg' },
              },
              {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: 'doc' },
                title: 'Notes',
              },
              { type: 'text', text: 'Describe these.' },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'redacted_thinking', data: 'abc' },
              { type: 'text', text: 'Two images and a note.' },
            ],
          },
          { role: 'user', content: [] },
        ],
        model: 'claude-sonnet-4-5',
        max_tokens: 64,
        metadata: { user_id: 'u-1' },
      };

      expect(roundTrip(body)).toBe(JSON.stringify(body));
    });

    it('should keep a body without a system prompt without one', () => {
      const body = {
        model: 'm',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      };
      expect(roundTrip(body)).toBe(JSON.stringify(body));
    });
  });

  describe('internal model', () => {
    const internal = converter.toInternal(toolSession);

    it('should keep the system prompt and its cache_control marker', () => {
      expect(internal.system?.parts).toEqual([
        expect.objectContaining({
          type: 'text',
          text: 'You are a support agent.',
          cacheControl: { type: 'ephemeral' },
        }),
      ]);
    });

    it('should turn tool_use and tool_result blocks into tool parts', () => {
      expect(internal.messages[1].parts.map((p) => p.type)).toEqual([
        'thinking',
        'text',
        'tool_call',
      ]);
      const results = internal.messages[2].parts.filter(
        (p): p is ToolResultPart => p.type === 'tool_result',
      );
      expect(results).toEqual([
        expect.objectContaining({
          toolCallId: 'toolu_1',
          isError: false,
          cacheControl: { type: 'ephemeral', ttl: '1h' },
          content: [
            expect.objectContaining({
              type: 'text',
              text: '{"status":"in_transit"}',
            }),
          ],
        }),
        expect.objectContaining({ toolCallId: 'toolu_2', isError: true }),
      ]);
    });

    it('should let a cache_control marker move without other changes', () => {
      const edited = converter.toInternal(toolSession);
      const system = edited.system!.parts[0];
      if (system.type === 'text') system.cacheControl = undefined;

      const out = converter.fromInternal(edited) as {
        system: { cache_control?: unknown }[];
      };
      expect(out.system[0]).toEqual({
        type: 'text',
        text: 'You are a support agent.',
      });
    });
  });
});
