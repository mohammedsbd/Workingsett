import request from 'supertest';
import type { TestApp } from './test-app';

let counter = 0;

export type NewUser = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

/** Builds unique registration data; the database is wiped between tests. */
export function newUserData(prefix = 'user'): NewUser {
  counter += 1;
  return {
    email: `${prefix}.${counter}@example.com`,
    password: 'secret',
    firstName: `Tester${counter}`,
    lastName: 'E2E',
  };
}

/** Registers a user through the API and returns the data used. */
export async function registerUser(
  t: TestApp,
  user: NewUser = newUserData(),
): Promise<NewUser> {
  await request(t.server)
    .post('/api/v1/auth/email/register')
    .send(user)
    .expect(204);
  return user;
}

/** Registers a user and confirms the email with the link from the mail. */
export async function registerConfirmedUser(
  t: TestApp,
  user: NewUser = newUserData(),
): Promise<NewUser> {
  await registerUser(t, user);
  await request(t.server)
    .post('/api/v1/auth/email/confirm')
    .send({ hash: t.mailer.findHash(user.email, 'confirm-email') })
    .expect(204);
  return user;
}

export type LoginBody = {
  token: string;
  refreshToken: string;
  tokenExpires: number;
  user: { id: number; email: string };
};

export async function login(
  t: TestApp,
  email: string,
  password: string,
): Promise<LoginBody> {
  const { body } = await request(t.server)
    .post('/api/v1/auth/email/login')
    .send({ email, password })
    .expect(200);
  return body as LoginBody;
}
