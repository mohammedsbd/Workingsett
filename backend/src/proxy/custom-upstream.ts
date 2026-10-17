/**
 * Custom upstream base URLs ("openai-compatible" projects, for example
 * Groq). Letting a project choose where Parsim sends requests is a
 * server-side request forgery risk: a URL could point at an internal
 * service. So a custom URL is allowed only when:
 *
 * - PARSIM_ALLOW_CUSTOM_UPSTREAM=true (development; any http or https URL), or
 * - it is https, has no credentials, and its host is in the allowlist
 *   (PARSIM_CUSTOM_UPSTREAM_HOSTS, api.groq.com by default).
 *
 * Checked when a project is saved and again on every request, so removing
 * a host from the allowlist takes effect at once.
 */

export type CustomUpstreamPolicy = {
  /** PARSIM_ALLOW_CUSTOM_UPSTREAM: any URL (development only). */
  allowAny: boolean;
  /** Allowed hosts, lower case. */
  hosts: string[];
};

export const DEFAULT_CUSTOM_UPSTREAM_HOSTS = ['api.groq.com'];

export type CustomUpstreamCheck =
  | { allowed: true; baseUrl: string }
  | { allowed: false; reason: string };

/** Whether `url` may be used as a project's upstream base URL. */
export function checkCustomUpstream(
  url: string | null | undefined,
  policy: CustomUpstreamPolicy,
): CustomUpstreamCheck {
  if (!url) {
    return {
      allowed: false,
      reason: 'An openai-compatible upstream needs a base URL.',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'The upstream base URL is not valid.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      allowed: false,
      reason: 'The upstream base URL must use http or https.',
    };
  }
  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      reason: 'The upstream base URL must not contain credentials.',
    };
  }
  const baseUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  if (policy.allowAny) return { allowed: true, baseUrl };
  if (parsed.protocol !== 'https:') {
    return {
      allowed: false,
      reason: 'The upstream base URL must use https.',
    };
  }
  if (!policy.hosts.includes(parsed.hostname.toLowerCase())) {
    return {
      allowed: false,
      reason: `The upstream host ${parsed.hostname} is not allowed. Add it to PARSIM_CUSTOM_UPSTREAM_HOSTS, or set PARSIM_ALLOW_CUSTOM_UPSTREAM=true in development.`,
    };
  }
  return { allowed: true, baseUrl };
}
