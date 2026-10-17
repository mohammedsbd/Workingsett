import { Upstream } from '../../proxy/providers/provider-adapter';

/** Parsim's own model, used for summaries unless a project pays itself. */
export type InternalModelConfig = {
  provider: Upstream;
  /** Empty when PARSIM_INTERNAL_MODEL is not set: summaries then fail. */
  model: string;
  /** Overrides the provider's base URL (tests point it at a fake). */
  baseUrl?: string;
  /**
   * PARSIM_INTERNAL_API_KEY, else the provider's key from .env
   * (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY for
   * openai-compatible).
   */
  apiKey?: string;
  /** PARSIM_INTERNAL_CONTEXT_TOKENS: the model's context window, if set. */
  contextTokens?: number;
};

export type CompressionConfig = {
  /** A finished stretch is summarized only above this many tokens. */
  minTokens: number;
  /** Run the summary worker in this process. */
  worker: boolean;
  /** How often the worker looks for new jobs, in seconds. */
  pollSeconds: number;
  /** Retries of a failed summary before it is marked failed. */
  retryLimit: number;
  internal: InternalModelConfig;
};
