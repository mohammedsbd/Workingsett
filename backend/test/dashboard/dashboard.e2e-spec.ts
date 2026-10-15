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
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { ProxyService } from '../../src/proxy/proxy.service';
import { archiveStubIds } from '../../src/recall/archive-stubs';
import { RECALL_TOOL_NAME } from '../../src/recall/recall-tool';
import { login } from '../utils/auth-helpers';
import { TESTER_EMAIL, TESTER_PASSWORD } from '../utils/constants';
import { FakeUpstream } from '../utils/fake-upstream';
import { loadConversation, toOpenAiBody } from '../utils/fixtures';
import { createProjectWithKey, ProxyFixture } from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

type Summary = {
  mode: string;
  requests: number;
  upstreamCalls: number;
  gc: {
    runs: number;
    tokensBefore: number;
    tokensAfter: number;
    reduction: number;
    applied: { tokensSaved: number; dollarsSaved: number };
    estimated: { tokensSaved: number; dollarsSaved: number };
  };
  recalls: { count: number; found: number; tokensRestored: number };
  decisionsByReason: Record<string, number>;
};

describe('Dashboard endpoints', () => {
  let t: TestApp;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      GC_ARCHIVE_MIN_TOKENS: '500',
      GC_SIDE_EFFECT_TOOLS: 'save_note',
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const research = (messages?: number) => {
    const c = loadConversation('research-agent-session');
    if (messages) c.messages = c.messages.slice(0, messages);
    return JSON.stringify({ ...toOpenAiBody(c), model: 'gpt-4o' });
  };

  const setMode = (fx: ProxyFixture, body: object) =>
    request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send(body)
      .expect(200);

  const proxy = async (fx: ProxyFixture, body: string, session: string) => {
    await request(t.server)
      .post('/v1/chat/completions')
      .set('content-type', 'application/json')
      .set('x-parsim-key', fx.parsimKey)
      .set('x-provider-key', 'sk-test')
      .set('x-parsim-session-id', session)
      .send(body)
      .expect(200);
    await t.app.get(ProxyService).whenIdle();
  };

  const get = <T>(fx: ProxyFixture, path: string, token = fx.adminToken) =>
    request(t.server)
      .get(`/api/v1/projects/${fx.project.id}${path}`)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .then((res) => res.body as T);

  /** An "on" project with two sessions, GC decisions and one recall. */
  const seedOn = async () => {
    const fx = await createProjectWithKey(t);
    await setMode(fx, { gcMode: 'on' });
    await proxy(fx, research(80), 'session-a');
    await proxy(fx, research(), 'session-a');
    const archiveId = archiveStubIds(upstream.lastRequest.rawBody)[0];
    upstream.respondNext({
      kind: 'json',
      body: {
        id: 'chatcmpl-r',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'r1',
                  type: 'function',
                  function: {
                    name: RECALL_TOOL_NAME,
                    arguments: JSON.stringify({ archive_id: archiveId }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      },
    });
    await proxy(fx, research(), 'session-a');
    await proxy(fx, research(12), 'session-b');
    return fx;
  };

  describe('summary', () => {
    it('should report requests, applied savings, recalls and decisions', async () => {
      const fx = await seedOn();

      const summary = await get<Summary>(fx, '/dashboard/summary');

      expect(summary.mode).toBe('on');
      expect(summary.requests).toBe(4);
      expect(summary.upstreamCalls).toBe(5);
      expect(summary.gc.runs).toBe(4);
      expect(summary.gc.applied.tokensSaved).toBe(
        summary.gc.tokensBefore - summary.gc.tokensAfter,
      );
      expect(summary.gc.applied.tokensSaved).toBeGreaterThan(10_000);
      expect(summary.gc.applied.dollarsSaved).toBeGreaterThan(0);
      expect(summary.gc.estimated).toEqual({ tokensSaved: 0, dollarsSaved: 0 });
      expect(summary.gc.reduction).toBeGreaterThan(0.5);
      expect(summary.recalls).toMatchObject({ count: 1, found: 1 });
      expect(summary.recalls.tokensRestored).toBeGreaterThan(500);

      const [{ count }] = (await t.dataSource.query(
        'SELECT count(*) AS count FROM gc_decision',
      )) as { count: string }[];
      const reasons = summary.decisionsByReason;
      expect(reasons.duplicate + reasons.superseded + reasons.stale_large).toBe(
        Number(count),
      );
      expect(reasons.stale_large).toBeGreaterThan(0);
    });

    it('should report shadow savings as estimates', async () => {
      const fx = await createProjectWithKey(t);
      await proxy(fx, research(), 'shadow');

      const summary = await get<Summary>(fx, '/dashboard/summary');

      expect(summary.mode).toBe('shadow');
      expect(summary.gc.applied).toEqual({ tokensSaved: 0, dollarsSaved: 0 });
      expect(summary.gc.estimated.tokensSaved).toBeGreaterThan(10_000);
      expect(summary.gc.estimated.dollarsSaved).toBeGreaterThan(0);
    });

    it('should only count the requested date range', async () => {
      const fx = await seedOn();
      const past = await get<Summary>(
        fx,
        '/dashboard/summary?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z',
      );
      expect(past).toMatchObject({
        requests: 0,
        gc: { runs: 0, reduction: 0 },
        recalls: { count: 0 },
      });
    });

    it.each([
      [
        'from after to',
        '?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
        400,
      ],
      [
        'more than a year',
        '?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z',
        400,
      ],
      ['a date that is not ISO 8601', '?from=yesterday', 422],
    ])('should reject %s', async (_, query, status) => {
      const fx = await createProjectWithKey(t);
      await request(t.server)
        .get(`/api/v1/projects/${fx.project.id}/dashboard/summary${query}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .expect(status);
    });
  });

  describe('daily savings', () => {
    it('should return one entry per day with today holding the traffic', async () => {
      const fx = await seedOn();

      const days = await get<
        { date: string; requests: number; applied: { tokensSaved: number } }[]
      >(fx, '/dashboard/daily');

      expect(days.length).toBeGreaterThanOrEqual(30);
      expect(days.length).toBeLessThanOrEqual(31);
      const today = new Date().toISOString().slice(0, 10);
      const todays = days.find((d) => d.date === today)!;
      expect(todays.requests).toBe(4);
      expect(todays.applied.tokensSaved).toBeGreaterThan(10_000);
      expect(
        days.filter((d) => d.date !== today).every((d) => d.requests === 0),
      ).toBe(true);
    });
  });

  describe('range bounds', () => {
    type Day = { requests: number };

    it("should count the newest rows when Node's clock lags the database's", async () => {
      const fx = await createProjectWithKey(t);
      await setMode(fx, { gcMode: 'on' });
      await proxy(fx, research(), 'session-a');

      // A real lag is a few milliseconds and only loses the race under load;
      // five seconds makes it certain. Only Date is faked.
      jest.useFakeTimers({
        now: Date.now() - 5_000,
        advanceTimers: true,
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      let summary: Summary;
      let days: Day[];
      try {
        summary = await get<Summary>(fx, '/dashboard/summary');
        days = await get<Day[]>(fx, '/dashboard/daily');
      } finally {
        jest.useRealTimers();
      }

      expect(summary.requests).toBe(1);
      expect(summary.gc.runs).toBe(1);
      expect(days.reduce((total, day) => total + day.requests, 0)).toBe(1);
    });

    it('should match usage records whatever time zone Node runs in', async () => {
      const fx = await createProjectWithKey(t);
      await proxy(fx, research(12), 'session-a');
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      // node-postgres sends Dates with Node's UTC offset. Sending them as UTC
      // stands in for a Node process whose zone differs from the database
      // session's (TZ cannot be changed inside Jest's sandbox).
      const pg = (t.dataSource.driver as PostgresDriver).postgres as {
        defaults: { parseInputDatesAsUTC: boolean };
      };
      pg.defaults.parseInputDatesAsUTC = true;
      let summary: Summary;
      try {
        summary = await get<Summary>(
          fx,
          `/dashboard/summary?from=${from}&to=${to}`,
        );
      } finally {
        pg.defaults.parseInputDatesAsUTC = false;
      }

      expect(summary.requests).toBe(1);
    });
  });

  describe('sessions', () => {
    type Page = {
      data: {
        externalId: string;
        requestCount: number;
        tokensSaved: number;
        recalls: number;
      }[];
      total: number;
      page: number;
      limit: number;
    };

    it('should list sessions with savings, sorted and paged', async () => {
      const fx = await seedOn();

      const bySaved = await get<Page>(
        fx,
        '/sessions?sort=tokensSaved&order=desc',
      );
      expect(bySaved.total).toBe(2);
      expect(bySaved.data.map((s) => s.externalId)).toEqual([
        'session-a',
        'session-b',
      ]);
      expect(bySaved.data[0]).toMatchObject({ requestCount: 3, recalls: 1 });
      expect(bySaved.data[0].tokensSaved).toBeGreaterThan(
        bySaved.data[1].tokensSaved,
      );

      const asc = await get<Page>(fx, '/sessions?sort=tokensSaved&order=asc');
      expect(asc.data.map((s) => s.externalId)).toEqual([
        'session-b',
        'session-a',
      ]);

      const second = await get<Page>(
        fx,
        '/sessions?sort=tokensSaved&limit=1&page=2',
      );
      expect(second).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(second.data.map((s) => s.externalId)).toEqual(['session-b']);
    });

    it('should search by session id or model, treating wildcards literally', async () => {
      const fx = await seedOn();
      expect(
        (await get<Page>(fx, '/sessions?search=SION-B')).data,
      ).toHaveLength(1);
      expect((await get<Page>(fx, '/sessions?search=gpt-4o')).total).toBe(2);
      expect((await get<Page>(fx, '/sessions?search=%25')).total).toBe(0);
    });

    it('should reject unknown sort fields and oversized pages', async () => {
      const fx = await createProjectWithKey(t);
      for (const query of ['?sort=password', '?limit=500', '?page=0']) {
        await request(t.server)
          .get(`/api/v1/projects/${fx.project.id}/sessions${query}`)
          .auth(fx.adminToken, { type: 'bearer' })
          .expect(422);
      }
    });
  });

  describe('session detail', () => {
    type Detail = {
      session: { externalId: string };
      contentAllowed: boolean;
      requests: {
        upstreamCalls: number;
        gc: { applied: boolean; tokensBefore: number } | null;
      }[];
      decisions: { reason: string; replacement: string; content?: unknown }[];
      recalls: { found: boolean }[];
    };

    const sessionId = async (fx: ProxyFixture, externalId: string) =>
      (
        (await t.dataSource.query(
          'SELECT id FROM agent_session WHERE "externalId" = $1 AND "projectId" = $2',
          [externalId, fx.project.id],
        )) as { id: string }[]
      )[0].id;

    it('should give the timeline, decisions with reasons, recalls and content', async () => {
      const fx = await seedOn();
      const id = await sessionId(fx, 'session-a');

      const detail = await get<Detail>(fx, `/sessions/${id}`);

      expect(detail.session.externalId).toBe('session-a');
      expect(detail.requests.map((r) => r.upstreamCalls)).toEqual([1, 1, 2]);
      expect(detail.requests.every((r) => r.gc?.applied)).toBe(true);
      expect(detail.decisions.length).toBeGreaterThan(5);
      for (const decision of detail.decisions) {
        expect(['duplicate', 'superseded', 'stale_large']).toContain(
          decision.reason,
        );
        expect(decision.replacement).toMatch(/^\[parsim /);
      }
      expect(detail.contentAllowed).toBe(true);
      expect(detail.decisions[0].content).toMatchObject({
        kind: 'tool_result',
      });
      expect(detail.recalls).toEqual([
        expect.objectContaining({ found: true }),
      ]);
    });

    it('should never return content when the project does not store it', async () => {
      const fx = await seedOn();
      await setMode(fx, { storeContent: false });
      const id = await sessionId(fx, 'session-a');

      const res = await request(t.server)
        .get(`/api/v1/projects/${fx.project.id}/sessions/${id}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .expect(200);

      expect((res.body as Detail).contentAllowed).toBe(false);
      expect(
        (res.body as Detail).decisions.every((d) => !('content' in d)),
      ).toBe(true);
      expect(res.text).not.toContain('Section 1 of');
    });

    it('should never return content from the list and summary endpoints', async () => {
      const fx = await seedOn();
      for (const path of [
        '/dashboard/summary',
        '/dashboard/daily',
        '/sessions',
        '/settings',
      ]) {
        const res = await request(t.server)
          .get(`/api/v1/projects/${fx.project.id}${path}`)
          .auth(fx.adminToken, { type: 'bearer' })
          .expect(200);
        expect(res.text).not.toContain('Section 1 of');
        expect(res.text).not.toContain('battery');
      }
    });

    it('should 404 for an unknown session or one of another project', async () => {
      const fx = await seedOn();
      const other = await createProjectWithKey(t);
      const id = await sessionId(fx, 'session-a');
      for (const [project, session] of [
        [fx.project.id, '00000000-0000-4000-8000-000000000000'],
        [other.project.id, id],
      ]) {
        await request(t.server)
          .get(`/api/v1/projects/${project}/sessions/${session}`)
          .auth(fx.adminToken, { type: 'bearer' })
          .expect(404);
      }
    });
  });

  describe('settings', () => {
    type Settings = {
      gcMode: string;
      thresholds: Record<string, { value: number | null; default: number }>;
      sideEffectTools: {
        project: string[];
        server: string[];
        patterns: string[];
      };
      recallMaxPerRequest: number;
    };

    it('should show defaults, then the project overrides', async () => {
      const fx = await createProjectWithKey(t);
      const before = await get<Settings>(fx, '/settings');
      expect(before).toMatchObject({
        gcMode: 'shadow',
        thresholds: {
          gcMinContextTokens: { value: null, default: 8000 },
          gcBatchTokens: { value: null, default: 4000 },
          gcArchiveMinTokens: { value: null, default: 500 },
        },
        sideEffectTools: { project: [], server: ['save_note'] },
        recallMaxPerRequest: 3,
      });
      expect(before.sideEffectTools.patterns).toContain('send_');

      await setMode(fx, {
        gcMode: 'on',
        gcMinContextTokens: 0,
        gcBatchTokens: 2000,
        gcSideEffectTools: ['book_flight'],
      });
      const after = await get<Settings>(fx, '/settings');
      expect(after).toMatchObject({
        gcMode: 'on',
        thresholds: {
          gcMinContextTokens: { value: 0, default: 8000 },
          gcBatchTokens: { value: 2000, default: 4000 },
        },
        sideEffectTools: { project: ['book_flight'] },
      });

      await setMode(fx, { gcBatchTokens: null });
      expect(
        (await get<Settings>(fx, '/settings')).thresholds.gcBatchTokens.value,
      ).toBeNull();
    });

    it('should show and change who pays for the replay judge', async () => {
      const fx = await createProjectWithKey(t);
      type ReplaySettings = {
        replay: {
          judgeKeySource: string;
          judgeModel: string | null;
          defaultBudgetUsd: number;
          maxBudgetUsd: number;
        };
      };
      expect((await get<ReplaySettings>(fx, '/settings')).replay).toMatchObject(
        {
          judgeKeySource: 'parsim',
          judgeModel: null,
          defaultBudgetUsd: 1,
          maxBudgetUsd: 25,
        },
      );
      await setMode(fx, {
        replayJudgeKeySource: 'project',
        replayJudgeModel: 'gpt-4o-mini',
      });
      expect((await get<ReplaySettings>(fx, '/settings')).replay).toMatchObject(
        { judgeKeySource: 'project', judgeModel: 'gpt-4o-mini' },
      );
    });

    it.each([
      { gcBatchTokens: -1 },
      { gcProtectedTurns: 0 },
      { gcArchiveAfterTurns: 1.5 },
      { gcSideEffectTools: 'book_flight' },
      { gcSideEffectTools: [''] },
    ])('should reject invalid settings %j', async (body) => {
      const fx = await createProjectWithKey(t);
      await request(t.server)
        .patch(`/api/v1/projects/${fx.project.id}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .send(body)
        .expect(422);
    });

    it("should apply the project's thresholds to its traffic", async () => {
      const fx = await createProjectWithKey(t);
      // Never archive in this project, whatever the server default.
      await setMode(fx, { gcMode: 'on', gcArchiveMinTokens: 1_000_000 });

      await proxy(fx, research(), 'thresholds');

      expect(upstream.lastRequest.rawBody).toContain('[parsim dropped');
      expect(upstream.lastRequest.rawBody).not.toContain('[parsim archived');
    });
  });

  describe('access', () => {
    const paths = (fx: ProxyFixture) =>
      [
        '/dashboard/summary',
        '/dashboard/daily',
        '/sessions',
        '/settings',
        `/sessions/00000000-0000-4000-8000-000000000000`,
      ].map((p) => `/api/v1/projects/${fx.project.id}${p}`);

    it("should not let one user see another user's project", async () => {
      const fx = await seedOn();
      const tester = (await login(t, TESTER_EMAIL, TESTER_PASSWORD)).token;
      for (const path of paths(fx)) {
        await request(t.server)
          .get(path)
          .auth(tester, { type: 'bearer' })
          .expect(404);
      }
    });

    it('should require a token', async () => {
      const fx = await createProjectWithKey(t);
      for (const path of paths(fx)) {
        await request(t.server).get(path).expect(401);
      }
    });
  });
});
