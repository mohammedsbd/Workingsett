import { normalize } from '../tasks/check.js';
import type { SideEffectEntry } from '../tools/side-effect-log.js';

/** Small, explicit statistics for the benchmark report. */

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Sample standard deviation (n - 1); 0 for fewer than two values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1),
  );
}

/** Nearest-rank percentile (p in 0..100); 0 for no values. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/** (base - value) / base, as a fraction; 0 when base is 0. */
export function reduction(base: number, value: number): number {
  return base > 0 ? (base - value) / base : 0;
}

export type Significance = 'significant' | 'not significant' | 'single run';

/**
 * Whether a difference between two arms is larger than their run-to-run
 * spread: |mean A - mean B| must exceed the larger of the two standard
 * deviations. With one run there is no spread to compare against.
 */
export function significance(a: number[], b: number[]): Significance {
  if (a.length < 2 || b.length < 2) return 'single run';
  const diff = Math.abs(mean(a) - mean(b));
  return diff > Math.max(stdev(a), stdev(b))
    ? 'significant'
    : 'not significant';
}

/** Latency of an arm against the full arm (ms). */
export function latencyOverhead(arm: number[], full: number[]) {
  return {
    p50: percentile(arm, 50) - percentile(full, 50),
    p95: percentile(arm, 95) - percentile(full, 95),
  };
}

/**
 * Side-effect safety: an arm's side-effect calls against the full arm's.
 * Each call has an identity (the ticket or question it is for) and a value
 * that must not change:
 *
 * - update_ticket: ticket_id -> status
 * - send_reply: ticket_id (the wording of a reply may differ)
 * - save_report: question_id -> the numbers in the answer (or its text)
 */
export type SideEffectIssue = {
  kind: 'missing' | 'duplicated' | 'changed' | 'extra';
  tool: string;
  target: string;
  expected?: string;
  actual?: string;
};

function identity(entry: SideEffectEntry): { target: string; value: string } {
  const arg = (name: string) => {
    const value = entry.args[name];
    return typeof value === 'string' ? value : JSON.stringify(value ?? '');
  };
  switch (entry.tool) {
    case 'update_ticket':
      return { target: normalize(arg('ticket_id')), value: arg('status') };
    case 'send_reply':
      return { target: normalize(arg('ticket_id')), value: '' };
    case 'save_report': {
      const answer = normalize(arg('answer'));
      const numbers = answer.match(/\d+(\.\d+)?/g);
      return {
        target: normalize(arg('question_id')),
        value: numbers ? numbers.join(' ') : answer.replace(/[^a-z0-9 ]/g, ''),
      };
    }
    default:
      return { target: JSON.stringify(entry.args), value: '' };
  }
}

export function diffSideEffects(
  full: SideEffectEntry[],
  arm: SideEffectEntry[],
): SideEffectIssue[] {
  const group = (entries: SideEffectEntry[]) => {
    const map = new Map<string, string[]>();
    for (const entry of entries) {
      const { target, value } = identity(entry);
      const key = `${entry.tool}\u0000${target}`;
      map.set(key, [...(map.get(key) ?? []), value]);
    }
    return map;
  };
  const expected = group(full);
  const actual = group(arm);
  const issues: SideEffectIssue[] = [];
  const split = (key: string) => {
    const [tool, target] = key.split('\u0000') as [string, string];
    return { tool, target };
  };
  for (const [key, values] of expected) {
    const got = actual.get(key);
    if (!got) {
      issues.push({ kind: 'missing', ...split(key) });
      continue;
    }
    if (got.length > values.length) {
      issues.push({ kind: 'duplicated', ...split(key) });
    }
    const want = values[values.length - 1]!;
    const last = got[got.length - 1]!;
    if (want !== last) {
      issues.push({
        kind: 'changed',
        ...split(key),
        expected: want,
        actual: last,
      });
    }
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) issues.push({ kind: 'extra', ...split(key) });
  }
  return issues;
}
