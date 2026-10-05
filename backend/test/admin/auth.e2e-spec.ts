import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../utils/constants';
import { createTestApp, TestApp } from '../utils/test-app';

describe('Auth', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.reset();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('Admin', () => {
    it('should successfully login via /api/v1/auth/email/login (POST)', () => {
      return request(t.server)
        .post('/api/v1/auth/email/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .expect(200)
        .expect(({ body }) => {
          expect(body.token).toBeDefined();
          expect(body.user.email).toBeDefined();
          expect(body.user.role).toBeDefined();
        });
    });
  });
});
