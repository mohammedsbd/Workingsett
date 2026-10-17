import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { login } from '../utils/auth-helpers';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../utils/constants';
import {
  FAKE_REPLY_TEXT,
  FAKE_USAGE,
  FakeUpstream,
  parseSse,
} from '../utils/fake-upstream';
import {
  chatBody,
  createProjectWithKey,
  waitForUsageRecords,
} from '../utils/proxy-helpers';
import { createTestApp, TestApp } from '../utils/test-app';

const PROVIDER_KEY = 'gsk-test-provider-0123456789';

/**
 * "openai-compatible" projects (for example Groq) forward to their own base
 * URL through the OpenAI adapter. A custom URL is a server-side request
 * forgery risk, so it is allowed only with PARSIM_ALLOW_CUSTOM_UPSTREAM=true
 * (development) or for an https host in the allowlist.
 */
describe('Proxy: openai-compatible upstreams', () => {
  describe('with PARSIM_ALLOW_CUSTOM_UPSTREAM=true', () => {
    let t: TestApp;
    let upstream: FakeUpstream;

    beforeAll(async () => {
      upstream = await FakeUpstream.start();
      t = await createTestApp({ PARSIM_ALLOW_CUSTOM_UPSTREAM: 'true' });
    });

    beforeEach(async () => {
      await t.reset();
      upstream.reset();
    });

    afterAll(async () => {
      await Promise.all([t?.close(), upstream?.stop()]);
    });

    const project = () =>
      createProjectWithKey(t, {
        upstream: 'openai-compatible',
        upstreamBaseUrl: `${upstream.baseUrl}/v1/`,
      });

    it('should forward to {base URL}/chat/completions and record usage', async () => {
      const fx = await project();
      expect(fx.project).toMatchObject({
        upstream: 'openai-compatible',
        upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      });
      const body = chatBody();

      const res = await request(t.server)
        .post('/v1/chat/completions')
        .set('content-type', 'application/json')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(body)
        .expect(200);

      expect(upstream.lastRequest.path).toBe('/v1/chat/completions');
      expect(upstream.lastRequest.rawBody).toBe(body);
      expect(upstream.lastRequest.headers.authorization).toBe(
        `Bearer ${PROVIDER_KEY}`,
      );
      expect(upstream.lastRequest.headers['x-parsim-key']).toBeUndefined();
      expect(
        (res.body as { choices: { message: { content: string } }[] }).choices[0]
          .message.content,
      ).toBe(FAKE_REPLY_TEXT);
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({
        upstream: 'openai-compatible',
        inputTokens: FAKE_USAGE.input,
        outputTokens: FAKE_USAGE.output,
        status: 200,
      });
    });

    it('should stream the response through', async () => {
      const fx = await project();
      const res = await request(t.server)
        .post('/v1/chat/completions')
        .set('content-type', 'application/json')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody({ stream: true }))
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      const text = parseSse(res.text)
        .filter((e) => e.data !== '[DONE]')
        .map(
          (e) =>
            (
              JSON.parse(e.data) as {
                choices: { delta?: { content?: string } }[];
              }
            ).choices[0]?.delta?.content ?? '',
        )
        .join('');
      expect(text).toBe(FAKE_REPLY_TEXT);
      expect(upstream.lastRequest.streamed).toBe(true);
      const [record] = await waitForUsageRecords(t.dataSource, fx.project.id);
      expect(record).toMatchObject({
        streamed: true,
        outputTokens: FAKE_USAGE.output,
      });
    });

    it('should refuse the Anthropic endpoint for an openai-compatible project', async () => {
      const fx = await project();
      const res = await request(t.server)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send({ model: 'm', max_tokens: 10, messages: [] })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('/v1/chat/completions');
      expect(upstream.requests).toHaveLength(0);
    });

    it('should pass an upstream error through', async () => {
      const fx = await project();
      upstream.failNext(429, { error: { message: 'Rate limit reached' } });
      const res = await request(t.server)
        .post('/v1/chat/completions')
        .set('content-type', 'application/json')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(429);
      expect(res.body).toEqual({ error: { message: 'Rate limit reached' } });
    });
  });

  describe('without PARSIM_ALLOW_CUSTOM_UPSTREAM', () => {
    let t: TestApp;
    let upstream: FakeUpstream;
    let token: string;

    beforeAll(async () => {
      upstream = await FakeUpstream.start();
      t = await createTestApp({ PARSIM_ALLOW_CUSTOM_UPSTREAM: 'false' });
    });

    beforeEach(async () => {
      await t.reset();
      upstream.reset();
      token = (await login(t, ADMIN_EMAIL, ADMIN_PASSWORD)).token;
    });

    afterAll(async () => {
      await Promise.all([t?.close(), upstream?.stop()]);
    });

    const create = (body: Record<string, unknown>) =>
      request(t.server)
        .post('/api/v1/projects')
        .auth(token, { type: 'bearer' })
        .send({ name: 'Groq project', upstream: 'openai-compatible', ...body });

    it.each([
      ['a local http URL', 'http://127.0.0.1:9/v1', /must use https/],
      [
        'a host not in the allowlist',
        'https://llm.example.test/v1',
        /not allowed/,
      ],
      ['no URL', undefined, /needs a base URL/],
    ])('should refuse to save %s', async (_, upstreamBaseUrl, reason) => {
      const res = await create({ upstreamBaseUrl }).expect(422);
      expect(
        (res.body as { errors: { upstreamBaseUrl: string } }).errors
          .upstreamBaseUrl,
      ).toMatch(reason);
    });

    it('should save an allowlisted host (Groq by default)', async () => {
      const res = await create({
        upstreamBaseUrl: 'https://api.groq.com/openai/v1',
      }).expect(201);
      expect(res.body).toMatchObject({
        upstream: 'openai-compatible',
        upstreamBaseUrl: 'https://api.groq.com/openai/v1',
      });
    });

    it('should refuse at request time a URL that is no longer allowed, without calling it', async () => {
      // Saved while allowed (for example before the allowlist changed).
      const fx = await createProjectWithKey(t);
      await t.dataSource.query(
        `UPDATE project SET upstream = 'openai-compatible', "upstreamBaseUrl" = $1 WHERE id = $2`,
        [`${upstream.baseUrl}/v1`, fx.project.id],
      );

      const res = await request(t.server)
        .post('/v1/chat/completions')
        .set('content-type', 'application/json')
        .set('x-parsim-key', fx.parsimKey)
        .set('x-provider-key', PROVIDER_KEY)
        .send(chatBody())
        .expect(403);

      expect(JSON.stringify(res.body)).toContain('custom_upstream_refused');
      expect(upstream.requests).toHaveLength(0);
    });

    it('should clear the base URL when a project moves to another upstream', async () => {
      const created = await create({
        upstreamBaseUrl: 'https://api.groq.com/openai/v1',
      }).expect(201);
      const res = await request(t.server)
        .patch(`/api/v1/projects/${(created.body as { id: string }).id}`)
        .auth(token, { type: 'bearer' })
        .send({ upstream: 'openai' })
        .expect(200);
      expect(res.body).toMatchObject({
        upstream: 'openai',
        upstreamBaseUrl: null,
      });
    });
  });
});
