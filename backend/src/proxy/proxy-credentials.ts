import { IncomingHttpHeaders } from 'node:http';
import { hasParsimKeyPrefix } from '../parsim-api-keys/parsim-key';

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
 * Reads the Parsim key and the provider key from request headers.
 *
 * - Parsim key: `x-parsim-key`, or `Authorization: Bearer psm_...`.
 * - Provider key: `x-provider-key`, or `Authorization: Bearer <token>` when the
 *   token is not a Parsim key (so an SDK can keep using its normal apiKey and
 *   pass the Parsim key in `x-parsim-key`).
 */
export function parseProxyCredentials(
  headers: IncomingHttpHeaders,
): ProxyCredentials {
  const bearer = bearerToken(headers);
  const bearerIsParsim = bearer !== undefined && hasParsimKeyPrefix(bearer);

  return {
    parsimKey:
      header(headers, 'x-parsim-key') ?? (bearerIsParsim ? bearer : undefined),
    providerKey:
      header(headers, 'x-provider-key') ??
      (bearer !== undefined && !bearerIsParsim ? bearer : undefined),
  };
}
