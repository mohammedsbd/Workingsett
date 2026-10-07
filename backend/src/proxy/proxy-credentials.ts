import { IncomingHttpHeaders } from 'node:http';
import { hasParsimKeyPrefix } from '../parsim-api-keys/parsim-key';
import { ProxyApi } from './providers/provider-adapter';

export type ProxyCredentials = {
  /** The Parsim key, if one was sent. */
  parsimKey?: string;
  /** The customer's provider key, if one was sent with the request. */
  providerKey?: string;
};

function header(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header(headers, 'authorization') ?? '');
  return match?.[1].trim() || undefined;
}

/**
 * The headers a client of this API normally puts its API key in, in order
 * of preference: `x-api-key` for Anthropic clients (then the bearer token,
 * which tools send for ANTHROPIC_AUTH_TOKEN), the bearer token for OpenAI.
 */
function authTokens(headers: IncomingHttpHeaders, api: ProxyApi): string[] {
  const tokens =
    api === 'anthropic-messages'
      ? [header(headers, 'x-api-key'), bearerToken(headers)]
      : [bearerToken(headers)];
  return tokens.filter((token): token is string => token !== undefined);
}

/**
 * Reads the Parsim key and the provider key from request headers.
 *
 * - Parsim key: `x-parsim-key`, or the client's normal API key header when
 *   it holds a `psm_` key. So a tool that only lets you set a base URL and
 *   an API key can use the Parsim key as its API key.
 * - Provider key: `x-provider-key`, or the client's normal API key header
 *   when it holds something else (so an SDK can keep its real provider key
 *   and send the Parsim key in `x-parsim-key`).
 */
export function parseProxyCredentials(
  headers: IncomingHttpHeaders,
  api: ProxyApi = 'openai-chat',
): ProxyCredentials {
  const tokens = authTokens(headers, api);
  return {
    parsimKey:
      header(headers, 'x-parsim-key') ?? tokens.find(hasParsimKeyPrefix),
    providerKey:
      header(headers, 'x-provider-key') ??
      tokens.find((token) => !hasParsimKeyPrefix(token)),
  };
}
