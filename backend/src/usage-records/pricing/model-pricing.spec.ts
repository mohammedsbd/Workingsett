import fs from 'node:fs';
import path from 'node:path';
import {
  calculateCostUsd,
  findModelPrice,
  ModelPriceTable,
  parseModelPriceTable,
} from './model-pricing';

const table: ModelPriceTable = {
  lastUpdated: '2026-10-06',
  models: {
    'gemini-3.8-flash': { input: 0.75, cachedInput: 0.075, output: 3.75 },
    'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
    'no-cache-rate': { input: 1, output: 2 },
    'claude-haiku-4-5': {
      input: 1,
      cachedInput: 0.1,
      cacheWrite: 1.25,
      cacheWrite1h: 2,
      output: 5,
    },
  },
};

const usage = (inputTokens: number, outputTokens: number, cached = 0) => ({
  inputTokens,
  outputTokens,
  cachedInputTokens: cached,
  cacheWriteInputTokens: null,
});

describe('model pricing', () => {
  describe('calculateCostUsd', () => {
    it('should price input and output tokens per million', () => {
      // 1M input * 0.75 + 1M output * 3.75
      expect(calculateCostUsd(table, 'gemini-3.8-flash', usage(1e6, 1e6))).toBe(
        4.5,
      );
    });

    it('should bill cached input tokens at the cached rate', () => {
      // 600k uncached * 2.5 + 400k cached * 1.25 + 100k output * 10, per 1M
      expect(
        calculateCostUsd(table, 'gpt-4o', usage(1_000_000, 100_000, 400_000)),
      ).toBe(1.5 + 0.5 + 1);
    });

    it('should bill cached tokens at the input rate when no cached rate is set', () => {
      expect(
        calculateCostUsd(table, 'no-cache-rate', usage(1e6, 0, 500_000)),
      ).toBe(1);
    });

    it('should never count more cached tokens than input tokens', () => {
      expect(calculateCostUsd(table, 'gpt-4o', usage(100, 0, 1_000))).toBe(
        calculateCostUsd(table, 'gpt-4o', usage(100, 0, 100)),
      );
    });

    it('should treat a null cached count as zero', () => {
      expect(
        calculateCostUsd(table, 'gpt-4o', {
          inputTokens: 1e6,
          outputTokens: 0,
          cachedInputTokens: null,
          cacheWriteInputTokens: null,
        }),
      ).toBe(2.5);
    });

    it('should round away floating point noise', () => {
      const cost = calculateCostUsd(table, 'gemini-3.8-flash', usage(7, 3));
      expect(cost).toBe(0.0000165);
      expect(String(cost).length).toBeLessThan(12);
    });

    it('should return null for unknown models instead of guessing', () => {
      expect(calculateCostUsd(table, 'gpt-99', usage(1000, 1000))).toBeNull();
      expect(calculateCostUsd(table, '', usage(1000, 1000))).toBeNull();
    });

    it('should not match on a prefix of a different model', () => {
      expect(calculateCostUsd(table, 'gpt-4o-mini', usage(10, 10))).toBeNull();
    });

    it('should not treat inherited object keys as models', () => {
      expect(calculateCostUsd(table, 'toString', usage(10, 10))).toBeNull();
    });
  });

  describe('cache writes (Anthropic)', () => {
    const anthropic = (
      input: number,
      read: number,
      write: number,
      write1h?: number,
    ) => ({
      inputTokens: input,
      outputTokens: 0,
      cachedInputTokens: read,
      cacheWriteInputTokens: write,
      ...(write1h !== undefined && { cacheWrite1hInputTokens: write1h }),
    });

    it('should bill cache reads, cache writes and the rest at their own rates', () => {
      // 1M total: 200k uncached * $1 + 500k reads * $0.10 + 300k writes * $1.25
      expect(
        calculateCostUsd(
          table,
          'claude-haiku-4-5',
          anthropic(1_000_000, 500_000, 300_000),
        ),
      ).toBe(0.2 + 0.05 + 0.375);
    });

    it('should bill 1-hour cache writes at the 1-hour rate', () => {
      // 300k writes: 100k 5-minute * $1.25 + 200k 1-hour * $2
      expect(
        calculateCostUsd(
          table,
          'claude-haiku-4-5',
          anthropic(300_000, 0, 300_000, 200_000),
        ),
      ).toBe(0.125 + 0.4);
    });

    it('should bill cache writes at the input rate when no write rate is set', () => {
      expect(
        calculateCostUsd(table, 'no-cache-rate', anthropic(1e6, 0, 1e6)),
      ).toBe(1);
    });

    it('should match Anthropic dated snapshots', () => {
      expect(findModelPrice(table, 'claude-haiku-4-5-20251001')).toBe(
        table.models['claude-haiku-4-5'],
      );
    });
  });

  describe('findModelPrice', () => {
    it('should match dated snapshots and the models/ prefix', () => {
      expect(findModelPrice(table, 'gpt-4o-2024-08-06')).toBe(
        table.models['gpt-4o'],
      );
      expect(findModelPrice(table, 'models/gemini-3.8-flash')).toBe(
        table.models['gemini-3.8-flash'],
      );
    });
  });

  describe('parseModelPriceTable', () => {
    it('should load the shipped config/model-prices.json', () => {
      const file = path.join(__dirname, '../../../config/model-prices.json');
      const parsed = parseModelPriceTable(
        JSON.parse(fs.readFileSync(file, 'utf8')) as unknown,
      );

      expect(parsed.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(parsed.models).length).toBeGreaterThan(5);
    });

    it('should reject a table without models or with a bad price', () => {
      expect(() => parseModelPriceTable({ lastUpdated: 'x' })).toThrow();
      expect(() =>
        parseModelPriceTable({ models: { m: { input: -1, output: 1 } } }),
      ).toThrow('Invalid price for model "m"');
      expect(() =>
        parseModelPriceTable({ models: { m: { input: 1 } } }),
      ).toThrow();
    });
  });
});
