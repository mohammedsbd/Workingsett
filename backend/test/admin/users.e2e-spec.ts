import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import request from 'supertest';
import { RoleEnum } from '../../src/roles/roles.enum';
import { StatusEnum } from '../../src/statuses/statuses.enum';
import { login, newUserData, registerUser } from '../utils/auth-helpers';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../utils/constants';
import { createTestApp, TestApp } from '../utils/test-app';

describe('Users Module', () => {
  let t: TestApp;
  let apiToken: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await t.reset();
    apiToken = (await login(t, ADMIN_EMAIL, ADMIN_PASSWORD)).token;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('Update', () => {
    describe('User with "Admin" role', () => {
      it('should change email and password, then the user logs in with them: /api/v1/users/:id (PATCH)', async () => {
        const user = await registerUser(t, newUserData('user-first'));
        const { user: created } = await login(t, user.email, user.password);
        const changedEmail = `changed.${user.email}`;
        const changedPassword = 'new-secret';

        await request(t.server)
          .patch(`/api/v1/users/${created.id}`)
          .auth(apiToken, { type: 'bearer' })
          .send({ email: changedEmail, password: changedPassword })
          .expect(200);

        await request(t.server)
          .post('/api/v1/auth/email/login')
          .send({ email: changedEmail, password: changedPassword })
          .expect(200)
          .expect(({ body }) => {
            expect(body.token).toBeDefined();
          });
      });
    });
  });

  describe('Create', () => {
    describe('User with "Admin" role', () => {
      it('should fail to create new user with invalid email: /api/v1/users (POST)', () => {
        return request(t.server)
          .post('/api/v1/users')
          .auth(apiToken, { type: 'bearer' })
          .send({ email: 'fail-data' })
          .expect(422);
      });

      it('should create a user who can then log in: /api/v1/users (POST)', async () => {
        const user = newUserData('user-created-by-admin');

        await request(t.server)
          .post('/api/v1/users')
          .auth(apiToken, { type: 'bearer' })
          .send({
            ...user,
            role: { id: RoleEnum.user },
            status: { id: StatusEnum.active },
          })
          .expect(201);

        await request(t.server)
          .post('/api/v1/auth/email/login')
          .send({ email: user.email, password: user.password })
          .expect(200)
          .expect(({ body }) => {
            expect(body.token).toBeDefined();
          });
      });
    });
  });

  describe('Get many', () => {
    describe('User with "Admin" role', () => {
      it('should get list of users: /api/v1/users (GET)', () => {
        return request(t.server)
          .get('/api/v1/users')
          .auth(apiToken, { type: 'bearer' })
          .expect(200)
          .expect(({ body }) => {
            expect(body.data[0].provider).toBeDefined();
            expect(body.data[0].email).toBeDefined();
            expect(body.data[0].hash).not.toBeDefined();
            expect(body.data[0].password).not.toBeDefined();
          });
      });
    });
  });
});
