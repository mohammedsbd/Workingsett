import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AnthropicAdapter } from './anthropic.adapter';
import { PROXY_OPERATIONS } from './provider-adapter';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({ proxy: { anthropicBaseUrl: 'http://anthropic.test' } }),
          ],
        }),
      ],
      providers: [AnthropicAdapter],
    }).compile();
    adapter = moduleRef.get(AnthropicAdapter);
  });

  const rawBody = Buffer.from('{"model":"claude-haiku-4-5","max_tokens":5}');
  const info = {
    model: 'claude-haiku-4-5',
    stream: false,
    hasStreamOptions: false,
  };

  it('should send messages to /v1/messages with the provider key in x-api-key', () => {
    const prepared = adapter.prepare({
      operation: PROXY_OPERATIONS.messages,
      rawBody,
      info,
      providerKey: 'sk-ant-test',
      clientHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-api-key': 'psm_should_not_be_forwarded',
        'x-parsim-key': 'psm_secret',
        authorization: 'Bearer something',
      },
    });

    expect(prepared.url).toBe('http://anthropic.test/v1/messages');
    expect(prepared.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    });
    expect(prepared.body).toBe(rawBody);
    expect(prepared.usageInjected).toBe(false);
  });

  it('should never change the body, even for streams', () => {
    const prepared = adapter.prepare({
      operation: PROXY_OPERATIONS.messages,
      rawBody,
      info: { ...info, stream: true },
      providerKey: 'k',
      clientHeaders: {},
    });

    expect(prepared.body).toBe(rawBody);
    expect(prepared.usageInjected).toBe(false);
    expect(prepared.headers.accept).toBe('text/event-stream');
  });

  it('should send count_tokens to /v1/messages/count_tokens', () => {
    expect(
      adapter.prepare({
        operation: PROXY_OPERATIONS.countTokens,
        rawBody,
        info,
        providerKey: 'k',
        clientHeaders: {},
      }).url,
    ).toBe('http://anthropic.test/v1/messages/count_tokens');
  });

  it('should refuse operations of another API', () => {
    expect(() =>
      adapter.prepare({
        operation: PROXY_OPERATIONS.chatCompletions,
        rawBody,
        info,
        providerKey: 'k',
        clientHeaders: {},
      }),
    ).toThrow();
  });
});
