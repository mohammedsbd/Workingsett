import { TokenUsage } from '../../usage-records/domain/token-usage';

type OpenAiUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
};

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

/** The `usage` object of an OpenAI-format response or chunk, if present. */
export function readOpenAiUsage(body: unknown): OpenAiUsage | null {
  if (typeof body !== 'object' || body === null) return null;
  const usage = (body as { usage?: unknown }).usage;
  return typeof usage === 'object' && usage !== null
    ? (usage as OpenAiUsage)
    : null;
}

/**
 * Converts an OpenAI `usage` object. `outputFromTotal` handles upstreams that
 * leave hidden reasoning tokens out of completion_tokens but count them in
 * total_tokens (Gemini's OpenAI-compatible endpoint does this).
 */
export function toTokenUsage(
  usage: OpenAiUsage | null,
  outputFromTotal = false,
): TokenUsage | null {
  if (!usage) return null;
  const input = asCount(usage.prompt_tokens);
  const completion = asCount(usage.completion_tokens);
  if (input === null || completion === null) return null;

  const total = asCount(usage.total_tokens);
  const output =
    outputFromTotal && total !== null
      ? Math.max(completion, total - input)
      : completion;

  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: asCount(usage.prompt_tokens_details?.cached_tokens),
  };
}

const INCLUDE_USAGE = Buffer.from('"stream_options":{"include_usage":true}');

/**
 * Adds stream_options.include_usage to a JSON object body without
 * re-serializing it, so every other byte stays exactly as the client sent it.
 */
export function injectIncludeUsage(rawBody: Buffer): Buffer {
  const end = rawBody.lastIndexOf('}');
  if (end < 0) throw new Error('Body is not a JSON object');

  let hasMembers = false;
  for (let i = end - 1; i >= 0; i--) {
    const char = rawBody[i];
    if (char === 0x7b /* { */) break;
    if (![0x20, 0x09, 0x0a, 0x0d].includes(char)) {
      hasMembers = true;
      break;
    }
  }

  return Buffer.concat([
    rawBody.subarray(0, end),
    hasMembers ? Buffer.from(',') : Buffer.alloc(0),
    INCLUDE_USAGE,
    rawBody.subarray(end),
  ]);
}
