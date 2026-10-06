import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import {
  defaultResponse,
  FakeUpstream,
  parseSse,
} from '../utils/fake-upstream';
import {
  chatBody,
  createProjectWithKey,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const PROVIDER_KEY = 'sk-test-provider-options';

/**
 * Runs the app with a short upstream timeout and PARSIM_REQUIRE_KEY=false,
 * which the main proxy suite leaves at their defaults.
 */
describe('Proxy options: timeouts and keyless dev mode', () => {
  let t: TestApp;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    upstream = await FakeUpstream.start();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: upstream.baseUrl,
      PROXY_UPSTREAM_TIMEOUT_MS: '300',
      PARSIM_REQUIRE_KEY: 'false',
    });
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  const proxy = () =>
    request(t.server)
      .post('/v1/chat/completions')
      .set('content-type', 'application/json')
      .set('x-provider-key', PROVIDER_KEY);

  describe('upstream timeout (PROXY_UPSTREAM_TIMEOUT_MS)', () => {
    it('should return 504 in OpenAI format when upstream sends nothing in time', async () => {
      const fx = await createProjectWithKey(t);
      upstream.respondNext({ kind: 'json', body: {}, delayMs: 1000 });

      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .send(chatBody())
        .expect(504);

      expect(res.body.error).toMatchObject({
        type: 'upstream_timeout',
        code: 'upstream_timeout',
      });
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record.status).toBe(504);
    });

    it('should end a stream that stalls between chunks and record a timeout', async () => {
      const fx = await createProjectWithKey(t);
      const canned = defaultResponse('openai', true, { stream: true });
      upstream.respondNext({ ...canned, delayMs: 1000 } as typeof canned);

      const res = await proxy()
        .set('x-parsim-key', fx.parsimKey)
        .send(chatBody({ stream: true }))
        .expect(200);

      expect(parseSse(res.text).map((e) => e.data)).not.toContain('[DONE]');
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({ status: 504, streamed: true });
    });
  });

  describe('PARSIM_REQUIRE_KEY=false', () => {
    it('should let localhost requests without a key use the oldest project', async () => {
      const first = await createProjectWithKey(t);
      await createProjectWithKey(t);

      await proxy().send(chatBody()).expect(200);

      const [record] = await waitForUsageRecords(
        t.dataSource,
        first.project.id,
      );
      expect(record.status).toBe(200);
    });

    it('should still reject a key that is sent but invalid', async () => {
      await createProjectWithKey(t);

      await proxy()
        .set('x-parsim-key', 'psm_' + 'z'.repeat(43))
        .send(chatBody())
        .expect(401);
    });

    it('should explain when there is no project to use', async () => {
      const res = await proxy().send(chatBody()).expect(401);

      expect(res.body.error.message).toContain('PARSIM_REQUIRE_KEY=false');
      expect(upstream.requests).toHaveLength(0);
    });
  });
});
