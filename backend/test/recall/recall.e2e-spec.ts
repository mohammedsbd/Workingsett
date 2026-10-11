import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { ProxyService } from '../../src/proxy/proxy.service';
import { archiveStubIds } from '../../src/recall/archive-stubs';
import {
  RECALL_LIMIT_REACHED,
  RECALL_SYSTEM_LINE,
  RECALL_TOOL_NAME,
} from '../../src/recall/recall-tool';
import {
  CannedResponse,
  defaultResponse,
  FAKE_REPLY_TEXT,
  FakeUpstream,
  parseSse,
  RecordedRequest,
} from '../utils/fake-upstream';
import {
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
  toOpenAiBody,
} from '../utils/fixtures';
import { createProjectWithKey, ProxyFixture } from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

type Api = 'openai' | 'anthropic' | 'gemini';

const MODEL = {
  openai: 'gpt-4o',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-3.8-flash',
};
const UPSTREAM = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
} as const;
const PATH = (api: Api, stream: boolean) =>
  api === 'openai'
    ? '/v1/chat/completions'
    : api === 'anthropic'
      ? '/v1/messages'
      : `/v1beta/models/${MODEL.gemini}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;

/** Usage the canned recall responses report, and the final default ones. */
const RECALL_USAGE = { input: 100, output: 10 };
const FINAL_INPUT = { openai: 42, anthropic: 82, gemini: 42 };
const FINAL_OUTPUT = 7;

/** A response in which the model calls parsim_recall (and maybe a client tool). */
function recallResponse(
  api: Api,
  archiveIds: string[],
  stream: boolean,
  clientTool = false,
): CannedResponse {
  const calls = archiveIds.map((id, i) => ({
    id: `call_r${i}`,
    archiveId: id,
  }));
  if (api === 'openai') {
    const toolCalls = [
      ...calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: {
          name: RECALL_TOOL_NAME,
          arguments: JSON.stringify({ archive_id: c.archiveId }),
        },
      })),
      ...(clientTool
        ? [
            {
              id: 'call_client',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":"x"}' },
            },
          ]
        : []),
    ];
    const usage = {
      prompt_tokens: RECALL_USAGE.input,
      completion_tokens: RECALL_USAGE.output,
      total_tokens: RECALL_USAGE.input + RECALL_USAGE.output,
    };
    if (!stream) {
      return {
        kind: 'json',
        body: {
          id: 'chatcmpl-recall',
          object: 'chat.completion',
          created: 1700000000,
          model: MODEL.openai,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Checking. ',
                tool_calls: toolCalls,
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage,
        },
      };
    }
    const chunk = (delta: object, finish: string | null = null) => ({
      id: 'chatcmpl-recall',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: MODEL.openai,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    return {
      kind: 'sse',
      events: [
        { data: chunk({ role: 'assistant', content: 'Checking. ' }) },
        ...toolCalls.map((c, index) => ({
          data: chunk({
            tool_calls: [
              {
                index,
                id: c.id,
                type: 'function',
                function: { name: c.function.name, arguments: '' },
              },
            ],
          }),
        })),
        ...toolCalls.map((c, index) => ({
          data: chunk({
            tool_calls: [
              { index, function: { arguments: c.function.arguments } },
            ],
          }),
        })),
        { data: chunk({}, 'tool_calls') },
        { data: { ...chunk({}), choices: [], usage } },
        { data: '[DONE]' },
      ],
    };
  }

  if (api === 'anthropic') {
    const blocks = [
      { type: 'text', text: 'Checking. ' },
      ...calls.map((c) => ({
        type: 'tool_use',
        id: c.id,
        name: RECALL_TOOL_NAME,
        input: { archive_id: c.archiveId },
      })),
      ...(clientTool
        ? [
            {
              type: 'tool_use',
              id: 'toolu_client',
              name: 'web_search',
              input: { query: 'x' },
            },
          ]
        : []),
    ];
    if (!stream) {
      return {
        kind: 'json',
        body: {
          id: 'msg_recall',
          type: 'message',
          role: 'assistant',
          model: MODEL.anthropic,
          content: blocks,
          stop_reason: 'tool_use',
          usage: {
            input_tokens: RECALL_USAGE.input,
            output_tokens: RECALL_USAGE.output,
          },
        },
      };
    }
    return {
      kind: 'sse',
      events: [
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_recall',
              type: 'message',
              role: 'assistant',
              model: MODEL.anthropic,
              content: [],
              usage: { input_tokens: RECALL_USAGE.input, output_tokens: 1 },
            },
          },
        },
        ...blocks.flatMap((block, index) => {
          const start =
            block.type === 'text'
              ? { type: 'text', text: '' }
              : { ...block, input: {} };
          const delta =
            block.type === 'text'
              ? { type: 'text_delta', text: (block as { text: string }).text }
              : {
                  type: 'input_json_delta',
                  partial_json: JSON.stringify(block.input),
                };
          return [
            {
              event: 'content_block_start',
              data: {
                type: 'content_block_start',
                index,
                content_block: start,
              },
            },
            {
              event: 'content_block_delta',
              data: { type: 'content_block_delta', index, delta },
            },
            {
              event: 'content_block_stop',
              data: { type: 'content_block_stop', index },
            },
          ];
        }),
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: RECALL_USAGE.output },
          },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ],
    };
  }

  const parts = [
    ...calls.map((c) => ({
      functionCall: {
        name: RECALL_TOOL_NAME,
        args: { archive_id: c.archiveId },
      },
    })),
    ...(clientTool
      ? [{ functionCall: { name: 'web_search', args: { query: 'x' } } }]
      : []),
  ];
  const usageMetadata = {
    promptTokenCount: RECALL_USAGE.input,
    candidatesTokenCount: RECALL_USAGE.output,
  };
  const candidate = (p: unknown[], finishReason?: string) => ({
    content: { role: 'model', parts: p },
    index: 0,
    ...(finishReason && { finishReason }),
  });
  if (!stream) {
    return {
      kind: 'json',
      body: {
        candidates: [candidate([{ text: 'Checking. ' }, ...parts], 'STOP')],
        usageMetadata,
      },
    };
  }
  return {
    kind: 'sse',
    events: [
      { data: { candidates: [candidate([{ text: 'Checking. ' }])] } },
      { data: { candidates: [candidate(parts, 'STOP')], usageMetadata } },
    ],
  };
}

describe('Recall: parsim_recall answered by Parsim', () => {
  let t: TestApp;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      PROXY_ANTHROPIC_BASE_URL: upstream.baseUrl,
      PROXY_GEMINI_NATIVE_BASE_URL: upstream.baseUrl,
      // The research fixture's tool results are ~900 tokens: archive them.
      GC_ARCHIVE_MIN_TOKENS: '500',
      GC_SIDE_EFFECT_TOOLS: 'save_note',
      PARSIM_RECALL_MAX_PER_REQUEST: '3',
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const research = (api: Api, stream = false): string => {
    const conversation = loadConversation('research-agent-session');
    const body =
      api === 'openai'
        ? toOpenAiBody(conversation)
        : api === 'anthropic'
          ? { ...toAnthropicBody(conversation), model: MODEL.anthropic }
          : toGeminiBody(conversation);
    return JSON.stringify({
      ...body,
      ...(api === 'openai' && { model: MODEL.openai }),
      ...(stream && api !== 'gemini' && { stream: true }),
    });
  };

  /** An "on" mode project and the archive ids its GC'd requests contain. */
  const setup = async (api: Api) => {
    const fx = await createProjectWithKey(t, { upstream: UPSTREAM[api] });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ gcMode: 'on' })
      .expect(200);
    // A first request archives old results; its stubs carry the ids.
    await send(fx, api, research(api));
    const archiveIds = archiveStubIds(upstream.lastRequest.rawBody);
    expect(archiveIds.length).toBeGreaterThan(0);
    upstream.reset();
    await t.dataSource.query('DELETE FROM usage_record');
    return { fx, archiveIds };
  };

  const send = async (
    fx: ProxyFixture,
    api: Api,
    body: string,
    stream = false,
  ) => {
    const res = await request(t.server)
      .post(PATH(api, stream))
      .set('content-type', 'application/json')
      .set('x-parsim-key', fx.parsimKey)
      .set('x-provider-key', 'provider-key-test')
      .set('x-parsim-session-id', 'recall-e2e')
      .send(body);
    await t.app.get(ProxyService).whenIdle();
    return res;
  };

  const usageRows = (): Promise<
    {
      inputTokens: number;
      outputTokens: number;
      upstreamCalls: number;
      status: number;
    }[]
  > => t.dataSource.query('SELECT * FROM usage_record ORDER BY "createdAt"');
  const recallRows = (): Promise<
    {
      archiveId: string;
      found: boolean;
      refused: boolean;
      tokensRestored: number;
      usageRecordId: string | null;
    }[]
  > =>
    t.dataSource.query(
      'SELECT * FROM recall ORDER BY "createdAt", "archiveId"',
    );

  /** The text of the archived original, as stored. */
  const archivedOriginal = async (archiveId: string): Promise<string> => {
    const [row] = (await t.dataSource.query(
      'SELECT content FROM archived_item WHERE "archiveId" = $1',
      [archiveId],
    )) as {
      content: {
        parts: { content: { text?: string; value?: { output: string } }[] }[];
      };
    }[];
    const part = row.content.parts[0].content[0];
    return part.text ?? part.value!.output;
  };

  /** Tool result texts of the last message of a forwarded request. */
  const lastToolResults = (api: Api, sent: RecordedRequest): string[] => {
    const body = sent.body as Record<string, unknown[]>;
    if (api === 'openai') {
      // The tool messages at the end, after Parsim's assistant turn.
      const messages = body.messages as { role: string; content: string }[];
      let start = messages.length;
      while (start > 0 && messages[start - 1].role === 'tool') start -= 1;
      return messages.slice(start).map((m) => m.content);
    }
    if (api === 'anthropic') {
      const last = body.messages[body.messages.length - 1] as {
        content: { type: string; content: string }[];
      };
      return last.content
        .filter((b) => b.type === 'tool_result')
        .map((b) => b.content);
    }
    const last = body.contents[body.contents.length - 1] as {
      parts: { functionResponse?: { response: { output: string } } }[];
    };
    return last.parts.flatMap((p) =>
      p.functionResponse ? [p.functionResponse.response.output] : [],
    );
  };

  /** Tool calls of the assistant turn Parsim added to the follow-up. */
  const followUpCalls = (api: Api, sent: RecordedRequest): string[] => {
    const body = sent.body as Record<string, unknown[]>;
    if (api === 'openai') {
      const turn = body.messages[body.messages.length - 2] as {
        tool_calls: { function: { name: string } }[];
      };
      return turn.tool_calls.map((c) => c.function.name);
    }
    if (api === 'anthropic') {
      const turn = body.messages[body.messages.length - 2] as {
        content: { type: string; name?: string }[];
      };
      return turn.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => b.name!);
    }
    const turn = body.contents[body.contents.length - 2] as {
      parts: { functionCall?: { name: string } }[];
    };
    return turn.parts.flatMap((p) =>
      p.functionCall ? [p.functionCall.name] : [],
    );
  };

  describe.each<Api>(['openai', 'anthropic', 'gemini'])('%s format', (api) => {
    it('should add parsim_recall and the system line, byte-identical across requests', async () => {
      const { fx } = await setup(api);
      await send(fx, api, research(api));
      await send(fx, api, research(api));

      const [a, b] = upstream.requests;
      expect(a.rawBody).toContain(RECALL_SYSTEM_LINE);
      expect(a.rawBody).toContain(`"${RECALL_TOOL_NAME}"`);
      expect(b.rawBody).toBe(a.rawBody);
      // The client's own tools are still there, unchanged and first.
      const body = JSON.parse(research(api)) as { tools: unknown[] };
      const sent = a.body as { tools: unknown[] };
      if (api === 'gemini') {
        const declarations = (
          sent.tools[0] as { functionDeclarations: unknown[] }
        ).functionDeclarations;
        expect(declarations.slice(0, -1)).toEqual(
          (body.tools[0] as { functionDeclarations: unknown[] })
            .functionDeclarations,
        );
      } else {
        expect(sent.tools.slice(0, -1)).toEqual(body.tools);
      }
    });

    it('should send the archived original back upstream and return only the final answer', async () => {
      const { fx, archiveIds } = await setup(api);
      upstream.respondNext(recallResponse(api, [archiveIds[0]], false));

      const res = await send(fx, api, research(api));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(FAKE_REPLY_TEXT);
      expect(JSON.stringify(res.body)).not.toContain(RECALL_TOOL_NAME);
      expect(upstream.requests).toHaveLength(2);
      const followUp = upstream.requests[1];
      expect(lastToolResults(api, followUp)).toEqual([
        await archivedOriginal(archiveIds[0]),
      ]);
      expect(followUpCalls(api, followUp)).toEqual([RECALL_TOOL_NAME]);

      const [usage] = await usageRows();
      expect(usage).toMatchObject({
        upstreamCalls: 2,
        inputTokens: RECALL_USAGE.input + FINAL_INPUT[api],
        outputTokens: RECALL_USAGE.output + FINAL_OUTPUT,
        status: 200,
      });
      const [recall] = await recallRows();
      expect(recall).toMatchObject({
        archiveId: archiveIds[0],
        found: true,
        refused: false,
      });
      expect(recall.tokensRestored).toBeGreaterThan(500);
      expect(recall.usageRecordId).not.toBeNull();
    });

    it('should splice a streamed follow-up into one stream for the client', async () => {
      const { fx, archiveIds } = await setup(api);
      upstream.respondNext(recallResponse(api, [archiveIds[0]], true));
      upstream.respondNext(
        defaultResponse(
          api,
          true,
          { model: MODEL[api], stream_options: { include_usage: true } },
          MODEL.gemini,
        ),
      );

      const res = await send(fx, api, research(api, true), true);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).not.toContain(RECALL_TOOL_NAME);
      const events = parseSse(res.text);
      const data = events
        .filter((e) => e.data !== '[DONE]')
        .map((e) => JSON.parse(e.data) as Record<string, unknown>);
      let text = '';
      if (api === 'openai') {
        for (const chunk of data) {
          expect(chunk.id).toBe('chatcmpl-recall');
          const choice = (
            chunk.choices as { delta: { content?: string } }[]
          )[0];
          text += choice?.delta.content ?? '';
        }
        expect(events[events.length - 1]?.data).toBe('[DONE]');
      } else if (api === 'anthropic') {
        expect(data.filter((d) => d.type === 'message_start')).toHaveLength(1);
        expect(data.filter((d) => d.type === 'message_stop')).toHaveLength(1);
        const starts = data.filter((d) => d.type === 'content_block_start');
        expect(starts.map((d) => d.index)).toEqual([0, 1]);
        for (const d of data) {
          const delta = d.delta as { text?: string } | undefined;
          if (d.type === 'content_block_delta') text += delta?.text ?? '';
        }
      } else {
        for (const chunk of data) {
          const parts = (
            chunk.candidates as { content: { parts: { text?: string }[] } }[]
          )[0].content.parts;
          text += parts.map((p) => p.text ?? '').join('');
        }
      }
      expect(text).toBe(`Checking. ${FAKE_REPLY_TEXT}`);

      expect(upstream.requests).toHaveLength(2);
      expect(lastToolResults(api, upstream.requests[1])).toEqual([
        await archivedOriginal(archiveIds[0]),
      ]);
      const [usage] = await usageRows();
      expect(usage).toMatchObject({
        upstreamCalls: 2,
        inputTokens: RECALL_USAGE.input + FINAL_INPUT[api],
        outputTokens: RECALL_USAGE.output + FINAL_OUTPUT,
      });
    });

    it('should resolve parsim_recall first and drop client tool calls from that turn', async () => {
      const { fx, archiveIds } = await setup(api);
      upstream.respondNext(recallResponse(api, [archiveIds[0]], false, true));

      const res = await send(fx, api, research(api));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(FAKE_REPLY_TEXT);
      expect(upstream.requests).toHaveLength(2);
      // The follow-up answers only the recall; the model asks for its tool again if needed.
      expect(followUpCalls(api, upstream.requests[1])).toEqual([
        RECALL_TOOL_NAME,
      ]);
      expect(lastToolResults(api, upstream.requests[1])).toHaveLength(1);
    });

    it('should tell the model when an archive id does not exist', async () => {
      const { fx } = await setup(api);
      upstream.respondNext(
        recallResponse(api, ['arc_0000000000000000'], false),
      );

      const res = await send(fx, api, research(api));

      expect(res.status).toBe(200);
      expect(lastToolResults(api, upstream.requests[1])).toEqual([
        'Archive id arc_0000000000000000 was not found. Continue without it.',
      ]);
      expect(await recallRows()).toMatchObject([
        { archiveId: 'arc_0000000000000000', found: false, tokensRestored: 0 },
      ]);
    });

    it('should stop after the recall limit with a final call that cannot use tools', async () => {
      const { fx, archiveIds } = await setup(api);
      const id = archiveIds[0];
      for (let i = 0; i < 4; i++)
        upstream.respondNext(recallResponse(api, [id], false));

      const res = await send(fx, api, research(api));

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(FAKE_REPLY_TEXT);
      // 4 recall responses, then the final answer.
      expect(upstream.requests).toHaveLength(5);
      const last = upstream.requests[4];
      expect(lastToolResults(api, last)).toEqual([RECALL_LIMIT_REACHED]);
      const body = last.body as Record<string, unknown>;
      if (api === 'openai') expect(body.tool_choice).toBe('none');
      if (api === 'anthropic')
        expect(body.tool_choice).toEqual({ type: 'none' });
      if (api === 'gemini') {
        expect(body.toolConfig).toEqual({
          functionCallingConfig: { mode: 'NONE' },
        });
      }
      for (const earlier of upstream.requests.slice(0, 4)) {
        const b = earlier.body as Record<string, unknown>;
        expect(b.tool_choice ?? b.toolConfig).toBeUndefined();
      }
      expect((await recallRows()).map((r) => [r.found, r.refused])).toEqual([
        [true, false],
        [true, false],
        [true, false],
        [false, true],
      ]);
      expect((await usageRows())[0].upstreamCalls).toBe(5);
    });
  });

  it('should hold the stream to the loop limit too', async () => {
    const { fx, archiveIds } = await setup('anthropic');
    for (let i = 0; i < 4; i++) {
      upstream.respondNext(recallResponse('anthropic', [archiveIds[0]], true));
    }
    upstream.respondNext(
      defaultResponse('anthropic', true, { model: MODEL.anthropic }),
    );

    const res = await send(fx, 'anthropic', research('anthropic', true), true);

    expect(upstream.requests).toHaveLength(5);
    const data = parseSse(res.text).map(
      (e) => JSON.parse(e.data) as { type: string; index?: number },
    );
    expect(data.filter((d) => d.type === 'message_start')).toHaveLength(1);
    // Four "Checking." blocks and the final text block, numbered in order.
    expect(
      data.filter((d) => d.type === 'content_block_start').map((d) => d.index),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(res.text).not.toContain(RECALL_TOOL_NAME);
  });

  it('should pass a client tool call through when the model does not recall', async () => {
    const { fx } = await setup('openai');
    const canned = {
      id: 'chatcmpl-tool',
      object: 'chat.completion',
      created: 1700000000,
      model: MODEL.openai,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'web_search', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    };
    upstream.respondNext({ kind: 'json', body: canned });

    const res = await send(fx, 'openai', research('openai'));

    expect(res.body).toEqual(canned);
    expect(upstream.requests).toHaveLength(1);
    expect((await usageRows())[0].upstreamCalls).toBe(1);
  });

  it('should stream held client tool calls unchanged when there is no recall', async () => {
    const { fx } = await setup('openai');
    const chunk = (delta: object, finish: string | null = null) => ({
      id: 'chatcmpl-tool',
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    const events = [
      { data: chunk({ role: 'assistant', content: 'Searching.' }) },
      {
        data: chunk({
          tool_calls: [
            {
              index: 0,
              id: 'c1',
              type: 'function',
              function: { name: 'web_search', arguments: '{}' },
            },
          ],
        }),
      },
      { data: chunk({}, 'tool_calls') },
      { data: '[DONE]' },
    ];
    upstream.respondNext({ kind: 'sse', events });

    const res = await send(
      fx,
      'openai',
      JSON.stringify({
        ...JSON.parse(research('openai')),
        stream: true,
        stream_options: { include_usage: false },
      }),
      true,
    );

    expect(parseSse(res.text).map((e) => e.data)).toEqual(
      events.map((e) =>
        typeof e.data === 'string' ? e.data : JSON.stringify(e.data),
      ),
    );
  });

  it('should not add parsim_recall when the request has no archive stubs', async () => {
    const fx = await createProjectWithKey(t, { upstream: 'openai' });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ gcMode: 'on' })
      .expect(200);
    const conversation = loadConversation('research-agent-session');
    conversation.messages = conversation.messages.slice(0, 20);
    const body = JSON.stringify(toOpenAiBody(conversation));

    await send(fx, 'openai', body);

    expect(upstream.lastRequest.rawBody).not.toContain(RECALL_TOOL_NAME);
  });
});
