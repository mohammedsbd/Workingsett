import { describe, expect, it } from 'vitest';
import {
  chartSeries,
  formatPercent,
  formatTokens,
  formatAgreement,
  formatUsd,
  headlineSavings,
  isReplayActive,
  pointVerdict,
  reduction,
  replayProgress,
  timeAgo,
  toggleRequest
} from './format';
import type { DailySavings, ReplayPoint, SavingsSummary } from './types';

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [1_000, '1k'],
    [12_345, '12.3k'],
    [999_999, '1000k'],
    [4_500_000, '4.5M'],
    [123_400_000, '123M'],
    [1_200_000_000, '1.2B'],
    [-2_500, '-2.5k']
  ])('formats %d as %s', (value, expected) => {
    expect(formatTokens(value)).toBe(expected);
  });
});

describe('formatUsd', () => {
  it.each([
    [0, '$0.00'],
    [9.3149, '$9.31'],
    [1234.5, '$1,234.50'],
    [0.00562, '$0.00562'],
    [0.12345, '$0.123'],
    [0.00004, '<$0.0001'],
    [-0.5, '-$0.5']
  ])('formats %d as %s', (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });
});

describe('formatPercent', () => {
  it.each([
    [0, '0%'],
    [0.64, '64%'],
    [0.055, '5.5%'],
    [0.05, '5%'],
    [1, '100%']
  ])('formats %d as %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });
});

describe('reduction', () => {
  it('is the share of tokens removed', () => {
    expect(reduction(1000, 360)).toBeCloseTo(0.64);
  });

  it('stays between 0 and 1', () => {
    expect(reduction(0, 0)).toBe(0);
    expect(reduction(100, 150)).toBe(0);
    expect(reduction(100, -5)).toBe(1);
  });
});

const gc = (applied: number, estimated: number) => ({
  runs: 1,
  tokensBefore: 100_000,
  tokensAfter: 50_000,
  reduction: 0.5,
  applied: { tokensSaved: applied, dollarsSaved: applied / 1e6 },
  estimated: { tokensSaved: estimated, dollarsSaved: estimated / 1e6 }
});

describe('headlineSavings', () => {
  it('should report dollars saved net of what the summaries cost', () => {
    expect(
      headlineSavings({
        mode: 'on',
        gc: gc(30_000, 0),
        compression: { summaries: 2, tokensSaved: 20_000, costUsd: 0.01 }
      }).dollarsSaved
    ).toBeCloseTo(headlineSavings({ mode: 'on', gc: gc(30_000, 0) }).dollarsSaved - 0.01, 10);
  });

  it('shows estimates in shadow mode', () => {
    expect(headlineSavings({ mode: 'shadow', gc: gc(0, 40_000) })).toEqual({
      tokensSaved: 40_000,
      dollarsSaved: 0.04,
      estimated: true
    });
  });

  it('shows real savings in on mode, plus estimates from before the switch', () => {
    expect(headlineSavings({ mode: 'on', gc: gc(30_000, 10_000) })).toEqual({
      tokensSaved: 40_000,
      dollarsSaved: 0.04,
      estimated: false
    });
  });

  it('marks on-mode savings as estimated when only shadow runs exist', () => {
    expect(headlineSavings({ mode: 'on', gc: gc(0, 10_000) }).estimated).toBe(true);
  });

  it('shows nothing when the GC is off', () => {
    expect(
      headlineSavings({ mode: 'off', gc: gc(5, 5) } as Pick<SavingsSummary, 'mode' | 'gc'>)
    ).toEqual({
      tokensSaved: 0,
      dollarsSaved: 0,
      estimated: false
    });
  });
});

describe('chartSeries', () => {
  it('adds applied and estimated savings per day and labels the dates in UTC', () => {
    const day: DailySavings = {
      date: '2026-10-03',
      requests: 12,
      costUsd: 0.5,
      compressionCostUsd: 0,
      tokensBefore: 10_000,
      tokensAfter: 4_000,
      applied: { tokensSaved: 5_000, dollarsSaved: 0.0037 },
      estimated: { tokensSaved: 1_000, dollarsSaved: 0.00075 }
    };
    expect(chartSeries([day])).toEqual([
      {
        date: '2026-10-03',
        label: 'Oct 3',
        tokensSaved: 6_000,
        dollarsSaved: 0.00445,
        requests: 12
      }
    ]);
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  it.each([
    ['2026-10-11T11:59:30Z', 'just now'],
    ['2026-10-11T11:55:00Z', '5 min ago'],
    ['2026-10-11T11:00:00Z', '1 hour ago'],
    ['2026-10-11T07:00:00Z', '5 hours ago'],
    ['2026-10-09T12:00:00Z', '2 days ago'],
    ['2026-08-01T12:00:00Z', '2 months ago'],
    ['2024-10-01T12:00:00Z', '2 years ago']
  ])('describes %s as %s', (date, expected) => {
    expect(timeAgo(date, now)).toBe(expected);
  });
});

const point = (fields: Partial<ReplayPoint>): ReplayPoint => ({
  requestNumber: 1,
  status: 'completed',
  gcChanged: true,
  exactMatch: false,
  toolCallsMatch: true,
  judgeScore: null,
  judgeCostUsd: 0,
  agreed: null,
  error: null,
  original: null,
  gc: null,
  ...fields
});

describe('replay helpers', () => {
  it('labels each point by its verdict', () => {
    expect(pointVerdict(point({ status: 'failed' }))).toEqual({ label: 'Failed', tone: 'failed' });
    expect(pointVerdict(point({ exactMatch: true, agreed: true, judgeScore: 5 }))).toEqual({
      label: 'Identical',
      tone: 'agree'
    });
    expect(pointVerdict(point({ agreed: true, judgeScore: 4 }))).toEqual({
      label: 'Equivalent, judge 4/5',
      tone: 'agree'
    });
    expect(pointVerdict(point({ agreed: false, judgeScore: 2 }))).toEqual({
      label: 'Different, judge 2/5',
      tone: 'differ'
    });
    expect(pointVerdict(point({}))).toEqual({ label: 'Not judged', tone: 'unknown' });
  });

  it('formats the agreement rate', () => {
    expect(formatAgreement({ rate: 2 / 3 })).toBe('67%');
    expect(formatAgreement({ rate: 1 })).toBe('100%');
    expect(formatAgreement({ rate: null })).toBe('No verdict yet');
  });

  it('measures progress and tells active replays apart', () => {
    expect(replayProgress({ pointsDone: 1, pointsTotal: 3 })).toBe(33);
    expect(replayProgress({ pointsDone: 0, pointsTotal: 0 })).toBe(0);
    expect(isReplayActive('running')).toBe(true);
    expect(isReplayActive('queued')).toBe(true);
    expect(isReplayActive('budget_exceeded')).toBe(false);
  });

  it('toggles request points, sorted and within the limit', () => {
    expect(toggleRequest([2, 9], 5, 5)).toEqual([2, 5, 9]);
    expect(toggleRequest([2, 5, 9], 5, 5)).toEqual([2, 9]);
    expect(toggleRequest([2, 9], 5, 2)).toEqual([2, 9]);
  });
});
