import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { STATE_BLOCK_START } from '../../src/compression/state-block';
import { CanonicalContent } from '../../src/context/context-items';
import { ProxyService } from '../../src/proxy/proxy.service';
import { archivedText, RECALL_TOOL_NAME } from '../../src/recall/recall-tool';
import { FakeUpstream } from '../utils/fake-upstream';
import { loadConversation, toOpenAiBody } from '../utils/fixtures';
import {
  createProjectWithKey,
  ProxyFixture,
  waitFor,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const SUMMARY_MODEL = 'gemini-3.8-flash';
const SUMMARY = {
  goal: 'Write a two-page report on grid battery storage.',
  decisions: ['Use the research.example.com articles as sources.'],
  facts: ['Battery recycling measured 17.0 units in revision 2.'],
  openItems: ['Draft the final report.'],
};
const SUMMARY_USAGE = { promptTokenCount: 9000, candidatesTokenCount: 300 };

/** The internal model's answer: the summary JSON, sent after `delayMs`. */
const summaryResponse = (delayMs: number) => ({
  kind: 'json' as const,
  delayMs,
  body: {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: JSON.stringify(SUMMARY) }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: SUMMARY_USAGE,
  },
});

type CompressionRow = {
  id: string;
  status: string;
  stateBlock: string | null;
  input: unknown;
  tokensBefore: number;
  tokensAfter: number | null;
  usageRecordId: string | null;
  error: string | null;
};

