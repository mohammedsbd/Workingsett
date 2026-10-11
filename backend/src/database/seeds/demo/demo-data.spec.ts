import { describe, expect, it } from '@jest/globals';
import {
  buildDemoRows,
  costUsd,
  DemoProjectPlan,
  seededRandom,
} from './demo-data';

const plan = (gcMode: 'on' | 'shadow'): DemoProjectPlan => ({
  name: 'Demo',
  upstream: 'gemini',
  gcMode,
  model: 'gemini-3.8-flash',
  price: { input: 0.75, cachedInput: 0.075, output: 3.75 },
  sessions: 6,
  tools: ['web_search', 'fetch_page'],
  label: 'demo',
});
const now = new Date('2026-10-11T12:00:00Z');

describe('demo seed data', () => {
  it('should repeat the same random sequence for the same seed', () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('should price cached input at the cached rate', () => {
    expect(
      costUsd(
        { input: 1, cachedInput: 0.1, output: 5 },
        1_000_000,
        500_000,
        100_000,
      ),
    ).toBe(0.5 + 0.05 + 0.5);
  });

  it('should give every request a GC run, within the last 30 days', () => {
    const rows = buildDemoRows('p1', plan('on'), 1, now);
    expect(rows.sessions).toHaveLength(6);
    expect(rows.runs).toHaveLength(rows.usage.length);
    const requests = rows.sessions.reduce(
      (sum, s) => sum + (s.requestCount as number),
      0,
    );
    expect(rows.usage).toHaveLength(requests);
    for (const usage of rows.usage) {
      const at = (usage.createdAt as Date).getTime();
      expect(at).toBeLessThan(now.getTime());
      expect(at).toBeGreaterThan(now.getTime() - 31 * 24 * 3_600_000);
    }
    for (const run of rows.runs) {
      expect(run.tokensAfter as number).toBeLessThanOrEqual(
        run.tokensBefore as number,
      );
    }
  });

  it('should make decisions only in passes, with stubs that match their reason', () => {
    const rows = buildDemoRows('p1', plan('on'), 2, now);
    const passes = new Set(rows.runs.filter((r) => r.ran).map((r) => r.id));
    expect(rows.decisions.length).toBeGreaterThan(0);
    for (const d of rows.decisions) {
      expect(passes.has(d.gcRunId)).toBe(true);
      const stub = d.replacement as string;
      if (d.reason === 'stale_large') {
        expect(stub).toContain(`id ${d.archiveId as string}]`);
      } else {
        expect(stub).toMatch(/^\[parsim dropped: /);
      }
    }
  });

  it('should only send smaller requests and recall in on mode', () => {
    const shadow = buildDemoRows('p1', plan('shadow'), 2, now);
    expect(shadow.runs.every((r) => r.applied === false)).toBe(true);
    expect(shadow.recalls).toEqual([]);
    expect(shadow.usage.every((u) => u.upstreamCalls === 1)).toBe(true);
  });
});
