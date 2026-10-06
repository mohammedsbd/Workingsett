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
  },
};

const usage = (inputTokens: number, outputTokens: number, cached = 0) => ({
  inputTokens,
  outputTokens,
  cachedInputTokens: cached,
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
