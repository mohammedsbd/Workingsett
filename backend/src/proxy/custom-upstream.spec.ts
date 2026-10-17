import { describe, expect, it } from '@jest/globals';
import {
  checkCustomUpstream,
  DEFAULT_CUSTOM_UPSTREAM_HOSTS,
} from './custom-upstream';

const strict = { allowAny: false, hosts: DEFAULT_CUSTOM_UPSTREAM_HOSTS };
const dev = { allowAny: true, hosts: DEFAULT_CUSTOM_UPSTREAM_HOSTS };

describe('checkCustomUpstream', () => {
  it('should allow an allowlisted https host and normalize the base URL', () => {
    expect(
      checkCustomUpstream('https://api.groq.com/openai/v1/', strict),
    ).toEqual({ allowed: true, baseUrl: 'https://api.groq.com/openai/v1' });
    expect(
      checkCustomUpstream('https://API.GROQ.COM/openai/v1?x=1', strict),
    ).toEqual({ allowed: true, baseUrl: 'https://api.groq.com/openai/v1' });
  });

  it.each([
    ['http://127.0.0.1:8080/v1', /must use https/],
    ['https://169.254.169.254/latest', /not allowed/],
    ['https://api.groq.com.evil.test/v1', /not allowed/],
    ['http://api.groq.com/openai/v1', /must use https/],
    ['https://user:pass@api.groq.com/v1', /credentials/],
    ['file:///etc/passwd', /http or https/],
    ['not a url', /not valid/],
    ['', /needs a base URL/],
  ])('should refuse %s without PARSIM_ALLOW_CUSTOM_UPSTREAM', (url, reason) => {
    const check = checkCustomUpstream(url, strict);
    expect(check.allowed).toBe(false);
    expect(check.allowed ? '' : check.reason).toMatch(reason);
  });

  it('should allow any http or https URL in development, never credentials or other schemes', () => {
    expect(checkCustomUpstream('http://127.0.0.1:8080/v1', dev)).toEqual({
      allowed: true,
      baseUrl: 'http://127.0.0.1:8080/v1',
    });
    expect(checkCustomUpstream('ftp://example.test', dev).allowed).toBe(false);
    expect(checkCustomUpstream('http://u:p@127.0.0.1/v1', dev).allowed).toBe(
      false,
    );
  });

  it('should use the configured allowlist instead of the default', () => {
    const policy = { allowAny: false, hosts: ['llm.internal.test'] };
    expect(
      checkCustomUpstream('https://llm.internal.test/v1', policy).allowed,
    ).toBe(true);
    expect(
      checkCustomUpstream('https://api.groq.com/openai/v1', policy).allowed,
    ).toBe(false);
  });
});
