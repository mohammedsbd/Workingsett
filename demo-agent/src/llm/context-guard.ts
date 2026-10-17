import type { ChatMessage, ToolDefinition } from './types.js';

/**
 * Fails loudly before a request that cannot fit: larger than the model's
 * context window, or larger than a per-request limit (on Groq's free tier
 * a request above the tokens-per-minute limit is rejected outright). Better
 * than a provider error, or a silently truncated prompt.
 */

/** Conservative: about 3 characters per token (below the usual 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Estimated prompt tokens of a request: messages, tool calls and tool definitions. */
export function estimateRequestTokens(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): number {
  let chars = JSON.stringify(tools).length;
  for (const message of messages) {
    chars += message.content.length + 8;
    if (message.role === 'assistant') {
      chars += JSON.stringify(message.toolCalls).length;
    }
  }
  return Math.ceil(chars / 3);
}

export class ContextTooLargeError extends Error {
  constructor(
    readonly estimatedTokens: number,
    readonly limitTokens: number,
    readonly limitName: string,
  ) {
    super(
      `The request is too large: about ${estimatedTokens} tokens (with the output limit) against ${limitName} of ${limitTokens} tokens. Use a model with a larger limit, or a context strategy that keeps less.`,
    );
    this.name = 'ContextTooLargeError';
  }
}

export type ContextLimits = {
  /** The model's context window. */
  contextTokens?: number;
  /** A per-request limit below it (for example a free tier's tokens per minute). */
  maxRequestTokens?: number;
  /** Output tokens reserved in the check. */
  maxOutputTokens: number;
};

/** Throws ContextTooLargeError when the request cannot fit. */
export function checkContext(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  limits: ContextLimits,
): number {
  const estimated =
    estimateRequestTokens(messages, tools) + limits.maxOutputTokens;
  if (limits.contextTokens && estimated > limits.contextTokens) {
    throw new ContextTooLargeError(
      estimated,
      limits.contextTokens,
      "the model's context window",
    );
  }
  if (limits.maxRequestTokens && estimated > limits.maxRequestTokens) {
    throw new ContextTooLargeError(
      estimated,
      limits.maxRequestTokens,
      'the per-request token limit',
    );
  }
  return estimated;
}
