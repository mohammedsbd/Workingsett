import { queryOptions } from '@tanstack/react-query';
import { getDaily, getSummary } from './service';

export const overviewKeys = {
  all: ['overview'] as const,
  summary: (projectId: string, days: number) =>
    [...overviewKeys.all, projectId, 'summary', days] as const,
  daily: (projectId: string, days: number) =>
    [...overviewKeys.all, projectId, 'daily', days] as const
};

export const summaryQueryOptions = (projectId: string, days: number) =>
  queryOptions({
    queryKey: overviewKeys.summary(projectId, days),
    queryFn: () => getSummary(projectId, days)
  });

export const dailyQueryOptions = (projectId: string, days: number) =>
  queryOptions({
    queryKey: overviewKeys.daily(projectId, days),
    queryFn: () => getDaily(projectId, days)
  });

export const RANGE_OPTIONS = [7, 30, 90] as const;
