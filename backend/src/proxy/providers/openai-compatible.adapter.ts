import { IncomingHttpHeaders } from 'node:http';
import { TokenUsage } from '../../usage-records/domain/token-usage';
import {
  ChatCompletionsAdapter,
  ChatRequestInfo,
  PreparedUpstreamRequest,
  Upstream,
} from './chat-completions-adapter';
import {
  injectIncludeUsage,
  readOpenAiUsage,
  toTokenUsage,
} from './openai-format';

/**
 * Shared logic for upstreams that speak the OpenAI chat completions format.
 * Subclasses set the URL, forwarded headers and usage quirks.
 */
export abstract class OpenAiCompatibleAdapter implements ChatCompletionsAdapter {
  abstract readonly upstream: Upstream;

  /** Client headers passed through to this upstream (lower case). */
  protected readonly forwardedHeaders: readonly string[] = [];

  /** Count hidden reasoning tokens from total_tokens (see toTokenUsage). */
  protected readonly outputFromTotal: boolean = false;

  protected abstract chatCompletionsUrl(): string;

  prepare({
    rawBody,
    info,
    providerKey,
    clientHeaders,
  }: {
    rawBody: Buffer;
    info: ChatRequestInfo;
    providerKey: string;
    clientHeaders: IncomingHttpHeaders;
  }): PreparedUpstreamRequest {
    const usageInjected = info.stream && !info.hasStreamOptions;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: info.stream ? 'text/event-stream' : 'application/json',
      authorization: `Bearer ${providerKey}`,
    };
    for (const name of this.forwardedHeaders) {
      const value = clientHeaders[name];
      if (typeof value === 'string') headers[name] = value;
    }

    return {
      url: this.chatCompletionsUrl(),
      headers,
      body: usageInjected ? injectIncludeUsage(rawBody) : rawBody,
      usageInjected,
    };
  }

  usageFromResponse(body: unknown): TokenUsage | null {
    return toTokenUsage(readOpenAiUsage(body), this.outputFromTotal);
  }

  usageFromChunk(chunk: unknown): TokenUsage | null {
    return toTokenUsage(readOpenAiUsage(chunk), this.outputFromTotal);
  }
}
