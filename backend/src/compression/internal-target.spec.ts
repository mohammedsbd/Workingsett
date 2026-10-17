import { describe, expect, it } from '@jest/globals';
import type { ProxyConfig } from '../proxy/config/proxy-config.type';
import { internalTarget, projectTarget } from './internal-target';
import { SummarizerError } from './summarizer';

const proxy = {
  openaiBaseUrl: 'https://openai.test',
  geminiNativeBaseUrl: 'https://gemini.test',
  anthropicBaseUrl: 'https://anthropic.test',
  customUpstream: { allowAny: false, hosts: ['api.groq.com'] },
} as ProxyConfig;

describe('internal model targets', () => {
  it('should use the proxy base URL for a native internal provider', () => {
    expect(
      internalTarget(
        { provider: 'gemini', model: 'flash', apiKey: 'k' },
        'flash',
        proxy,
      ),
    ).toEqual({
      provider: 'gemini',
      model: 'flash',
      baseUrl: 'https://gemini.test',
      apiKey: 'k',
      contextTokens: undefined,
    });
  });

  it('should use PARSIM_INTERNAL_BASE_URL and the context window for an openai-compatible provider', () => {
    const groq = {
      provider: 'openai-compatible' as const,
      model: 'groq-model',
      apiKey: 'gsk',
      baseUrl: 'https://api.groq.com/openai/v1',
      contextTokens: 131_072,
    };
    expect(internalTarget(groq, 'judge-model', proxy)).toEqual({
      provider: 'openai-compatible',
      model: 'judge-model',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk',
      contextTokens: 131_072,
    });
    expect(() =>
      internalTarget({ ...groq, baseUrl: undefined }, 'm', proxy),
    ).toThrow(/PARSIM_INTERNAL_BASE_URL is required/);
  });

  it('should refuse a missing model or key, never retried', () => {
    const error = (() => {
      try {
        internalTarget({ provider: 'gemini', model: '' }, '', proxy);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(SummarizerError);
    expect((error as SummarizerError).retryable).toBe(false);
  });

  it("should check an openai-compatible project's base URL again", () => {
    const project = {
      upstream: 'openai-compatible' as const,
      upstreamBaseUrl: 'https://api.groq.com/openai/v1',
    };
    expect(projectTarget(project, 'gsk', 'm', proxy)).toMatchObject({
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    expect(() =>
      projectTarget(
        { ...project, upstreamBaseUrl: 'https://evil.test/v1' },
        'gsk',
        'm',
        proxy,
      ),
    ).toThrow(/not allowed/);
    expect(
      projectTarget(
        { upstream: 'anthropic', upstreamBaseUrl: null },
        'k',
        'm',
        proxy,
      ).baseUrl,
    ).toBe('https://anthropic.test');
  });
});
