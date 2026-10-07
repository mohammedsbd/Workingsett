import { TokenUsage } from '../../usage-records/domain/token-usage';

/** The `usage` object of the Anthropic Messages API. */
type AnthropicUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation?: { ephemeral_1h_input_tokens?: unknown } | null;
};

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;

/**
 * Converts Anthropic usage. Anthropic's input_tokens excludes cache reads
 * and cache writes, so Parsim's inputTokens is the sum of all three.
 * Returns null when input or output tokens are missing.
 */
export function anthropicUsage(usage: unknown): TokenUsage | null {
  const raw = asObject(usage) as AnthropicUsage | null;
  if (!raw) return null;
  const input = asCount(raw.input_tokens);
  const output = asCount(raw.output_tokens);
  if (input === null || output === null) return null;

  const cacheRead = asCount(raw.cache_read_input_tokens);
  const cacheWrite = asCount(raw.cache_creation_input_tokens);
  const write1h = asCount(raw.cache_creation?.ephemeral_1h_input_tokens);

  return {
    inputTokens: input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: output,
    cachedInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    ...(write1h !== null && { cacheWrite1hInputTokens: write1h }),
  };
}

/** Usage from a non-streamed Messages API response. */
export function anthropicResponseUsage(body: unknown): TokenUsage | null {
  return anthropicUsage(asObject(body)?.usage);
}

/**
 * Usage after one Messages API stream event.
 *
 * - `message_start` carries the full usage so far: input, cache read and
 *   cache write tokens, plus a small initial output count.
 * - `message_delta` carries the final, cumulative output_tokens, and newer
 *   API versions repeat the input and cache counts there too. Fields it
 *   leaves out keep their values from `message_start`.
 */
export function anthropicStreamUsage(
  event: unknown,
  previous: TokenUsage | null,
): TokenUsage | null {
  const data = asObject(event);
  if (data?.type === 'message_start') {
    return anthropicUsage(asObject(data.message)?.usage) ?? previous;
  }
  if (data?.type !== 'message_delta') return previous;

  const delta = asObject(data.usage) as AnthropicUsage | null;
  const output = asCount(delta?.output_tokens);
  if (!delta || output === null) return previous;

  const base: TokenUsage = previous ?? {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
  };
  const input = asCount(delta.input_tokens);
  const cacheRead = asCount(delta.cache_read_input_tokens);
  const cacheWrite = asCount(delta.cache_creation_input_tokens);
  const write1h = asCount(delta.cache_creation?.ephemeral_1h_input_tokens);

  const cachedInputTokens = cacheRead ?? base.cachedInputTokens;
  const cacheWriteInputTokens = cacheWrite ?? base.cacheWriteInputTokens;
  const inputTokens =
    input !== null
      ? input + (cachedInputTokens ?? 0) + (cacheWriteInputTokens ?? 0)
      : base.inputTokens;
  const cacheWrite1hInputTokens = write1h ?? base.cacheWrite1hInputTokens;

  return {
    inputTokens,
    outputTokens: output,
    cachedInputTokens,
    cacheWriteInputTokens,
    ...(cacheWrite1hInputTokens !== undefined && { cacheWrite1hInputTokens }),
  };
}
