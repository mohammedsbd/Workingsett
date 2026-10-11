/**
 * Development auto-login: until sign-in pages exist (step 18), the
 * frontend's server signs in as the seeded admin and keeps the backend JWT
 * in an httpOnly cookie. Enabled only by DEV_AUTO_LOGIN=true, and never
 * when NODE_ENV=production.
 */

export const TOKEN_COOKIE = 'parsim_token';

/** Renew the token this long before the backend says it expires. */
const EXPIRY_MARGIN_MS = 30_000;

export type DevAuthEnv = {
  NODE_ENV?: string;
  DEV_AUTO_LOGIN?: string;
  DEV_AUTO_LOGIN_EMAIL?: string;
  DEV_AUTO_LOGIN_PASSWORD?: string;
};

export class DevAutoLoginInProductionError extends Error {
  constructor() {
    super('DEV_AUTO_LOGIN must not be enabled when NODE_ENV=production.');
  }
}

/** Whether to sign in automatically. Throws when enabled in production. */
export function devAutoLoginEnabled(env: DevAuthEnv): boolean {
  if (env.DEV_AUTO_LOGIN !== 'true') return false;
  if (env.NODE_ENV === 'production') throw new DevAutoLoginInProductionError();
  return true;
}

export type DevToken = { token: string; maxAgeSeconds: number };

/** Signs in as the configured development user. */
export async function devLogin(
  apiUrl: string,
  env: DevAuthEnv,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<DevToken> {
  if (!devAutoLoginEnabled(env)) throw new Error('DEV_AUTO_LOGIN is not enabled.');
  const res = await fetchImpl(`${apiUrl}/api/v1/auth/email/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: env.DEV_AUTO_LOGIN_EMAIL ?? 'admin@example.com',
      password: env.DEV_AUTO_LOGIN_PASSWORD ?? 'secret'
    })
  });
  if (!res.ok) throw new Error(`Development sign-in failed with status ${res.status}.`);
  const body = (await res.json()) as { token: string; tokenExpires: number };
  return {
    token: body.token,
    maxAgeSeconds: Math.max(1, Math.floor((body.tokenExpires - now - EXPIRY_MARGIN_MS) / 1000))
  };
}
