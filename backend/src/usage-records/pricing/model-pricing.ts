import { TokenUsage } from '../domain/token-usage';

/** USD per 1M tokens. */
export type ModelPrice = {
  input: number;
  cachedInput?: number;
  output: number;
};

export type ModelPriceTable = {
  lastUpdated: string;
  note?: string;
  models: Record<string, ModelPrice>;
};

const PER_MILLION = 1_000_000;
const DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Finds the price for a model id. Matches exactly, then without a "models/"
 * prefix (Gemini) and without a dated snapshot suffix like "-2024-08-06".
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
 * Cost in USD, or null when the model is not in the table. Cached input
 * tokens are billed at the cached rate (or the normal rate if none is set).
 */
export function calculateCostUsd(
  table: ModelPriceTable,
  model: string,
  usage: TokenUsage,
): number | null {
  const price = findModelPrice(table, model);
  if (!price) return null;

  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  const cost =
    (uncached * price.input +
      cached * (price.cachedInput ?? price.input) +
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
    const values = [price?.input, price?.output, price?.cachedInput];
    const valid = values.every(
      (v, i) =>
        (i === 2 && v === undefined) || (typeof v === 'number' && v >= 0),
    );
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
