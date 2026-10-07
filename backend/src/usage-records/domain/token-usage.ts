/** Token counts reported by a provider for one request. */
export type TokenUsage = {
  /**
   * All prompt tokens: uncached, read from the cache and written to the
   * cache. (Anthropic reports these three separately; they are added up.)
   */
  inputTokens: number;
  /** Billed output tokens, including hidden reasoning/thinking tokens. */
  outputTokens: number;
  /** Prompt tokens read from the provider's cache, if reported. */
  cachedInputTokens: number | null;
  /** Prompt tokens written to the provider's cache, if reported (Anthropic). */
  cacheWriteInputTokens: number | null;
  /** Part of cacheWriteInputTokens written to the 1-hour cache, if reported. */
  cacheWrite1hInputTokens?: number;
};
