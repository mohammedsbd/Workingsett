import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { GeminiNativeConverter } from '../../context/normalization/gemini-native.converter';
import { TokenUsage } from '../../usage-records/domain/token-usage';
import { QueryParams, queryWithoutKey } from '../proxy-credentials';
import { geminiResponseUsage, geminiStreamUsage } from './gemini-format';
import {
  PreparedUpstreamRequest,
  ProviderAdapter,
  ProxyOperation,
  RequestInfo,
} from './provider-adapter';

const METHODS: Partial<Record<ProxyOperation['name'], string>> = {
  'gemini.generateContent': 'generateContent',
  'gemini.streamGenerateContent': 'streamGenerateContent',
  'gemini.countTokens': 'countTokens',
};

/**
 * Forwards Gemini native API requests to
 * {PROXY_GEMINI_NATIVE_BASE_URL}/v1beta/models/{model}:{method}. The body
 * is sent unchanged and the key goes in x-goog-api-key, never in the URL.
 * Other query parameters (alt=sse) are passed on. Gemini reports usage in
 * usageMetadata, on the response and on streamed chunks.
 */
@Injectable()
export class GeminiNativeAdapter implements ProviderAdapter {
  readonly api = 'gemini-native' as const;
  readonly upstream = 'gemini' as const;
  readonly converter = new GeminiNativeConverter();

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  prepare({
    operation,
    rawBody,
    info,
    providerKey,
    query,
  }: {
    operation: ProxyOperation;
    rawBody: Buffer;
    info: RequestInfo;
    providerKey: string;
    query: QueryParams;
  }): PreparedUpstreamRequest {
    const method = METHODS[operation.name];
    if (!method) {
      throw new Error(`Gemini native adapter cannot handle ${operation.name}`);
    }
    const base = this.configService.getOrThrow('proxy.geminiNativeBaseUrl', {
      infer: true,
    });
    const model = encodeURIComponent(info.model);

    return {
      url: `${base}/v1beta/models/${model}:${method}${queryWithoutKey(query)}`,
      headers: {
        'content-type': 'application/json',
        accept: info.stream ? 'text/event-stream' : 'application/json',
        'x-goog-api-key': providerKey,
      },
      body: rawBody,
      usageInjected: false,
    };
  }

  usageFromResponse(body: unknown): TokenUsage | null {
    return geminiResponseUsage(body);
  }

  usageFromStreamEvent(
    event: unknown,
    previous: TokenUsage | null,
  ): TokenUsage | null {
    return geminiStreamUsage(event, previous);
  }
}
