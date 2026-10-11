import { parsimFetch, queryString } from '@/lib/parsim/client-api';
import type { DailySavings, SavingsSummary } from '@/lib/parsim/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The backend path of a project's savings for the last `days` days. */
export function summaryPath(projectId: string, days: number, now = Date.now()): string {
  return `/projects/${projectId}/dashboard/summary${queryString({
    from: new Date(now - days * DAY_MS).toISOString()
  })}`;
}

export function dailyPath(projectId: string, days: number, now = Date.now()): string {
  return `/projects/${projectId}/dashboard/daily${queryString({
    from: new Date(now - days * DAY_MS).toISOString()
  })}`;
}

export const getSummary = (projectId: string, days: number) =>
  parsimFetch<SavingsSummary>(summaryPath(projectId, days));

export const getDaily = (projectId: string, days: number) =>
  parsimFetch<DailySavings[]>(dailyPath(projectId, days));
