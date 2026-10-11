import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import request from 'supertest';
import { ArchivedItemRepository } from '../../src/archived-items/infrastructure/persistence/archived-item.repository';
import { contentHash } from '../../src/context/canonical-json';
import * as gcEngine from '../../src/gc/gc-engine';
import { ProxyService } from '../../src/proxy/proxy.service';
import { FAKE_REPLY_TEXT, FakeUpstream } from '../utils/fake-upstream';
import {
  FixtureConversation,
  loadConversation,
  toAnthropicBody,
  toOpenAiBody,
} from '../utils/fixtures';
import { createProjectWithKey, ProxyFixture } from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const PROVIDER_KEY = 'sk-test-gc';

type GcRunRow = {
  mode: string;
  ran: boolean;
  applied: boolean;
  failed: boolean;
  error: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  decisionCount: number;
  newDecisionCount: number;
  agentSessionId: string | null;
  usageRecordId: string | null;
};
type DecisionRow = {
  id: string;
  itemKey: string;
  position: number;
  toolName: string;
  decision: string;
  reason: string;
  replacement: string;
  archiveId: string | null;
  contentHash: string;
  createdAt: Date;
};
type ArchiveRow = {
  archiveId: string;
  toolName: string;
  contentHash: string;
  tokenCount: number;
  content: unknown;
};

type Api = 'openai' | 'anthropic';
const ENDPOINT: Record<Api, string> = {
  openai: '/v1/chat/completions',
  anthropic: '/v1/messages',
};

