import type { ProxyConfig } from '../proxy/config/proxy-config.type';
import { checkCustomUpstream } from '../proxy/custom-upstream';
import { Upstream } from '../proxy/providers/provider-adapter';
import type { InternalModelConfig } from './config/compression-config.type';
import { SummarizerError, SummarizerTarget } from './summarizer';

/**
 * Builds the targets of Parsim's own model calls (compression summaries,
 * the replay judge): with Parsim's internal model, or with a project's own
 * provider key. Errors are SummarizerErrors that are never retried.
 */

/** The API base for a native provider, from the proxy's base URLs. */
function nativeBaseUrl(
  provider: Exclude<Upstream, 'openai-compatible'>,
  proxy: ProxyConfig,
): string {
  return provider === 'openai'
    ? proxy.openaiBaseUrl
    : provider === 'gemini'
      ? proxy.geminiNativeBaseUrl
      : proxy.anthropicBaseUrl;
}

/** Parsim's internal model, with `model` (for example a judge override). */
export function internalTarget(
  internal: InternalModelConfig,
  model: string,
  proxy: ProxyConfig,
): SummarizerTarget {
  if (!internal.apiKey || !model) {
    throw new SummarizerError(
      'PARSIM_INTERNAL_MODEL or the internal provider key is not set',
      false,
    );
  }
  if (internal.provider === 'openai-compatible' && !internal.baseUrl) {
    throw new SummarizerError(
      'PARSIM_INTERNAL_BASE_URL is required for an openai-compatible internal provider',
      false,
    );
  }
  return {
    provider: internal.provider,
    model,
    baseUrl:
      internal.baseUrl ??
      nativeBaseUrl(
        internal.provider as Exclude<Upstream, 'openai-compatible'>,
        proxy,
      ),
    apiKey: internal.apiKey,
    contextTokens: internal.contextTokens,
  };
}

/**
 * A project's own provider: its upstream, stored key and the given model.
 * An openai-compatible base URL is checked against the custom upstream
 * policy again, in case the allowlist changed since it was saved.
 */
export function projectTarget(
  project: {
    upstream: Upstream;
    upstreamBaseUrl: string | null;
  },
  apiKey: string | undefined,
  model: string | null | undefined,
  proxy: ProxyConfig,
): SummarizerTarget {
  if (!apiKey || !model) {
    throw new SummarizerError(
      'the project has no stored provider key or model',
      false,
    );
  }
  if (project.upstream === 'openai-compatible') {
    const check = checkCustomUpstream(
      project.upstreamBaseUrl,
      proxy.customUpstream,
    );
    if (!check.allowed) throw new SummarizerError(check.reason, false);
    return {
      provider: project.upstream,
      model,
      baseUrl: check.baseUrl,
      apiKey,
    };
  }
  return {
    provider: project.upstream,
    model,
    baseUrl: nativeBaseUrl(project.upstream, proxy),
    apiKey,
  };
}
