import { describe, expect, it } from 'vitest';
import {
  chartSeries,
  formatPercent,
  formatTokens,
  formatUsd,
  headlineSavings,
  reduction,
  timeAgo
} from './format';
import type { DailySavings, SavingsSummary } from './types';

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
