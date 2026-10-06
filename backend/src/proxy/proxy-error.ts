import { ProxyApi } from './providers/provider-adapter';

/** Error body in the OpenAI format, so OpenAI SDKs surface Parsim errors. */
export type OpenAiErrorBody = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

/** Error body in the Anthropic format, so Anthropic SDKs surface Parsim errors. */
export type AnthropicErrorBody = {
  type: 'error';
  error: { type: string; message: string };
};

/** Anthropic error types by HTTP status (see the Anthropic API errors page). */
const ANTHROPIC_ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
};

/** An error Parsim itself returns (not one passed through from upstream). */
export class ProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }

  /** The error body in the format of the API the client called. */
  toBody(api: ProxyApi = 'openai-chat'): OpenAiErrorBody | AnthropicErrorBody {
    if (api === 'anthropic-messages') {
      return {
        type: 'error',
        error: {
          type: ANTHROPIC_ERROR_TYPES[this.status] ?? 'api_error',
          message: this.message,
        },
      };
    }
    return {
      error: {
        message: this.message,
        type: this.type,
        param: null,
        code: this.code,
      },
    };
  }
}

export const proxyErrors = {
  missingParsimKey: () =>
    new ProxyError(
      401,
      'Missing Parsim API key. Send it in the x-parsim-key header, as "Authorization: Bearer psm_...", or (Anthropic format) as the x-api-key.',
      'invalid_request_error',
      'missing_parsim_key',
    ),
  invalidParsimKey: () =>
    new ProxyError(
      401,
      'Invalid or revoked Parsim API key.',
      'invalid_request_error',
      'invalid_parsim_key',
    ),
  missingProviderKey: () =>
    new ProxyError(
      401,
      'Missing provider API key. Send it in the x-provider-key header, as the provider auth header (Authorization bearer or x-api-key), or store one on the project.',
      'invalid_request_error',
      'missing_provider_key',
    ),
  noDevProject: () =>
    new ProxyError(
      401,
      'PARSIM_REQUIRE_KEY=false needs at least one project to use. Create a project first.',
      'invalid_request_error',
      'missing_parsim_key',
    ),
  wrongEndpoint: (upstream: string, endpoint: string) =>
    new ProxyError(
      400,
      `This project forwards to ${upstream}. Send its requests to ${endpoint}.`,
      'invalid_request_error',
      'wrong_endpoint',
    ),
  invalidJson: () =>
    new ProxyError(
      400,
      'Request body must be a JSON object.',
      'invalid_request_error',
      'invalid_json',
    ),
  upstreamTimeout: () =>
    new ProxyError(
      504,
      'The upstream provider did not respond in time.',
      'upstream_timeout',
      'upstream_timeout',
    ),
  upstreamUnreachable: () =>
    new ProxyError(
      502,
      'Could not reach the upstream provider.',
      'upstream_error',
      'upstream_unreachable',
    ),
};
