import { describe, expect, it, vi } from 'vitest';
import { DevAutoLoginInProductionError, devAutoLoginEnabled, devLogin } from './dev-auth';

describe('devAutoLoginEnabled', () => {
  it('is off unless DEV_AUTO_LOGIN=true', () => {
    expect(devAutoLoginEnabled({})).toBe(false);
    expect(devAutoLoginEnabled({ DEV_AUTO_LOGIN: 'false' })).toBe(false);
    expect(devAutoLoginEnabled({ DEV_AUTO_LOGIN: 'true', NODE_ENV: 'development' })).toBe(true);
  });

  it('refuses to run in production', () => {
    expect(() => devAutoLoginEnabled({ DEV_AUTO_LOGIN: 'true', NODE_ENV: 'production' })).toThrow(
      DevAutoLoginInProductionError
    );
    // Off stays off in production.
    expect(devAutoLoginEnabled({ NODE_ENV: 'production' })).toBe(false);
  });
});

describe('devLogin', () => {
  const env = {
    DEV_AUTO_LOGIN: 'true',
    NODE_ENV: 'development',
    DEV_AUTO_LOGIN_EMAIL: 'admin@example.com',
    DEV_AUTO_LOGIN_PASSWORD: 'test-password'
  };

  it('signs in and keeps the token until shortly before it expires', async () => {
    const now = 1_000_000;
    const fetchImpl = vi.fn(async () =>
      Response.json({ token: 'jwt-token', tokenExpires: now + 15 * 60_000 })
    );

    const result = await devLogin('http://api.test', env, fetchImpl, now);

    expect(result).toEqual({ token: 'jwt-token', maxAgeSeconds: 870 });
    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/api/v1/auth/email/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'test-password' })
    });
  });

  it('fails clearly when the backend rejects the sign-in', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 422 }));
    await expect(devLogin('http://api.test', env, fetchImpl)).rejects.toThrow('status 422');
  });

  it('never signs in when disabled or in production', async () => {
    const fetchImpl = vi.fn();
    await expect(devLogin('http://api.test', {}, fetchImpl)).rejects.toThrow('not enabled');
    await expect(
      devLogin('http://api.test', { ...env, NODE_ENV: 'production' }, fetchImpl)
    ).rejects.toThrow(DevAutoLoginInProductionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
