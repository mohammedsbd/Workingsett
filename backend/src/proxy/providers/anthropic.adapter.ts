import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingHttpHeaders } from 'node:http';
import { AllConfigType } from '../../config/config.type';
import { TokenUsage } from '../../usage-records/domain/token-usage';
import {
  anthropicResponseUsage,
  anthropicStreamUsage,
} from './anthropic-format';
import {
  PreparedUpstreamRequest,
  ProviderAdapter,
  ProxyOperation,
  RequestInfo,
} from './provider-adapter';

/** Client headers passed through to Anthropic (lower case). */
const FORWARDED_HEADERS = ['anthropic-version', 'anthropic-beta'];

const PATHS: Partial<Record<ProxyOperation['name'], string>> = {
  messages: '/v1/messages',
  'messages.count_tokens': '/v1/messages/count_tokens',
};

/**
 * Forwards Anthropic Messages API requests to
 * {PROXY_ANTHROPIC_BASE_URL}/v1/messages (and /v1/messages/count_tokens).
 * The body is sent unchanged: Anthropic always reports usage, in the
 * response body and in the message_start and message_delta stream events.
 */
@Injectable()
export class AnthropicAdapter implements ProviderAdapter {
  readonly api = 'anthropic-messages' as const;
  readonly upstream = 'anthropic' as const;

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  prepare({
    operation,
    rawBody,
    info,
    providerKey,
    clientHeaders,
  }: {
    operation: ProxyOperation;
    rawBody: Buffer;
    info: RequestInfo;
    providerKey: string;
    clientHeaders: IncomingHttpHeaders;
  }): PreparedUpstreamRequest {
    const path = PATHS[operation.name];
    if (!path)
      throw new Error(`Anthropic adapter cannot handle ${operation.name}`);
    const base = this.configService.getOrThrow('proxy.anthropicBaseUrl', {
      infer: true,
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: info.stream ? 'text/event-stream' : 'application/json',
      'x-api-key': providerKey,
    };
    for (const name of FORWARDED_HEADERS) {
      const value = clientHeaders[name];
      if (typeof value === 'string') headers[name] = value;
    }

    return {
      url: `${base}${path}`,
      headers,
      body: rawBody,
      usageInjected: false,
    };
  }

  usageFromResponse(body: unknown): TokenUsage | null {
    return anthropicResponseUsage(body);
  }

  usageFromStreamEvent(
    event: unknown,
    previous: TokenUsage | null,
  ): TokenUsage | null {
    return anthropicStreamUsage(event, previous);
  }
}