describe('Compression (e2e)', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  let internal: FakeUpstream;
  const body = JSON.stringify(
    toOpenAiBody(loadConversation('research-agent-session')),
  );

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    internal = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      GC_SIDE_EFFECT_TOOLS: 'save_note',
      COMPRESSION_WORKER: 'true',
      COMPRESSION_POLL_SECONDS: '1',
      COMPRESSION_RETRY_LIMIT: '0',
      PARSIM_INTERNAL_PROVIDER: 'gemini',
      PARSIM_INTERNAL_MODEL: SUMMARY_MODEL,
      PARSIM_INTERNAL_BASE_URL: internal.baseUrl,
      // A fake key: summaries go to the fake internal model only.
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

  async function compressingProject(
    settings: Record<string, unknown> = {},
  ): Promise<ProxyFixture> {
    const fx = await createProjectWithKey(t, {
      upstream: 'openai',
      providerKey: 'sk-customer',
    });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      // No new GC decisions: the GC alone would shrink this fixture so
      // much that no stretch is worth a summary (see docs/compression.md).
      .send({
        gcMode: 'on',
        compressionEnabled: true,
        gcMinContextTokens: 1_000_000,
        ...settings,
      })
      .expect(200);
    return fx;
  }

  async function send(fx: ProxyFixture, raw = body) {
    await request(t.server)
      .post('/v1/chat/completions')
      .set('authorization', `Bearer ${fx.parsimKey}`)
      .set('x-parsim-session-id', 'compression-e2e')
      .set('content-type', 'application/json')
      .send(raw)
      .expect(200);
    await t.app.get(ProxyService).whenIdle();
  }

  const compressions = (projectId: string): Promise<CompressionRow[]> =>
    t.dataSource.query(
      'SELECT * FROM compression WHERE "projectId" = $1 ORDER BY "startIndex"',
      [projectId],
    );

  const waitForStatus = (projectId: string, status: string) =>
    waitFor(async () => {
      const [row] = await compressions(projectId);
      return row?.status === status ? row : null;
    }, 20_000);

  it('should send the originals until the summary is ready, then the state block', async () => {
    const fx = await compressingProject();
    internal.respondNext(summaryResponse(1500));

    await send(fx);
    const [pending] = await compressions(fx.project.id);
    expect(pending).toMatchObject({ status: 'pending' });
    expect(pending.tokensBefore).toBeGreaterThanOrEqual(6000);

    // The request does not wait: the original turns go out meanwhile.
    await send(fx);
    const before = upstream.lastRequest.rawBody;
    expect(before).not.toContain(STATE_BLOCK_START);
    expect((await compressions(fx.project.id))[0].status).toBe('pending');

    const ready = await waitForStatus(fx.project.id, 'ready');
    expect(ready.input).toBeNull();
    expect(ready.stateBlock).toContain(`Goal: ${SUMMARY.goal}`);
    expect(ready.stateBlock).toContain(`- ${SUMMARY.facts[0]}`);
    expect(ready.tokensAfter).toBeLessThan(ready.tokensBefore / 5);

    // The summary was asked of the internal model, with its key.
    expect(internal.requests).toHaveLength(1);
    expect(internal.lastRequest.model).toBe(SUMMARY_MODEL);
    expect(internal.lastRequest.headers['x-goog-api-key']).toBe(
      'internal-test-key',
    );

    await send(fx);
    const after = upstream.lastRequest;
    expect(after.rawBody).toContain(STATE_BLOCK_START);
    // Smaller, though every save_note call and result stays in place.
    expect(after.rawBody.length).toBeLessThan(before.length * 0.7);
    // Side-effect calls and their results stay, unchanged.
    expect(after.rawBody).toContain('"name":"save_note"');
    // parsim_recall is offered so the originals can be fetched.
    expect(after.rawBody).toContain(RECALL_TOOL_NAME);

    // The same block, byte for byte, on the next request.
    await send(fx);
    expect(upstream.lastRequest.rawBody).toBe(after.rawBody);

    const runs: { compressionSavedTokens: number }[] = await t.dataSource.query(
      'SELECT "compressionSavedTokens" FROM gc_run WHERE "projectId" = $1 ORDER BY "createdAt"',
      [fx.project.id],
    );
    expect(runs.map((r) => r.compressionSavedTokens > 0)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('should record the summary cost as a compression usage record', async () => {
    const fx = await compressingProject();
    internal.respondNext(summaryResponse(0));
    await send(fx);
    const ready = await waitForStatus(fx.project.id, 'ready');

    const rows: {
      id: string;
      kind: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: string | null;
    }[] = await t.dataSource.query(
      'SELECT * FROM usage_record WHERE "projectId" = $1 ORDER BY "createdAt"',
      [fx.project.id],
    );
    const compression = rows.find((r) => r.kind === 'compression')!;
    expect(rows.filter((r) => r.kind === 'proxy')).toHaveLength(1);
    expect(compression).toMatchObject({
      id: ready.usageRecordId,
      model: SUMMARY_MODEL,
      inputTokens: SUMMARY_USAGE.promptTokenCount,
      outputTokens: SUMMARY_USAGE.candidatesTokenCount,
    });
    expect(Number(compression.costUsd)).toBeGreaterThan(0);
  });

  it('should report compression cost and net savings on the dashboard', async () => {
    const fx = await compressingProject();
    internal.respondNext(summaryResponse(0));
    await send(fx);
    await waitForStatus(fx.project.id, 'ready');
    await send(fx);
    const api = (path: string) =>
      request(t.server)
        .get(`/api/v1/projects/${fx.project.id}${path}`)
        .auth(fx.adminToken, { type: 'bearer' })
        .expect(200)
        .then(({ body }) => body as Record<string, unknown>);

    const summary = (await api('/dashboard/summary')) as {
      requests: number;
      gc: { applied: { dollarsSaved: number } };
      compression: { summaries: number; tokensSaved: number; costUsd: number };
      netDollarsSaved: number;
    };
    // The summary call is not a client request.
    expect(summary.requests).toBe(2);
    expect(summary.compression.summaries).toBe(1);
    expect(summary.compression.tokensSaved).toBeGreaterThan(0);
    expect(summary.compression.costUsd).toBeGreaterThan(0);
    expect(summary.netDollarsSaved).toBeCloseTo(
      summary.gc.applied.dollarsSaved - summary.compression.costUsd,
      6,
    );

    const [session] = (await t.dataSource.query(
      'SELECT id FROM agent_session WHERE "projectId" = $1',
      [fx.project.id],
    )) as { id: string }[];
    const detail = (await api(`/sessions/${session.id}`)) as {
      requests: unknown[];
      compressions: { status: string; costUsd: number; stateBlock?: string }[];
    };
    expect(detail.requests).toHaveLength(2);
    expect(detail.compressions).toHaveLength(1);
    expect(detail.compressions[0].status).toBe('ready');
    expect(detail.compressions[0].costUsd).toBeGreaterThan(0);
    expect(detail.compressions[0].stateBlock).toContain(STATE_BLOCK_START);

    const settings = (await api('/settings')) as {
      compression: Record<string, unknown>;
    };
    expect(settings.compression).toEqual({
      enabled: true,
      keySource: 'parsim',
      model: null,
      minTokens: 6000,
      internalModelConfigured: true,
    });
  });

  it('should make the archived originals of compressed turns recallable', async () => {
    const fx = await compressingProject();
    internal.respondNext(summaryResponse(0));
    await send(fx);
    const ready = await waitForStatus(fx.project.id, 'ready');
    const archiveId = /- turn 1: (arc_[0-9a-f]{16})/.exec(
      ready.stateBlock!,
    )![1];
    const [archived]: { content: CanonicalContent }[] =
      await t.dataSource.query(
        'SELECT content FROM archived_item WHERE "projectId" = $1 AND "archiveId" = $2',
        [fx.project.id, archiveId],
      );
    expect(archived).toBeDefined();

    // The model asks for the original; Parsim answers and continues.
    upstream.respondNext({
      kind: 'json',
      body: {
        id: 'chatcmpl-recall',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_recall',
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
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      },
    });
    await send(fx);

    const followUp = upstream.lastRequest.body as {
      messages: { role: string; tool_call_id?: string; content: unknown }[];
    };
    const answer = followUp.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_recall',
    );
    expect(JSON.stringify(answer?.content)).toContain(
      JSON.stringify(archivedText(archived.content).slice(0, 80)).slice(1, -1),
    );
  });

  it('should mark the compression failed and keep sending the originals when the summary fails', async () => {
    const fx = await compressingProject();
    internal.failNext(400, { error: { message: 'bad request' } });
    await send(fx);

    const failed = await waitForStatus(fx.project.id, 'failed');
    expect(failed.error).toBe('upstream returned 400');
    await send(fx);
    expect(upstream.lastRequest.rawBody).not.toContain(STATE_BLOCK_START);
  });

  it('should not pay for a summary when the GC already shrank the stretch', async () => {
    const fx = await compressingProject({ gcMinContextTokens: null });
    await send(fx);
    await send(fx);
    expect(await compressions(fx.project.id)).toEqual([]);
    expect(internal.requests).toEqual([]);
  });

  it('should not compress projects in shadow mode', async () => {
    const fx = await compressingProject({ gcMode: 'shadow' });
    await send(fx);
    expect(await compressions(fx.project.id)).toEqual([]);
    expect(internal.requests).toEqual([]);
  });
});
