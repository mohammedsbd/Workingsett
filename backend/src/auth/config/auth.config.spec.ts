import { Logger } from '@nestjs/common';
import authConfig from './auth.config';

const STRONG_ENV = {
  AUTH_JWT_SECRET: 'strong-jwt-secret',
  AUTH_JWT_TOKEN_EXPIRES_IN: '15m',
  AUTH_REFRESH_SECRET: 'strong-refresh-secret',
  AUTH_REFRESH_TOKEN_EXPIRES_IN: '30d',
  AUTH_FORGOT_SECRET: 'strong-forgot-secret',
  AUTH_FORGOT_TOKEN_EXPIRES_IN: '30m',
  AUTH_CONFIRM_EMAIL_SECRET: 'strong-confirm-secret',
  AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN: '1d',
  AUTH_UNIFORM_ERRORS: 'true',
};

describe('authConfig', () => {
  const originalEnv = process.env;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv, ...STRONG_ENV };
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    warn.mockRestore();
  });

  it('should map the AUTH_* variables to the auth config', () => {
    expect(authConfig()).toEqual({
      secret: 'strong-jwt-secret',
      expires: '15m',
      refreshSecret: 'strong-refresh-secret',
      refreshExpires: '30d',
      forgotSecret: 'strong-forgot-secret',
      forgotExpires: '30m',
      confirmEmailSecret: 'strong-confirm-secret',
      confirmEmailExpires: '1d',
      uniformErrors: true,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('should fail validation when a required variable is missing', () => {
    delete process.env.AUTH_JWT_SECRET;

    expect(() => authConfig()).toThrow();
  });

  it('should refuse placeholder secrets in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_JWT_SECRET = 'secret';
    process.env.AUTH_FORGOT_SECRET = 'secret_for_forgot';

    expect(() => authConfig()).toThrow(
      'AUTH_JWT_SECRET, AUTH_FORGOT_SECRET still use the placeholder values from .env.example',
    );
  });

  it('should only warn about placeholder secrets outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.AUTH_REFRESH_SECRET = 'secret_for_refresh';

    expect(() => authConfig()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AUTH_REFRESH_SECRET still use the placeholder'),
    );
  });
});
