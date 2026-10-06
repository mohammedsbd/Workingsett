import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GeminiOpenAiAdapter } from './gemini-openai.adapter';
import { OpenAiAdapter } from './openai.adapter';

describe('chat completions adapters', () => {
  let openai: OpenAiAdapter;
  let gemini: GeminiOpenAiAdapter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              proxy: {
                openaiBaseUrl: 'http://openai.test',
                geminiBaseUrl: 'http://gemini.test/v1beta/openai',
              },
            }),
          ],
        }),
      ],
      providers: [OpenAiAdapter, GeminiOpenAiAdapter],
    }).compile();
    openai = moduleRef.get(OpenAiAdapter);
    gemini = moduleRef.get(GeminiOpenAiAdapter);
  });

  const rawBody = Buffer.from('{"model":"m","stream":true,"messages":[]}');

  it('should send OpenAI requests to /v1/chat/completions with the provider key', () => {
    const prepared = openai.prepare({
      rawBody,
      info: { model: 'm', stream: false, hasStreamOptions: false },
      providerKey: 'sk-test',
      clientHeaders: {
        'openai-organization': 'org-1',
        'x-parsim-key': 'psm_secret',
        cookie: 'a=b',
      },
    });

    expect(prepared.url).toBe('http://openai.test/v1/chat/completions');
    expect(prepared.headers).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer sk-test',
      'openai-organization': 'org-1',
    });
    expect(prepared.body).toBe(rawBody);
    expect(prepared.usageInjected).toBe(false);
  });

  it('should send Gemini requests to the OpenAI-compatible path without OpenAI headers', () => {
    const prepared = gemini.prepare({
      rawBody,
      info: { model: 'm', stream: false, hasStreamOptions: false },
      providerKey: 'gemini-key',
      clientHeaders: { 'openai-organization': 'org-1' },
    });

    expect(prepared.url).toBe(
      'http://gemini.test/v1beta/openai/chat/completions',
    );
    expect(prepared.headers.authorization).toBe('Bearer gemini-key');
    expect(prepared.headers['openai-organization']).toBeUndefined();
  });

  it('should inject include_usage only for streams without stream_options', () => {
    const streamed = { model: 'm', stream: true, hasStreamOptions: false };
    const injected = openai.prepare({
      rawBody,
      info: streamed,
      providerKey: 'k',
      clientHeaders: {},
    });
    const clientChose = openai.prepare({
      rawBody,
      info: { ...streamed, hasStreamOptions: true },
      providerKey: 'k',
      clientHeaders: {},
    });

    expect(injected.usageInjected).toBe(true);
    expect(injected.headers.accept).toBe('text/event-stream');
    expect(JSON.parse(injected.body.toString())).toMatchObject({
      stream_options: { include_usage: true },
    });
    expect(clientChose.usageInjected).toBe(false);
    expect(clientChose.body).toBe(rawBody);
  });

  it('should count Gemini thinking tokens as output but not OpenAI totals', () => {
    const body = {
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 153 },
    };

    expect(gemini.usageFromResponse(body)?.outputTokens).toBe(146);
    expect(openai.usageFromResponse(body)?.outputTokens).toBe(3);
  });
});
