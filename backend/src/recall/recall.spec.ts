import { describe, expect, it } from '@jest/globals';
import { anthropicRecall } from './anthropic-recall';
import { archiveStubIds } from './archive-stubs';
import { geminiRecall } from './gemini-recall';
import { openAiRecall } from './openai-recall';
import { RecallFormat, StreamEvent } from './recall-format';
import { planRecallRound } from './recall-limit';
import {
  archivedText,
  archiveIdFrom,
  RECALL_SYSTEM_LINE,
  RECALL_TOOL_NAME,
  recallNotFound,
} from './recall-tool';
import { parseEvent, SseEventSplitter } from './sse-events';

const sse = (data: unknown, name?: string): StreamEvent =>
  parseEvent(
    `${name ? `event: ${name}\n` : ''}data: ${
      typeof data === 'string' ? data : JSON.stringify(data)
    }\n\n`,
  );

const clientTool = {
  type: 'function',
  function: { name: 'web_search', parameters: { type: 'object' } },
};

describe('parsim_recall', () => {
  describe('injection', () => {
    const cases: {
      name: string;
      format: RecallFormat;
      body: Record<string, unknown>;
      clientTools: (body: Record<string, unknown>) => unknown;
      recallTool: (body: Record<string, unknown>) => unknown;
    }[] = [
      {
        name: 'OpenAI',
        format: openAiRecall,
        body: {
          model: 'gpt-4o',
          tools: [clientTool],
          messages: [
            { role: 'system', content: 'S' },
            { role: 'developer', content: 'D' },
            { role: 'user', content: 'Q' },
          ],
        },
        clientTools: (b) => (b.tools as unknown[]).slice(0, 1),
        recallTool: (b) =>
          (b.tools as { function: { name: string } }[])[1].function.name,
      },
      {
        name: 'Anthropic',
        format: anthropicRecall,
        body: {
          model: 'claude',
          system: [
            { type: 'text', text: 'S', cache_control: { type: 'ephemeral' } },
          ],
          tools: [{ name: 'web_search', input_schema: { type: 'object' } }],
          messages: [{ role: 'user', content: 'Q' }],
        },
        clientTools: (b) => (b.tools as unknown[]).slice(0, 1),
        recallTool: (b) => (b.tools as { name: string }[])[1].name,
      },
      {
        name: 'Gemini',
        format: geminiRecall,
        body: {
          systemInstruction: { parts: [{ text: 'S' }] },
          tools: [
            { googleSearch: {} },
            { functionDeclarations: [{ name: 'web_search' }] },
          ],
          contents: [{ role: 'user', parts: [{ text: 'Q' }] }],
        },
        clientTools: (b) => [
          (b.tools as unknown[])[0],
          (
            (b.tools as { functionDeclarations?: unknown[] }[])[1]
              .functionDeclarations ?? []
          ).slice(0, 1),
        ],
        recallTool: (b) =>
          (b.tools as { functionDeclarations: { name: string }[] }[])[1]
            .functionDeclarations[1].name,
      },
    ];

    it.each(cases)(
      'should keep $name client tools unchanged and append parsim_recall',
      ({ format, body, clientTools, recallTool }) => {
        const before = JSON.stringify(body);
        const injected = format.inject(body);

        expect(JSON.stringify(body)).toBe(before);
        const original = JSON.parse(before) as Record<string, unknown>;
        expect(clientTools(injected)).toEqual(
          format === geminiRecall
            ? [
                (original.tools as unknown[])[0],
                (original.tools as { functionDeclarations: unknown[] }[])[1]
                  .functionDeclarations,
              ]
            : original.tools,
        );
        expect(recallTool(injected)).toBe(RECALL_TOOL_NAME);
        expect(JSON.stringify(injected)).toContain(RECALL_SYSTEM_LINE);
      },
    );

    it.each(cases)(
      'should inject byte-identically on every call ($name)',
      ({ format, body }) => {
        expect(JSON.stringify(format.inject(body))).toBe(
          JSON.stringify(format.inject(JSON.parse(JSON.stringify(body)))),
        );
      },
    );

    it('should put the OpenAI system line after the leading system messages', () => {
      const injected = openAiRecall.inject(cases[0].body) as {
        messages: { role: string; content: string }[];
      };
      expect(injected.messages.map((m) => m.content)).toEqual([
        'S',
        'D',
        RECALL_SYSTEM_LINE,
        'Q',
      ]);
      expect(
        (openAiRecall.inject({ messages: [] }) as { messages: unknown[] })
          .messages,
      ).toEqual([{ role: 'system', content: RECALL_SYSTEM_LINE }]);
    });

    it.each([
      ['a string', 'S', `S\n\n${RECALL_SYSTEM_LINE}`],
      ['absent', undefined, RECALL_SYSTEM_LINE],
      [
        'blocks with a cache breakpoint',
        [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
        [
          { type: 'text', text: 'S', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: RECALL_SYSTEM_LINE },
        ],
      ],
    ])(
      'should add the Anthropic system line to %s system',
      (_, system, expected) => {
        expect(anthropicRecall.inject({ system }).system).toEqual(expected);
        expect(anthropicRecall.inject({}).tools).toHaveLength(1);
      },
    );

    it('should add a Gemini tool and system instruction when there are none', () => {
      expect(geminiRecall.inject({ contents: [] })).toEqual({
        contents: [],
        systemInstruction: { parts: [{ text: RECALL_SYSTEM_LINE }] },
        tools: [
          {
            functionDeclarations: [
              expect.objectContaining({ name: RECALL_TOOL_NAME }),
            ],
          },
        ],
      });
    });
  });

  describe('responses', () => {
    it('should split OpenAI recall and client tool calls', () => {
      const turn = openAiRecall.turnFromResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Checking.',
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: {
                    name: RECALL_TOOL_NAME,
                    arguments: '{"archive_id":"arc_1"}',
                  },
                },
                {
                  id: 'c2',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{}' },
                },
              ],
            },
          },
        ],
      })!;

      expect(turn.recallCalls).toEqual([{ id: 'c1', archiveId: 'arc_1' }]);
      expect(turn.clientToolCalls).toBe(1);
      expect(turn.followUpMessage).toEqual({
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: {
              name: RECALL_TOOL_NAME,
              arguments: '{"archive_id":"arc_1"}',
            },
          },
        ],
      });
      expect(openAiRecall.turnFromResponse({ error: {} })).toBeNull();
    });

    it('should keep Anthropic thinking and text but drop client tool_use', () => {
      const thinking = { type: 'thinking', thinking: 'hm', signature: 'sig' };
      const turn = anthropicRecall.turnFromResponse({
        content: [
          thinking,
          { type: 'text', text: 'Let me look.' },
          {
            type: 'tool_use',
            id: 't1',
            name: RECALL_TOOL_NAME,
            input: { archive_id: 'arc_2' },
          },
          { type: 'tool_use', id: 't2', name: 'web_search', input: {} },
        ],
      })!;

      expect(turn.recallCalls).toEqual([{ id: 't1', archiveId: 'arc_2' }]);
      expect(turn.clientToolCalls).toBe(1);
      expect(
        (turn.followUpMessage.content as { type: string }[]).map((b) => b.type),
      ).toEqual(['thinking', 'text', 'tool_use']);
      expect(anthropicRecall.turnFromResponse('nope')).toBeNull();
    });

    it('should read Gemini function calls with and without ids', () => {
      const turn = geminiRecall.turnFromResponse({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Looking.' },
                {
                  functionCall: {
                    name: RECALL_TOOL_NAME,
                    args: { archive_id: 'arc_3' },
                  },
                  thoughtSignature: 'sig',
                },
                {
                  functionCall: {
                    id: 'g2',
                    name: RECALL_TOOL_NAME,
                    args: { archive_id: 'arc_4' },
                  },
                },
                { functionCall: { name: 'web_search', args: {} } },
              ],
            },
          },
        ],
      })!;

      expect(turn.recallCalls).toEqual([
        { id: '', archiveId: 'arc_3' },
        { id: 'g2', archiveId: 'arc_4' },
      ]);
      expect(turn.clientToolCalls).toBe(1);
      expect(turn.followUpMessage.parts).toHaveLength(3);
      expect(geminiRecall.turnFromResponse({ candidates: [] })).toBeNull();
    });
  });

  describe('follow-up requests', () => {
    const results = [
      { call: { id: 'c1', archiveId: 'arc_1' }, text: 'ORIGINAL' },
    ];

    it('should append the turn and tool results, and turn tools off when final', () => {
      const turn = openAiRecall.turnFromResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  function: {
                    name: RECALL_TOOL_NAME,
                    arguments: '{"archive_id":"arc_1"}',
                  },
                },
              ],
            },
          },
        ],
      })!;
      const body = { model: 'm', messages: [{ role: 'user', content: 'Q' }] };

      const next = openAiRecall.followUp(body, turn, results, false);
      expect(next.messages).toEqual([
        { role: 'user', content: 'Q' },
        turn.followUpMessage,
        { role: 'tool', tool_call_id: 'c1', content: 'ORIGINAL' },
      ]);
      expect(next).not.toHaveProperty('tool_choice');
      expect(openAiRecall.followUp(body, turn, results, true).tool_choice).toBe(
        'none',
      );
    });

    it('should answer Anthropic recalls in one user message', () => {
      const turn = anthropicRecall.turnFromResponse({ content: [] })!;
      const next = anthropicRecall.followUp(
        { messages: [] },
        turn,
        results,
        true,
      );
      expect(next.messages).toEqual([
        { role: 'assistant', content: [] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'c1', content: 'ORIGINAL' },
          ],
        },
      ]);
      expect(next.tool_choice).toEqual({ type: 'none' });
    });

    it('should answer Gemini recalls as function responses, with ids only when given', () => {
      const turn = geminiRecall.turnFromResponse({
        candidates: [{ content: { parts: [] } }],
      })!;
      const next = geminiRecall.followUp(
        {
          contents: [],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        },
        turn,
        [...results, { call: { id: '', archiveId: 'x' }, text: 'NO' }],
        true,
      );
      expect((next.contents as unknown[])[1]).toEqual({
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'c1',
              name: RECALL_TOOL_NAME,
              response: { output: 'ORIGINAL' },
            },
          },
          {
            functionResponse: {
              name: RECALL_TOOL_NAME,
              response: { output: 'NO' },
            },
          },
        ],
      });
      expect(next.toolConfig).toEqual({
        functionCallingConfig: { mode: 'NONE' },
      });
    });
  });

  describe('stream watchers', () => {
    it('should forward OpenAI text and hold from the first tool call', () => {
      const watcher = openAiRecall.newStreamWatcher();
      const chunk = (delta: object, finish: string | null = null) =>
        sse({ id: 'x', choices: [{ index: 0, delta, finish_reason: finish }] });

      expect(watcher.push(chunk({ role: 'assistant', content: 'Let ' }))).toBe(
        true,
      );
      expect(watcher.push(chunk({ content: 'me check.' }))).toBe(true);
      expect(
        watcher.push(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'c1',
                type: 'function',
                function: { name: RECALL_TOOL_NAME, arguments: '{"archive' },
              },
            ],
          }),
        ),
      ).toBe(false);
      expect(
        watcher.push(
          chunk({
            tool_calls: [
              { index: 0, function: { arguments: '_id":"arc_9"}' } },
            ],
          }),
        ),
      ).toBe(false);
      expect(watcher.push(chunk({}, 'tool_calls'))).toBe(false);
      expect(watcher.push(sse('[DONE]'))).toBe(false);

      const turn = watcher.turn();
      expect(turn.recallCalls).toEqual([{ id: 'c1', archiveId: 'arc_9' }]);
      expect(turn.followUpMessage.content).toBe('Let me check.');
    });

    it('should rebuild Anthropic blocks, count forwarded ones and hold tool_use', () => {
      const watcher = anthropicRecall.newStreamWatcher();
      const events = [
        sse({ type: 'message_start', message: { id: 'm1' } }, 'message_start'),
        sse({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
        sse({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'hm' },
        }),
        sse({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'sig' },
        }),
        sse({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        sse({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'Checking.' },
        }),
        sse({ type: 'content_block_stop', index: 1 }),
      ];
      expect(events.map((e) => watcher.push(e))).toEqual(
        events.map(() => true),
      );
      expect(
        watcher.push(
          sse({
            type: 'content_block_start',
            index: 2,
            content_block: {
              type: 'tool_use',
              id: 't1',
              name: RECALL_TOOL_NAME,
              input: {},
            },
          }),
        ),
      ).toBe(false);
      watcher.push(
        sse({
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '{"archive_id":' },
        }),
      );
      watcher.push(
        sse({
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'input_json_delta', partial_json: '"arc_5"}' },
        }),
      );
      expect(watcher.push(sse({ type: 'message_stop' }))).toBe(false);

      expect(watcher.forwardedBlocks).toBe(2);
      const turn = watcher.turn();
      expect(turn.recallCalls).toEqual([{ id: 't1', archiveId: 'arc_5' }]);
      expect(turn.followUpMessage.content).toEqual([
        { type: 'thinking', thinking: 'hm', signature: 'sig' },
        { type: 'text', text: 'Checking.' },
        {
          type: 'tool_use',
          id: 't1',
          name: RECALL_TOOL_NAME,
          input: { archive_id: 'arc_5' },
        },
      ]);
    });

    it('should hold Gemini chunks from the first function call', () => {
      const watcher = geminiRecall.newStreamWatcher();
      const chunk = (parts: unknown[]) =>
        sse({ candidates: [{ content: { role: 'model', parts } }] });

      expect(watcher.push(chunk([{ text: 'Looking' }]))).toBe(true);
      expect(
        watcher.push(
          chunk([
            {
              functionCall: {
                name: RECALL_TOOL_NAME,
                args: { archive_id: 'arc_6' },
              },
            },
          ]),
        ),
      ).toBe(false);
      expect(watcher.push(chunk([{ text: 'more' }]))).toBe(false);
      expect(watcher.turn().recallCalls).toEqual([
        { id: '', archiveId: 'arc_6' },
      ]);
    });
  });

  describe('splicers', () => {
    it('should give OpenAI follow-up chunks the first response id', () => {
      const splice = openAiRecall.newSplicer({
        responseId: 'chatcmpl-1',
        blockOffset: 0,
      });
      const out = splice(sse({ id: 'chatcmpl-2', choices: [] }));
      expect(parseEvent(out!).data).toEqual({ id: 'chatcmpl-1', choices: [] });
      expect(splice(sse('[DONE]'))).toBe('data: [DONE]\n\n');
    });

    it('should drop the Anthropic follow-up message_start and shift block indexes', () => {
      const splice = anthropicRecall.newSplicer({
        responseId: null,
        blockOffset: 2,
      });
      expect(
        splice(sse({ type: 'message_start', message: {} }, 'message_start')),
      ).toBeNull();
      const out = splice(
        sse(
          { type: 'content_block_start', index: 0, content_block: {} },
          'content_block_start',
        ),
      )!;
      expect(out.startsWith('event: content_block_start\n')).toBe(true);
      expect(parseEvent(out).data).toMatchObject({ index: 2 });
      const stop = sse({ type: 'message_stop' }, 'message_stop');
      expect(splice(stop)).toBe(stop.raw);
    });

    it('should pass Gemini follow-up chunks unchanged', () => {
      const event = sse({ candidates: [] });
      expect(
        geminiRecall.newSplicer({ responseId: null, blockOffset: 0 })(event),
      ).toBe(event.raw);
    });
  });

  describe('helpers', () => {
    it('should find archive stub ids in any request body, once each', () => {
      const stub = (id: string) =>
        `[parsim archived: fetch_page result, 912 tokens, id ${id}]`;
      const body = JSON.stringify({
        messages: [
          { role: 'tool', content: stub('arc_0123456789abcdef') },
          {
            content: [
              { type: 'tool_result', content: stub('arc_fedcba9876543210') },
            ],
          },
          {
            functionResponse: {
              response: { output: stub('arc_0123456789abcdef') },
            },
          },
          {
            content:
              '[parsim dropped: x result, duplicate of a later tool result]',
          },
          { content: '[parsim archived: x result, 1 tokens, id arc_short]' },
        ],
      });
      expect(archiveStubIds(body)).toEqual([
        'arc_0123456789abcdef',
        'arc_fedcba9876543210',
      ]);
      expect(archiveStubIds('{}')).toEqual([]);
    });

    it.each([
      ['{"archive_id":" arc_1 "}', 'arc_1'],
      [{ archive_id: 'arc_2' }, 'arc_2'],
      ['not json', ''],
      [{ archive_id: 7 }, ''],
      [null, ''],
    ])('should read the archive id from %j', (input, expected) => {
      expect(archiveIdFrom(input)).toBe(expected);
    });

    it('should render archived content as text', () => {
      expect(
        archivedText({
          kind: 'tool_result',
          parts: [
            {
              type: 'tool_result',
              isError: false,
              content: [
                { type: 'text', text: 'Page text. ' },
                { type: 'image', image: { source: 'url', url: 'u' } },
                { type: 'other', value: { output: { total: 1 } } },
                { type: 'other', value: 'plain' },
                { type: 'other', value: { output: ' unwrapped' } },
                { type: 'thinking', text: '!' },
                { type: 'tool_call', name: 'f', input: { a: 1 } },
              ],
            },
          ],
        }),
      ).toBe('Page text. [image]{"output":{"total":1}}plain unwrapped!{"a":1}');
    });

    it('should explain a missing archive id', () => {
      expect(recallNotFound('arc_x')).toContain('arc_x was not found');
      expect(recallNotFound('')).toContain('No archive id');
    });

    it('should split SSE bytes into events across chunk boundaries', () => {
      const splitter = new SseEventSplitter();
      const first = splitter.push(Buffer.from('event: a\ndata: {"x":1}\n\nda'));
      const second = splitter.push(Buffer.from('ta: [DONE]\n\ndata: oops'));
      expect(first).toEqual([
        { raw: 'event: a\ndata: {"x":1}\n\n', name: 'a', data: { x: 1 } },
      ]);
      expect(second.map((e) => e.data)).toEqual(['[DONE]']);
      expect(splitter.flush()).toEqual([
        { raw: 'data: oops', name: null, data: null },
      ]);
      expect(splitter.flush()).toEqual([]);
    });
  });

  describe('loop limit', () => {
    const calls = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        archiveId: `a${i}`,
      }));

    it.each([
      { used: 0, n: 2, fetch: 2, refused: 0, final: false },
      { used: 0, n: 3, fetch: 3, refused: 0, final: false },
      { used: 2, n: 2, fetch: 1, refused: 1, final: true },
      { used: 3, n: 1, fetch: 0, refused: 1, final: true },
      { used: 5, n: 2, fetch: 0, refused: 2, final: true },
    ])(
      'should allow $fetch and refuse $refused of $n calls after $used recalls',
      ({ used, n, fetch, refused, final }) => {
        const round = planRecallRound(calls(n), used, 3);
        expect(round.fetch).toHaveLength(fetch);
        expect(round.refused).toHaveLength(refused);
        expect(round.final).toBe(final);
        expect([...round.fetch, ...round.refused]).toEqual(calls(n));
      },
    );
  });
});
