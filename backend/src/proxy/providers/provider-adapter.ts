import { IncomingHttpHeaders } from 'node:http';
import { TokenUsage } from '../../usage-records/domain/token-usage';

/** Upstreams a project can forward to. */
export const UPSTREAMS = ['openai', 'gemini', 'anthropic'] as const;
export type Upstream = (typeof UPSTREAMS)[number];

/** Client-facing API formats the proxy serves. */
export type ProxyApi = 'openai-chat' | 'anthropic-messages';

/** One proxied endpoint. */
export type ProxyOperation = {
  api: ProxyApi;
  /** Name used in logs, for example "chat.completions". */
  name: 'chat.completions' | 'messages' | 'messages.count_tokens';
  /** Generation calls are billed and recorded; token counting is not. */
  recordsUsage: boolean;
};

export const PROXY_OPERATIONS = {
  chatCompletions: {
    api: 'openai-chat',
    name: 'chat.completions',
    recordsUsage: true,
  },
  messages: { api: 'anthropic-messages', name: 'messages', recordsUsage: true },
  countTokens: {
    api: 'anthropic-messages',
    name: 'messages.count_tokens',
    recordsUsage: false,
  },
} as const satisfies Record<string, ProxyOperation>;

/** What the pipeline needs to know about a request. Never content. */
export type RequestInfo = {
  model: string;
  stream: boolean;
  /** The client set stream_options itself (OpenAI format). */
  hasStreamOptions: boolean;
};

export type PreparedUpstreamRequest = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
  /**
   * Parsim changed the body to get token counts (OpenAI-format streams).
   * Usage the client did not ask for must then be removed from the stream.
   */
  usageInjected: boolean;
};

/**
 * Turns an incoming request into the upstream call and reads token usage
 * back. There is one adapter per (client API, upstream) pair; the proxy
 * pipeline only talks to this interface.
 */
export interface ProviderAdapter {
  readonly api: ProxyApi;
  readonly upstream: Upstream;
  prepare(input: {
    operation: ProxyOperation;
    rawBody: Buffer;
    info: RequestInfo;
    providerKey: string;
    clientHeaders: IncomingHttpHeaders;
  }): PreparedUpstreamRequest;
  /** Usage from a non-streamed JSON response body. */
  usageFromResponse(body: unknown): TokenUsage | null;
  /**
   * Usage after one parsed stream event. `previous` is the usage seen so
   * far, for formats that report it across several events (Anthropic).
   */
  usageFromStreamEvent(
    event: unknown,
    previous: TokenUsage | null,
  ): TokenUsage | null;
}

export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');
