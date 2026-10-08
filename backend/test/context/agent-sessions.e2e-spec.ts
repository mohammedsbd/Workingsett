import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import request from 'supertest';
import { extractContextItems } from '../../src/context/context-items';
import { OpenAiChatConverter } from '../../src/context/normalization/openai-chat.converter';
import { ContextItemRepository } from '../../src/context-items/infrastructure/persistence/context-item.repository';
import { ProxyService } from '../../src/proxy/proxy.service';
import { FakeUpstream } from '../utils/fake-upstream';
import { loadConversation } from '../utils/fixtures';
import {
  createProjectWithKey,
  dumpAllTables,
  ProxyFixture,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const PROVIDER_KEY = 'sk-test-context';

type SessionRow = {
  id: string;
  externalId: string;
  idSource: string;
  provider: string;
  model: string;
  requestCount: number;
};
type ItemRow = {
  position: number;
  kind: string;
  contentHash: string;
  tokenCount: number;
  tokenizer: string;
  firstSeenRequest: number;
};

describe('Agent sessions and context storage', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  let fx: ProxyFixture;
  const research = loadConversation('research-agent-session');

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      PROXY_ANTHROPIC_BASE_URL: upstream.baseUrl,
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
    fx = await createProjectWithKey(t);
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const chatBody = (messages: unknown[], extra: object = {}) =>
    JSON.stringify({
      model: 'gpt-4o',
      messages,
      tools: research.tools,
      ...extra,
    });

  const send = async (
    body: string,
    headers: Record<string, string> = {},
    key = fx.parsimKey,
  ) => {
    await request(t.server)
      .post('/v1/chat/completions')
      .set('content-type', 'application/json')
      .set('x-parsim-key', key)
      .set('x-provider-key', PROVIDER_KEY)
      .set(headers)
      .send(body)
      .expect(200);
    // Context is stored after the response; wait for it.
    await t.app.get(ProxyService).whenIdle();
  };

  const sessions = (): Promise<SessionRow[]> =>
    t.dataSource.query('SELECT * FROM agent_session ORDER BY "firstSeenAt"');
  const items = (sessionId: string): Promise<ItemRow[]> =>
    t.dataSource.query(
      'SELECT * FROM context_item WHERE "agentSessionId" = $1 ORDER BY position',
      [sessionId],
    );
  const contentCount = async (): Promise<number> =>
    Number(
      (
        (await t.dataSource.query(
          'SELECT count(*) AS n FROM context_content',
        )) as { n: string }[]
      )[0].n,
    );

  describe('three requests from one growing conversation', () => {
    const cuts = [10, 40, research.messages.length];
    const expected = cuts.map((n) =>
      extractContextItems(
        new OpenAiChatConverter().toInternal({
          messages: research.messages.slice(0, n),
        }),
      ),
    );

    beforeEach(async () => {
      for (const n of cuts) {
        await send(chatBody(research.messages.slice(0, n)));
      }
    });

    it('should create one agent session that counts three requests', async () => {
      const rows = await sessions();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        idSource: 'derived',
        provider: 'openai',
        model: 'gpt-4o',
        requestCount: 3,
      });
      expect(rows[0].externalId).toMatch(/^derived:[0-9a-f]{32}$/);
    });

    it('should store each item once, marked with the request that first had it', async () => {
      const [session] = await sessions();
      const stored = await items(session.id);
      const all = expected[2];

      expect(stored.map((i) => i.position)).toEqual(all.map((i) => i.position));
      expect(stored.map((i) => i.contentHash)).toEqual(
        all.map((i) => i.contentHash),
      );
      const firstSeen = (position: number) =>
        position < expected[0].length
          ? 1
          : position < expected[1].length
            ? 2
            : 3;
      expect(stored.map((i) => i.firstSeenRequest)).toEqual(
        stored.map((i) => firstSeen(i.position)),
      );
    });

    it('should store repeated content only once', async () => {
      const distinct = new Set(expected[2].map((i) => i.contentHash)).size;

      expect(await contentCount()).toBe(distinct);
      expect(distinct).toBeLessThan(expected[2].length);
    });

    it('should count tokens with the OpenAI tokenizer', async () => {
      const [session] = await sessions();
      const stored = await items(session.id);

      expect(stored.every((i) => i.tokenizer === 'tiktoken:o200k_base')).toBe(
        true,
      );
      expect(stored.every((i) => i.tokenCount > 0)).toBe(true);
    });

    it('should link every usage record to the session', async () => {
      const [session] = await sessions();
      const usage = await waitForUsageRecords(t.dataSource, fx.project.id, 3);

      expect(usage.map((u) => u.agentSessionId)).toEqual([
        session.id,
        session.id,
        session.id,
      ]);
    });

    it('should not add items when the same request is sent again', async () => {
      const [session] = await sessions();
      const before = (await items(session.id)).length;

      await send(chatBody(research.messages));

      expect(await items(session.id)).toHaveLength(before);
      expect((await sessions())[0].requestCount).toBe(4);
    });
  });

  describe('session identification', () => {
    it('should use the x-parsim-session-id header and not forward it', async () => {
      await send(chatBody([{ role: 'user', content: 'Task A' }]), {
        'x-parsim-session-id': 'run-7',
      });
      await send(chatBody([{ role: 'user', content: 'Task B' }]), {
        'x-parsim-session-id': 'run-7',
      });

      const rows = await sessions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        externalId: 'run-7',
        idSource: 'header',
        requestCount: 2,
      });
      expect(
        upstream.lastRequest.headers['x-parsim-session-id'],
      ).toBeUndefined();
    });

    it('should keep different conversations in different sessions', async () => {
      await send(chatBody([{ role: 'user', content: 'Task A' }]));
      await send(chatBody([{ role: 'user', content: 'Task B' }]));

      expect(await sessions()).toHaveLength(2);
    });

    it('should keep sessions of different projects apart', async () => {
      const other = await createProjectWithKey(t);
      const body = chatBody([{ role: 'user', content: 'Same task' }]);

      await send(body);
      await send(body, {}, other.parsimKey);

      const rows = await sessions();
      expect(rows).toHaveLength(2);
      expect(rows[0].externalId).toBe(rows[1].externalId);
    });
  });

  describe('Anthropic requests', () => {
    it('should not store an item again when its cache_control marker moves', async () => {
      const anthropic = await createProjectWithKey(t, {
        upstream: 'anthropic',
      });
      const turn = (marked: number) =>
        JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 64,
          system: [{ type: 'text', text: 'You are a support agent.' }],
          messages: [
            { role: 'user', content: 'Where is O-5001?' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'tu_1',
                  name: 'get_order',
                  input: { id: 'O-5001' },
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tu_1',
                  content: 'in transit',
                  ...(marked === 1 && { cache_control: { type: 'ephemeral' } }),
                },
              ],
            },
            ...(marked === 2
              ? [
                  { role: 'assistant', content: 'It is in transit.' },
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: 'Thanks',
                        cache_control: { type: 'ephemeral' },
                      },
                    ],
                  },
                ]
              : []),
          ],
        });

      for (const body of [turn(1), turn(2)]) {
        await request(t.server)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .set('anthropic-version', '2023-06-01')
          .set('x-api-key', anthropic.parsimKey)
          .set('x-provider-key', 'sk-ant-test')
          .send(body)
          .expect(200);
        await t.app.get(ProxyService).whenIdle();
      }

      const [session] = await sessions();
      const stored = await items(session.id);
      expect(session).toMatchObject({ provider: 'anthropic', requestCount: 2 });
      expect(
        stored.map((i) => [i.position, i.kind, i.firstSeenRequest]),
      ).toEqual([
        [0, 'system', 1],
        [1, 'user', 1],
        [2, 'tool_call', 1],
        [3, 'tool_result', 1],
        [4, 'assistant', 2],
        [5, 'user', 2],
      ]);
      expect(stored.every((i) => i.tokenizer === 'approx:o200k_base')).toBe(
        true,
      );
    });
  });

  describe('content storage setting', () => {
    it('should store hashes and token counts but no content when storeContent is off', async () => {
      await request(t.server)
        .patch(`/api/v1/projects/${fx.project.id}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .send({ storeContent: false })
        .expect(200)
        .expect(({ body }) => expect(body.storeContent).toBe(false));

      await send(chatBody(research.messages.slice(0, 20)));

      const [session] = await sessions();
      expect((await items(session.id)).length).toBeGreaterThan(0);
      expect(await contentCount()).toBe(0);
      const database = await dumpAllTables(t.dataSource);
      expect(database).not.toContain(research.messages[1].content as string);
    });

    it('should store content by default outside production', async () => {
      await send(chatBody([{ role: 'user', content: 'Remember this.' }]));

      const [row] = (await t.dataSource.query(
        'SELECT content FROM context_content',
      )) as { content: unknown }[];
      expect(row.content).toEqual({
        kind: 'user',
        parts: [{ type: 'text', text: 'Remember this.' }],
      });
    });
  });

  describe('failures and privacy', () => {
    it('should still answer 200 and record usage when storing context fails', async () => {
      const repository = t.app.get(ContextItemRepository, { strict: false });
      const spy = jest
        .spyOn(repository, 'insertMissing')
        .mockRejectedValueOnce(new Error('database unavailable'));

      try {
        await send(chatBody([{ role: 'user', content: 'Still works?' }]));
      } finally {
        spy.mockRestore();
      }

      const [usage] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(usage).toMatchObject({ status: 200, agentSessionId: null });
      expect(t.logs.text).toContain('Could not store context');
      expect(t.logs.text).not.toContain('Still works?');
    });

    it('should capture streamed requests too', async () => {
      await send(
        chatBody([{ role: 'user', content: 'Stream it' }], { stream: true }),
      );

      const [session] = await sessions();
      expect(await items(session.id)).toHaveLength(1);
    });

    it('should never log content at info level', async () => {
      await send(chatBody(research.messages.slice(0, 15)));

      expect(t.logs.text).toContain('context session=');
      for (const message of research.messages.slice(0, 15)) {
        if (
          typeof message.content === 'string' &&
          message.content.length > 20
        ) {
          expect(t.logs.text).not.toContain(message.content.slice(0, 40));
        }
      }
    });
  });
});
