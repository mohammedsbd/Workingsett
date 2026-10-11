import type { DailySavings, GcMode, Savings, SavingsSummary } from './types';

/** 950, 12.3k, 4.5M, 1.2B. */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k']
  ];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const scaled = value / size;
      const digits = Math.abs(scaled) >= 100 ? 0 : 1;
      return `${trimZero(scaled.toFixed(digits))}${unit}`;
    }
  }
  return Math.round(value).toString();
}

/**
 * Dollars with sensible precision: cents above $1, four significant
 * digits for small amounts (token costs are often fractions of a cent).
 */
export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  const abs = Math.abs(value);
  if (abs >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    }).format(value);
  }
  if (abs < 0.0001) return value < 0 ? '-<$0.0001' : '<$0.0001';
  return `${value < 0 ? '-' : ''}$${trimZero(abs.toPrecision(3))}`;
}

/** A 0 to 1 fraction as a percentage, one decimal under 10%. */
export function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent === 0) return '0%';
  return `${trimZero(percent.toFixed(Math.abs(percent) < 10 ? 1 : 0))}%`;
}

function trimZero(text: string): string {
  return text.includes('.') && !text.includes('e') ? text.replace(/\.?0+$/, '') : text;
}

/** The share of tokens the GC removed, 0 to 1. */
export function reduction(tokensBefore: number, tokensAfter: number): number {
  if (tokensBefore <= 0) return 0;
  return Math.max(0, Math.min(1, (tokensBefore - tokensAfter) / tokensBefore));
}

/**
 * The savings to headline for a project: in shadow mode what the GC would
 * have saved (estimates), otherwise what it saved. When a project was
 * switched during the range, both are added.
 */
export function headlineSavings(summary: Pick<SavingsSummary, 'mode' | 'gc'>): Savings & {
  estimated: boolean;
} {
  const { applied, estimated } = summary.gc;
  if (summary.mode === 'shadow') {
    return { ...estimated, estimated: true };
  }
  if (summary.mode === 'on') {
    return {
      tokensSaved: applied.tokensSaved + estimated.tokensSaved,
      dollarsSaved: applied.dollarsSaved + estimated.dollarsSaved,
      estimated: applied.tokensSaved === 0 && estimated.tokensSaved > 0
    };
  }
  return { tokensSaved: 0, dollarsSaved: 0, estimated: false };
}

export type ChartPoint = {
  date: string;
  /** Short label for the x axis, for example "Oct 3". */
  label: string;
  tokensSaved: number;
  dollarsSaved: number;
  requests: number;
};

/** Daily rows as chart points, with applied and estimated savings summed. */
export function chartSeries(days: DailySavings[]): ChartPoint[] {
  return days.map((day) => ({
    date: day.date,
    label: new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }),
    tokensSaved: day.applied.tokensSaved + day.estimated.tokensSaved,
    dollarsSaved: roundUsd(day.applied.dollarsSaved + day.estimated.dollarsSaved),
    requests: day.requests
  }));
}

const roundUsd = (value: number) => Math.round(value * 1e6) / 1e6;

export const GC_MODE_LABELS: Record<GcMode, string> = {
  off: 'Off',
  shadow: 'Shadow',
  on: 'On'
};

export const REASON_LABELS = {
  duplicate: 'Duplicate',
  superseded: 'Superseded',
  stale_large: 'Archived (large and old)'
} as const;

/** Relative time, for example "3 min ago", "2 days ago". */
export function timeAgo(date: string | Date, now = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, 'year'],
    [60 * 60 * 24 * 30, 'month'],
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'min']
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${unit}${count === 1 || unit === 'min' ? '' : 's'} ago`;
    }
  }
  return 'just now';
}
