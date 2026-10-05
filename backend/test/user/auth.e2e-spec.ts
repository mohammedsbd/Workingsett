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
  login,
  newUserData,
  registerConfirmedUser,
  registerUser,
} from '../utils/auth-helpers';
import { TESTER_EMAIL, TESTER_PASSWORD } from '../utils/constants';
import { createTestApp, TestApp } from '../utils/test-app';

describe('Auth Module', () => {
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

  describe('Registration', () => {
    it('should fail with exists email: /api/v1/auth/email/register (POST)', () => {
      return request(t.server)
        .post('/api/v1/auth/email/register')
        .send({
          email: TESTER_EMAIL,
          password: TESTER_PASSWORD,
          firstName: 'Tester',
          lastName: 'E2E',
        })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors.email).toBeDefined();
        });
    });

    it('should successfully: /api/v1/auth/email/register (POST)', () => {
      return request(t.server)
        .post('/api/v1/auth/email/register')
        .send(newUserData())
        .expect(204);
    });

    it('should send a confirmation email on registration', async () => {
      const user = await registerUser(t);

      expect(t.mailer.findHash(user.email, 'confirm-email')).toEqual(
        expect.any(String),
      );
    });

    describe('Login', () => {
      it('should successfully with unconfirmed email: /api/v1/auth/email/login (POST)', async () => {
        const user = await registerUser(t);

        await request(t.server)
          .post('/api/v1/auth/email/login')
          .send({ email: user.email, password: user.password })
          .expect(200)
          .expect(({ body }) => {
            expect(body.token).toBeDefined();
          });
      });
    });

    describe('Confirm email', () => {
      it('should successfully: /api/v1/auth/email/confirm (POST)', async () => {
        const user = await registerUser(t);

        await request(t.server)
          .post('/api/v1/auth/email/confirm')
          .send({ hash: t.mailer.findHash(user.email, 'confirm-email') })
          .expect(204);
      });

      it('should fail for already confirmed email: /api/v1/auth/email/confirm (POST)', async () => {
        const user = await registerConfirmedUser(t);

        await request(t.server)
          .post('/api/v1/auth/email/confirm')
          .send({ hash: t.mailer.findHash(user.email, 'confirm-email') })
          .expect(404);
      });
    });
  });

  describe('Login', () => {
    it('should successfully for user with confirmed email: /api/v1/auth/email/login (POST)', async () => {
      const user = await registerConfirmedUser(t);

      await request(t.server)
        .post('/api/v1/auth/email/login')
        .send({ email: user.email, password: user.password })
        .expect(200)
        .expect(({ body }) => {
          expect(body.token).toBeDefined();
          expect(body.refreshToken).toBeDefined();
          expect(body.tokenExpires).toBeDefined();
          expect(body.user.email).toBeDefined();
          expect(body.user.hash).not.toBeDefined();
          expect(body.user.password).not.toBeDefined();
        });
    });
  });

  describe('Forgot password', () => {
    it('should reset password only once per link: /api/v1/auth/reset/password (POST)', async () => {
      const user = await registerUser(t, newUserData('forgot'));
      const newPassword = 'new-secret';

      await request(t.server)
        .post('/api/v1/auth/forgot/password')
        .send({ email: user.email })
        .expect(204);

      const hash = t.mailer.findHash(user.email, 'password-change');

      await request(t.server)
        .post('/api/v1/auth/reset/password')
        .send({ hash, password: newPassword })
        .expect(204);

      await login(t, user.email, newPassword);

      // The link is single-use: the reset token is bound to the previous
      // password hash, so replaying it must fail.
      await request(t.server)
        .post('/api/v1/auth/reset/password')
        .send({ hash, password: 'another-password' })
        .expect(422);

      await login(t, user.email, newPassword);
    });
  });

  describe('Logged in user', () => {
    it('should retrieve your own profile: /api/v1/auth/me (GET)', async () => {
      const user = await registerConfirmedUser(t);
      const { token } = await login(t, user.email, user.password);

      await request(t.server)
        .get('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.provider).toBeDefined();
          expect(body.email).toBeDefined();
          expect(body.hash).not.toBeDefined();
          expect(body.password).not.toBeDefined();
        });
    });

    it('should get new refresh token: /api/v1/auth/refresh (POST)', async () => {
      const user = await registerConfirmedUser(t);
      const first = (await login(t, user.email, user.password)).refreshToken;

      const second = await request(t.server)
        .post('/api/v1/auth/refresh')
        .auth(first, { type: 'bearer' })
        .expect(200)
        .then(({ body }) => body.refreshToken as string);

      await request(t.server)
        .post('/api/v1/auth/refresh')
        .auth(second, { type: 'bearer' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.token).toBeDefined();
          expect(body.refreshToken).toBeDefined();
          expect(body.tokenExpires).toBeDefined();
        });
    });

    it('should fail on the second attempt to refresh token with the same token: /api/v1/auth/refresh (POST)', async () => {
      const user = await registerConfirmedUser(t);
      const { refreshToken } = await login(t, user.email, user.password);

      await request(t.server)
        .post('/api/v1/auth/refresh')
        .auth(refreshToken, { type: 'bearer' })
        .expect(200);

      await request(t.server)
        .post('/api/v1/auth/refresh')
        .auth(refreshToken, { type: 'bearer' })
        .expect(401);
    });

    it('should update profile successfully: /api/v1/auth/me (PATCH)', async () => {
      const user = await registerConfirmedUser(t);
      const newPassword = 'new-secret';
      const { token } = await login(t, user.email, user.password);

      await request(t.server)
        .patch('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .send({ firstName: 'Renamed', password: newPassword })
        .expect(422);

      await request(t.server)
        .patch('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .send({
          firstName: 'Renamed',
          password: newPassword,
          oldPassword: user.password,
        })
        .expect(200);

      await login(t, user.email, newPassword);
    });

    it('should update profile email successfully: /api/v1/auth/me (PATCH)', async () => {
      const user = await registerUser(t);
      const newEmail = `new.${user.email}`;
      const { token } = await login(t, user.email, user.password);

      await request(t.server)
        .patch('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .send({ email: newEmail })
        .expect(200);

      await request(t.server)
        .get('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.email).not.toBe(newEmail);
        });

      await request(t.server)
        .post('/api/v1/auth/email/login')
        .send({ email: newEmail, password: user.password })
        .expect(422);

      await request(t.server)
        .post('/api/v1/auth/email/confirm/new')
        .send({ hash: t.mailer.findHash(newEmail, 'confirm-new-email') })
        .expect(204);

      await request(t.server)
        .get('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.email).toBe(newEmail);
        });

      await login(t, newEmail, user.password);
    });

    it('should delete profile successfully: /api/v1/auth/me (DELETE)', async () => {
      const user = await registerConfirmedUser(t);
      const { token } = await login(t, user.email, user.password);

      await request(t.server)
        .delete('/api/v1/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(204);

      await request(t.server)
        .post('/api/v1/auth/email/login')
        .send({ email: user.email, password: user.password })
        .expect(422);
    });
  });
});
