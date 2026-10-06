import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { hashParsimKey } from '../../src/parsim-api-keys/parsim-key';
import { login } from '../utils/auth-helpers';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TESTER_EMAIL,
  TESTER_PASSWORD,
} from '../utils/constants';
import { createTestApp, TestApp } from '../utils/test-app';

describe('Projects and Parsim API keys', () => {
  let t: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.reset();
    adminToken = (await login(t, ADMIN_EMAIL, ADMIN_PASSWORD)).token;
  });

  afterAll(async () => {
    await t?.close();
  });

  const createProject = (token: string, body: object) =>
    request(t.server)
      .post('/api/v1/projects')
      .auth(token, { type: 'bearer' })
      .send(body);

  describe('projects', () => {
    it('should create a project for the logged-in user', async () => {
      const { body } = await createProject(adminToken, {
        name: 'Research agent',
        upstream: 'gemini',
      }).expect(201);

      expect(body).toMatchObject({
        id: expect.any(String),
        name: 'Research agent',
        upstream: 'gemini',
        ownerId: 1,
        hasProviderKey: false,
      });
      expect(body).not.toHaveProperty('providerKeyEncrypted');
    });

    it('should store the provider key encrypted and never return it', async () => {
      const providerKey = 'sk-test-provider-key-0123456789';
      const { body } = await createProject(adminToken, {
        name: 'With key',
        upstream: 'openai',
        providerKey,
      }).expect(201);
      const [row] = await t.dataSource.query(
        'SELECT "providerKeyEncrypted" FROM project WHERE id = $1',
        [body.id],
      );

      expect(body.hasProviderKey).toBe(true);
      expect(JSON.stringify(body)).not.toContain(providerKey);
      expect(row.providerKeyEncrypted).toMatch(/^v1:/);
      expect(row.providerKeyEncrypted).not.toContain(providerKey);
    });

    it('should validate the name and upstream', async () => {
      await createProject(adminToken, { name: 'x', upstream: 'azure' }).expect(
        422,
      );
      await createProject(adminToken, { name: '', upstream: 'openai' }).expect(
        422,
      );
    });

    it('should require a logged-in user', async () => {
      await request(t.server).get('/api/v1/projects').expect(401);
      await request(t.server)
        .post('/api/v1/projects')
        .send({ name: 'x', upstream: 'openai' })
        .expect(401);
    });

    it('should only list and show the user’s own projects', async () => {
      const testerToken = (await login(t, TESTER_EMAIL, TESTER_PASSWORD)).token;
      const mine = await createProject(adminToken, {
        name: 'Mine',
        upstream: 'openai',
      }).then(({ body }) => body as { id: string });
      const theirs = await createProject(testerToken, {
        name: 'Theirs',
        upstream: 'openai',
      }).then(({ body }) => body as { id: string });

      const { body: list } = await request(t.server)
        .get('/api/v1/projects')
        .auth(adminToken, { type: 'bearer' })
        .expect(200);
      expect(list.map((p: { id: string }) => p.id)).toEqual([mine.id]);

      await request(t.server)
        .get(`/api/v1/projects/${theirs.id}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(404);
      await request(t.server)
        .patch(`/api/v1/projects/${theirs.id}`)
        .auth(adminToken, { type: 'bearer' })
        .send({ name: 'hijacked' })
        .expect(404);
    });

    it('should update the upstream and replace or remove the provider key', async () => {
      const project = await createProject(adminToken, {
        name: 'P',
        upstream: 'openai',
      }).then(({ body }) => body as { id: string });
      const patch = (body: object) =>
        request(t.server)
          .patch(`/api/v1/projects/${project.id}`)
          .auth(adminToken, { type: 'bearer' })
          .send(body)
          .expect(200)
          .then(
            (res) => res.body as { upstream: string; hasProviderKey: boolean },
          );

      expect(
        await patch({ upstream: 'gemini', providerKey: 'k1' }),
      ).toMatchObject({ upstream: 'gemini', hasProviderKey: true });
      expect(await patch({})).toMatchObject({ hasProviderKey: true });
      expect(await patch({ providerKey: null })).toMatchObject({
        hasProviderKey: false,
      });
    });
  });

  describe('API keys', () => {
    let projectId: string;
    const keysUrl = () => `/api/v1/projects/${projectId}/api-keys`;

    beforeEach(async () => {
      projectId = await createProject(adminToken, {
        name: 'Keys',
        upstream: 'openai',
      }).then(({ body }) => body.id as string);
    });

    it('should show the full key once and store only its hash', async () => {
      const { body } = await request(t.server)
        .post(keysUrl())
        .auth(adminToken, { type: 'bearer' })
        .send({ name: 'Production' })
        .expect(201);
      const [row] = await t.dataSource.query(
        'SELECT * FROM parsim_api_key WHERE id = $1',
        [body.id],
      );

      expect(body.key).toMatch(/^psm_[A-Za-z0-9_-]{43}$/);
      expect(body.prefix).toBe(body.key.slice(0, 12));
      expect(body).not.toHaveProperty('keyHash');
      expect(row.keyHash).toBe(hashParsimKey(body.key));
      expect(JSON.stringify(row)).not.toContain(body.key);
    });

    it('should list keys without the key or its hash', async () => {
      await request(t.server)
        .post(keysUrl())
        .auth(adminToken, { type: 'bearer' })
        .send({})
        .expect(201);
      const { body } = await request(t.server)
        .get(keysUrl())
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        prefix: expect.stringMatching(/^psm_/),
        name: null,
        revokedAt: null,
        lastUsedAt: null,
      });
      expect(body[0]).not.toHaveProperty('key');
      expect(body[0]).not.toHaveProperty('keyHash');
    });

    it('should revoke a key', async () => {
      const created = await request(t.server)
        .post(keysUrl())
        .auth(adminToken, { type: 'bearer' })
        .send({})
        .then(({ body }) => body as { id: string });
      const { body } = await request(t.server)
        .post(`${keysUrl()}/${created.id}/revoke`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(body.revokedAt).toEqual(expect.any(String));
    });

    it('should not let another user manage the keys', async () => {
      const testerToken = (await login(t, TESTER_EMAIL, TESTER_PASSWORD)).token;
      const created = await request(t.server)
        .post(keysUrl())
        .auth(adminToken, { type: 'bearer' })
        .send({})
        .then(({ body }) => body as { id: string });

      await request(t.server)
        .get(keysUrl())
        .auth(testerToken, { type: 'bearer' })
        .expect(404);
      await request(t.server)
        .post(keysUrl())
        .auth(testerToken, { type: 'bearer' })
        .send({})
        .expect(404);
      await request(t.server)
        .post(`${keysUrl()}/${created.id}/revoke`)
        .auth(testerToken, { type: 'bearer' })
        .expect(404);
    });

    it('should return 404 for a key of a different project', async () => {
      const otherProject = await createProject(adminToken, {
        name: 'Other',
        upstream: 'openai',
      }).then(({ body }) => body.id as string);
      const otherKey = await request(t.server)
        .post(`/api/v1/projects/${otherProject}/api-keys`)
        .auth(adminToken, { type: 'bearer' })
        .send({})
        .then(({ body }) => body as { id: string });

      await request(t.server)
        .post(`${keysUrl()}/${otherKey.id}/revoke`)
        .auth(adminToken, { type: 'bearer' })
        .expect(404);
    });
  });
});
