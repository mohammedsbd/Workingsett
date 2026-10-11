import { extractContextItems } from './context-items';
import { AnthropicMessagesConverter } from './normalization/anthropic-messages.converter';
import { OpenAiChatConverter } from './normalization/openai-chat.converter';

const openai = new OpenAiChatConverter();
const anthropic = new AnthropicMessagesConverter();

describe('extractContextItems', () => {
  it('should split OpenAI messages into content, tool call and tool result items', () => {
    const items = extractContextItems(
      openai.toInternal({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'S' },
          { role: 'user', content: 'Find it' },
          {
            role: 'assistant',
            content: 'On it.',
            tool_calls: [
              {
                id: 'a',
                type: 'function',
                function: { name: 'search', arguments: '{"q":1}' },
              },
              {
                id: 'b',
                type: 'function',
                function: { name: 'fetch', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'a', content: 'r1' },
          { role: 'tool', tool_call_id: 'b', content: 'r2' },
        ],
      }),
    );

    expect(
      items.map((i) => [i.position, i.role, i.kind, i.toolCallId]),
    ).toEqual([
      [0, 'system', 'system', null],
      [1, 'user', 'user', null],
      [2, 'assistant', 'assistant', null],
      [3, 'assistant', 'tool_call', 'a'],
      [4, 'assistant', 'tool_call', 'b'],
      [5, 'tool', 'tool_result', 'a'],
      [6, 'tool', 'tool_result', 'b'],
    ]);
  });

  it('should treat the Anthropic system prompt and tool_result blocks as items', () => {
    const items = extractContextItems(
      anthropic.toInternal({
        system: 'You are terse.',
        messages: [
          { role: 'user', content: 'Q' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 't1', name: 'f', input: { x: 1 } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
              { type: 'text', text: 'And now?' },
            ],
          },
        ],
      }),
    );

    expect(items.map((i) => i.kind)).toEqual([
      'system',
      'user',
      'tool_call',
      'tool_result',
      'user',
    ]);
  });

  it('should point every item at its message and part', () => {
    const items = extractContextItems(
      anthropic.toInternal({
        system: 'S',
        messages: [
          { role: 'user', content: 'Q' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Looking.' },
              { type: 'tool_use', id: 't1', name: 'f', input: {} },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
              { type: 'text', text: 'And now?' },
            ],
          },
        ],
      }),
    );

    expect(items.map((i) => [i.kind, i.messageIndex, i.partIndex])).toEqual([
      ['system', null, null],
      ['user', 0, null],
      ['assistant', 1, null],
      ['tool_call', 1, 1],
      ['tool_result', 2, 0],
      ['user', 2, null],
    ]);
  });

  it('should give identical tool output the same hash, whatever the call id', () => {
    const items = extractContextItems(
      openai.toInternal({
        messages: [
          { role: 'tool', tool_call_id: 'call_1', content: 'same page text' },
          { role: 'tool', tool_call_id: 'call_9', content: 'same page text' },
          { role: 'tool', tool_call_id: 'call_2', content: 'other text' },
        ],
      }),
    );

    expect(items[0].contentHash).toBe(items[1].contentHash);
    expect(items[0].contentHash).not.toBe(items[2].contentHash);
  });

  it('should ignore cache_control markers when hashing', () => {
    const hashes = (marker: object | undefined) =>
      extractContextItems(
        anthropic.toInternal({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Long document',
                  ...(marker && { cache_control: marker }),
                },
              ],
            },
          ],
        }),
      )[0].contentHash;

    expect(hashes({ type: 'ephemeral' })).toBe(hashes(undefined));
  });

  it('should hash the same text differently by kind', () => {
    const items = extractContextItems(
      openai.toInternal({
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hello' },
        ],
      }),
    );

    expect(items[0].contentHash).not.toBe(items[1].contentHash);
  });

  it('should keep the hash of earlier items when messages are appended', () => {
    const first = [{ role: 'user', content: 'goal' }];
    const longer = [...first, { role: 'assistant', content: 'step 1' }];

    const a = extractContextItems(openai.toInternal({ messages: first }));
    const b = extractContextItems(openai.toInternal({ messages: longer }));

    expect(b[0]).toMatchObject({ position: 0, contentHash: a[0].contentHash });
  });

  it('should count images and collect text for token counting', () => {
    const [item] = extractContextItems(
      openai.toInternal({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Compare' },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/1.png' },
              },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/2.png' },
              },
            ],
          },
        ],
      }),
    );

    expect(item.imageCount).toBe(2);
    expect(item.tokenText).toContain('Compare');
    expect(item.tokenText).not.toContain('example.com');
  });
});
