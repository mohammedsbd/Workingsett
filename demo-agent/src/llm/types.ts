/** Providers the demo agent can call, each through its official SDK. */
export const PROVIDERS = ['gemini', 'groq', 'openai', 'anthropic'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * A provider-neutral conversation. Assistant messages keep the provider's
 * own content in `raw`, so it is sent back unchanged on later calls (Gemini
 * needs its thought signatures back, for example).
 */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls: ToolCall[];
      raw?: { provider: ProviderName; content: unknown };
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON schema of the arguments (an object schema). */
  parameters: Record<string, unknown>;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  raw?: { provider: ProviderName; content: unknown };
};

export type CompletionRequest = {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Sent as x-parsim-session-id, so Parsim groups the run's requests. */
  sessionId: string;
};

/** One model behind one SDK. Throws RateLimitedError on 429. */
export interface ChatModel {
  readonly provider: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<ModelTurn>;
}
