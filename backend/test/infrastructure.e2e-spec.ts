import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { UserEntity } from '../src/users/infrastructure/persistence/relational/entities/user.entity';
import { registerUser } from './utils/auth-helpers';
import { ADMIN_EMAIL, TESTER_EMAIL } from './utils/constants';
import { FAKE_REPLY_TEXT, FakeUpstream } from './utils/fake-upstream';
import { createTestApp, TestApp } from './utils/test-app';

describe('Test infrastructure', () => {
  let t: TestApp;
  let upstream: FakeUpstream;

  beforeAll(async () => {
    [t, upstream] = await Promise.all([createTestApp(), FakeUpstream.start()]);
  });

  beforeEach(async () => {
    await t.reset();
    upstream.reset();
  });

  afterAll(async () => {
    await Promise.all([t?.close(), upstream?.stop()]);
  });

  it('should run the app against the test database', () => {
    const { database } = t.dataSource.options as { database?: string };

    expect(database).toBe(process.env.DATABASE_NAME);
    expect(database).toMatch(/_test$/);
  });

  it('should serve requests in-process without a listening port', async () => {
    await request(t.server).get('/api/v1/auth/me').expect(401);
  });

  it('should wipe data and re-seed the base users on reset', async () => {
    const users = t.dataSource.getRepository(UserEntity);
    const user = await registerUser(t);
    expect(await users.count()).toBe(3);
    expect(t.mailer.messages).toHaveLength(1);

    await t.reset();

    const emails = (await users.find()).map((u) => u.email).sort();
    expect(emails).toEqual([ADMIN_EMAIL, TESTER_EMAIL].sort());
    expect(emails).not.toContain(user.email);
    expect(t.mailer.messages).toHaveLength(0);
  });

  it('should restart ids after reset so tests do not depend on order', async () => {
    const users = t.dataSource.getRepository(UserEntity);

    expect(
      (await users.find({ order: { id: 'ASC' } })).map((u) => u.id),
    ).toEqual([1, 2]);
  });

  it('should run the fake upstream alongside the app and record requests', async () => {
    const response = await fetch(`${upstream.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-customer-test',
      },
      body: JSON.stringify({
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    expect(body.choices[0].message.content).toBe(FAKE_REPLY_TEXT);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.lastRequest.headers.authorization).toBe(
      'Bearer sk-customer-test',
    );
    expect(upstream.lastRequest.body).toEqual({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'ping' }],
    });
  });
});
