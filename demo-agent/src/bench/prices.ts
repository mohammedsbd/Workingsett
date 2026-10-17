import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import type { Usage } from '../llm/types.js';

/**
 * Prices from Parsim's editable price table (backend/config/model-prices.json),
 * USD per 1M tokens. Free-tier development runs are priced at the model's
 * list price, so arms can be compared (the run itself costs nothing).
 */

export type Price = { input: number; cachedInput?: number; output: number };
export type PriceTable = Record<string, Price>;

export const DEFAULT_PRICES_PATH = path.join(
  ROOT,
  '..',
  'backend',
  'config',
  'model-prices.json',
);

/** Made-up prices for dry runs against the scripted fake upstream. */
export const DRY_RUN_PRICE: Price = { input: 1, cachedInput: 0.1, output: 2 };

export function loadPrices(file = DEFAULT_PRICES_PATH): PriceTable {
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    models: PriceTable;
  };
  return data.models;
}

export class UnknownPriceError extends Error {
  constructor(readonly model: string) {
    super(
      `No price for ${model} in the price table. Add it to backend/config/model-prices.json (USD per 1M tokens).`,
    );
    this.name = 'UnknownPriceError';
  }
}

export function priceOf(table: PriceTable, model: string): Price {
  const price = table[model];
  if (!price) throw new UnknownPriceError(model);
  return price;
}

const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;

/** Raw cost: every input token at the input price, no cache discount. */
export function rawCost(usage: Usage, price: Price): number {
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output)
  );
}

/** Cache-adjusted cost: cached input tokens at the cached input price. */
export function cacheAdjustedCost(usage: Usage, price: Price): number {
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  return (
    (usage.inputTokens - cached) * perToken(price.input) +
    cached * perToken(price.cachedInput ?? price.input) +
    usage.outputTokens * perToken(price.output)
  );
}

/**
 * Net cost: everything paid for the arm. What went upstream (through
 * Parsim this includes recall follow-ups the agent never sees, so the
 * larger of the agent's and Parsim's counts), plus internal model calls
 * (the summarize baseline's summaries) and Parsim's compression summaries.
 */
export function netCost(input: {
  agentUsage: Usage;
  parsimUsage: Usage | null;
  internalUsage: Usage;
  compressionCostUsd: number;
  modelPrice: Price;
  internalPrice: Price;
}): number {
  const upstream =
    input.parsimUsage &&
    input.parsimUsage.inputTokens > input.agentUsage.inputTokens
      ? input.parsimUsage
      : input.agentUsage;
  return (
    rawCost(upstream, input.modelPrice) +
    rawCost(input.internalUsage, input.internalPrice) +
    input.compressionCostUsd
  );
}
