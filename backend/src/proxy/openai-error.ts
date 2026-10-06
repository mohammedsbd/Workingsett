/** Error body in the OpenAI format, so SDKs surface Parsim errors normally. */
export type OpenAiErrorBody = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

export class ProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }

  toBody(): OpenAiErrorBody {
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
      'Missing Parsim API key. Send it in the x-parsim-key header or as "Authorization: Bearer psm_...".',
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
      'Missing provider API key. Send it in the x-provider-key header, as the Authorization bearer token, or store one on the project.',
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
