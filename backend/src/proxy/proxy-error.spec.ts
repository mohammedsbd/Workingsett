import { ProxyError, proxyErrors } from './proxy-error';

describe('ProxyError', () => {
  it('should use the OpenAI error format for OpenAI-format requests', () => {
    expect(proxyErrors.invalidParsimKey().toBody('openai-chat')).toEqual({
      error: {
        message: 'Invalid or revoked Parsim API key.',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_parsim_key',
      },
    });
  });

  it.each([
    [401, 'authentication_error'],
    [400, 'invalid_request_error'],
    [404, 'not_found_error'],
    [429, 'rate_limit_error'],
    [502, 'api_error'],
    [504, 'api_error'],
  ])(
    'should use the Anthropic error format with type for status %i',
    (status, type) => {
      expect(
        new ProxyError(status, 'Something', 'x').toBody('anthropic-messages'),
      ).toEqual({ type: 'error', error: { type, message: 'Something' } });
    },
  );

  it('should explain which endpoint a project uses', () => {
    const error = proxyErrors.wrongEndpoint('anthropic', '/v1/messages');

    expect(error.status).toBe(400);
    expect(error.message).toBe(
      'This project forwards to anthropic. Send its requests to /v1/messages.',
    );
  });
});
