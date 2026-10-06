import { TokenUsage } from '../domain/token-usage';

/** USD per 1M tokens. */
export type ModelPrice = {
  input: number;
  /** Cache reads (hits). Defaults to the input price. */
  cachedInput?: number;
  /** Cache writes (Anthropic 5-minute cache). Defaults to the input price. */
  cacheWrite?: number;
  /** Writes to Anthropic's 1-hour cache. Defaults to cacheWrite. */
  cacheWrite1h?: number;
  output: number;
};

export type ModelPriceTable = {
  lastUpdated: string;
  note?: string;
  models: Record<string, ModelPrice>;
};

const PER_MILLION = 1_000_000;
/** Dated snapshot suffixes: "-2024-08-06" (OpenAI), "-20251001" (Anthropic). */
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8})$/;

/**
 * Finds the price for a model id. Matches exactly, then without a "models/"
 * prefix (Gemini) and without a dated snapshot suffix like "-2024-08-06"
 * or "-20251001".
 * Anything else is unknown: we never guess a price.
 */
export function findModelPrice(
  table: ModelPriceTable,
  model: string,
): ModelPrice | null {
  const candidates = [model];
  const bare = model.replace(/^models\//, '');
  candidates.push(bare, bare.replace(DATE_SUFFIX, ''));

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(table.models, candidate)) {
      return table.models[candidate];
    }
  }
  return null;
}

/**
 * Cost in USD, or null when the model is not in the table. Input tokens are
 * split into cache reads, cache writes (5-minute and 1-hour) and the rest,
 * each billed at its own rate (the input rate when no special rate is set).
 */
export function calculateCostUsd(
  table: ModelPriceTable,
  model: string,
  usage: TokenUsage,
): number | null {
  const price = findModelPrice(table, model);
  if (!price) return null;

  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(
    usage.cacheWriteInputTokens ?? 0,
    usage.inputTokens - cached,
  );
  const written1h = Math.min(usage.cacheWrite1hInputTokens ?? 0, written);
  const uncached = usage.inputTokens - cached - written;
  const cacheWritePrice = price.cacheWrite ?? price.input;

  const cost =
    (uncached * price.input +
      cached * (price.cachedInput ?? price.input) +
      (written - written1h) * cacheWritePrice +
      written1h * (price.cacheWrite1h ?? cacheWritePrice) +
      usage.outputTokens * price.output) /
    PER_MILLION;

  // Round to 8 decimals so stored values don't carry float noise.
  return Math.round(cost * 1e8) / 1e8;
}

/** Validates the parsed JSON so a bad edit fails loudly at startup. */
export function parseModelPriceTable(raw: unknown): ModelPriceTable {
  const table = raw as Partial<ModelPriceTable> | null;
  if (!table || typeof table !== 'object' || !table.models) {
    throw new Error('Model price table must be an object with "models"');
  }
  for (const [model, price] of Object.entries(table.models)) {
    const required = [price?.input, price?.output];
    const optional = [
      price?.cachedInput,
      price?.cacheWrite,
      price?.cacheWrite1h,
    ];
    const isPrice = (v: unknown) => typeof v === 'number' && v >= 0;
    const valid =
      required.every(isPrice) &&
      optional.every((v) => v === undefined || isPrice(v));
    if (!valid) {
      throw new Error(
        `Invalid price for model "${model}" in model price table`,
      );
    }
  }
  return {
    lastUpdated: String(table.lastUpdated ?? ''),
    note: table.note,
    models: table.models,
  };
}
