import { describe, expect, it } from '@jest/globals';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TokenCounter } from '../../src/context/token-counter';
import { DEFAULT_GC_CONFIG } from '../../src/gc/gc-config';
import {
  FixtureReplayer,
  fixturePoints,
  loadFixture,
} from '../../src/replay/fixtures/fixture-replay';
import { parseModelPriceTable } from '../../src/usage-records/pricing/model-pricing';

/**
 * Replays one fixture session (the research agent) with Gemini Flash:
 * three request points the GC changed, each sent as recorded and as the
 * GC made it through Gemini's OpenAI-compatible endpoint, judged by the
 * same model. Opt-in only (`npm run test:live`), with GEMINI_API_KEY and
 * PARSIM_INTERNAL_MODEL in .env.test. The fixture is synthetic, so nothing
 * real goes through the key. About 120k input tokens, under $0.15 at paid
 * prices, and the budget stops it at $0.25. The report is written to a
 * temp file to be checked by hand.
 */
const key = process.env.GEMINI_API_KEY;
const model = process.env.PARSIM_INTERNAL_MODEL;
const enabled =
  process.env.LIVE_TESTS === 'true' &&
  process.env.PARSIM_INTERNAL_PROVIDER !== 'openai' &&
  process.env.PARSIM_INTERNAL_PROVIDER !== 'anthropic' &&
  !!key &&
  !!model;
const run = enabled ? it : it.skip;

const BUDGET_USD = 0.25;

describe('Live replay', () => {
  run(
    'should replay a fixture session with Gemini Flash within its budget',
    async () => {
      const tokens = new TokenCounter();
      const points = fixturePoints(loadFixture('research-agent-session'), {
        model: model!,
        gc: { ...DEFAULT_GC_CONFIG, sideEffectTools: ['save_note'] },
        count: (text, images) =>
          tokens.count(text, images, { upstream: 'gemini', model: model! })
            .tokens,
        max: 3,
      });
      expect(points).toHaveLength(3);

      const geminiOpenAi = (
        process.env.PROXY_GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      ).replace(/\/+$/, '');
      const geminiNative = (
        process.env.PROXY_GEMINI_NATIVE_BASE_URL ||
        'https://generativelanguage.googleapis.com'
      ).replace(/\/+$/, '');
      const replayer = new FixtureReplayer({
        target: {
          provider: 'gemini',
          url: `${geminiOpenAi}/chat/completions`,
          apiKey: key!,
          model: model!,
        },
        judge: {
          provider: 'gemini',
          model: model!,
          baseUrl: geminiNative,
          apiKey: key!,
        },
        prices: parseModelPriceTable(
          JSON.parse(
            readFileSync('config/model-prices.json', 'utf8'),
          ) as unknown,
        ),
        passScore: 4,
        recallMax: 3,
        outputReserveTokens: 4096,
      });
      const estimate = replayer.estimate(points, 500);
      expect(estimate.totalUsd).toBeLessThan(BUDGET_USD);

      const report = await replayer.run(points, BUDGET_USD);
      const file = path.join(tmpdir(), 'parsim-replay-live.json');
      writeFileSync(file, JSON.stringify({ estimate, report }, null, 2));
      console.log(`Replay report written to ${file}`);

      expect(report.stopped).toBeNull();
      expect(report.spentUsd).toBeLessThanOrEqual(BUDGET_USD);
      for (const point of report.points) {
        expect(point.status).toBe('completed');
        expect(point.original!.temperatureZero).toBe(true);
        expect(point.judgeScore).not.toBeNull();
      }
      // The GC'd versions were sent with fewer input tokens.
      expect(report.gc.inputTokens).toBeLessThan(report.original.inputTokens);
      expect(report.agreement.rate).not.toBeNull();
    },
    600_000,
  );
});
