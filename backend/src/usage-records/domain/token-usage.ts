/** Token counts reported by a provider for one request. */
export type TokenUsage = {
  /** All prompt tokens, including cached ones. */
  inputTokens: number;
  /** Billed output tokens, including hidden reasoning/thinking tokens. */
  outputTokens: number;
  /** Prompt tokens served from the provider's cache, if reported. */
  cachedInputTokens: number | null;
};
