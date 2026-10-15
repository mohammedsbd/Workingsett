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
import { RECALL_TOOL_NAME } from '../../src/recall/recall-tool';
import type {
  ReplayEstimateView,
  ReplayOptions,
  ReplayReport,
  ReplaySummary,
} from '../../src/replay/replay.types';
import { CannedResponse, FakeUpstream } from '../utils/fake-upstream';
import {
  FixtureMessage,
  loadConversation,
  toOpenAiBody,
} from '../utils/fixtures';
import {
  createProjectWithKey,
  ProxyFixture,
  waitFor,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const MODEL = 'gpt-4o';
const JUDGE_MODEL = 'gemini-3.8-flash';
const SESSION = 'replay-e2e';

/** An OpenAI answer from the fake upstream, with the usage it reports. */
const answer = (
  content: string,
  usage = { prompt_tokens: 1000, completion_tokens: 50 },
): CannedResponse => ({
  kind: 'json',
  body: {
    id: 'chatcmpl-replay',
    object: 'chat.completion',
    model: MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      ...usage,
      total_tokens: usage.prompt_tokens + usage.completion_tokens,
    },
  },
});

/** The judge's verdict, from the fake internal model (Gemini native). */
const verdict = (score: number, reason: string): CannedResponse => ({
  kind: 'json',
  body: {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: JSON.stringify({ score, reason }) }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 40 },
  },
});

