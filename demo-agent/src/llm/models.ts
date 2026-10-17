import type { ProviderConfig } from '../config.js';
import { AnthropicChatModel } from './anthropic-model.js';
import { checkContext } from './context-guard.js';
import { GeminiChatModel } from './gemini-model.js';
import { OpenAiChatModel } from './openai-model.js';
import { RetryPolicy, withRateLimitRetry } from './rate-limit.js';
import type { ChatModel, CompletionRequest, ModelTurn } from './types.js';

/** The SDK-backed model for a provider. */
export function sdkModel(config: ProviderConfig): ChatModel {
  switch (config.provider) {
    case 'gemini':
      return new GeminiChatModel(config);
    case 'anthropic':
      return new AnthropicChatModel(config);
    case 'openai':
    case 'groq':
      return new OpenAiChatModel(config);
  }
}

/**
 * Wraps a model with the context guard (fails before a request that cannot
 * fit) and rate limit handling (retries per-minute 429s, stops cleanly on a
 * daily quota with QuotaExhaustedError).
 */
export class GuardedModel implements ChatModel {
  readonly provider;
  readonly model;

  constructor(
    private readonly inner: ChatModel,
    private readonly limits: {
      contextTokens?: number;
      maxRequestTokens?: number;
      maxOutputTokens: number;
    },
    private readonly retry: RetryPolicy = {},
  ) {
    this.provider = inner.provider;
    this.model = inner.model;
  }

  async complete(request: CompletionRequest): Promise<ModelTurn> {
    checkContext(request.messages, request.tools, this.limits);
    // Rate-limit waits are reported apart, so latency is the provider's.
    let waitedMs = 0;
    const sleep =
      this.retry.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const turn = await withRateLimitRetry(() => this.inner.complete(request), {
      ...this.retry,
      sleep: (ms) => {
        waitedMs += ms;
        return sleep(ms);
      },
    });
    return { ...turn, waitedMs: (turn.waitedMs ?? 0) + waitedMs };
  }
}

export function createModel(
  config: ProviderConfig,
  retry: RetryPolicy = {},
): ChatModel {
  return new GuardedModel(sdkModel(config), config, retry);
}
