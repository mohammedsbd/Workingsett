import { IncomingHttpHeaders } from 'node:http';
import { TokenUsage } from '../../usage-records/domain/token-usage';

/** Upstreams a project can forward OpenAI-format chat requests to. */
export const UPSTREAMS = ['openai', 'gemini'] as const;
export type Upstream = (typeof UPSTREAMS)[number];

/** What the pipeline needs to know about a chat request. Never content. */
export type ChatRequestInfo = {
  model: string;
  stream: boolean;
  /** The client set stream_options itself. */
  hasStreamOptions: boolean;
};

export type PreparedUpstreamRequest = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
  /**
   * Parsim added stream_options.include_usage to get token counts. Usage the
   * client did not ask for must then be removed from the stream.
   */
  usageInjected: boolean;
};

/**
 * Turns an incoming OpenAI-format chat request into the upstream call and
 * reads token usage back. One adapter per upstream; the proxy pipeline only
 * talks to this interface.
 */
export interface ChatCompletionsAdapter {
  readonly upstream: Upstream;
  prepare(input: {
    rawBody: Buffer;
    info: ChatRequestInfo;
    providerKey: string;
    clientHeaders: IncomingHttpHeaders;
  }): PreparedUpstreamRequest;
  /** Usage from a non-streamed JSON response body. */
  usageFromResponse(body: unknown): TokenUsage | null;
  /** Usage from one parsed stream chunk, if it carries any. */
  usageFromChunk(chunk: unknown): TokenUsage | null;
}

export const CHAT_COMPLETIONS_ADAPTERS = Symbol('CHAT_COMPLETIONS_ADAPTERS');