describe('Replay (e2e)', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  let internal: FakeUpstream;

  // Three requests of one research session, each ending before an
  // assistant turn: about a third, two thirds and all of the conversation.
  const conversation = loadConversation('research-agent-session');
  const cuts = conversation.messages
    .map((m, i) => (m.role === 'assistant' && i > 1 ? i : -1))
    .filter((i) => i > 0);
  const requests = [
    cuts[Math.floor(cuts.length / 3)],
    cuts[Math.floor((2 * cuts.length) / 3)],
    cuts[cuts.length - 1],
  ].map((end) => ({
    ...toOpenAiBody({
      ...conversation,
      messages: conversation.messages.slice(0, end) as FixtureMessage[],
    }),
    model: MODEL,
    temperature: 0.7,
    stream: true,
  }));

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    internal = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      GC_SIDE_EFFECT_TOOLS: 'save_note',
      // The research fixture's tool results are ~900 tokens: archive them,
      // so the GC'd version carries archive stubs and parsim_recall.
      GC_ARCHIVE_MIN_TOKENS: '500',
      REPLAY_WORKER: 'true',
      REPLAY_POLL_SECONDS: '1',
      PARSIM_INTERNAL_PROVIDER: 'gemini',
      PARSIM_INTERNAL_MODEL: JUDGE_MODEL,
      PARSIM_INTERNAL_BASE_URL: internal.baseUrl,
      // A fake key: the judge only ever reaches the fake internal model.
      GEMINI_API_KEY: 'internal-test-key',
    });
  });

  beforeEach(async () => {
    upstream.reset();
    internal.reset();
    await t.reset();
  });

  afterAll(async () => {
    await t?.close();
    await upstream?.stop();
    await internal?.stop();
  });

  /** A project in on mode with a recorded three-request session. */
  async function recordedSession(
    settings: Record<string, unknown> = {},
  ): Promise<{ fx: ProxyFixture; sessionId: string; base: string }> {
    const fx = await createProjectWithKey(t, {
      upstream: 'openai',
      providerKey: 'sk-customer',
    });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ gcMode: 'on', storeContent: true, ...settings })
      .expect(200);
    for (const body of requests) {
      await request(t.server)
        .post('/v1/chat/completions')
        .set('authorization', `Bearer ${fx.parsimKey}`)
        .set('x-parsim-session-id', SESSION)
        .send(body)
        .expect(200);
      await t.app.get(ProxyService).whenIdle();
    }
    const [{ id: sessionId }] = (await t.dataSource.query(
      'SELECT id FROM agent_session WHERE "projectId" = $1',
      [fx.project.id],
    )) as { id: string }[];
    upstream.reset();
    return {
      fx,
      sessionId,
      base: `/api/v1/projects/${fx.project.id}/sessions/${sessionId}/replays`,
    };
  }

  const finished = (fx: ProxyFixture, base: string, id: string) =>
    waitFor(async () => {
      const { body } = await request(t.server)
        .get(`${base}/${id}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .expect(200);
      const report = body as ReplayReport;
      return ['completed', 'budget_exceeded', 'failed'].includes(
        report.replay.status,
      )
        ? report
        : null;
    }, 20_000);

  it('should offer the recorded requests and estimate the cost without sending anything', async () => {
    const { fx, base } = await recordedSession();

    const options = await request(t.server)
      .get(`${base}/options`)
      .auth(fx.adminToken, { type: 'bearer' })
      .expect(200)
      .then(({ body }) => body as ReplayOptions);
    expect(options.blockedReason).toBeNull();
    expect(options.candidates.map((c) => c.requestNumber)).toEqual([1, 2, 3]);
    expect(options.candidates.some((c) => c.gcChanged)).toBe(true);
    expect(options.defaultBudgetUsd).toBe(1);
    expect(options.judge).toEqual({
      keySource: 'parsim',
      provider: 'gemini',
      model: JUDGE_MODEL,
    });

    const estimate = await request(t.server)
      .post(`${base}/estimate`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ requestNumbers: [3, 1], budgetUsd: 0.5 })
      .expect(200)
      .then(({ body }) => body as ReplayEstimateView);
    expect(estimate.requestNumbers).toEqual([1, 3]);
    expect(estimate.models).toEqual([MODEL]);
    const [first, last] = estimate.points;
    // The GC shrinks the full session; both versions are priced.
    expect(last.gcInputTokens).toBeLessThan(last.originalInputTokens);
    expect(last.originalInputTokens).toBeGreaterThan(first.originalInputTokens);
    expect(estimate.totalUsd).toBeGreaterThan(0);
    expect(estimate.totalUsd).toBeCloseTo(
      estimate.points.reduce(
        (s, p) => s + p.originalUsd + p.gcUsd + p.judgeUsd,
        0,
      ),
      5,
    );
    expect(upstream.requests).toHaveLength(0);
    expect(internal.requests).toHaveLength(0);
  });

  it('should report the agreement rate, both versions and the answers side by side', async () => {
    const { fx, base, sessionId } = await recordedSession();
    // Point 1: identical answers. Point 2: different, the judge agrees.
    // Point 3: different, the judge does not.
    upstream.respondNext(answer('The capacity is 40 GWh.'));
    upstream.respondNext(
      answer('The capacity is 40 GWh.', {
        prompt_tokens: 400,
        completion_tokens: 50,
      }),
    );
    upstream.respondNext(answer('Battery recycling reached 17.0 units.'));
    upstream.respondNext(
      answer('Recycling: 17.0 units.', {
        prompt_tokens: 400,
        completion_tokens: 50,
      }),
    );
    upstream.respondNext(answer('Draft the report with 3 sources.'));
    upstream.respondNext(
      answer('I need more data first.', {
        prompt_tokens: 400,
        completion_tokens: 50,
      }),
    );
    internal.respondNext(verdict(5, 'Same figure.'));
    internal.respondNext(verdict(2, 'B delays the report.'));

    const started = await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ requestNumbers: [1, 2, 3] })
      .expect(201)
      .then(({ body }) => body as ReplaySummary);
    expect(started).toMatchObject({
      status: 'queued',
      pointsTotal: 3,
      budgetUsd: 1,
    });
    expect(started.estimatedCostUsd).toBeGreaterThan(0);

    const report = await finished(fx, base, started.id);
    expect(report.replay).toMatchObject({
      status: 'completed',
      pointsDone: 3,
      error: null,
    });
    expect(report.agreement).toEqual({
      judged: 3,
      agreed: 2,
      rate: 2 / 3,
      exactMatches: 1,
      toolCallMatches: 3,
      failed: 0,
    });
    expect(
      report.points.map((p) => [
        p.requestNumber,
        p.exactMatch,
        p.judgeScore,
        p.agreed,
      ]),
    ).toEqual([
      [1, true, 5, true],
      [2, false, 5, true],
      [3, false, 2, false],
    ]);
    expect(report.points[2].judgeReason).toBe('B delays the report.');
    expect(report.points[2].original!.answer!.text).toBe(
      'Draft the report with 3 sources.',
    );
    expect(report.points[2].gc!.answer!.text).toBe('I need more data first.');

    // Tokens and cost of both versions (gpt-4o: $2.50 in, $10.00 out per 1M).
    expect(report.totals.original).toEqual({
      inputTokens: 3000,
      outputTokens: 150,
      costUsd: 0.009,
    });
    expect(report.totals.gc).toEqual({
      inputTokens: 1200,
      outputTokens: 150,
      costUsd: 0.0045,
    });
    expect(report.totals.judgeCostUsd).toBeGreaterThan(0);
    expect(report.replay.spentUsd).toBeCloseTo(
      0.009 + 0.0045 + report.totals.judgeCostUsd,
      6,
    );

    // Each point went upstream twice, not streamed, at temperature 0, with
    // the project's key: first as recorded, then as the GC made it.
    expect(upstream.requests).toHaveLength(6);
    for (const sent of upstream.requests) {
      expect(sent.headers.authorization).toBe('Bearer sk-customer');
      expect(sent.body).toMatchObject({ model: MODEL, temperature: 0 });
      expect(sent.body).not.toHaveProperty('stream');
    }
    const [original, gc] = [upstream.requests[4], upstream.requests[5]];
    expect((original.body as { messages: unknown[] }).messages).toEqual(
      (requests[2] as { messages?: unknown }).messages,
    );
    expect(original.rawBody).not.toContain(RECALL_TOOL_NAME);
    expect(gc.rawBody.length).toBeLessThan(original.rawBody.length);
    expect(gc.rawBody).toContain('[parsim archived:');
    expect(gc.rawBody).toContain(RECALL_TOOL_NAME);

    // Only the two differing points were judged, by the internal model.
    expect(internal.requests).toHaveLength(2);
    expect(internal.lastRequest.path).toBe(
      `/v1beta/models/${JUDGE_MODEL}:generateContent`,
    );
    expect(internal.lastRequest.rawBody).toContain('I need more data first.');

    // Every call is a usage record of its own kind, outside the proxy totals.
    const kinds = (await t.dataSource.query(
      `SELECT kind, count(*)::int AS n FROM usage_record WHERE "agentSessionId" = $1 GROUP BY kind ORDER BY kind`,
      [sessionId],
    )) as { kind: string; n: number }[];
    expect(kinds).toEqual([
      { kind: 'proxy', n: 3 },
      { kind: 'replay', n: 6 },
      { kind: 'replay_judge', n: 2 },
    ]);

    const list = await request(t.server)
      .get(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .expect(200)
      .then(({ body }) => body as ReplaySummary[]);
    expect(list.map((r) => [r.id, r.status])).toEqual([
      [started.id, 'completed'],
    ]);
  });

  it('should stop before a call that could pass the budget', async () => {
    const { fx, base } = await recordedSession();
    // Each call reports 30,000 input and 1,000 output tokens: $0.085.
    const expensive = { prompt_tokens: 30_000, completion_tokens: 1_000 };
    for (let i = 0; i < 4; i++)
      upstream.respondNext(answer('Same answer.', expensive));

    const started = await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ requestNumbers: [1, 2], budgetUsd: 0.2 })
      .expect(201)
      .then(({ body }) => body as ReplaySummary);

    const report = await finished(fx, base, started.id);
    // Point 1 cost $0.17. Point 2's first call reserves at least 4,096
    // output tokens ($0.04), which could pass $0.20, so it never starts.
    expect(report.replay).toMatchObject({
      status: 'budget_exceeded',
      pointsDone: 1,
    });
    expect(report.replay.error).toContain('budget');
    expect(report.replay.spentUsd).toBeCloseTo(0.17, 6);
    expect(report.replay.spentUsd).toBeLessThanOrEqual(0.2);
    expect(report.points.map((p) => p.requestNumber)).toEqual([1]);
    expect(upstream.requests).toHaveLength(2);
  });

  it('should keep the answers out of the report once content storage is off', async () => {
    const { fx, base } = await recordedSession();
    const started = await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ requestNumbers: [1] })
      .expect(201)
      .then(({ body }) => body as ReplaySummary);
    await finished(fx, base, started.id);
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ storeContent: false })
      .expect(200);

    const report = await request(t.server)
      .get(`${base}/${started.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .expect(200)
      .then(({ body }) => body as ReplayReport);
    expect(report.contentAllowed).toBe(false);
    expect(report.points[0].original).not.toHaveProperty('answer');
    expect(report.points[0]).not.toHaveProperty('judgeReason');
    expect(report.agreement.rate).toBe(1);

    // And no new replay can start.
    const { body } = await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({})
      .expect(400);
    expect((body as { message: string }).message).toContain('content storage');
  });

  it('should refuse a replay without a stored provider key, a budget above the limit or an unknown request', async () => {
    const { fx, base } = await recordedSession();
    await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ budgetUsd: 1000 })
      .expect(400);
    await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ requestNumbers: [99] })
      .expect(400);
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({ providerKey: null })
      .expect(200);
    const options = await request(t.server)
      .get(`${base}/options`)
      .auth(fx.adminToken, { type: 'bearer' })
      .expect(200)
      .then(({ body }) => body as ReplayOptions);
    expect(options.blockedReason).toContain('provider key');
    await request(t.server)
      .post(base)
      .auth(fx.adminToken, { type: 'bearer' })
      .send({})
      .expect(400);
    expect(upstream.requests).toHaveLength(0);
  });

  it("should not show another project's session", async () => {
    const { base } = await recordedSession();
    const other = await createProjectWithKey(t);
    const foreign = base.replace(
      /projects\/[^/]+/,
      `projects/${other.project.id}`,
    );
    await request(t.server)
      .get(`${foreign}/options`)
      .auth(other.adminToken, { type: 'bearer' })
      .expect(404);
  });
});