describe('Context GC in the proxy', () => {
  let t: TestApp;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      PROXY_ANTHROPIC_BASE_URL: upstream.baseUrl,
      // The research fixture's tool results are ~900 tokens: archive them.
      GC_ARCHIVE_MIN_TOKENS: '500',
      GC_SIDE_EFFECT_TOOLS: 'save_note',
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const project = async (
    api: Api,
    gcMode?: 'off' | 'shadow' | 'on',
    extra: object = {},
  ): Promise<ProxyFixture> => {
    const fx = await createProjectWithKey(t, {
      upstream: api === 'openai' ? 'openai' : 'anthropic',
    });
    if (gcMode || Object.keys(extra).length) {
      await request(t.server)
        .patch(`/api/v1/projects/${fx.project.id}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .send({ ...(gcMode && { gcMode }), ...extra })
        .expect(200);
    }
    return fx;
  };

  const conversation = (messages?: number): FixtureConversation => {
    const c = loadConversation('research-agent-session');
    if (messages !== undefined) c.messages = c.messages.slice(0, messages);
    return c;
  };

  const bodyFor = (api: Api, c: FixtureConversation, extra: object = {}) =>
    JSON.stringify({
      ...(api === 'openai' ? toOpenAiBody(c) : toAnthropicBody(c)),
      ...extra,
    });

  const send = async (fx: ProxyFixture, api: Api, body: string) => {
    const res = await request(t.server)
      .post(ENDPOINT[api])
      .set('content-type', 'application/json')
      .set('x-parsim-key', fx.parsimKey)
      .set('x-provider-key', PROVIDER_KEY)
      .set('x-parsim-session-id', 'gc-e2e-session')
      .send(body);
    // GC runs and decisions are stored after the response.
    await t.app.get(ProxyService).whenIdle();
    return res;
  };

  const runs = (projectId: string): Promise<GcRunRow[]> =>
    t.dataSource.query(
      'SELECT * FROM gc_run WHERE "projectId" = $1 ORDER BY "createdAt"',
      [projectId],
    );
  const decisions = (): Promise<DecisionRow[]> =>
    t.dataSource.query(
      'SELECT * FROM gc_decision ORDER BY position, "createdAt"',
    );
  const archived = (projectId: string): Promise<ArchiveRow[]> =>
    t.dataSource.query(
      'SELECT * FROM archived_item WHERE "projectId" = $1 ORDER BY "archiveId"',
      [projectId],
    );

  /** Tool result contents of a forwarded request, in order. */
  const toolResults = (api: Api, body: unknown): string[] => {
    const messages = (body as { messages: Record<string, unknown>[] }).messages;
    if (api === 'openai') {
      return messages
        .filter((m) => m.role === 'tool')
        .map((m) => m.content as string);
    }
    return messages.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Record<string, unknown>[])
            .filter((b) => b.type === 'tool_result')
            .map((b) =>
              typeof b.content === 'string'
                ? b.content
                : JSON.stringify(b.content),
            )
        : [],
    );
  };

  it('should default new projects to shadow mode', async () => {
    const fx = await createProjectWithKey(t);
    const res = await request(t.server)
      .get(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .expect(200);
    expect(res.body).toMatchObject({ gcMode: 'shadow' });
  });

  it('should reject an unknown gc mode', async () => {
    const fx = await createProjectWithKey(t);
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ gcMode: 'aggressive' })
      .expect(422);
  });

  describe.each<Api>(['openai', 'anthropic'])('%s format', (api) => {
    describe('shadow mode', () => {
      it('should forward the original request and store what the GC would have done', async () => {
        const fx = await project(api);
        const body = bodyFor(api, conversation());

        const res = await send(fx, api, body);

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain(FAKE_REPLY_TEXT);
        expect(upstream.lastRequest.rawBody).toBe(body);

        const [run] = await runs(fx.project.id);
        expect(run).toMatchObject({
          mode: 'shadow',
          ran: true,
          applied: false,
          failed: false,
          error: null,
        });
        expect(run.agentSessionId).not.toBeNull();
        expect(run.usageRecordId).not.toBeNull();
        expect(run.tokensAfter!).toBeLessThan(run.tokensBefore!);
        expect(run.newDecisionCount).toBe(run.decisionCount);

        const rows = await decisions();
        expect(rows).toHaveLength(run.decisionCount);
        expect(new Set(rows.map((r) => r.reason))).toEqual(
          new Set(['duplicate', 'superseded', 'stale_large']),
        );
        // Nothing was archived for real: the original was forwarded.
        expect(await archived(fx.project.id)).toEqual([]);
      });
    });

    describe('on mode', () => {
      it('should forward a smaller request and store the archived originals', async () => {
        const fx = await project(api, 'on');
        const c = conversation();
        const body = bodyFor(api, c);

        const res = await send(fx, api, body);

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain(FAKE_REPLY_TEXT);
        const forwarded = upstream.lastRequest;
        expect(forwarded.rawBody.length).toBeLessThan(body.length / 2);
        expect(forwarded.headers['x-parsim-session-id']).toBeUndefined();

        const original = JSON.parse(body) as { messages: unknown[] };
        const sent = forwarded.body as { messages: unknown[] };
        // Same messages and tool pairs; only tool result content changed.
        expect(sent.messages).toHaveLength(original.messages.length);
        const before = toolResults(api, original);
        const after = toolResults(api, sent);
        expect(after).toHaveLength(before.length);
        const stubs = after.filter((r) => r.includes('[parsim '));
        expect(stubs.length).toBeGreaterThan(0);

        const [run] = await runs(fx.project.id);
        expect(run).toMatchObject({ mode: 'on', ran: true, applied: true });
        expect(run.tokensAfter!).toBeLessThan(run.tokensBefore!);

        const rows = await decisions();
        expect(rows).toHaveLength(run.decisionCount);
        for (const row of rows) {
          expect(after.some((r) => r.includes(row.replacement))).toBe(true);
        }

        const archives = await archived(fx.project.id);
        const archiveDecisions = rows.filter((r) => r.decision === 'archive');
        expect(archiveDecisions.length).toBeGreaterThan(0);
        expect(archives.map((a) => a.archiveId).sort()).toEqual(
          [...new Set(archiveDecisions.map((r) => r.archiveId))].sort(),
        );
        for (const archive of archives) {
          // The stored original is the full tool result, hash-checked.
          expect(contentHash(archive.content)).toBe(archive.contentHash);
          expect(JSON.stringify(archive.content).length).toBeGreaterThan(2000);
        }
      });

      it('should send rewritten items byte-identical on the next request of the session', async () => {
        const fx = await project(api, 'on');
        await send(fx, api, bodyFor(api, conversation(80)));
        const first = upstream.lastRequest.body as { messages: unknown[] };
        const firstDecisions = await decisions();

        await send(fx, api, bodyFor(api, conversation()));
        const second = upstream.lastRequest.body as { messages: unknown[] };
        const secondDecisions = await decisions();

        // Decisions are only added, never changed.
        expect(secondDecisions.length).toBeGreaterThan(firstDecisions.length);
        for (const decision of firstDecisions) {
          expect(secondDecisions).toContainEqual(decision);
        }
        // Every message the first request rewrote is sent the same way again.
        const firstStubs = toolResults(api, first).filter((r) =>
          r.includes('[parsim '),
        );
        const secondResults = toolResults(api, second);
        firstStubs.forEach((stub) => {
          expect(secondResults).toContain(stub);
        });
        const [, run] = await runs(fx.project.id);
        expect(run.decisionCount).toBe(secondDecisions.length);
        expect(run.newDecisionCount).toBe(
          secondDecisions.length - firstDecisions.length,
        );
      });

      it('should forward a short conversation unchanged', async () => {
        const fx = await project(api, 'on');
        const body = bodyFor(api, conversation(12));

        await send(fx, api, body);

        expect(upstream.lastRequest.rawBody).toBe(body);
        const [run] = await runs(fx.project.id);
        expect(run).toMatchObject({
          ran: false,
          applied: false,
          decisionCount: 0,
        });
      });

      it('should fail open: forward the original request and log no content when the GC throws', async () => {
        const fx = await project(api, 'on');
        const secret = 'SECRET-TOOL-OUTPUT-42';
        jest.spyOn(gcEngine, 'runGc').mockImplementation(() => {
          throw new RangeError(secret);
        });
        const body = bodyFor(api, conversation());

        const res = await send(fx, api, body);

        expect(res.status).toBe(200);
        expect(upstream.lastRequest.rawBody).toBe(body);
        const [run] = await runs(fx.project.id);
        expect(run).toMatchObject({
          mode: 'on',
          failed: true,
          applied: false,
          error: 'RangeError',
          tokensBefore: null,
        });
        expect(t.logs.text).toContain('GC failed');
        expect(t.logs.text).not.toContain(secret);
      });

      it('should fail open when the archived originals cannot be stored', async () => {
        const fx = await project(api, 'on');
        jest
          .spyOn(t.app.get(ArchivedItemRepository), 'insertMissing')
          .mockRejectedValue(new Error('database down'));
        const body = bodyFor(api, conversation());

        const res = await send(fx, api, body);

        expect(res.status).toBe(200);
        expect(upstream.lastRequest.rawBody).toBe(body);
        expect(await runs(fx.project.id)).toMatchObject([
          { failed: true, applied: false },
        ]);
        expect(await decisions()).toEqual([]);
      });

      it('should store archived originals even when the project does not store content', async () => {
        const fx = await project(api, 'on', { storeContent: false });

        await send(fx, api, bodyFor(api, conversation()));

        expect((await archived(fx.project.id)).length).toBeGreaterThan(0);
        const contents: unknown[] = await t.dataSource.query(
          'SELECT * FROM context_content',
        );
        expect(contents).toEqual([]);
      });
    });
  });

  it('should keep the stream working with a GC-rewritten body', async () => {
    const fx = await project('openai', 'on');
    const body = bodyFor('openai', conversation(), { stream: true });

    const res = await send(fx, 'openai', body);

    expect(res.status).toBe(200);
    expect(res.text).toContain('data: [DONE]');
    const forwarded = upstream.lastRequest.body as Record<string, unknown>;
    expect(forwarded.stream_options).toEqual({ include_usage: true });
    expect(upstream.lastRequest.rawBody.length).toBeLessThan(body.length / 2);
  });

  it('should fail open in shadow mode too', async () => {
    const fx = await project('openai');
    jest.spyOn(gcEngine, 'runGc').mockImplementation(() => {
      throw new Error('boom');
    });
    const body = bodyFor('openai', conversation());

    const res = await send(fx, 'openai', body);

    expect(res.status).toBe(200);
    expect(upstream.lastRequest.rawBody).toBe(body);
    expect(await runs(fx.project.id)).toMatchObject([
      { mode: 'shadow', failed: true, error: 'Error' },
    ]);
  });

  it('should not run the GC when the mode is off', async () => {
    const fx = await project('openai', 'off');
    const body = bodyFor('openai', conversation());

    await send(fx, 'openai', body);

    expect(upstream.lastRequest.rawBody).toBe(body);
    expect(await runs(fx.project.id)).toEqual([]);
  });
});
