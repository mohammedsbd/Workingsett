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

/** The `key` query parameter Gemini clients may send their API key in. */
export const GEMINI_KEY_PARAM = 'key';

function queryValue(query: QueryParams, name: string): string | undefined {
  const value = query[name];
  const first = Array.isArray(value) ? (value as unknown[])[0] : value;
  const trimmed = typeof first === 'string' ? first.trim() : '';
  return trimmed ? trimmed : undefined;
}

export type QueryParams = Record<string, unknown>;

/**
 * Where a client of this API normally puts its API key, in order of
 * preference: `x-api-key` for Anthropic clients (then the bearer token,
 * which tools send for ANTHROPIC_AUTH_TOKEN), `x-goog-api-key` then the
 * `key` query parameter for Gemini, the bearer token for OpenAI.
 */
function authTokens(
  headers: IncomingHttpHeaders,
  api: ProxyApi,
  query: QueryParams,
): string[] {
  const tokens =
    api === 'anthropic-messages'
      ? [header(headers, 'x-api-key'), bearerToken(headers)]
      : api === 'gemini-native'
        ? [
            header(headers, 'x-goog-api-key'),
            queryValue(query, GEMINI_KEY_PARAM),
          ]
        : [bearerToken(headers)];
  return tokens.filter((token): token is string => token !== undefined);
}

/** The query parameters without the API key. */
export function omitKey(query: QueryParams): QueryParams {
  return Object.fromEntries(
    Object.entries(query).filter(([name]) => name !== GEMINI_KEY_PARAM),
  );
}

/**
 * The query string without the API key, for the upstream URL and anything
 * that could be logged or stored. Returns "" or "?a=b&...".
 */
export function queryWithoutKey(query: QueryParams): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(omitKey(query))) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') params.append(name, item);
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A URL with its `key` query parameter removed. */
export function urlWithoutKey(url: string): string {
  const [path, search = ''] = url.split('?', 2);
  return (
    path + queryWithoutKey(Object.fromEntries(new URLSearchParams(search)))
  );
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
  query: QueryParams = {},
): ProxyCredentials {
  const tokens = authTokens(headers, api, query);
  return {
    parsimKey:
      header(headers, 'x-parsim-key') ?? tokens.find(hasParsimKeyPrefix),
    providerKey:
      header(headers, 'x-provider-key') ??
      tokens.find((token) => !hasParsimKeyPrefix(token)),
  };
}
