import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GeminiNativeAdapter } from './gemini-native.adapter';
import { PROXY_OPERATIONS } from './provider-adapter';

describe('GeminiNativeAdapter', () => {
  let adapter: GeminiNativeAdapter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({ proxy: { geminiNativeBaseUrl: 'http://gemini.test' } }),
          ],
        }),
      ],
      providers: [GeminiNativeAdapter],
    }).compile();
    adapter = moduleRef.get(GeminiNativeAdapter);
  });

  const rawBody = Buffer.from('{"contents":[{"parts":[{"text":"Hi"}]}]}');
  const info = (stream: boolean) => ({
    model: 'gemini-3.8-flash',
    stream,
    hasStreamOptions: false,
  });

  it('should send generateContent with the key in x-goog-api-key and the body unchanged', () => {
    const prepared = adapter.prepare({
      operation: PROXY_OPERATIONS.generateContent,
      rawBody,
      info: info(false),
      providerKey: 'AIza-test',
      query: {},
    });

    expect(prepared).toEqual({
      url: 'http://gemini.test/v1beta/models/gemini-3.8-flash:generateContent',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-goog-api-key': 'AIza-test',
      },
      body: rawBody,
      usageInjected: false,
    });
  });

  it('should pass alt=sse on for streams and never put a key in the URL', () => {
    const prepared = adapter.prepare({
      operation: PROXY_OPERATIONS.streamGenerateContent,
      rawBody,
      info: info(true),
      providerKey: 'AIza-test',
      query: { alt: 'sse', key: 'AIza-from-client' },
    });

    expect(prepared.url).toBe(
      'http://gemini.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    );
    expect(prepared.headers.accept).toBe('text/event-stream');
  });

  it('should send countTokens to its own method', () => {
    const prepared = adapter.prepare({
      operation: PROXY_OPERATIONS.geminiCountTokens,
      rawBody,
      info: info(false),
      providerKey: 'AIza-test',
      query: {},
    });
    expect(prepared.url).toBe(
      'http://gemini.test/v1beta/models/gemini-3.8-flash:countTokens',
    );
  });

  it('should refuse operations of other APIs', () => {
    expect(() =>
      adapter.prepare({
        operation: PROXY_OPERATIONS.messages,
        rawBody,
        info: info(false),
        providerKey: 'AIza-test',
        query: {},
      }),
    ).toThrow('cannot handle messages');
  });

  it('should read usage from responses and stream chunks', () => {
    const usageMetadata = { promptTokenCount: 4, candidatesTokenCount: 2 };
    expect(adapter.usageFromResponse({ usageMetadata })).toMatchObject({
      inputTokens: 4,
      outputTokens: 2,
    });
    expect(adapter.usageFromStreamEvent({ usageMetadata }, null)).toMatchObject(
      { inputTokens: 4, outputTokens: 2 },
    );
  });
});
