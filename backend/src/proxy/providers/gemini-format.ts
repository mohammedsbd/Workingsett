import { TokenUsage } from '../../usage-records/domain/token-usage';

/** The `usageMetadata` object of the Gemini API. */
type UsageMetadata = {
  promptTokenCount?: unknown;
  cachedContentTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  toolUsePromptTokenCount?: unknown;
  totalTokenCount?: unknown;
};

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Converts Gemini usageMetadata.
 *
 * - Input: promptTokenCount (which already includes cached tokens) plus
 *   toolUsePromptTokenCount (tool results Gemini fed itself, billed as input).
 * - Output: candidatesTokenCount plus thoughtsTokenCount (thinking is billed
 *   as output). If neither is reported, totalTokenCount minus input.
 * - Cached: cachedContentTokenCount.
 *
 * Returns null without a prompt count.
 */
export function geminiUsage(metadata: unknown): TokenUsage | null {
  const raw = asObject(metadata) as UsageMetadata | null;
  const prompt = asCount(raw?.promptTokenCount);
  if (!raw || prompt === null) return null;

  const input = prompt + (asCount(raw.toolUsePromptTokenCount) ?? 0);
  const candidates = asCount(raw.candidatesTokenCount);
  const thoughts = asCount(raw.thoughtsTokenCount);
  const total = asCount(raw.totalTokenCount);
  const output =
    candidates !== null || thoughts !== null
      ? (candidates ?? 0) + (thoughts ?? 0)
      : total !== null
        ? Math.max(0, total - input)
        : 0;

  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: asCount(raw.cachedContentTokenCount),
    cacheWriteInputTokens: null,
  };
}

/**
 * Usage from a non-streamed response. A streamGenerateContent call without
 * alt=sse returns a JSON array of chunks; the last chunk with usage wins.
 */
export function geminiResponseUsage(body: unknown): TokenUsage | null {
  if (Array.isArray(body)) {
    let usage: TokenUsage | null = null;
    for (const chunk of body) usage = geminiStreamUsage(chunk, usage);
    return usage;
  }
  return geminiUsage(asObject(body)?.usageMetadata);
}

/**
 * Usage after one streamed chunk. Chunks repeat usageMetadata with
 * running totals, so the latest one replaces what came before.
 */
export function geminiStreamUsage(
  chunk: unknown,
  previous: TokenUsage | null,
): TokenUsage | null {
  return geminiUsage(asObject(chunk)?.usageMetadata) ?? previous;
}
