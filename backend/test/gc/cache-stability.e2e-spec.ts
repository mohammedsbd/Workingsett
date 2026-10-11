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
import { FakeUpstream } from '../utils/fake-upstream';
import {
  FixtureConversation,
  loadConversation,
  toAnthropicBody,
  toGeminiBody,
  toOpenAiBody,
} from '../utils/fixtures';
import { createProjectWithKey, ProxyFixture } from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

type Api = 'openai' | 'anthropic' | 'gemini';
const PATH: Record<Api, string> = {
  openai: '/v1/chat/completions',
  anthropic: '/v1/messages',
  gemini: '/v1beta/models/gemini-3.8-flash:generateContent',
};
const UPSTREAM = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
} as const;

describe('Prompt-cache stability with the GC on', () => {
  let t: TestApp;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      PROXY_ANTHROPIC_BASE_URL: upstream.baseUrl,
      PROXY_GEMINI_NATIVE_BASE_URL: upstream.baseUrl,
      GC_ARCHIVE_MIN_TOKENS: '500',
      GC_SIDE_EFFECT_TOOLS: 'save_note',
      GC_BATCH_TOKENS: '4000',
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const onProject = async (api: Api): Promise<ProxyFixture> => {
    const fx = await createProjectWithKey(t, { upstream: UPSTREAM[api] });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ gcMode: 'on' })
      .expect(200);
    return fx;
  };

  const research = (messages: number): FixtureConversation => {
    const c = loadConversation('research-agent-session');
    c.messages = c.messages.slice(0, messages);
    return c;
  };

  const bodyFor = (api: Api, c: FixtureConversation, extra: object = {}) =>
    JSON.stringify({
      ...(api === 'openai'
        ? toOpenAiBody(c)
        : api === 'anthropic'
          ? toAnthropicBody(c)
          : toGeminiBody(c)),
      ...extra,
    });

  const send = async (fx: ProxyFixture, api: Api, body: string) => {
    await request(t.server)
      .post(PATH[api])
      .set('content-type', 'application/json')
      .set('x-parsim-key', fx.parsimKey)
      .set('x-provider-key', 'provider-key-test')
      .set('x-parsim-session-id', 'cache-e2e')
      .send(body)
      .expect(200);
    await t.app.get(ProxyService).whenIdle();
    return upstream.lastRequest.body as Record<string, unknown>;
  };

  /** Everything but the conversation, plus the conversation's messages. */
  const split = (body: Record<string, unknown>) => {
    const key = 'messages' in body ? 'messages' : 'contents';
    const rest = { ...body };
    delete rest[key];
    return {
      rest,
      messages: (body[key] as unknown[]).map((m) => JSON.stringify(m)),
    };
  };

  const runs = (): Promise<{ ran: boolean; applied: boolean }[]> =>
    t.dataSource.query('SELECT ran, applied FROM gc_run ORDER BY "createdAt"');

  describe.each<Api>(['openai', 'anthropic', 'gemini'])('%s format', (api) => {
    it('should send byte-identical prefixes for two sequential requests of a session', async () => {
      const fx = await onProject(api);

      const first = split(await send(fx, api, bodyFor(api, research(80))));
      const second = split(await send(fx, api, bodyFor(api, research(82))));

      // Only a little context was added: no new pass, nothing re-decided.
      expect((await runs()).map((r) => r.ran)).toEqual([true, false]);
      expect(second.rest).toEqual(first.rest);
      expect(second.messages.slice(0, first.messages.length)).toEqual(
        first.messages,
      );
      expect(first.messages.join('')).toContain('[parsim ');
    });

    it('should run the next pass only after enough new context, keeping rewritten items', async () => {
      const fx = await onProject(api);

      const first = split(await send(fx, api, bodyFor(api, research(60))));
      await send(fx, api, bodyFor(api, research(62)));
      const third = split(await send(fx, api, bodyFor(api, research(117))));

      expect((await runs()).map((r) => r.ran)).toEqual([true, false, true]);
      first.messages.forEach((message, i) => {
        if (message.includes('[parsim ')) {
          expect(third.messages[i]).toBe(message);
        }
      });
    });
  });

  it('should keep every Anthropic cache_control marker the client sent', async () => {
    const fx = await onProject('anthropic');
    const body = JSON.parse(bodyFor('anthropic', research(117))) as {
      system: string;
      messages: { content: Record<string, unknown>[] }[];
    };
    const marked = {
      ...body,
      system: [
        {
          type: 'text',
          text: body.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
    };
    const last = marked.messages[marked.messages.length - 1].content;
    last[last.length - 1].cache_control = { type: 'ephemeral' };

    const sent = await send(fx, 'anthropic', JSON.stringify(marked));

    const count = (value: unknown) =>
      (JSON.stringify(value).match(/"cache_control"/g) ?? []).length;
    expect(count(sent)).toBe(count(marked));
    const sentMessages = sent.messages as unknown[];
    expect(sentMessages[sentMessages.length - 1]).toEqual(
      marked.messages[marked.messages.length - 1],
    );
    expect((sent.system as unknown[])[0]).toEqual(marked.system[0]);
  });

  it('should pass a Gemini cachedContent through and never archive or add tools next to it', async () => {
    const fx = await onProject('gemini');
    const body = JSON.parse(bodyFor('gemini', research(117))) as Record<
      string,
      unknown
    >;
    delete body.systemInstruction;
    delete body.tools;
    const cached = { ...body, cachedContent: 'cachedContents/research-abc' };

    const sent = await send(fx, 'gemini', JSON.stringify(cached));

    expect(sent.cachedContent).toBe('cachedContents/research-abc');
    expect(sent.systemInstruction).toBeUndefined();
    expect(sent.tools).toBeUndefined();
    const text = JSON.stringify(sent);
    expect(text).toContain('[parsim dropped');
    expect(text).not.toContain('[parsim archived');
    expect(await t.dataSource.query('SELECT * FROM archived_item')).toEqual([]);
  });

  it('should record cached tokens Gemini reports for a cachedContent request', async () => {
    const fx = await onProject('gemini');
    upstream.respondNext({
      kind: 'json',
      body: {
        candidates: [],
        usageMetadata: {
          promptTokenCount: 5000,
          cachedContentTokenCount: 4000,
          candidatesTokenCount: 10,
        },
      },
    });

    await send(
      fx,
      'gemini',
      JSON.stringify({
        cachedContent: 'cachedContents/abc',
        contents: [{ role: 'user', parts: [{ text: 'Next question.' }] }],
      }),
    );

    const [usage] = (await t.dataSource.query(
      'SELECT "inputTokens", "cachedInputTokens" FROM usage_record',
    )) as { inputTokens: number; cachedInputTokens: number }[];
    expect(usage).toEqual({ inputTokens: 5000, cachedInputTokens: 4000 });
  });
});
