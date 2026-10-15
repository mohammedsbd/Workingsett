import { readFileSync } from 'node:fs';
import { FakeUpstream } from '../../../test/utils/fake-upstream';
import { TokenCounter } from '../../context/token-counter';
import { archiveStubIds } from '../../recall/archive-stubs';
import { DEFAULT_GC_CONFIG } from '../../gc/gc-config';
import { parseModelPriceTable } from '../../usage-records/pricing/model-pricing';
import {
  FixtureReplayer,
  fixturePoints,
  listFixtures,
  loadFixture,
} from './fixture-replay';

const MODEL = 'gemini-3.8-flash';
const tokens = new TokenCounter();
const count = (text: string, images: number) =>
  tokens.count(text, images, { upstream: 'gemini', model: MODEL }).tokens;
const gc = { ...DEFAULT_GC_CONFIG, sideEffectTools: ['save_note'] };

describe('fixture replay', () => {
  it('should list the fixture conversations', () => {
    expect(listFixtures()).toEqual([
      'research-agent-session',
      'short-chat',
      'support-agent-session',
    ]);
  });

  it('should pick the request points the GC changed, spread over the session', () => {
    const fixture = loadFixture('research-agent-session');
    const points = fixturePoints(fixture, { model: MODEL, gc, count, max: 3 });
    expect(points).toHaveLength(3);
    const numbers = points.map((p) => p.requestNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    for (const point of points) {
      const messages = point.original.messages as { role: string }[];
      // Request N ends just before the N-th assistant turn.
      expect(fixture.messages[messages.length].role).toBe('assistant');
      expect(point.original.model).toBe(MODEL);
      expect(JSON.stringify(point.gc).length).toBeLessThan(
        JSON.stringify(point.original).length,
      );
      // Every archive stub can be recalled from the point's archive.
      for (const id of archiveStubIds(JSON.stringify(point.gc))) {
        expect(point.archive.has(id)).toBe(true);
      }
    }
    // Deterministic, like the GC.
    expect(
      JSON.stringify(
        fixturePoints(fixture, { model: MODEL, gc, count, max: 3 }),
      ),
    ).toBe(JSON.stringify(points));
  });

  it('should find nothing to replay in a short chat', () => {
    expect(
      fixturePoints(loadFixture('short-chat'), {
        model: MODEL,
        gc,
        count,
        max: 5,
      }),
    ).toEqual([]);
  });

  describe('against a fake provider', () => {
    let upstream: FakeUpstream;
    beforeAll(async () => {
      upstream = await FakeUpstream.start();
    });
    afterAll(() => upstream.stop());
    beforeEach(() => upstream.reset());

    const replayer = () =>
      new FixtureReplayer({
        target: {
          provider: 'gemini',
          url: `${upstream.baseUrl}/v1beta/openai/chat/completions`,
          apiKey: 'test-key',
          model: MODEL,
        },
        judge: {
          provider: 'gemini',
          model: MODEL,
          baseUrl: upstream.baseUrl,
          apiKey: 'test-key',
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

    it('should replay each point twice and report identical answers as agreeing', async () => {
      const points = fixturePoints(loadFixture('research-agent-session'), {
        model: MODEL,
        gc,
        count,
        max: 2,
      });
      const r = replayer();
      expect(r.estimate(points, 500).totalUsd).toBeGreaterThan(0);

      const report = await r.run(points, 1);
      expect(report.stopped).toBeNull();
      expect(report.agreement).toEqual({
        judged: 2,
        agreed: 2,
        rate: 1,
        exactMatches: 2,
      });
      expect(upstream.requests).toHaveLength(4);
      expect(upstream.requests.every((q) => q.format === 'gemini-openai')).toBe(
        true,
      );
      expect(report.spentUsd).toBeCloseTo(
        report.original.costUsd + report.gc.costUsd,
        5,
      );
    });

    it('should stop when the budget cannot cover the next call', async () => {
      const points = fixturePoints(loadFixture('research-agent-session'), {
        model: MODEL,
        gc,
        count,
        max: 2,
      });
      const report = await replayer().run(points, 0.001);
      expect(report.points).toEqual([]);
      expect(report.stopped).toContain('budget');
      expect(upstream.requests).toHaveLength(0);
    });
  });
});
