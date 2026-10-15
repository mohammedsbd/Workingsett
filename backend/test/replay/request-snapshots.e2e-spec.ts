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
import { RequestSnapshotsService } from '../../src/request-snapshots/request-snapshots.service';
import { FakeUpstream } from '../utils/fake-upstream';
import { loadConversation, toOpenAiBody } from '../utils/fixtures';
import { createProjectWithKey, ProxyFixture } from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

type SnapshotRow = {
  agentSessionId: string;
  requestNumber: number;
  api: string;
  model: string;
  streamed: boolean;
  gc: unknown;
};

describe('Request snapshots (e2e)', () => {
  let t: TestApp;
  let upstream: FakeUpstream;
  const research = toOpenAiBody(loadConversation('research-agent-session'));

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      GC_SIDE_EFFECT_TOOLS: 'save_note',
    });
  });

  beforeEach(async () => {
    upstream.reset();
    await t.reset();
  });

  afterAll(async () => {
    await t?.close();
    await upstream?.stop();
  });

  async function project(settings: Record<string, unknown>) {
    const fx = await createProjectWithKey(t, {
      upstream: 'openai',
      providerKey: 'sk-customer',
    });
    await request(t.server)
      .patch(`/api/v1/projects/${fx.project.id}`)
      .auth(fx.adminToken, { type: 'bearer' })
      .send(settings)
      .expect(200);
    return fx;
  }

  async function send(fx: ProxyFixture, body: object) {
    await request(t.server)
      .post('/v1/chat/completions')
      .set('authorization', `Bearer ${fx.parsimKey}`)
      .set('x-parsim-session-id', 'snapshot-e2e')
      .send(body)
      .expect(200);
    await t.app.get(ProxyService).whenIdle();
  }

  const snapshots = (projectId: string): Promise<SnapshotRow[]> =>
    t.dataSource.query(
      'SELECT * FROM request_snapshot WHERE "projectId" = $1 ORDER BY "requestNumber"',
      [projectId],
    );

  it('should rebuild what an on-mode request sent, as received and as forwarded', async () => {
    const fx = await project({ gcMode: 'on', storeContent: true });
    await send(fx, research);

    const [row] = await snapshots(fx.project.id);
    expect(row).toMatchObject({
      requestNumber: 1,
      api: 'openai-chat',
      model: research.model,
      streamed: false,
    });
    const loaded = await t.app
      .get(RequestSnapshotsService)
      .load(fx.project.id, row.agentSessionId, 1);
    expect(JSON.stringify(loaded!.original)).toBe(JSON.stringify(research));
    // The GC'd request is exactly what went upstream (no recall tool added
    // here, since parsim_recall is added per call).
    const forwarded = JSON.parse(upstream.lastRequest.rawBody) as {
      messages: unknown[];
    };
    expect(loaded!.gc!.messages).toEqual(forwarded.messages);
    expect(JSON.stringify(loaded!.gc)).not.toBe(JSON.stringify(research));
  });

  it('should store the request the GC would have sent in shadow mode', async () => {
    const fx = await project({ gcMode: 'shadow', storeContent: true });
    await send(fx, research);

    const [row] = await snapshots(fx.project.id);
    const loaded = await t.app
      .get(RequestSnapshotsService)
      .load(fx.project.id, row.agentSessionId, 1);
    // Shadow mode forwarded the original.
    expect(JSON.parse(upstream.lastRequest.rawBody)).toEqual(research);
    expect(loaded!.gc).not.toBeNull();
    expect(JSON.stringify(loaded!.gc).length).toBeLessThan(
      JSON.stringify(research).length,
    );
  });

  it('should store no GC body when the GC changed nothing, and each message once', async () => {
    const fx = await project({ gcMode: 'off', storeContent: true });
    const short = toOpenAiBody(loadConversation('short-chat'));
    await send(fx, short);
    const messages = short.messages as unknown[];
    await send(fx, {
      ...short,
      messages: [...messages, { role: 'user', content: 'And one more.' }],
    });

    const rows = await snapshots(fx.project.id);
    expect(rows.map((r) => [r.requestNumber, r.gc])).toEqual([
      [1, null],
      [2, null],
    ]);
    const [{ parts }] = (await t.dataSource.query(
      'SELECT count(*)::int AS parts FROM snapshot_part WHERE "projectId" = $1',
      [fx.project.id],
    )) as { parts: number }[];
    // One envelope plus every distinct message.
    expect(parts).toBe(1 + messages.length + 1);
  });

  it('should store nothing when the project does not store content', async () => {
    const fx = await project({ gcMode: 'on', storeContent: false });
    await send(fx, research);

    expect(await snapshots(fx.project.id)).toEqual([]);
    const [{ parts }] = (await t.dataSource.query(
      'SELECT count(*)::int AS parts FROM snapshot_part',
    )) as { parts: number }[];
    expect(parts).toBe(0);
  });
});
